"""
lab2_etf.py — A股定投回测工具

功能：
  输入股票代码，模拟从 2020年1月 起每月定投 3000 元至 2026年7月，
  分红继续用于定投（通过前复权价格自动体现），计算：
    - 年化收益率（XIRR 内部收益率）
    - 最大回撤（基于每日市值）
    - 总投入、最终市值、总收益率

用法：
  python lab-scripts/lab2_etf.py 600036
  python lab-scripts/lab2_etf.py           （交互式输入）

数据源：mootdx（通达信协议，前复权日线，分红再投资自动体现在前复权价格中）
"""
import sys
import os
import time
import numpy as np
import pandas as pd
import akshare as ak
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from mootdx.quotes import Quotes

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

# ── 配置 ─────────────────────────────────────────────────────
MONTHLY_AMOUNT = 3000       # 每月定投金额（元）
START_YM = pd.Period("2020-01", "M")
END_YM   = pd.Period("2026-07", "M")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

tdx = Quotes.factory(market="std")


# ============================================================
# 工具函数
# ============================================================
def safe_call(fn, label, *args, retries=3, delay=2.0, **kwargs):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            result = fn(*args, **kwargs)
            return result
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(delay * attempt)
    print(f"  [!] {label} 失败: {type(last_err).__name__}: {last_err}")
    return None


def get_stock_name(code):
    try:
        stocks = tdx.stocks()
        match = stocks[stocks["code"].astype(str).str.zfill(6) == code]
        if len(match) > 0:
            return match.iloc[0]["name"]
    except Exception:
        pass
    return code


def calc_xirr(cashflows, dates):
    """
    牛顿法计算 XIRR（年化内部收益率）。
    cashflows: 负=投入, 正=赎回/终值
    """
    if len(cashflows) < 2:
        return np.nan
    years = np.array([(d - dates[0]).total_seconds() / (365.25 * 86400) for d in dates])
    c = np.array(cashflows, dtype=float)
    if np.all(c >= 0) or np.all(c <= 0):
        return np.nan

    guess = 0.05
    for _ in range(200):
        f = np.sum(c / (1.0 + guess) ** years)
        df = np.sum(-years * c / (1.0 + guess) ** (years + 1))
        if abs(df) < 1e-12:
            break
        new_guess = guess - f / df
        new_guess = max(new_guess, -0.99)
        if abs(new_guess - guess) < 1e-10:
            return new_guess
        guess = new_guess
    return guess if abs(np.sum(c / (1.0 + guess) ** years)) < 1e-6 else np.nan


# ============================================================
# 1. 获取历史日线（前复权 — 含分红再投资）
# ============================================================
def fetch_history(code):
    """
    使用 akshare 腾讯源获取前复权 (qfq) 日线。
    前复权价格已自动反映分红再投资 — 历史价格被分红金额向下调整，
    用前复权价格买入更多"当量份额"，终值按最新市价估值。
    """
    prefix = "sh" if code.startswith(("6", "9")) else "sz"
    tx_symbol = f"{prefix}{code}"

    df = safe_call(
        ak.stock_zh_a_hist_tx, f"{code} 腾讯qfq",
        symbol=tx_symbol, start_date="20100101", end_date="20260720",
        adjust="qfq", retries=3, delay=2,
    )

    if df is None or df.empty:
        return None

    df = df.rename(columns={
        "date": "日期", "open": "开盘", "close": "收盘",
        "high": "最高", "low": "最低", "amount": "成交额",
    })
    df["日期"] = pd.to_datetime(df["日期"])
    df = df.set_index("日期").sort_index()
    return df


# ============================================================
# 2. 定投模拟（核心）
# ============================================================
def simulate_dca(df):
    """
    模拟每月定投 + 每日市值跟踪。

    关键设计：
      - 每月第一个交易日定投 MONTHLY_AMOUNT 元
      - 最终估值使用数据最后交易日的收盘价（非最后定投日）
      - 每日追踪市值以精确计算最大回撤
    """
    df = df.copy().sort_index()

    # ── 找到每个 (年, 月) 的第一个交易日 ────────────────────
    # 构建映射: (year, month) -> 该月第一个交易日的 Timestamp index
    first_day_map = {}
    for idx in df.index:
        key = (idx.year, idx.month)
        if key not in first_day_map:
            first_day_map[key] = idx

    # 筛选投资月份 [2020-01, 2026-07]
    invest_dates = {}  # Timestamp -> price
    for (y, m), dt in sorted(first_day_map.items()):
        if (y > 2020 or (y == 2020 and m >= 1)) and (y < 2026 or (y == 2026 and m <= 7)):
            invest_dates[dt] = float(df.loc[dt, "收盘"])

    if not invest_dates:
        return None, None, None

    invest_sorted = sorted(invest_dates.keys())
    first_dt = invest_sorted[0]
    last_dt = df.index[-1]

    # ── 在定投日累加份额 ────────────────────────────────────
    total_shares = 0.0
    total_invested = 0.0
    monthly_records = []

    for dt in invest_sorted:
        price = invest_dates[dt]
        shares_bought = MONTHLY_AMOUNT / price
        total_shares += shares_bought
        total_invested += MONTHLY_AMOUNT
        monthly_records.append({
            "date": dt,
            "price": round(price, 2),
            "shares_bought": round(shares_bought, 2),
            "total_shares": round(total_shares, 2),
            "total_invested": round(total_invested, 2),
        })

    # ── 构建每日市值序列 ────────────────────────────────────
    # 用向量化方式：每个交易日使用该日之前（含）的累计份额
    daily_sub = df.loc[first_dt:last_dt][["收盘"]].copy()
    daily_sub["total_shares"] = 0.0
    daily_sub["total_invested"] = 0.0

    # 按投资日逐段填充
    for i, dt in enumerate(invest_sorted):
        shares_now = monthly_records[i]["total_shares"]
        invested_now = monthly_records[i]["total_invested"]
        daily_sub.loc[dt:, "total_shares"] = shares_now
        daily_sub.loc[dt:, "total_invested"] = invested_now

    daily_sub["portfolio_value"] = daily_sub["total_shares"] * daily_sub["收盘"]
    daily_sub["peak"] = daily_sub["portfolio_value"].cummax()
    daily_sub["drawdown"] = (daily_sub["portfolio_value"] - daily_sub["peak"]) / daily_sub["peak"]

    # 还原 date 列
    daily_sub = daily_sub.reset_index(names="date")

    # ── 汇总指标 ────────────────────────────────────────────
    final_value   = float(daily_sub["portfolio_value"].iloc[-1])
    total_months  = len(monthly_records)
    total_return  = (final_value - total_invested) / total_invested if total_invested > 0 else 0.0
    max_dd        = float(daily_sub["drawdown"].min())
    years         = (daily_sub["date"].iloc[-1] - daily_sub["date"].iloc[0]).total_seconds() / (365.25 * 86400)

    # XIRR
    cf = [-MONTHLY_AMOUNT] * total_months + [final_value]
    cf_dates = [pd.Timestamp(r["date"]) for r in monthly_records] + [daily_sub["date"].iloc[-1]]
    xirr = calc_xirr(cf, cf_dates)

    summary = {
        "total_months":       total_months,
        "total_invested":     round(total_invested, 2),
        "final_value":        round(final_value, 2),
        "total_return_pct":   round(total_return * 100, 2),
        "years":              round(years, 2),
        "xirr_pct":           round(xirr * 100, 2) if not np.isnan(xirr) else 0.0,
        "max_drawdown_pct":   round(max_dd * 100, 2),
        "start_date":         daily_sub["date"].iloc[0].strftime("%Y-%m-%d"),
        "end_date":           daily_sub["date"].iloc[-1].strftime("%Y-%m-%d"),
        "final_price":        round(float(daily_sub["收盘"].iloc[-1]), 2),
    }
    return daily_sub, monthly_records, summary


# ============================================================
# 3. 可视化
# ============================================================
def plot_result(code, name, daily_df, monthly_records, summary):
    """3 面板：持仓市值、价格走势、每日回撤"""
    rec_df = pd.DataFrame(monthly_records)
    rec_df["date"] = pd.to_datetime(rec_df["date"])

    fig, axes = plt.subplots(3, 1, figsize=(16, 12),
                             gridspec_kw={"height_ratios": [2.5, 1, 1]})

    # ── 面板1：持仓市值 & 累计投入 ───────────────────────────
    ax1 = axes[0]
    ax1.fill_between(daily_df["date"], 0, daily_df["portfolio_value"],
                     alpha=0.10, color="#1565C0")
    ax1.plot(daily_df["date"], daily_df["portfolio_value"],
             color="#1565C0", linewidth=1.2, label="持仓市值（每日）")
    # 投入阶梯
    ax1.step(rec_df["date"], rec_df["total_invested"], where="post",
             color="#FF9800", linewidth=1.5, linestyle="--", label="累计投入")

    # 标注终值
    last = daily_df.iloc[-1]
    ax1.annotate(
        f"{last['portfolio_value']:,.0f} 元",
        xy=(last["date"], last["portfolio_value"]),
        xytext=(15, 5), textcoords="offset points",
        fontsize=11, fontweight="bold", color="#1565C0",
    )

    title = (f"{name}({code})  每月定投 {MONTHLY_AMOUNT:,} 元  |  "
             f"年化: {summary['xirr_pct']:+.1f}% (XIRR)  |  "
             f"最大回撤: {summary['max_drawdown_pct']:.1f}%  |  "
             f"终值: {summary['final_value']:,.0f} 元")
    ax1.set_title(title, fontsize=13, fontweight="bold")
    ax1.set_ylabel("金额 (元)")
    ax1.legend(loc="upper left", fontsize=9, framealpha=0.7)
    ax1.grid(True, alpha=0.3)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:,.0f}"))

    # ── 面板2：收盘价 + 定投买入点 ───────────────────────────
    ax2 = axes[1]
    ax2.plot(daily_df["date"], daily_df["收盘"],
             color="#333", linewidth=0.7, alpha=0.8)
    ax2.scatter(rec_df["date"], rec_df["price"],
                color="#FF5722", s=14, zorder=5, label="定投日买入价")
    ax2.set_ylabel("前复权收盘价 (元)")
    ax2.legend(loc="upper left", fontsize=8)
    ax2.grid(True, alpha=0.3)

    # ── 面板3：每日回撤 ─────────────────────────────────────
    ax3 = axes[2]
    dd_pct = daily_df["drawdown"] * 100
    ax3.fill_between(daily_df["date"], dd_pct, 0,
                     color="#E53935", alpha=0.25)
    ax3.plot(daily_df["date"], dd_pct,
             color="#C62828", linewidth=0.8)
    ax3.axhline(y=summary["max_drawdown_pct"], color="red",
                linewidth=0.6, linestyle="--", alpha=0.5)
    ax3.annotate(
        f"最大回撤 {summary['max_drawdown_pct']:.1f}%",
        xy=(daily_df["date"].iloc[-1], summary["max_drawdown_pct"]),
        fontsize=9, color="#C62828", fontweight="bold",
    )
    ax3.set_ylabel("回撤 (%)")
    ax3.set_xlabel("日期")
    ax3.grid(True, alpha=0.3)
    y_lo = min(dd_pct.min() * 1.3, -5)
    ax3.set_ylim(y_lo, 5)

    for ax in axes:
        ax.set_xlim(daily_df["date"].iloc[0], daily_df["date"].iloc[-1])

    plt.tight_layout()
    chart_path = os.path.join(OUTPUT_DIR, "..", f"lab2_dca_{code}.png")
    plt.savefig(chart_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"\n  -> 图表已保存: lab2_dca_{code}.png")


# ============================================================
# 4. 主流程
# ============================================================
def main():
    if len(sys.argv) > 1:
        code = sys.argv[1].strip().zfill(6)
    else:
        code = input("请输入股票代码（如 600036 招商银行）: ").strip().zfill(6)

    if not code or len(code) != 6:
        print("错误：请输入6位股票代码。")
        sys.exit(1)

    name = get_stock_name(code)
    print(f"\n{'=' * 60}")
    print(f"  定投回测：{name}({code})")
    print(f"  策略：每月定投 {MONTHLY_AMOUNT:,} 元，分红再投资")
    print(f"  期间：{START_YM} -> {END_YM}")
    print(f"{'=' * 60}")

    # ── 数据 ────────────────────────────────────────────────
    print("\n  -> 获取历史日线（前复权）...")
    df = fetch_history(code)
    if df is None or df.empty:
        print(f"  [!] 无法获取 {code} 的历史数据。")
        sys.exit(1)
    print(f"  [OK] {len(df)} 根日线, "
          f"{df.index[0].strftime('%Y-%m-%d')} -> {df.index[-1].strftime('%Y-%m-%d')}")

    # ── 模拟 ────────────────────────────────────────────────
    print("\n  -> 模拟定投...")
    daily_df, monthly_records, summary = simulate_dca(df)
    if daily_df is None:
        print("  [!] 定投模拟失败。")
        sys.exit(1)

    # ── 输出 ────────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"  定投回测结果")
    print(f"{'=' * 60}")
    print(f"  定投期数:          {summary['total_months']} 期 "
          f"({summary['years']} 年)")
    print(f"  累计投入:          {summary['total_invested']:,.0f} 元")
    print(f"  最终市值:          {summary['final_value']:,.0f} 元 "
          f"(股价 {summary['final_price']} 元)")
    print(f"  总收益率:          {summary['total_return_pct']:+.1f}%")
    print(f"  年化收益率 (XIRR): {summary['xirr_pct']:+.1f}%")
    print(f"  最大回撤:          {summary['max_drawdown_pct']:.1f}%")
    print(f"  估值日期:          {summary['end_date']}")
    print(f"{'=' * 60}")

    # ── 年度明细 ────────────────────────────────────────────
    print(f"\n  [年度定投明细]")
    rec_df = pd.DataFrame(monthly_records)
    rec_df["date"] = pd.to_datetime(rec_df["date"])
    rec_df["year"] = rec_df["date"].dt.year
    yearly = rec_df.groupby("year").agg(
        定投期数=("shares_bought", "count"),
        当年投入=("shares_bought", lambda x: int(len(x) * MONTHLY_AMOUNT)),
        年末累计投入=("total_invested", "last"),
    ).astype(int)
    # 年末市值：用 daily_df 中每年最后一个交易日的 portfolio_value
    daily_df["year"] = daily_df["date"].dt.year
    year_end_value = daily_df.groupby("year")["portfolio_value"].last().astype(int)
    yearly["年末市值"] = year_end_value
    yearly["当年收益率"] = (
        (yearly["年末市值"] - yearly["年末累计投入"]) / yearly["年末累计投入"] * 100
    ).round(1)
    print(yearly.to_string())

    # ── 图表 ────────────────────────────────────────────────
    print("\n  -> 生成图表...")
    plot_result(code, name, daily_df, monthly_records, summary)


if __name__ == "__main__":
    main()
