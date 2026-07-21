"""从 report/data 快照重算全部指标、图表和 Markdown 报告。"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd

from analysis import (
    build_index_level,
    build_repo_level,
    build_stock_level,
    rolling_backtest,
    simulate_level_dca,
)
from data_fetch import CSI_INDICES, STOCKS


REPORT_DIR = Path(__file__).resolve().parent
DATA_DIR = REPORT_DIR / "data"
START_YM = "2020-01"
END_YM = "2026-07"
HOLDING_YEARS = [3, 5, 10]

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

BENCHMARKS = {
    "REPO": "国债逆回购GC001代理",
    "H00300": "沪深300全收益",
    "H00905": "中证500全收益",
}

COLORS = {
    "big_four": "#3366AA",
    "joint_stock": "#D9822B",
    "equity_benchmark": "#6B7C85",
    "repo": "#7A6F52",
}


def load_snapshot():
    required = [
        "stock_prices.csv",
        "dividends.csv",
        "csi_indices.csv",
        "repo_204001.csv",
        "manifest.json",
    ]
    missing = [name for name in required if not (DATA_DIR / name).exists()]
    if missing:
        raise FileNotFoundError(
            f"缺少数据快照 {missing}；请先运行 python report/data_fetch.py"
        )

    stocks = pd.read_csv(DATA_DIR / "stock_prices.csv", parse_dates=["date"])
    dividends = pd.read_csv(DATA_DIR / "dividends.csv", parse_dates=["date"])
    indices = pd.read_csv(DATA_DIR / "csi_indices.csv", parse_dates=["date"])
    repo = pd.read_csv(DATA_DIR / "repo_204001.csv", parse_dates=["date"])
    manifest = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    return stocks, dividends, indices, repo, manifest


def build_levels(stocks, dividends, indices, repo):
    levels = {}
    price_only_levels = {}
    meta = {}

    big_four = {"601398", "601939", "601288", "601988"}
    bank_colors = {
        "601398": "#1F77B4",
        "601939": "#2F5597",
        "601288": "#4C8C4A",
        "601988": "#8C6D31",
        "600036": "#D9822B",
        "601166": "#B05A3C",
        "600016": "#C06C84",
    }
    for code, name in STOCKS.items():
        price_rows = stocks[stocks["code"].astype(str).str.zfill(6) == code]
        dividend_rows = dividends[dividends["code"].astype(str).str.zfill(6) == code]
        levels[code] = build_stock_level(price_rows, dividend_rows, True)
        price_only_levels[code] = build_stock_level(price_rows, dividend_rows, False)
        meta[code] = {
            "name": name,
            "category": "四大行" if code in big_four else "股份行",
            "color": bank_colors[code],
        }

    for code in ["H00300", "H00905", "000300", "000905"]:
        rows = indices[indices["code"] == code]
        levels[code] = build_index_level(rows)

    price_only_levels["H00300"] = levels["000300"]
    price_only_levels["H00905"] = levels["000905"]
    meta["H00300"] = {
        "name": "沪深300全收益",
        "category": "权益基准",
        "color": COLORS["equity_benchmark"],
    }
    meta["H00905"] = {
        "name": "中证500全收益",
        "category": "权益基准",
        "color": "#8B98A1",
    }

    levels["REPO"] = build_repo_level(repo)
    meta["REPO"] = {
        "name": "国债逆回购GC001代理",
        "category": "现金基准",
        "color": COLORS["repo"],
    }
    return levels, price_only_levels, meta


def fixed_backtests(levels, meta):
    rows = []
    daily_results = {}
    ordered_codes = ["REPO", "H00300", "H00905", *STOCKS.keys()]
    for code in ordered_codes:
        daily, summary = simulate_level_dca(levels[code], START_YM, END_YM)
        if summary is None:
            continue
        daily_results[code] = daily
        rows.append({
            "code": code,
            "name": meta[code]["name"],
            "category": meta[code]["category"],
            **summary,
        })
    return pd.DataFrame(rows), daily_results


def dividend_audit(levels, price_only_levels, meta):
    rows = []
    for code in [*STOCKS.keys(), "H00300", "H00905"]:
        _, total_summary = simulate_level_dca(levels[code], START_YM, END_YM)
        _, price_summary = simulate_level_dca(price_only_levels[code], START_YM, END_YM)
        rows.append({
            "code": code,
            "name": meta[code]["name"],
            "total_return_xirr_pct": total_summary["xirr_pct"],
            "price_only_xirr_pct": price_summary["xirr_pct"],
            "dividend_uplift_pct_points": (
                total_summary["xirr_pct"] - price_summary["xirr_pct"]
            ),
            "total_return_end_ratio": (
                levels[code].loc[:pd.Timestamp("2026-07-20")].iloc[-1]
                / levels[code].loc[pd.Timestamp("2020-01-01"):].iloc[0]
            ),
            "price_only_end_ratio": (
                price_only_levels[code].loc[:pd.Timestamp("2026-07-20")].iloc[-1]
                / price_only_levels[code].loc[pd.Timestamp("2020-01-01"):].iloc[0]
            ),
        })
    return pd.DataFrame(rows)


def rolling_comparisons(levels, meta):
    rolling = {}
    for code in [*STOCKS.keys(), "REPO", "H00300", "H00905"]:
        for years in HOLDING_YEARS:
            frame = rolling_backtest(levels[code], years)
            frame["code"] = code
            frame["name"] = meta[code]["name"]
            rolling[(code, years)] = frame

    rows = []
    for code, name in STOCKS.items():
        for years in HOLDING_YEARS:
            bank = rolling[(code, years)]
            row = {
                "code": code,
                "name": name,
                "holding_years": years,
                "windows": len(bank),
                "positive_pct": (bank["xirr_pct"] > 0).mean() * 100.0,
                "best_xirr_pct": bank["xirr_pct"].max(),
                "worst_xirr_pct": bank["xirr_pct"].min(),
            }
            for benchmark_code, column in [
                ("REPO", "beat_repo_pct"),
                ("H00300", "beat_csi300_pct"),
                ("H00905", "beat_csi500_pct"),
            ]:
                benchmark = rolling[(benchmark_code, years)][["start_ym", "xirr_pct"]]
                benchmark = benchmark.rename(columns={"xirr_pct": "benchmark_xirr"})
                matched = bank[["start_ym", "xirr_pct"]].merge(
                    benchmark, on="start_ym", how="inner"
                )
                # 少于 12 个可比起点时不报告“胜率”，避免把 2 个高度重叠的
                # 十年窗口包装成稳定概率。
                row[column] = (
                    (matched["xirr_pct"] > matched["benchmark_xirr"]).mean() * 100.0
                    if len(matched) >= 12
                    else np.nan
                )
                row[column.replace("_pct", "_windows")] = len(matched)
            rows.append(row)
    return pd.DataFrame(rows), rolling


def save_tables(fixed, audit, rolling_summary):
    fixed.to_csv(DATA_DIR / "fixed_backtest_results.csv", index=False, encoding="utf-8-sig")
    audit.to_csv(DATA_DIR / "dividend_audit.csv", index=False, encoding="utf-8-sig")
    rolling_summary.to_csv(
        DATA_DIR / "rolling_comparison_summary.csv", index=False, encoding="utf-8-sig"
    )


def chart_fixed_xirr(fixed, meta):
    plot = fixed.sort_values("xirr_pct")
    colors = [meta[code]["color"] for code in plot["code"]]
    fig, ax = plt.subplots(figsize=(12, 7))
    bars = ax.barh(plot["name"], plot["xirr_pct"], color=colors, alpha=0.9)
    ax.axvline(0, color="#333333", linewidth=0.8)
    ax.bar_label(bars, labels=[f"{value:+.1f}%" for value in plot["xirr_pct"]], padding=4)
    ax.set_title("固定样本定投 XIRR（2020-01 至 2026-07）", fontsize=15, fontweight="bold")
    ax.set_xlabel("年化收益率 XIRR (%)")
    ax.grid(axis="x", alpha=0.25)
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "chart1_fixed_xirr.png", dpi=170, bbox_inches="tight")
    plt.close()


def chart_total_return_levels(levels, meta):
    fig, axes = plt.subplots(2, 1, figsize=(14, 11), sharex=True)
    bank_line_styles = {
        "601398": "-",
        "601939": "--",
        "601288": "-.",
        "601988": ":",
        "600036": "-",
        "601166": "--",
        "600016": "-.",
    }
    for code in STOCKS:
        series = levels[code].loc["2020-01-01":"2026-07-20"]
        normalized = series / series.iloc[0] * 100.0
        axes[0].plot(
            normalized.index,
            normalized,
            label=meta[code]["name"],
            linewidth=1.5,
            color=meta[code]["color"],
            linestyle=bank_line_styles[code],
            alpha=0.9,
        )
    axes[0].set_title("七家银行含分红总回报指数", fontsize=13, fontweight="bold")
    axes[0].legend(ncol=4, fontsize=8)

    benchmark_line_styles = {"H00300": "-", "H00905": "--", "REPO": ":"}
    for code in ["H00300", "H00905", "REPO"]:
        series = levels[code].loc["2020-01-01":"2026-07-20"]
        normalized = series / series.iloc[0] * 100.0
        axes[1].plot(
            normalized.index,
            normalized,
            label=meta[code]["name"],
            linewidth=1.6,
            color=meta[code]["color"],
            linestyle=benchmark_line_styles[code],
        )
    axes[1].set_title("三类基础基准", fontsize=13, fontweight="bold")
    axes[1].legend(fontsize=9)
    axes[1].set_xlabel("日期")

    for ax in axes:
        ax.axhline(100, color="#777777", linestyle=":", linewidth=0.8)
        ax.set_ylabel("总回报指数（起点=100）")
        ax.grid(alpha=0.25)
    fig.suptitle("银行股与基础基准的总回报路径", fontsize=16, fontweight="bold")
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "chart2_total_return_levels.png", dpi=170, bbox_inches="tight")
    plt.close()


def chart_risk(fixed, meta):
    plot = fixed.sort_values("strategy_max_drawdown_pct")
    y = np.arange(len(plot))
    fig, ax = plt.subplots(figsize=(12, 7))
    strategy_bars = ax.barh(
        y - 0.18,
        plot["strategy_max_drawdown_pct"],
        height=0.34,
        label="现金流调整后策略净值回撤",
        color="#466C8B",
    )
    principal_bars = ax.barh(
        y + 0.18,
        plot["max_principal_loss_pct"],
        height=0.34,
        label="账户相对本金最大浮亏",
        color="#D38B5D",
    )
    ax.bar_label(
        strategy_bars,
        labels=[f"{value:.1f}%" for value in plot["strategy_max_drawdown_pct"]],
        padding=3,
        fontsize=8,
    )
    ax.bar_label(
        principal_bars,
        labels=[f"{value:.1f}%" for value in plot["max_principal_loss_pct"]],
        padding=3,
        fontsize=8,
    )
    ax.set_yticks(y, plot["name"])
    ax.axvline(0, color="#333333", linewidth=0.8)
    ax.set_title("固定样本的两类投资者风险口径", fontsize=15, fontweight="bold")
    ax.set_xlabel("百分比 (%)")
    ax.legend()
    ax.grid(axis="x", alpha=0.25)
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "chart3_risk_comparison.png", dpi=170, bbox_inches="tight")
    plt.close()


def chart_dividend_audit(audit):
    plot = audit.copy()
    x = np.arange(len(plot))
    fig, ax = plt.subplots(figsize=(13, 7))
    ax.bar(
        x - 0.2,
        plot["price_only_xirr_pct"],
        width=0.38,
        label="价格口径（不含现金分红）",
        color="#A9B3BA",
    )
    ax.bar(
        x + 0.2,
        plot["total_return_xirr_pct"],
        width=0.38,
        label="总回报口径（分红再投资）",
        color="#D9822B",
    )
    ax.set_xticks(x, plot["name"], rotation=25, ha="right")
    ax.axhline(0, color="#333333", linewidth=0.8)
    ax.set_title("分红与复权口径对定投 XIRR 的影响", fontsize=15, fontweight="bold")
    ax.set_ylabel("XIRR (%)")
    ax.legend()
    ax.grid(axis="y", alpha=0.25)
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "chart4_dividend_impact.png", dpi=170, bbox_inches="tight")
    plt.close()


def chart_rolling_success(rolling_summary):
    plot = rolling_summary.copy()
    plot["label"] = plot["name"] + "·" + plot["holding_years"].astype(str) + "年"
    columns = ["positive_pct", "beat_repo_pct", "beat_csi300_pct", "beat_csi500_pct"]
    matrix = plot[columns].to_numpy(dtype=float)
    fig, ax = plt.subplots(figsize=(11, 11))
    image = ax.imshow(matrix, vmin=0, vmax=100, cmap="Blues", aspect="auto")
    ax.set_yticks(np.arange(len(plot)), plot["label"], fontsize=8)
    ax.set_xticks(
        np.arange(len(columns)),
        ["XIRR为正", "跑赢逆回购", "跑赢沪深300", "跑赢中证500"],
    )
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            value = matrix[row, column]
            label = "N/A" if np.isnan(value) else f"{value:.0f}%"
            ax.text(
                column,
                row,
                label,
                ha="center",
                va="center",
                color="white" if not np.isnan(value) and value >= 60 else "#222222",
                fontsize=8,
            )
    ax.set_title("滚动窗口成功率与基准胜率", fontsize=15, fontweight="bold")
    fig.colorbar(image, ax=ax, label="窗口占比 (%)")
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "chart5_rolling_success.png", dpi=170, bbox_inches="tight")
    plt.close()


def format_pct(value, digits=1):
    return "N/A" if pd.isna(value) else f"{value:+.{digits}f}%"


def format_rate(value):
    return "N/A" if pd.isna(value) else f"{value:.0f}%"


def build_markdown(fixed, audit, rolling_summary, manifest):
    fixed_lookup = fixed.set_index("code")
    bank_fixed = fixed[fixed["code"].isin(STOCKS)].copy()
    repo_xirr = fixed_lookup.loc["REPO", "xirr_pct"]
    csi300_xirr = fixed_lookup.loc["H00300", "xirr_pct"]
    csi500_xirr = fixed_lookup.loc["H00905", "xirr_pct"]
    beat_repo = int((bank_fixed["xirr_pct"] > repo_xirr).sum())
    beat_csi300 = int((bank_fixed["xirr_pct"] > csi300_xirr).sum())
    beat_csi500 = int((bank_fixed["xirr_pct"] > csi500_xirr).sum())

    fixed_rows = []
    for code in ["REPO", "H00300", "H00905", *STOCKS.keys()]:
        row = fixed_lookup.loc[code]
        fixed_rows.append(
            f"| {row['name']} | {row['category']} | {int(row['periods'])} | "
            f"{row['final_value']:,.0f} | {format_pct(row['xirr_pct'])} | "
            f"{format_pct(row['max_principal_loss_pct'])} | "
            f"{format_pct(row['asset_max_drawdown_pct'])} | "
            f"{format_pct(row['strategy_max_drawdown_pct'])} |"
        )

    audit_rows = []
    for row in audit.itertuples(index=False):
        audit_rows.append(
            f"| {row.name} | {format_pct(row.price_only_xirr_pct)} | "
            f"{format_pct(row.total_return_xirr_pct)} | "
            f"{row.dividend_uplift_pct_points:+.1f} 个百分点 |"
        )

    rolling_rows = []
    for row in rolling_summary.itertuples(index=False):
        rolling_rows.append(
            f"| {row.name} | {row.holding_years}年 | {row.windows} | "
            f"{format_rate(row.positive_pct)} | {format_rate(row.beat_repo_pct)} "
            f"({row.beat_repo_windows}) | {format_rate(row.beat_csi300_pct)} | "
            f"{format_rate(row.beat_csi500_pct)} | {format_pct(row.worst_xirr_pct)} |"
        )

    markdown = f"""# 七家银行定投与三类基础基准回测报告

> **固定样本**：2020-01 至 2026-07，每月第一个可交易日投入 3,000 元
> **银行范围**：工商、建设、农业、中国、招商、兴业、民生
> **基础基准**：国债逆回购 GC001 代理、沪深300全收益、中证500全收益
> **数据截止**：{manifest['data_end'][:4]}-{manifest['data_end'][4:6]}-{manifest['data_end'][6:]}

---

## 一、结论先行

固定样本内，**{beat_repo}/7** 家银行跑赢国债逆回购代理，其中 **{beat_csi300}/7** 跑赢沪深300全收益、**{beat_csi500}/7** 跑赢中证500全收益。但固定起止点不能证明长期稳定超额收益，是否“稳定跑赢”应以滚动窗口的同起点、同终点比较为准。

国债逆回购代理的固定样本 XIRR 为 **{repo_xirr:.1f}%**，沪深300全收益为 **{csi300_xirr:.1f}%**，中证500全收益为 **{csi500_xirr:.1f}%**。银行结果必须在这三个基准之上分别解释：逆回购衡量低风险资金机会成本，两类全收益指数衡量承担股票市场风险后的替代收益。

---

## 二、基准与收益口径

- **国债逆回购**：采用上交所 204001 一天期回购定盘利率作为 GC001 的可复核代理，按相邻交易日之间的实际日历天数计息并连续滚动。它不是个人账户的实际成交价，未计手续费与成交偏差。
- **沪深300**：使用中证官方全收益指数 `H00300`，而不是仅反映价格变化的 `000300`。
- **中证500**：使用中证官方全收益指数 `H00905`，而不是仅反映价格变化的 `000905`。
- **银行股**：使用不复权收盘价；现金分红按除权日税前每股派息计算，并在除权日收盘立即再投资；送股和转增按每股比例增加份额。

这种处理避免把长期高分红股票的加法前复权价格误当作可交易价格。前复权序列可能接近零甚至为负，不能直接用于跨越多年、包含多笔外部现金流的定投买入。

---

## 三、固定样本结果

![固定样本XIRR](chart1_fixed_xirr.png)

| 标的 | 类别 | 期数 | 最终市值（元） | XIRR | 本金最大浮亏 | 标的总回报最大回撤 | 策略净值最大回撤 |
|---|---|---:|---:|---:|---:|---:|---:|
{chr(10).join(fixed_rows)}

三个口径分别回答不同问题：账户相对本金最大浮亏回答“最差时比累计投入亏多少”；标的总回报最大回撤回答“含分红的标的净值从高点跌了多少”；策略净值最大回撤先剔除每笔新增本金，再衡量策略单位净值从高点跌了多少。当前模型始终满仓、允许碎股且不保留现金，因此后两列数值相同；这是模型条件下的结果相等，不是把两种定义混用。

![总回报路径](chart2_total_return_levels.png)

---

## 四、分红再投资与复权校核

![分红影响](chart4_dividend_impact.png)

| 标的 | 价格口径 XIRR | 总回报口径 XIRR | 分红贡献 |
|---|---:|---:|---:|
{chr(10).join(audit_rows)}

校核方法：银行股分别用“不复权价格、不计现金分红”和“不复权价格、显式分红再投资”重算；沪深300和中证500分别比较价格指数与官方全收益指数。同一只资产满仓、允许碎股且全部资金立即投入时，标的总回报净值与现金流调整后的策略净值应重合，测试要求最大误差不超过 `1e-10`。

---

## 五、风险比较

![风险比较](chart3_risk_comparison.png)

逆回购代理净值按非负定盘利率连续累积，因此模型回撤为 0；这不代表逆回购绝对无风险，实际仍有交易规则、成交利率、资金可用时间和操作风险。股票类基准及银行股的回撤均来自含分红总回报净值。

---

## 六、滚动窗口与基准胜率

![滚动窗口胜率](chart5_rolling_success.png)

| 银行 | 期限 | 银行窗口数 | XIRR为正 | 跑赢逆回购（可比窗） | 跑赢沪深300 | 跑赢中证500 | 最差XIRR |
|---|---:|---:|---:|---:|---:|---:|---:|
{chr(10).join(rolling_rows)}

每个窗口连续投入 `期限 × 12` 期，并在自己的结束月估值。逆回购官方接口当前实际返回的数据始于 {manifest.get('repo_start_actual', '20160726')[:4]}-{manifest.get('repo_start_actual', '20160726')[4:6]}-{manifest.get('repo_start_actual', '20160726')[6:]}，因此较早银行窗口没有逆回购可比值；括号内为真正参与比较的窗口数。少于 12 个可比起点时胜率显示为 `N/A`。沪深300和中证500比较也只使用两边起止月份完全一致的窗口。

相邻滚动窗口高度重叠，胜率不能当作独立重复试验的概率。它更适合回答“结论对起点是否敏感”，不适合直接预测下一窗口胜率。

---

## 七、限制与下一步

1. 允许碎股，未计股票佣金、最低佣金、印花税、分红税及买卖价差。
2. 分红按除权日收盘立即再投资，真实到账日和成交价可能不同。
3. 204001 使用定盘利率代理个人实际成交收益，并按相邻交易日的日历天数计息；应进一步加入手续费和结算规则压力测试。
4. 七家银行是事后选择的存续公司，仍有幸存者偏差和选股偏差。
5. 本报告只研究历史市场收益，没有纳入净息差、不良贷款率、拨备覆盖率、资本充足率和估值变化等基本面解释变量。

因此，可以比较的是“这些历史窗口中银行股相对三个基础基准的结果”；不能据此承诺未来收益或把高股息等同于低风险。

---

## 八、数据与复现

- 数据获取：`report/data_fetch.py`
- 回测引擎：`report/analysis.py`
- 报告生成：`report/build_report.py`
- 口径校验：`report/verify_returns.py`
- 自动测试：`report/test_analysis.py`
- 数据快照：`report/data/`

来源：

- [中证指数历史行情接口](https://www.csindex.com.cn/csindex-home/perf/index-perf)
- [沪深300指数编制方案](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000300_Index_Methodology_cn.pdf)
- [中证500指数资料](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000905factsheet.pdf)
- [上交所204001回购定盘利率](https://bond.sse.com.cn/data/standard/repocurve/onerepo/)
- 腾讯证券不复权日线接口
- 新浪财经分红配股详情
"""
    (REPORT_DIR / "七家银行与基准回测报告.md").write_text(markdown, encoding="utf-8")


def main():
    stocks, dividends, indices, repo, manifest = load_snapshot()
    levels, price_only_levels, meta = build_levels(stocks, dividends, indices, repo)
    fixed, _ = fixed_backtests(levels, meta)
    audit = dividend_audit(levels, price_only_levels, meta)
    rolling_summary, _ = rolling_comparisons(levels, meta)
    save_tables(fixed, audit, rolling_summary)

    chart_fixed_xirr(fixed, meta)
    chart_total_return_levels(levels, meta)
    chart_risk(fixed, meta)
    chart_dividend_audit(audit)
    chart_rolling_success(rolling_summary)
    build_markdown(fixed, audit, rolling_summary, manifest)
    print("报告、图表和结果表已生成。")


if __name__ == "__main__":
    main()
