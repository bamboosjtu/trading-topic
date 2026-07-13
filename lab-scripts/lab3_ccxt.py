"""
实验三：ccxt 基础实验
目标：使用 ccxt 获取加密货币行情、K线、订单簿，理解统一接口设计
"""

import ccxt
import pandas as pd
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

# ============================================================
# 任务 1：探索交易所列表 & 统一接口
# ============================================================
print("=" * 60)
print("任务 1：ccxt 支持的交易所概览")
print("=" * 60)

exchanges = ccxt.exchanges
print(f"ccxt 支持的交易所总数: {len(exchanges)}")
print(f"部分交易所: {exchanges[:10]}")

# 查看 Binance 支持的功能
print(f"\nBinance 支持的功能:")
exchange = ccxt.binance()
for k, v in list(exchange.has.items())[:15]:
    print(f"  {k}: {v}")

# ============================================================
# 任务 2：获取 BTC/USDT 行情
# ============================================================
print("\n" + "=" * 60)
print("任务 2：Binance BTC/USDT 实时行情")
print("=" * 60)

exchange = ccxt.binance({"enableRateLimit": True})

# 加载交易对信息
markets = exchange.load_markets()
print(f"Binance 交易对总数: {len(markets)}")

# 实时 ticker
ticker = exchange.fetch_ticker("BTC/USDT")
print(f"\nBTC/USDT 实时行情:")
print(f"  最新价:   {ticker['last']:>12.2f} USDT")
print(f"  24h最高:  {ticker['high']:>12.2f} USDT")
print(f"  24h最低:  {ticker['low']:>12.2f} USDT")
print(f"  24h成交量: {ticker['baseVolume']:>12.2f} BTC")
print(f"  24h涨跌幅: {ticker['percentage']:>+10.2f}%")
print(f"  买一/卖一: {ticker['bid']:.2f} / {ticker['ask']:.2f}")

# ============================================================
# 任务 3：K线数据 & 技术分析基础
# ============================================================
print("\n" + "=" * 60)
print("任务 3：BTC/USDT K线数据")
print("=" * 60)

# 获取日K线（最近 200 根）
ohlcv = exchange.fetch_ohlcv("BTC/USDT", "1d", limit=200)
df = pd.DataFrame(
    ohlcv,
    columns=["timestamp", "open", "high", "low", "close", "volume"]
)
df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
df.set_index("timestamp", inplace=True)
print(f"K线数据形状: {df.shape}")
print(df.tail())

# 画 K 线图（简化版：收盘价 + 成交量）
fig, axes = plt.subplots(2, 1, figsize=(14, 8), gridspec_kw={"height_ratios": [3, 1]})

axes[0].plot(df.index, df["close"], color="#2196F3", linewidth=1.2, label="收盘价")
axes[0].fill_between(df.index, df["close"], df["close"].rolling(20).mean(),
                     alpha=0.3, color="#2196F3", label="MA20偏离")
axes[0].plot(df.index, df["close"].rolling(20).mean(), color="#FF9800",
             linewidth=0.8, linestyle="--", label="MA20")
axes[0].set_title("BTC/USDT 日线收盘价 & MA20", fontsize=14)
axes[0].legend(loc="upper left")
axes[0].grid(True, alpha=0.3)
axes[0].set_ylabel("价格 (USDT)")

axes[1].bar(df.index, df["volume"], color="#4CAF50", alpha=0.5, width=0.8)
axes[1].set_title("成交量", fontsize=12)
axes[1].set_ylabel("成交量 (BTC)")
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig("lab3_task3_btc_kline.png", dpi=150)
plt.close()
print("→ 图表已保存: lab3_task3_btc_kline.png")

# ============================================================
# 任务 4：多交易所比价（套利信号）
# ============================================================
print("\n" + "=" * 60)
print("任务 4：多交易所 BTC/USDT 比价")
print("=" * 60)

exchanges_to_check = ["binance", "okx", "bybit", "gate"]
prices = {}

for ex_id in exchanges_to_check:
    try:
        ex = getattr(ccxt, ex_id)({"enableRateLimit": True})
        ticker = ex.fetch_ticker("BTC/USDT")
        prices[ex_id] = {
            "last": ticker["last"],
            "bid": ticker.get("bid"),
            "ask": ticker.get("ask"),
            "spread": (ticker.get("ask", 0) - ticker.get("bid", 0)) if ticker.get("ask") and ticker.get("bid") else None
        }
        print(f"  {ex_id:>10s}: 最新 {prices[ex_id]['last']:>12.2f}  "
              f"买 {prices[ex_id].get('bid', 'N/A')}  卖 {prices[ex_id].get('ask', 'N/A')}")
    except Exception as e:
        print(f"  {ex_id:>10s}: 获取失败 - {e}")

# 算价差
valid_prices = {k: v["last"] for k, v in prices.items() if v["last"]}
if len(valid_prices) >= 2:
    max_ex = max(valid_prices, key=valid_prices.get)
    min_ex = min(valid_prices, key=valid_prices.get)
    spread_pct = (valid_prices[max_ex] - valid_prices[min_ex]) / valid_prices[min_ex] * 100
    print(f"\n📊 最大价差: {max_ex}({valid_prices[max_ex]:.2f}) ↔ {min_ex}({valid_prices[min_ex]:.2f})")
    print(f"   价差比例: {spread_pct:.4f}%")
    if spread_pct < 0.5:
        print("   → 价差很小，套利空间有限（正常市场状态）")

# ============================================================
# 任务 5（选做）：订单簿深度分析
# ============================================================
print("\n" + "=" * 60)
print("任务 5（选做）：BTC/USDT 订单簿深度")
print("=" * 60)

exchange = ccxt.binance({"enableRateLimit": True})
orderbook = exchange.fetch_order_book("BTC/USDT", limit=50)

df_bids = pd.DataFrame(orderbook["bids"], columns=["price", "amount"])
df_asks = pd.DataFrame(orderbook["asks"], columns=["price", "amount"])

df_bids["cumulative"] = df_bids["amount"].cumsum()
df_asks["cumulative"] = df_asks["amount"].cumsum()

print(f"买盘深度 (前5档):")
print(df_bids.head().to_string(index=False))
print(f"\n卖盘深度 (前5档):")
print(df_asks.head().to_string(index=False))

# 画深度图
fig, ax = plt.subplots(figsize=(10, 5))
ax.fill_between(df_bids["price"], df_bids["cumulative"], step="post",
                color="#4CAF50", alpha=0.4, label="买盘")
ax.fill_between(df_asks["price"], df_asks["cumulative"], step="post",
                color="#F44336", alpha=0.4, label="卖盘")
ax.set_title("BTC/USDT 订单簿深度 (Binance)", fontsize=14)
ax.set_xlabel("价格 (USDT)")
ax.set_ylabel("累计数量 (BTC)")
ax.legend()
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig("lab3_task5_depth.png", dpi=150)
plt.close()
print("→ 图表已保存: lab3_task5_depth.png")

print("\n✅ 实验三完成！")
