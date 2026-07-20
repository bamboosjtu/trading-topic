"""
lab2_rolling.py — 四大行定投滚动回测

针对工商、建设、农业、中国四大行，分别模拟 3年/5年/10年 定投，
滚动所有可能的入市月份，找出年化收益率(XIRR)最高和最低的入市时机。

用法：
  python lab-scripts/lab2_rolling.py
"""
import sys
import os
import time
import numpy as np
import pandas as pd
from mootdx.quotes import Quotes

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from lab2_etf import calc_xirr, safe_call

# ── 配置 ─────────────────────────────────────────────────────
MONTHLY_AMOUNT = 3000
HOLDING_PERIODS = [3, 5, 10]          # 定投年数
BIG_FOUR = {
    "601398": "工商银行",
    "601939": "建设银行",
    "601288": "农业银行",
    "601988": "中国银行",
}
BATCH_SIZE = 800                      # mootdx 单次最大 bar 数
MAX_BATCHES = 6                       # 最多拉 6 批 (覆盖 ~4800 根 ≈ 19 年)

tdx = Quotes.factory(market="std")


# ============================================================
# 1. 获取扩展历史数据（尽可能多拉）
# ============================================================
def fetch_extended_history(code):
    """拉取尽可能长的前复权日线，最多试 6 批 (每批 800)"""
    frames = []
    for batch_start in [0, 800, 1600, 2400, 3200, 4000]:
        time.sleep(0.3)
        bars = safe_call(
            tdx.bars, f"{code} K线 batch{batch_start//800+1}",
            symbol=code, frequency=9, start=batch_start, offset=BATCH_SIZE,
            retries=2, delay=1.5,
        )
        if bars is not None and len(bars) > 0:
            frames.append(bars)
            if len(bars) < BATCH_SIZE:
                break
        else:
            break
    if not frames:
        return None
    df = pd.concat(frames, axis=0)
    df = df[~df.index.duplicated(keep="first")].sort_index()
    return df


# ============================================================
# 2. 定投模拟（指定起止月份）
# ============================================================
def simulate_dca_range(df, start_ym, end_ym):
    """
    在指定月份范围内模拟每月定投。
    start_ym, end_ym: pd.Period('2020-01', 'M') 格式
    返回: (summary_dict, monthly_records)
    """
    df = df.copy().sort_index()

    # 找到每个 (年, 月) 的第一个交易日
    first_day_map = {}
    for idx in df.index:
        key = (idx.year, idx.month)
        if key not in first_day_map:
            first_day_map[key] = idx

    # 筛选投资月份
    invest_dates = {}
    for (y, m), dt in sorted(first_day_map.items()):
        ym = pd.Period(f"{y}-{m:02d}", "M")
        if start_ym <= ym <= end_ym:
            invest_dates[dt] = float(df.loc[dt, "收盘"])

    if not invest_dates:
        return None, None

    invest_sorted = sorted(invest_dates.keys())

    # 累加份额
    total_shares = 0.0
    total_invested = 0.0
    monthly_records = []
    for dt in invest_sorted:
        price = invest_dates[dt]
        shares_bought = MONTHLY_AMOUNT / price
        total_shares += shares_bought
        total_invested += MONTHLY_AMOUNT
        monthly_records.append({
            "date": dt, "price": price,
            "total_shares": total_shares,
            "total_invested": total_invested,
        })

    # 每日市值（从首次定投到最后交易日）
    first_dt = invest_sorted[0]
    last_dt = df.index[-1]
    daily_sub = df.loc[first_dt:last_dt][["收盘"]].copy()
    daily_sub["total_shares"] = 0.0
    daily_sub["total_invested"] = 0.0

    for i, dt in enumerate(invest_sorted):
        shares_now = monthly_records[i]["total_shares"]
        invested_now = monthly_records[i]["total_invested"]
        daily_sub.loc[dt:, "total_shares"] = shares_now
        daily_sub.loc[dt:, "total_invested"] = invested_now

    daily_sub["portfolio_value"] = daily_sub["total_shares"] * daily_sub["收盘"]
    daily_sub["peak"] = daily_sub["portfolio_value"].cummax()
    daily_sub["drawdown"] = (daily_sub["portfolio_value"] - daily_sub["peak"]) / daily_sub["peak"]

    final_value = float(daily_sub["portfolio_value"].iloc[-1])
    total_months = len(monthly_records)
    max_dd = float(daily_sub["drawdown"].min())
    years = (daily_sub.index[-1] - daily_sub.index[0]).total_seconds() / (365.25 * 86400)

    # XIRR
    cf = [-MONTHLY_AMOUNT] * total_months + [final_value]
    cf_dates = [dt for dt in invest_sorted] + [daily_sub.index[-1]]
    xirr = calc_xirr(cf, cf_dates)

    return {
        "total_months": total_months,
        "total_invested": round(total_invested, 2),
        "final_value": round(final_value, 2),
        "total_return_pct": round((final_value - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
        "xirr_pct": round(xirr * 100, 2) if not np.isnan(xirr) else None,
        "max_dd_pct": round(max_dd * 100, 2),
        "start_date": str(invest_sorted[0].strftime("%Y-%m-%d")),
        "end_date": str(daily_sub.index[-1].strftime("%Y-%m-%d")),
        "years": round(years, 2),
    }, monthly_records


# ============================================================
# 3. 滚动回测
# ============================================================
def rolling_backtest(code, name, df, holding_years):
    """
    对一只股票滚动所有可能的入市月份，返回每种入市月份的 XIRR。

    定投期限：从入市月起，每月定投，持续 holding_years 年。
    估值日：数据最后交易日（模拟持有到期）。
    """
    # 确定可用的时间范围
    df_sorted = df.sort_index()
    first_date = df_sorted.index[0]
    last_date = df_sorted.index[-1]

    # 按月份生成所有可能的入市起点
    available_months = pd.period_range(
        start=first_date.to_period("M"),
        end=last_date.to_period("M"),
        freq="M"
    )

    results = []
    for start_ym in available_months:
        end_ym = start_ym + holding_years * 12 - 1  # 定投 N 年 = N*12 期

        # 确保结束月份在数据范围内
        if end_ym > last_date.to_period("M"):
            continue

        summary, _ = simulate_dca_range(df, start_ym, end_ym)
        if summary is None or summary["xirr_pct"] is None:
            continue

        results.append({
            "entry_ym": str(start_ym),        # e.g. "2020-01"
            "entry_date": summary["start_date"],
            "exit_date": summary["end_date"],
            "months": summary["total_months"],
            "invested": summary["total_invested"],
            "final_value": summary["final_value"],
            "total_return": summary["total_return_pct"],
            "xirr": summary["xirr_pct"],
            "max_dd": summary["max_dd_pct"],
        })

    return results


# ============================================================
# 4. 主流程
# ============================================================
def main():
    # 用于汇总所有结果
    all_best = []   # 各期限 × 各银行的最佳
    all_worst = []  # 各期限 × 各银行的最差

    for code, name in BIG_FOUR.items():
        print(f"\n{'=' * 70}")
        print(f"  {name}({code})")
        print(f"{'=' * 70}")

        # 获取数据
        print(f"  -> 获取历史日线...")
        df = fetch_extended_history(code)
        if df is None or df.empty:
            print(f"  [!] 数据获取失败，跳过")
            continue

        data_start = df.index[0].strftime("%Y-%m-%d")
        data_end = df.index[-1].strftime("%Y-%m-%d")
        data_years = (df.index[-1] - df.index[0]).days / 365.25
        print(f"  [OK] {len(df)} 根日线, {data_start} -> {data_end} ({data_years:.1f} 年)")

        row_data = {}

        for hold_years in HOLDING_PERIODS:
            print(f"\n  --- 定投 {hold_years} 年 ---")
            results = rolling_backtest(code, name, df, hold_years)

            if not results:
                print(f"    数据不足，无有效回测")
                continue

            df_r = pd.DataFrame(results)
            best = df_r.loc[df_r["xirr"].idxmax()]
            worst = df_r.loc[df_r["xirr"].idxmin()]

            print(f"    共 {len(df_r)} 个入市窗口")
            print(f"    最佳入市: {best['entry_ym']}  定投 {best['months']} 月  "
                  f"XIRR={best['xirr']:+.1f}%  回撤={best['max_dd']:.1f}%  "
                  f"终值={best['final_value']:,.0f}")
            print(f"    最差入市: {worst['entry_ym']}  定投 {worst['months']} 月  "
                  f"XIRR={worst['xirr']:+.1f}%  回撤={worst['max_dd']:.1f}%  "
                  f"终值={worst['final_value']:,.0f}")

            all_best.append({
                "银行": name,
                "代码": code,
                "定投年数": hold_years,
                "最佳入市": best["entry_ym"],
                "最佳XIRR": best["xirr"],
                "最佳回撤": best["max_dd"],
                "最佳终值": best["final_value"],
            })
            all_worst.append({
                "银行": name,
                "代码": code,
                "定投年数": hold_years,
                "最差入市": worst["entry_ym"],
                "最差XIRR": worst["xirr"],
                "最差回撤": worst["max_dd"],
                "最差终值": worst["final_value"],
            })
            row_data[hold_years] = {"best": best, "worst": worst, "count": len(df_r)}

    # ── 汇总表 ──────────────────────────────────────────────
    print(f"\n\n{'=' * 90}")
    print(f"  四大行定投滚动回测汇总")
    print(f"{'=' * 90}")

    df_best = pd.DataFrame(all_best)
    df_worst = pd.DataFrame(all_worst)

    # 按期限分别展示
    for hold_years in HOLDING_PERIODS:
        print(f"\n  【定投 {hold_years} 年】")
        sub = df_best[df_best["定投年数"] == hold_years].copy()
        sub = sub.sort_values("最佳XIRR", ascending=False)
        sub["最佳XIRR"] = sub["最佳XIRR"].apply(lambda x: f"{x:+.1f}%")
        sub["最佳回撤"] = sub["最佳回撤"].apply(lambda x: f"{x:.1f}%")
        sub["最佳终值"] = sub["最佳终值"].apply(lambda x: f"{x:,.0f}")
        print(sub.to_string(index=False))

        # 该期限下四大行最佳/最差的极值
        best_of_best = sub.iloc[0]
        print(f"  -> 该期限最高 XIRR: {best_of_best['最佳XIRR']} "
              f"({best_of_best['银行']} 入市:{best_of_best['最佳入市']})")

        sub_w = df_worst[df_worst["定投年数"] == hold_years].copy()
        sub_w = sub_w.sort_values("最差XIRR")
        sub_w["最差XIRR"] = sub_w["最差XIRR"].apply(lambda x: f"{x:+.1f}%")
        sub_w["最差回撤"] = sub_w["最差回撤"].apply(lambda x: f"{x:.1f}%")
        sub_w["最差终值"] = sub_w["最差终值"].apply(lambda x: f"{x:,.0f}")
        worst_of_worst = sub_w.iloc[0]
        print(f"  -> 该期限最低 XIRR: {worst_of_worst['最差XIRR']} "
              f"({worst_of_worst['银行']} 入市:{worst_of_worst['最差入市']})")


if __name__ == "__main__":
    main()
