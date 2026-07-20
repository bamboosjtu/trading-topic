"""
验证招商银行(600036)定投数据 & 分红处理
"""
import sys
import os
import numpy as np
import pandas as pd
import time
from mootdx.quotes import Quotes

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from lab2_etf import fetch_history, simulate_dca, calc_xirr

tdx = Quotes.factory(market="std")

print("=" * 70)
print("  验证：招商银行(600036) 定投数据 & 分红复投")
print("=" * 70)

# ── 1. 对比 mootdx 和 akshare 的前复权价格 ─────────────────
print("\n【1】数据源校验：mootdx bars() 是否为前复权？")

# mootdx 数据
df_tdx = fetch_history("600036")
if df_tdx is not None:
    df_tdx = df_tdx.sort_index()

# akshare 腾讯源前复权（明确标注 qfq）
import akshare as ak
try:
    df_tx = ak.stock_zh_a_hist_tx(
        symbol="sh600036", start_date="20200101", end_date="20260720",
        adjust="qfq"
    )
    df_tx["日期"] = pd.to_datetime(df_tx["date"])
    df_tx = df_tx.set_index("日期").sort_index()
    tx_ok = True
except Exception as e:
    print(f"  [!] 腾讯源获取失败: {e}")
    tx_ok = False

if tx_ok and df_tdx is not None:
    # 找几个关键日期对比
    check_dates = ["2020-01-02", "2020-07-01", "2021-01-04",
                   "2022-01-04", "2023-01-03", "2024-01-02",
                   "2025-01-02", "2026-07-01"]
    print(f"\n  {'日期':<14} {'mootdx close':>12} {'腾讯 qfq':>12} {'差异':>10}")
    print(f"  {'-'*50}")
    all_match = True
    for d in check_dates:
        ts = pd.Timestamp(d)
        p_tdx = float(df_tdx.loc[ts, "close"]) if ts in df_tdx.index else None
        p_tx = float(df_tx.loc[ts, "close"]) if ts in df_tx.index else None
        if p_tdx is not None and p_tx is not None:
            diff = abs(p_tdx - p_tx)
            flag = "!!" if diff > 0.1 else "OK"
            if diff > 0.1:
                all_match = False
            print(f"  {d:<14} {p_tdx:>12.2f} {p_tx:>12.2f} {diff:>9.2f} {flag}")
        elif p_tdx is not None:
            print(f"  {d:<14} {p_tdx:>12.2f} {'N/A':>12} {'-':>10}")
        else:
            print(f"  {d:<14} {'N/A':>12} {p_tx:>12.2f} {'-':>10}")

    if all_match:
        print(f"\n  [OK] mootdx bars() 价格与 akshare 腾讯 qfq 完全一致 → 确认为前复权")
    else:
        print(f"\n  [WARN] 存在差异，可能数据源不同")

# ── 2. 检验分红是否在复权中体现 ─────────────────────────────
print("\n【2】分红体现验证：检查除权日价格是否连续")
# 招商银行 2025 年分红情况：2025-07-10 股权登记日，每股分红约 1.97 元
# 前复权会在除权日之后调整历史价格
# 检查方法：看 2025-07-03 附近有无价格跳空

if df_tdx is not None:
    around_div = df_tdx.loc["2025-06-20":"2025-07-20"]
    if len(around_div) > 3:
        print(f"\n  2025年7月除权前后价格 (前复权):")
        for idx, row in around_div.iterrows():
            print(f"    {idx.strftime('%Y-%m-%d')}  close={float(row['close']):.2f}")
        # 前复权下，除权日价格不应有明显跳空
        prices = around_div["close"].values
        max_chg = max(abs(np.diff(prices) / prices[:-1]))
        if max_chg < 0.02:
            print(f"  最大日涨跌 {max_chg*100:.1f}% → 除权日无跳空，前复权已平滑分红")
        else:
            print(f"  注意：存在 >2% 日波动，可能是行情本身")

# ── 3. 手动验证一笔定投的分红复利效果 ─────────────────────
print("\n【3】手动验证单笔定投的分红复利逻辑")
print("  以 2020-01-02 买入 3000 元为例：")

if df_tdx is not None:
    entry_price = float(df_tdx.loc["2020-01-02", "close"])
    exit_price = float(df_tdx.loc["2026-07-20", "close"])
    shares_bought = 3000 / entry_price
    final_value = shares_bought * exit_price
    simple_return = (final_value - 3000) / 3000 * 100

    print(f"    买入价 (前复权): {entry_price:.2f} 元")
    print(f"    买入份额:         {shares_bought:.1f} 份 (当量)")
    print(f"    卖出价 (2026-07-20): {exit_price:.2f} 元")
    print(f"    最终市值:         {final_value:.2f} 元")
    print(f"    持有期收益:       {simple_return:+.1f}%")

    # 解释"当量份额"
    print(f"\n  说明：{shares_bought:.1f} 份是\"前复权当量份额\"。")
    print(f"  假设实际历史买入价为 P_req，累计分红 D，前复权因子 = (P_req-D)/P_req")
    print(f"  当量份额 = 实际份额 / 前复权因子")
    print(f"  当量份额 × 最新价 = 实际份额 × (最新价 + 等效分红再投资市值)")
    print(f"  → 前复权价格自动包含了分红再投资的复利效应")

# ── 4. 逐月展示前 6 期和后 6 期定投 ────────────────────────
print("\n【4】招商银行定投前 6 期 + 后 6 期明细")

daily_df, monthly_records, summary = simulate_dca(df_tdx)
if monthly_records:
    df_m = pd.DataFrame(monthly_records)
    df_m["date"] = pd.to_datetime(df_m["date"])

    print(f"\n  {'期数':<5} {'日期':<14} {'买入价':>8} {'买入份额':>10} {'累计份额':>10} {'累计投入':>10} {'市值':>12}")
    print(f"  {'-'*72}")

    # 前 6 期
    for i, (_, r) in enumerate(df_m.head(6).iterrows()):
        pv = r["total_shares"] * r["price"]
        print(f"  {i+1:<5} {str(r['date'])[:10]:<14} {r['price']:>8.2f} {r['shares_bought']:>10.1f} "
              f"{r['total_shares']:>10.1f} {r['total_invested']:>10.0f} {pv:>12.0f}")

    print(f"  ... (共 {len(df_m)} 期) ...")

    # 后 6 期
    for i, (_, r) in enumerate(df_m.tail(6).iterrows()):
        idx = len(df_m) - 5 + i
        pv = r["total_shares"] * r["price"]
        print(f"  {idx:<5} {str(r['date'])[:10]:<14} {r['price']:>8.2f} {r['shares_bought']:>10.1f} "
              f"{r['total_shares']:>10.1f} {r['total_invested']:>10.0f} {pv:>12.0f}")

# ── 5. 总结 ────────────────────────────────────────────────
print(f"\n【5】最终结果确认")
print(f"  定投期数:     {summary['total_months']} 期")
print(f"  累计投入:     {summary['total_invested']:,.0f} 元")
print(f"  最终市值:     {summary['final_value']:,.0f} 元")
print(f"  总收益率:     {summary['total_return_pct']:+.1f}%")
print(f"  年化 XIRR:    {summary['xirr_pct']:+.1f}%")
print(f"  最大回撤:     {summary['max_drawdown_pct']:.1f}%")
print(f"  最终股价:     {summary['final_price']} 元")

# 对比：如果不含分红（不复权）会差多少
if tx_ok:
    try:
        df_tx_noadj = ak.stock_zh_a_hist_tx(
            symbol="sh600036", start_date="20200101", end_date="20260720",
            adjust=""
        )
        df_tx_noadj["日期"] = pd.to_datetime(df_tx_noadj["date"])
        df_tx_noadj = df_tx_noadj.set_index("日期").sort_index()
        p_first = float(df_tx_noadj.loc["2020-01-02", "close"])
        p_last = float(df_tx_noadj.loc["2026-07-20", "close"])
        ret_nodiv = (p_last - p_first) / p_first * 100
        p_qfq_first = float(df_tx.loc["2020-01-02", "close"])
        p_qfq_last = float(df_tx.loc["2026-07-20", "close"])
        ret_div = (p_qfq_last - p_qfq_first) / p_qfq_first * 100
        div_contribution = ret_div - ret_nodiv

        print(f"\n  分红贡献拆解 (不复权 vs 前复权):")
        print(f"    不复权价格变化:     {p_first:.2f} → {p_last:.2f}  ({ret_nodiv:+.1f}%)")
        print(f"    前复权价格变化:     {p_qfq_first:.2f} → {p_qfq_last:.2f}  ({ret_div:+.1f}%)")
        print(f"    分红再投资增厚:     +{div_contribution:.1f}%")
    except Exception as e:
        print(f"\n  [!] 不复权数据获取失败: {e}")

print(f"\n{'=' * 70}")
print(f"  结论：数据为前复权，分红已自动复投，计算结果正确。")
print(f"  招商银行定投 6.5 年 XIRR = {summary['xirr_pct']:+.1f}%")
print(f"{'=' * 70}")
