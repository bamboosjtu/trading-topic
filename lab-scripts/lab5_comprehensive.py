"""
综合实验：跨包数据联动
目标：结合 yfinance + ccxt + akshare，分析 BTC 与中美科技股的相关性
"""

import yfinance as yf
import ccxt
import akshare as ak
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

print("=" * 60)
print("综合实验：BTC 与全球科技股相关性分析")
print("=" * 60)

# ============================================================
# Step 1: 用 yfinance 获取美股科技股
# ============================================================
print("\n[1/4] yfinance → 获取美股科技股数据...")
us_tech = ["AAPL", "MSFT", "NVDA", "META"]
df_us = yf.download(us_tech, start="2023-07-01")["Close"]
df_us_returns = df_us.pct_change().dropna()
print(f"  美股数据: {df_us_returns.shape}")

# ============================================================
# Step 2: 用 ccxt 获取 BTC 价格
# ============================================================
print("[2/4] ccxt → 获取 BTC/USDT 日线...")
exchange = ccxt.binance({"enableRateLimit": True})
ohlcv = exchange.fetch_ohlcv(
    "BTC/USDT", "1d",
    since=exchange.parse8601("2023-07-01T00:00:00Z")
)
df_btc = pd.DataFrame(
    ohlcv,
    columns=["timestamp", "open", "high", "low", "close", "volume"]
)
df_btc["timestamp"] = pd.to_datetime(df_btc["timestamp"], unit="ms")
df_btc.set_index("timestamp", inplace=True)
btc_returns = df_btc["close"].pct_change().dropna()
print(f"  BTC数据: {len(btc_returns)} 条日线")

# ============================================================
# Step 3: 用 akshare 获取 A 股科技股
# ============================================================
print("[3/4] akshare → 获取A股科技股数据...")
cn_tech_codes = ["002371", "688981", "603501", "002049"]
cn_tech_names = ["北方华创", "中芯国际", "韦尔股份", "紫光国微"]
cn_data = {}

for code, name in zip(cn_tech_codes, cn_tech_names):
    try:
        df = ak.stock_zh_a_hist(
            symbol=code, period="daily",
            start_date="20230701", end_date="20250701",
            adjust="qfq"
        )
        df["日期"] = pd.to_datetime(df["日期"])
        df.set_index("日期", inplace=True)
        cn_data[name] = df["收盘"]
        print(f"  {name}({code}): {len(df)} 条")
    except Exception as e:
        print(f"  {name}({code}): 获取失败 - {e}")

df_cn = pd.DataFrame(cn_data)
df_cn_returns = df_cn.pct_change().dropna()
print(f"  A股数据: {df_cn_returns.shape}")

# ============================================================
# Step 4: 对齐日期 & 计算相关性
# ============================================================
print("[4/4] 对齐日期 & 计算相关性矩阵...")

# 合并所有收益率数据
all_returns = df_us_returns.copy()
all_returns["BTC"] = btc_returns
for col in df_cn_returns.columns:
    all_returns[col] = df_cn_returns[col]

all_returns = all_returns.dropna()
print(f"  对齐后数据: {all_returns.shape}")

# 相关性矩阵
corr_matrix = all_returns.corr()

# 画图
fig, axes = plt.subplots(1, 2, figsize=(16, 7))

# 子图1：相关性热力图
mask = np.triu(np.ones_like(corr_matrix, dtype=bool), k=1)
sns.heatmap(corr_matrix, mask=mask, annot=True, fmt=".2f",
            cmap="RdBu_r", center=0, vmin=-1, vmax=1,
            square=True, linewidths=0.5, ax=axes[0],
            cbar_kws={"shrink": 0.8})
axes[0].set_title("BTC · 美股科技 · A股科技 收益率相关性", fontsize=14)

# 子图2：BTC vs 各标的 滚动相关性
rolling_window = 60
btc_roll = all_returns["BTC"].rolling(rolling_window)

for col in ["AAPL", "NVDA", "中芯国际"]:
    if col in all_returns.columns:
        roll_corr = all_returns[col].rolling(rolling_window).corr(all_returns["BTC"])
        axes[1].plot(roll_corr.index, roll_corr, linewidth=1.2, label=f"BTC vs {col}")

axes[1].axhline(y=0, color="black", linewidth=0.5)
axes[1].set_title(f"BTC 与主要科技股 {rolling_window}日滚动相关性", fontsize=14)
axes[1].legend(loc="lower left")
axes[1].set_ylabel("Pearson 相关系数")
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig("comprehensive_correlation.png", dpi=150)
plt.close()
print("\n→ 图表已保存: comprehensive_correlation.png")

# ============================================================
# 结论输出
# ============================================================
print("\n" + "=" * 60)
print("分析结论")
print("=" * 60)

btc_corr = corr_matrix["BTC"].drop("BTC").sort_values(ascending=False)
print("\nBTC 与各标的相关系数排名:")
for asset, corr in btc_corr.items():
    tag = ("强正相关" if corr > 0.5
           else "弱正相关" if corr > 0
           else "弱负相关" if corr > -0.5
           else "强负相关")
    print(f"  {asset:>10s}: {corr:>+6.3f}  ({tag})")

print("\n💡 思考题：")
print("  1. BTC 与美股科技股的相关性是否高于与A股科技股？可能的原因是什么？")
print("  2. 滚动相关性在哪些时间段出现显著变化？对应什么市场事件？")
print("  3. 如果 BTC 与科技股高度相关，它还能充当分散化工具吗？")

print("\n✅ 综合实验完成！")
