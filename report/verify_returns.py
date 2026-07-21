"""对数据快照和分红/复权口径执行可重复校核。"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from analysis import build_index_level, build_repo_level, build_stock_level, simulate_level_dca
from data_fetch import STOCKS


REPORT_DIR = Path(__file__).resolve().parent
DATA_DIR = REPORT_DIR / "data"


def main():
    prices = pd.read_csv(DATA_DIR / "stock_prices.csv", parse_dates=["date"])
    dividends = pd.read_csv(DATA_DIR / "dividends.csv", parse_dates=["date"])
    indices = pd.read_csv(DATA_DIR / "csi_indices.csv", parse_dates=["date"])
    repo = pd.read_csv(DATA_DIR / "repo_204001.csv", parse_dates=["date"])

    checks = []
    for code, name in STOCKS.items():
        stock_prices = prices[prices["code"].astype(str).str.zfill(6) == code]
        stock_dividends = dividends[dividends["code"].astype(str).str.zfill(6) == code]
        if stock_prices.empty or (stock_prices["close"] <= 0).any():
            raise AssertionError(f"{name} 不复权价格缺失或包含非正数")
        if stock_dividends.empty or not (stock_dividends["cash_dividend_per_share"] > 0).any():
            raise AssertionError(f"{name} 没有有效现金分红事件")

        total_level = build_stock_level(stock_prices, stock_dividends, True)
        price_level = build_stock_level(stock_prices, stock_dividends, False)
        total_daily, total_summary = simulate_level_dca(total_level, "2020-01", "2026-07")
        _, price_summary = simulate_level_dca(price_level, "2020-01", "2026-07")
        nav_error = float(
            (total_daily["asset_nav"] - total_daily["strategy_nav"]).abs().max()
        )
        if nav_error > 1e-10:
            raise AssertionError(f"{name} 总回报净值与策略净值不一致: {nav_error}")
        if total_summary["xirr_pct"] <= price_summary["xirr_pct"]:
            raise AssertionError(f"{name} 分红再投资没有提高固定样本XIRR")

        checks.append({
            "asset": name,
            "price_rows": len(stock_prices),
            "dividend_events": len(stock_dividends),
            "price_only_xirr_pct": price_summary["xirr_pct"],
            "total_return_xirr_pct": total_summary["xirr_pct"],
            "nav_identity_max_error": nav_error,
        })

    for total_code, price_code, name in [
        ("H00300", "000300", "沪深300"),
        ("H00905", "000905", "中证500"),
    ]:
        total_level = build_index_level(indices[indices["code"] == total_code])
        price_level = build_index_level(indices[indices["code"] == price_code])
        _, total_summary = simulate_level_dca(total_level, "2020-01", "2026-07")
        _, price_summary = simulate_level_dca(price_level, "2020-01", "2026-07")
        if total_summary["xirr_pct"] <= price_summary["xirr_pct"]:
            raise AssertionError(f"{name}官方全收益指数未高于价格指数")
        checks.append({
            "asset": name,
            "price_rows": len(price_level),
            "dividend_events": "官方全收益指数内含",
            "price_only_xirr_pct": price_summary["xirr_pct"],
            "total_return_xirr_pct": total_summary["xirr_pct"],
            "nav_identity_max_error": 0.0,
        })

    repo_level = build_repo_level(repo)
    if repo_level.index.min() > pd.Timestamp("2020-01-02"):
        raise AssertionError("逆回购数据不能完整覆盖固定样本")
    if not repo_level.is_monotonic_increasing:
        raise AssertionError("非负定盘利率构造的逆回购净值不应下降")

    result = {
        "status": "passed",
        "fixed_sample": "2020-01 to 2026-07",
        "checks": checks,
        "repo": {
            "start": repo_level.index.min().strftime("%Y-%m-%d"),
            "end": repo_level.index.max().strftime("%Y-%m-%d"),
            "rows": len(repo_level),
            "assumption": "前一交易日204001定盘利率按实际日历天数计息至下一交易日",
        },
        "adjustment_policy": (
            "银行使用不复权价格加显式税前分红再投资；指数使用官方全收益指数；"
            "不使用前复权价格作为历史买入价。"
        ),
    }
    (DATA_DIR / "verification.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
