"""
实验一：akshare 基础实验
目标：使用 akshare 获取 A 股行情、基本面、另类数据
依赖：pip install akshare pandas matplotlib
"""

import akshare as ak
import pandas as pd
import matplotlib.pyplot as plt

# 设置中文显示
plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

# ============================================================
# 任务 1：获取 A 股历史日线数据
# ============================================================
print("=" * 60)
print("任务 1：获取平安银行(000001) 2024 年日线数据")
print("=" * 60)

df_daily = ak.stock_zh_a_hist(
    symbol="000001",
    period="daily",
    start_date="20240101",
    end_date="20240701",
    adjust="qfq"  # 前复权
)

print(f"数据形状: {df_daily.shape}")
print(df_daily.head())
print(f"\n列名: {df_daily.columns.tolist()}")

# 画收盘价走势
df_daily["日期"] = pd.to_datetime(df_daily["日期"])
df_daily.set_index("日期", inplace=True)

fig, axes = plt.subplots(2, 1, figsize=(12, 8))

axes[0].plot(df_daily.index, df_daily["收盘"], color="#2196F3", linewidth=1.2)
axes[0].set_title("平安银行(000001) 2024年H1 收盘价", fontsize=14)
axes[0].set_ylabel("价格 (元)")
axes[0].grid(True, alpha=0.3)

axes[1].bar(df_daily.index, df_daily["成交量"], color="#FF9800", alpha=0.6, width=0.8)
axes[1].set_title("成交量", fontsize=14)
axes[1].set_ylabel("成交量 (手)")
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig("lab1_task1_kline.png", dpi=150)
plt.close()
print("→ 图表已保存: lab1_task1_kline.png")

# ============================================================
# 任务 2：获取全市场实时行情快照
# ============================================================
print("\n" + "=" * 60)
print("任务 2：A股全市场实时行情快照")
print("=" * 60)

df_spot = ak.stock_zh_a_spot_em()

print(f"全市场股票数: {len(df_spot)}")
print(f"列名: {df_spot.columns.tolist()[:10]}...")

# 按成交额排序 TOP10
if "成交额" in df_spot.columns:
    top10_amount = df_spot.nlargest(10, "成交额")[["代码", "名称", "最新价", "涨跌幅", "成交额", "换手率"]]
    print("\n📊 成交额 TOP10：")
    print(top10_amount.to_string(index=False))

# 涨停股数量
if "涨跌幅" in df_spot.columns:
    limit_up = df_spot[df_spot["涨跌幅"] >= 9.8]
    limit_down = df_spot[df_spot["涨跌幅"] <= -9.8]
    print(f"\n涨停家数(≥9.8%): {len(limit_up)}")
    print(f"跌停家数(≤-9.8%): {len(limit_down)}")

# ============================================================
# 任务 3：北向资金流向
# ============================================================
print("\n" + "=" * 60)
print("任务 3：北向资金历史流向")
print("=" * 60)

df_north = ak.stock_hsgt_north_net_flow_in_em(symbol="北上")
print(f"数据形状: {df_north.shape}")
print(df_north.tail(10))

# 画北向资金累计图
if "value" in df_north.columns or "数值" in df_north.columns:
    value_col = "value" if "value" in df_north.columns else "数值"
    date_col = "date" if "date" in df_north.columns else "日期"

    df_north["date"] = pd.to_datetime(df_north[date_col])
    df_north = df_north.sort_values("date")
    df_north["cumsum"] = df_north[value_col].cumsum()

    fig, ax = plt.subplots(figsize=(12, 4))
    ax.bar(df_north["date"], df_north[value_col],
           color=["#4CAF50" if v > 0 else "#F44336" for v in df_north[value_col]],
           alpha=0.6)
    ax2 = ax.twinx()
    ax2.plot(df_north["date"], df_north["cumsum"], color="#2196F3", linewidth=1.5)
    ax.set_title("北向资金每日净流入 & 累计净流入", fontsize=14)
    ax.set_ylabel("每日净流入 (亿元)")
    ax2.set_ylabel("累计净流入 (亿元)")
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig("lab1_task3_north_flow.png", dpi=150)
    plt.close()
    print("→ 图表已保存: lab1_task3_north_flow.png")

# ============================================================
# 任务 4（选做）：股票基本信息
# ============================================================
print("\n" + "=" * 60)
print("任务 4（选做）：获取个股基本信息")
print("=" * 60)

try:
    df_info = ak.stock_individual_info_em(symbol="000001")
    print(df_info.to_string(index=False))
except Exception as e:
    print(f"接口可能已变更: {e}")

print("\n✅ 实验一完成！")
