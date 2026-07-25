# 产品测试 Fixture

> 三域隔离约束：见 [docs/product/ARCHITECTURE.md §3](../../../docs/product/ARCHITECTURE.md)

本目录是产品域自有的测试 fixture，**不允许**在运行时读取 `research/bank-dca/data/` 或 `labs/`。

## Fixture 转移规则

从 Research 转入 fixture 时，每个 fixture 必须包含：

| 字段 | 说明 |
| --- | --- |
| `source` | 来源说明（如 `research/bank-dca/data/verification.json@<commit>`） |
| `data_cutoff` | 数据截止日 |
| `caliber_version` | 金融口径版本（如 `bank-dca-v1`） |
| `review_record` | 评审记录链接或文档路径 |
| `expected` | 预期逐笔流水与汇总指标 |

## 当前状态

R1 实现阶段待转入：

- [ ] `bank-dca-xirr-baseline.json`：从 `research/bank-dca/data/verification.json` 推导 7 行资产 XIRR 基线
- [ ] `bank-dca-drawdown-baseline.json`：最大回撤容差基线
- [ ] `dividend-reinvest-flow.json`：分红再投资逐笔流水基线

转移完成后，删除或移动 `research/` 工作目录不应导致产品测试失败。
