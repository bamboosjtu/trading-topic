"""
实验二：tushare 基础实验
目标：使用 tushare pro 获取标准化行情、财务数据、特色数据
前置：注册 https://tushare.pro 获取 Token
"""

import tushare as ts
import pandas as pd
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

# ============================================================
# 第零步：设置 Token 并初始化 pro_api
# ============================================================
# ⚠️ 请替换为你的 Token: https://tushare.pro → 个人主页 → 接口TOKEN
TOKEN = "你的TOKEN"
ts.set_token(TOKEN)
pro = ts.pro_api()

# ============================================================
# 任务 1：标准化行情获取
# ============================================================
print("=" * 60)
print("任务 1：沪深300成分股日线行情")
print("=" * 60)

# 第一步：获取沪深300成分股列表
df_hs300 = pro.index_weight(index_code="000300.SH", trade_date="20240701")
print(f"沪深300成分股数量: {len(df_hs300)}")

# 第二步：获取成分股日线（批量）
df_daily = pro.daily(
    ts_code=",".join(df_hs300["con_code"].head(5).tolist()),
    start_date="20240101",
    end_date="20240701"
)
print(f"前5只成分股半年日线: {df_daily.shape[0]} 条记录")
print(df_daily.head())

# 第三步：复权因子
df_adj = pro.adj_factor(ts_code="000001.SZ", trade_date="20240701")
print(f"\n平安银行复权因子示例:")
print(df_adj.head())

# ============================================================
# 任务 2：财务报表数据（三张表）
# ============================================================
print("\n" + "=" * 60)
print("任务 2：平安银行 2023 年报三张表")
print("=" * 60)

# 利润表
df_income = pro.income(ts_code="000001.SZ", period="20231231")
print(f"\n📊 利润表 ({len(df_income)} 条):")
if not df_income.empty:
    key_items = df_income[df_income["report_type"] == "1"]  # 合并报表
    cols_show = ["report_type", "total_revenue", "oper_cost", "n_income", "basic_eps"]
    available = [c for c in cols_show if c in key_items.columns]
    print(key_items[available].to_string(index=False))

# 资产负债表
df_bs = pro.balancesheet(ts_code="000001.SZ", period="20231231")
print(f"\n📊 资产负债表 ({len(df_bs)} 条记录)")

# 现金流量表
df_cf = pro.cashflow(ts_code="000001.SZ", period="20231231")
print(f"📊 现金流量表 ({len(df_cf)} 条记录)")

# 关键财务指标（ROE/ROA/毛利率/净利率等）
df_indicator = pro.fina_indicator(ts_code="000001.SZ", period="20231231")
if not df_indicator.empty:
    cols = ["roe", "roa", "grossprofit_margin", "netprofit_margin", "debt_to_assets"]
    available = [c for c in cols if c in df_indicator.columns]
    print(f"\n📊 关键财务指标:")
    print(df_indicator[available].to_string(index=False))

# ============================================================
# 任务 3：龙虎榜数据
# ============================================================
print("\n" + "=" * 60)
print("任务 3：龙虎榜数据")
print("=" * 60)

try:
    df_top = pro.top_list(trade_date="20240628")
    print(f"龙虎榜记录数: {len(df_top)}")
    if not df_top.empty:
        print(df_top[["ts_code", "name", "pct_change", "net_buy_amount"]].head(10).to_string(index=False))
except Exception as e:
    print(f"龙虎榜获取失败（可能需要更高积分）: {e}")

# ============================================================
# 任务 4（选做）：探索更多接口
# ============================================================
print("\n" + "=" * 60)
print("任务 4（选做）：探索 tushare 接口体系")
print("=" * 60)

# 可尝试的其他接口:
# pro.daily_basic()  - 每日指标（PE/PB/换手率）
# pro.moneyflow()    - 资金流向
# pro.stk_factor()   - 股票因子

try:
    df_basic = pro.daily_basic(ts_code="000001.SZ", trade_date="20240701")
    print("每日指标 (daily_basic):")
    print(df_basic.to_string(index=False))
except Exception as e:
    print(f"daily_basic 失败: {e}")

print("\n✅ 实验二完成！")
