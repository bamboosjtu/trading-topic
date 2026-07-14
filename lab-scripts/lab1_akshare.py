"""
实验一：akshare 基础实验
依赖：pip install akshare pandas matplotlib mootdx
"""
import time
import akshare as ak
import pandas as pd
import matplotlib.pyplot as plt
from mootdx.quotes import Quotes

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False
tdx = Quotes.factory(market="std")


def safe_call(fn, label, *args, **kwargs):
    try:
        result = fn(*args, **kwargs)
        print(f"[√] {label} 成功")
        return result
    except Exception as e:
        print(f"[!] {label} 失败: {type(e).__name__}: {e}")
        return None


def find_col(df, *candidates):
    for c in df.columns:
        for cand in candidates:
            if cand.lower() == c.lower() or cand in c:
                return c
    return df.columns[0]


# ============================================================
# 任务 1：A 股历史日线（东财 → 腾讯兜底）
# ============================================================
print("=" * 60)
print("任务 1：平安银行(000001) 历史日线")
print("=" * 60)

df = safe_call(
    ak.stock_zh_a_hist,
    "stock_zh_a_hist(东财源)",
    symbol="000001", period="daily",
    start_date="20240101", end_date="20240701", adjust="qfq",
)
if df is None:
    time.sleep(2)
    df = safe_call(
        ak.stock_zh_a_hist_tx,
        "stock_zh_a_hist_tx(腾讯源·兜底)",
        symbol="sz000001",
        start_date="20240101", end_date="20240701", adjust="qfq",
    )

if df is not None:
    print(f"形状: {df.shape}")
    print(df.head())
    date_c = find_col(df, "date", "日期")
    close_c = find_col(df, "close", "收盘")
    vol_c = find_col(df, "vol", "amount", "成交量")
    df[date_c] = pd.to_datetime(df[date_c])
    df = df.set_index(date_c)

    fig, axes = plt.subplots(2, 1, figsize=(12, 8))
    axes[0].plot(df.index, df[close_c], color="#2196F3", linewidth=1.2)
    axes[0].set_title("平安银行(000001) 收盘价", fontsize=14)
    axes[0].grid(True, alpha=0.3)
    axes[1].bar(df.index, df[vol_c], color="#FF9800", alpha=0.6)
    axes[1].set_title("成交量", fontsize=14)
    axes[1].grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("lab1_task1_kline.png", dpi=150)
    plt.close()
    print("→ lab1_task1_kline.png")
else:
    print("任务1 跳过")

# ============================================================
# 任务 2：实时行情（通达信 UDP 协议）
# ============================================================
print("\n" + "=" * 60)
print("任务 2：A 股实时行情（通达信源）")
print("=" * 60)

SAMPLE_CODES = [
    "000001", "000858", "002594", "300750", "600519",
    "600036", "601318", "600900", "000333", "601857",
]

try:
    quotes = tdx.quotes(symbol=SAMPLE_CODES)
    if quotes is not None and not quotes.empty:
        show_cols = ["code", "price", "open", "high", "low", "volume", "amount"]
        show = quotes[[c for c in show_cols if c in quotes.columns]]
        print(f"共 {len(show)} 只股票:")
        print(show.to_string(index=False))
    else:
        print("返回空（可能非交易时段）")
except Exception as e:
    print(f"[!] 失败: {type(e).__name__}: {e}")

# ============================================================
# 任务 3：行业代表股行情对比（通达信源）
# ============================================================
print("\n" + "=" * 60)
print("任务 3：各行业代表股实时行情")
print("=" * 60)

# 银行、白酒、新能源、医药、保险、电力、家电、石油
SECTOR_STOCKS = {
    "银行": "000001",
    "白酒": "600519",
    "新能源": "002594",
    "医药": "300760",
    "保险": "601318",
    "电力": "600900",
    "家电": "000333",
    "石油": "601857",
}

try:
    codes = list(SECTOR_STOCKS.values())
    quotes = tdx.quotes(symbol=codes)
    if quotes is not None and not quotes.empty:
        quotes["行业"] = quotes["code"].map({v: k for k, v in SECTOR_STOCKS.items()})
        records = []
        for _, row in quotes.iterrows():
            records.append({
                "行业": row["行业"],
                "代码": row["code"],
                "现价": row["price"],
                "开盘": row["open"],
                "最高": row["high"],
                "最低": row["low"],
                "成交额(亿)": row["amount"] / 1e8 if row.get("amount") else 0,
            })
        df_sec = pd.DataFrame(records)
        print(df_sec.to_string(index=False))

        # 柱状图：各行业成交额对比
        fig, ax = plt.subplots(figsize=(10, 5))
        colors = plt.cm.Set3(range(len(df_sec)))
        ax.bar(df_sec["行业"], df_sec["成交额(亿)"], color=colors, alpha=0.8)
        ax.set_title("行业代表股成交额对比", fontsize=14)
        ax.set_ylabel("成交额 (亿元)")
        ax.grid(True, alpha=0.3, axis="y")
        plt.xticks(rotation=30)
        plt.tight_layout()
        plt.savefig("lab1_task3_sector_compare.png", dpi=150)
        plt.close()
        print("→ lab1_task3_sector_compare.png")
    else:
        print("返回空（可能非交易时段）")
except Exception as e:
    print(f"[!] 失败: {type(e).__name__}: {e}")

print("\n实验一完成")
