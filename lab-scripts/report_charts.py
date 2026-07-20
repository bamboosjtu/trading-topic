"""
生成定投报告所需图表 → report/
"""
import os
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.gridspec import GridSpec

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJ_ROOT = os.path.dirname(SCRIPT_DIR)
REPORT_DIR = os.path.join(PROJ_ROOT, "report")
DATA_DIR = os.path.join(PROJ_ROOT, "data")
os.makedirs(REPORT_DIR, exist_ok=True)

sys.path.insert(0, SCRIPT_DIR)
from lab2_etf import fetch_history, simulate_dca, get_stock_name, calc_xirr
from lab2_rolling import simulate_dca_range

BIG_FOUR = {
    "601398": "工商银行",
    "601939": "建设银行",
    "601288": "农业银行",
    "601988": "中国银行",
}
COLORS_4 = ["#E53935", "#1E88E5", "#43A047", "#FB8C00"]

# ============================================================
# 图1: 四大行归一化走势 (2020-2026)
# ============================================================
def chart1_price_comparison():
    fig, ax = plt.subplots(figsize=(14, 5))
    for (code, name), color in zip(BIG_FOUR.items(), COLORS_4):
        df = fetch_history(code)
        if df is None:
            continue
        df = df[df.index >= "2020-01-01"]
        norm = df["close"] / df["close"].iloc[0] * 100
        ax.plot(df.index, norm, color=color, linewidth=1.5, label=f"{name}({code})")

    ax.axhline(y=100, color="gray", linestyle="--", linewidth=0.6, alpha=0.5)
    ax.set_title("四大行归一化走势 (2020-01-01 基准=100)", fontsize=15, fontweight="bold")
    ax.set_ylabel("归一化价格 (基准=100)")
    ax.legend(loc="upper left", fontsize=10, framealpha=0.8)
    ax.grid(True, alpha=0.3)
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f"))
    plt.tight_layout()
    plt.savefig(os.path.join(REPORT_DIR, "chart1_price_comparison.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  [OK] chart1_price_comparison.png")

# ============================================================
# 图2: 四大行定投市值增长曲线
# ============================================================
def chart2_dca_growth():
    fig, axes = plt.subplots(2, 2, figsize=(16, 11))
    axes = axes.flatten()

    for idx, ((code, name), color) in enumerate(zip(BIG_FOUR.items(), COLORS_4)):
        ax = axes[idx]
        print(f"    -> {name}...", end=" ")
        df = fetch_history(code)
        daily_df, monthly_records, summary = simulate_dca(df)
        if daily_df is None:
            print("skip")
            continue

        # Fill area under portfolio value
        ax.fill_between(daily_df["date"], 0, daily_df["portfolio_value"],
                        alpha=0.12, color=color)
        ax.plot(daily_df["date"], daily_df["portfolio_value"],
                color=color, linewidth=1.3, label="持仓市值")
        # Invested line
        rec_df = pd.DataFrame(monthly_records)
        rec_df["date"] = pd.to_datetime(rec_df["date"])
        ax.step(rec_df["date"], rec_df["total_invested"], where="post",
                color="#888888", linewidth=1.0, linestyle="--", label="累计投入")

        # Annotation
        ax.annotate(
            f"XIRR {summary['xirr_pct']:+.1f}%\n终值 {summary['final_value']:,.0f} 元\n回撤 {summary['max_drawdown_pct']:.1f}%",
            xy=(0.03, 0.97), xycoords="axes fraction",
            fontsize=10, verticalalignment="top",
            bbox=dict(boxstyle="round,pad=0.4", facecolor="white", alpha=0.85),
        )
        ax.set_title(f"{name} ({code})", fontsize=13, fontweight="bold")
        ax.set_ylabel("金额 (元)")
        ax.legend(loc="lower right", fontsize=8)
        ax.grid(True, alpha=0.3)
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x/10000:.0f}万"))
        print("done")

    fig.suptitle("四大行定投市值增长 (2020-01 → 2026-07, 每月 3,000 元)", fontsize=16, fontweight="bold", y=1.01)
    plt.tight_layout()
    plt.savefig(os.path.join(REPORT_DIR, "chart2_dca_growth.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  [OK] chart2_dca_growth.png")

# ============================================================
# 图3: 30 只银行股定投 XIRR 排名
# ============================================================
def chart3_bank_ranking():
    csv_path = os.path.join(DATA_DIR, "银行股定投回测排名.csv")
    if not os.path.exists(csv_path):
        print("  [!] 排名数据不存在，运行 lab2_batch.py 生成")
        return

    df = pd.read_csv(csv_path, dtype={"code": str})
    df = df.sort_values("xirr_pct", ascending=True)

    fig, ax = plt.subplots(figsize=(14, 8))

    colors = []
    for _, row in df.iterrows():
        code = str(row["code"]).zfill(6)
        if code in BIG_FOUR:
            colors.append("#E53935")  # Red for Big Four
        else:
            colors.append("#90A4AE")

    bars = ax.barh(range(len(df)), df["xirr_pct"], color=colors, alpha=0.85, height=0.7)

    # Highlight Big Four with labels
    for i, (_, row) in enumerate(df.iterrows()):
        code = str(row["code"]).zfill(6)
        if code in BIG_FOUR:
            ax.annotate(
                f"{row['name']} {row['xirr_pct']:+.1f}%",
                xy=(row["xirr_pct"], i),
                xytext=(5, 0), textcoords="offset points",
                fontsize=9, fontweight="bold", color="#C62828", va="center",
            )

    ax.set_yticks(range(len(df)))
    ax.set_yticklabels([f"{r['name']}" for _, r in df.iterrows()], fontsize=8)

    ax.axvline(x=0, color="black", linewidth=0.6)
    ax.axvline(x=df["xirr_pct"].mean(), color="#FF9800", linewidth=1.0,
               linestyle="--", alpha=0.7, label=f"均值 {df['xirr_pct'].mean():+.1f}%")

    ax.set_title("A股银行股定投 XIRR 排名 (2020-01 → 2026-07, 每月 3,000 元)",
                 fontsize=15, fontweight="bold")
    ax.set_xlabel("年化收益率 XIRR (%)")
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3, axis="x")
    plt.tight_layout()
    plt.savefig(os.path.join(REPORT_DIR, "chart3_bank_ranking.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  [OK] chart3_bank_ranking.png")

# ============================================================
# 图4: 四大行滚动窗口 XIRR 热力图
# ============================================================
def chart4_rolling_xirr():
    fig, axes = plt.subplots(2, 2, figsize=(18, 12))
    axes = axes.flatten()

    for idx, ((code, name), color) in enumerate(zip(BIG_FOUR.items(), COLORS_4)):
        ax = axes[idx]
        print(f"    -> {name} rolling...", end=" ")

        df = fetch_history(code)
        if df is None:
            print("skip")
            continue

        # Calculate rolling 3/5/10 year XIRR for all possible entries
        df_sorted = df.sort_index()
        last_date = df_sorted.index[-1]
        available_months = pd.period_range(
            start=df_sorted.index[0].to_period("M"),
            end=last_date.to_period("M"),
            freq="M"
        )

        results = {3: [], 5: [], 10: []}
        for hold_years, ls, style in [(3, "-", "solid"), (5, "--", "dashed"), (10, "-.", "dashdot")]:
            for start_ym in available_months:
                end_ym = start_ym + hold_years * 12 - 1
                if end_ym > last_date.to_period("M"):
                    break
                summary, _ = simulate_dca_range(df, start_ym, end_ym)
                if summary and summary["xirr_pct"] is not None:
                    results[hold_years].append({
                        "entry": start_ym.start_time,
                        "xirr": summary["xirr_pct"],
                    })

            if results[hold_years]:
                df_r = pd.DataFrame(results[hold_years])
                ax.plot(df_r["entry"], df_r["xirr"],
                        linewidth=1.0, linestyle=style,
                        label=f"{hold_years}年定投", alpha=0.85)

        ax.axhline(y=0, color="black", linewidth=0.5, alpha=0.5)
        ax.set_title(f"{name} ({code})", fontsize=13, fontweight="bold")
        ax.set_ylabel("XIRR (%)")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)
        print("done")

    fig.suptitle("四大行滚动定投 XIRR (不同入市月份 → 不同期限)", fontsize=16, fontweight="bold", y=1.01)
    plt.tight_layout()
    plt.savefig(os.path.join(REPORT_DIR, "chart4_rolling_xirr.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  [OK] chart4_rolling_xirr.png")

# ============================================================
# 图5: 四大行回撤对比
# ============================================================
def chart5_drawdown():
    fig, ax = plt.subplots(figsize=(14, 5))

    for (code, name), color in zip(BIG_FOUR.items(), COLORS_4):
        print(f"    -> {name} drawdown...", end=" ")
        df = fetch_history(code)
        daily_df, _, summary = simulate_dca(df)
        if daily_df is None:
            print("skip")
            continue

        dd_pct = daily_df["drawdown"] * 100
        ax.fill_between(daily_df["date"], dd_pct, 0,
                        alpha=0.08, color=color)
        ax.plot(daily_df["date"], dd_pct,
                color=color, linewidth=1.0,
                label=f"{name} (最大回撤: {summary['max_drawdown_pct']:.1f}%)")
        print("done")

    ax.axhline(y=0, color="black", linewidth=0.5)
    ax.set_title("四大行定投持仓回撤对比", fontsize=15, fontweight="bold")
    ax.set_ylabel("回撤 (%)")
    ax.legend(loc="lower left", fontsize=10, framealpha=0.8)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(REPORT_DIR, "chart5_drawdown.png"), dpi=150, bbox_inches="tight")
    plt.close()
    print("  [OK] chart5_drawdown.png")


# ============================================================
# 主流程
# ============================================================
if __name__ == "__main__":
    print("生成定投报告图表...\n")
    chart1_price_comparison()
    chart2_dca_growth()
    chart3_bank_ranking()
    chart4_rolling_xirr()
    chart5_drawdown()
    print("\n所有图表已生成到 report/")
