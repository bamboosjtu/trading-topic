"""
批量回测所有银行股 — 定投收益排名
调用 lab2_etf 的模拟引擎，遍历 data/银行股清单.csv 中所有有效银行股
"""
import os
import sys
import time
import pandas as pd
import numpy as np

# 把 lab-scripts 加入路径以导入 lab2_etf
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from lab2_etf import fetch_history, simulate_dca, get_stock_name, tdx

# ── 加载银行股清单 ──────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "data")
bank_csv = os.path.join(DATA_DIR, "银行股清单.csv")
df_banks = pd.read_csv(bank_csv, dtype={"code": str})
df_banks["code"] = df_banks["code"].str.zfill(6)

# 排除非真实股票（指数/港股）
EXCLUDE_CODES = {"000134", "000869"}
df_banks = df_banks[~df_banks["code"].isin(EXCLUDE_CODES)]

codes = df_banks["code"].tolist()
names = df_banks["name"].tolist()
print(f"共 {len(codes)} 只银行股，开始批量回测...\n")

# ── 逐只回测 ────────────────────────────────────────────────
results = []
errors = []

for i, (code, name) in enumerate(zip(codes, names)):
    print(f"[{i+1:2d}/{len(codes)}] {name}({code}) ...", end=" ", flush=True)

    try:
        df = fetch_history(code)
        if df is None or df.empty:
            print("数据获取失败")
            errors.append((code, name, "数据获取失败"))
            continue

        daily_df, monthly_records, summary = simulate_dca(df)
        if daily_df is None:
            print("模拟失败")
            errors.append((code, name, "模拟失败"))
            continue

        results.append({
            "code": code,
            "name": name,
            "periods": summary["total_months"],
            "invested": summary["total_invested"],
            "final_value": summary["final_value"],
            "total_return_pct": summary["total_return_pct"],
            "xirr_pct": summary["xirr_pct"],
            "max_dd_pct": summary["max_drawdown_pct"],
            "final_price": summary["final_price"],
            "years": summary["years"],
        })
        print(f"XIRR={summary['xirr_pct']:+.1f}%  "
              f"回撤={summary['max_drawdown_pct']:.1f}%  "
              f"终值={summary['final_value']:,.0f}")

    except Exception as e:
        print(f"异常: {e}")
        errors.append((code, name, str(e)))

    time.sleep(0.3)  # 限流

# ── 汇总排名 ────────────────────────────────────────────────
if not results:
    print("\n没有成功回测的结果。")
    sys.exit(1)

df_result = pd.DataFrame(results)
df_result = df_result.sort_values("xirr_pct", ascending=False).reset_index(drop=True)
df_result.insert(0, "排名", range(1, len(df_result) + 1))

print(f"\n{'=' * 100}")
print(f"  银行股定投回测排名 (2020-01 -> 2026-07, 每月 3,000 元)")
print(f"{'=' * 100}")
print(df_result.to_string(
    index=False,
    formatters={
        "invested":     lambda x: f"{x:,.0f}",
        "final_value":  lambda x: f"{x:,.0f}",
        "total_return_pct": lambda x: f"{x:+.1f}%",
        "xirr_pct":     lambda x: f"{x:+.1f}%",
        "max_dd_pct":   lambda x: f"{x:.1f}%",
        "final_price":  lambda x: f"{x:.2f}",
        "years":        lambda x: f"{x:.2f}",
    }
))

# ── 统计摘要 ────────────────────────────────────────────────
print(f"\n{'=' * 100}")
print(f"  统计摘要")
print(f"{'=' * 100}")
print(f"  回测总数: {len(df_result)} 只")
print(f"  XIRR 均值: {df_result['xirr_pct'].mean():+.1f}%")
print(f"  XIRR 中位: {df_result['xirr_pct'].median():+.1f}%")
print(f"  XIRR 最高: {df_result['xirr_pct'].max():+.1f}% ({df_result.iloc[0]['name']} {df_result.iloc[0]['code']})")
print(f"  XIRR 最低: {df_result['xirr_pct'].min():+.1f}% ({df_result.iloc[-1]['name']} {df_result.iloc[-1]['code']})")
print(f"  盈利 (>0%) : {(df_result['xirr_pct'] > 0).sum()} 只")
print(f"  亏损 (<0%) : {(df_result['xirr_pct'] < 0).sum()} 只")
print(f"  最大回撤均值: {df_result['max_dd_pct'].mean():.1f}%")

# 保存
out_path = os.path.join(DATA_DIR, "银行股定投回测排名.csv")
df_result.to_csv(out_path, index=False, encoding="utf-8-sig")
print(f"\n  -> 排名已保存: data/银行股定投回测排名.csv")

if errors:
    print(f"\n  [!] {len(errors)} 只失败:")
    for code, name, reason in errors:
        print(f"      {name}({code}): {reason}")
