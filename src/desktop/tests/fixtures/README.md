# 产品测试 Fixture

> 三域隔离约束：见 [docs/product/ARCHITECTURE.md §3](../../../../docs/product/ARCHITECTURE.md)

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

## R1 当前状态

R1 暂未接收 Research 快照。XIRR、最大回撤、交易日顺延、整数手、分红再投资、
流水冲正和账户重建均使用产品域内的确定性测试向量，见
`electron/domain/analysis.test.ts` 与 `electron/storage/database.test.ts`。

因此，删除或移动 `research/`、`labs/` 不会影响产品构建与测试。后续若接收新的研究
结论，必须按上表固化为产品自有 fixture，经评审后再纳入产品测试。
