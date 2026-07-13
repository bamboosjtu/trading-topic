"""
实验四：yfinance 基础实验
目标：使用 yfinance 获取美股行情、基本面、投资组合对比
"""

import yfinance as yf
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

# ============================================================
# 任务 1：Ticker 对象 & 基本信息
# ============================================================
print("=" * 60)
print("任务 1：苹果(AAPL)基本信息")
print("=" * 60)

aapl = yf.Ticker("AAPL")
info = aapl.info

# 提取关键信息
key_info = {
    "公司名称": info.get("longName"),
    "行业": info.get("sector"),
    "细分行业": info.get("industry"),
    "市值": f"${info.get('marketCap', 0) / 1e12:.2f}T" if info.get("marketCap") else "N/A",
    "市盈率(TTM)": info.get("trailingPE"),
    "前瞻市盈率": info.get("forwardPE"),
    "市净率": info.get("priceToBook"),
    "股息率": info.get("dividendYield"),
    "52周最高": info.get("fiftyTwoWeekHigh"),
    "52周最低": info.get("fiftyTwoWeekLow"),
    "员工数": info.get("fullTimeEmployees"),
    "国家": info.get("country"),
}

for k, v in key_info.items():
    if isinstance(v, float):
        print(f"  {k}: {v:.2f}")
    else:
        print(f"  {k}: {v}")

# ============================================================
# 任务 2：历史K线 & 收益率分析
# ============================================================
print("\n" + "=" * 60)
print("任务 2：AAPL 历史K线与收益率")
print("=" * 60)

# 获取 5 年历史数据
hist = aapl.history(period="5y")
print(f"数据范围: {hist.index[0].date()} → {hist.index[-1].date()}")
print(f"数据条数: {len(hist)}")
print(hist.tail())

# 计算收益率
returns = hist["Close"].pct_change().dropna()
print(f"\n日收益率统计:")
print(f"  均值:        {returns.mean() * 100:.4f}%")
print(f"  标准差:      {returns.std() * 100:.4f}%")
print(f"  年化收益率:  {((1 + returns.mean())**252 - 1) * 100:.2f}%")
print(f"  年化波动率:  {returns.std() * np.sqrt(252) * 100:.2f}%")
print(f"  夏普比率:    {(returns.mean() / returns.std()) * np.sqrt(252):.2f}")

# 画收盘价 + 回撤
fig, axes = plt.subplots(3, 1, figsize=(14, 10),
                         gridspec_kw={"height_ratios": [2, 1, 1]})

axes[0].plot(hist.index, hist["Close"], color="#2196F3", linewidth=1, label="收盘价")
axes[0].plot(hist.index, hist["Close"].rolling(50).mean(),
             color="#FF9800", linewidth=1, label="MA50", alpha=0.8)
axes[0].plot(hist.index, hist["Close"].rolling(200).mean(),
             color="#F44336", linewidth=1, label="MA200", alpha=0.8)
axes[0].set_title("AAPL 5年收盘价 & 均线", fontsize=14)
axes[0].legend(loc="upper left")
axes[0].grid(True, alpha=0.3)
axes[0].set_ylabel("价格 (USD)")

axes[1].bar(returns.index, returns * 100,
            color=["#4CAF50" if r > 0 else "#F44336" for r in returns],
            alpha=0.5, width=1)
axes[1].axhline(y=0, color="black", linewidth=0.5)
axes[1].set_title("日收益率 (%)", fontsize=12)
axes[1].set_ylabel("%")
axes[1].grid(True, alpha=0.3)

cummax = hist["Close"].cummax()
drawdown = (hist["Close"] - cummax) / cummax * 100
axes[2].fill_between(hist.index, drawdown, 0, color="#F44336", alpha=0.5)
axes[2].set_title("回撤 (%)", fontsize=12)
axes[2].set_ylabel("%")
axes[2].grid(True, alpha=0.3)
axes[2].set_ylim(drawdown.min() * 1.1, 1)

plt.tight_layout()
plt.savefig("lab4_task2_aapl.png", dpi=150)
plt.close()
print("→ 图表已保存: lab4_task2_aapl.png")

# ============================================================
# 任务 3：分红历史
# ============================================================
print("\n" + "=" * 60)
print("任务 3：AAPL 分红与拆股历史")
print("=" * 60)

print("\n📊 最近 10 次分红:")
print(aapl.dividends.tail(10).to_string())

print(f"\n📊 拆股历史:")
print(aapl.splits.to_string())

# ============================================================
# 任务 4：投资组合对比 — 科技巨头
# ============================================================
print("\n" + "=" * 60)
print("任务 4：FAANG 组合对比")
print("=" * 60)

tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "META"]
df_close = yf.download(tickers, start="2023-01-01")["Close"]

# 归一化到 100
df_norm = df_close / df_close.iloc[0] * 100

print(f"数据形状: {df_norm.shape}")
print(f"\n各标的累计收益率 (2023.1.1 → 今):")
for t in tickers:
    total_return = (df_close[t].iloc[-1] / df_close[t].iloc[0] - 1) * 100
    print(f"  {t:>8s}: {total_return:>+8.2f}%")

# 画对比图
fig, ax = plt.subplots(figsize=(14, 6))
colors = ["#2196F3", "#4CAF50", "#F44336", "#FF9800", "#9C27B0"]
for ticker, color in zip(tickers, colors):
    ax.plot(df_norm.index, df_norm[ticker], color=color, linewidth=1.5, label=ticker)
ax.set_title("FAANG 累计收益对比 (2023.1.1 = 100)", fontsize=14)
ax.legend(loc="upper left")
ax.grid(True, alpha=0.3)
ax.set_ylabel("归一化价格")
plt.tight_layout()
plt.savefig("lab4_task4_faang.png", dpi=150)
plt.close()
print("→ 图表已保存: lab4_task4_faang.png")

# ============================================================
# 任务 5（选做）：A股 & 港股支持
# ============================================================
print("\n" + "=" * 60)
print("任务 5（选做）：yfinance 获取 A股/港股")
print("=" * 60)

test_symbols = {
    "茅台": "600519.SS",
    "腾讯": "0700.HK",
    "比亚迪A": "002594.SZ",
}

for name, symbol in test_symbols.items():
    try:
        tk = yf.Ticker(symbol)
        hist = tk.history(period="1mo")
        if not hist.empty:
            print(f"  {name} ({symbol}): {len(hist)} 条日线, "
                  f"最新收盘 {hist['Close'].iloc[-1]:.2f}")
        else:
            print(f"  {name} ({symbol}): 无数据（可能需要科学上网）")
    except Exception as e:
        print(f"  {name} ({symbol}): 获取失败 - {e}")

print("\n✅ 实验四完成！")
