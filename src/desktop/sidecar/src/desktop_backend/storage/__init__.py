"""SQLite 存储层（产品域自有实现）。

需求来源：docs/product/ARCHITECTURE.md §8

逻辑表（R1 待实现）：
- ledger_entries：不可变业务流水及冲正关联
- instruments：A 股证券主数据
- market_prices：行情快照、来源和截止时间
- corporate_actions：现金分红及来源字段
- backtest_runs：输入参数、口径版本、来源、告警和结果摘要
- settings：本地配置
- schema_migrations：数据库版本

数据类型约束（ARCHITECTURE §8）：
- 金额与费用使用十进制定点数
- 数量使用整数股
- 日期保存 ISO 8601，交易日按 Asia/Shanghai 解释
- 持仓、现金、总资产和累计盈亏是派生结果，应从流水和估值快照重建

骨架阶段：不创建实际数据库，仅声明迁移版本占位。
"""

SCHEMA_VERSION = "0.1.0"  # 数据库 schema 版本，随迁移递增
