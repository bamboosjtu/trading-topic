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

## R1 已接收的 Research 快照

`research-verification.json` 是从 `research/bank-dca/data/verification.json@f1d8c769`
复制的口径基准快照（2026-07-25 复制，data_cutoff=2026-07-20，caliber_version=bank-dca-v1）。
顶层 `_meta` 字段记录来源、评审记录与口径说明，符合上表转移规则。

该 fixture 当前用途：

- 核对产品端回测的分红事件数、价格行数与 XIRR 量级是否落在研究端基准附近；
- 验证产品端 `nav`（标的总收益净值）构建逻辑与 research `build_total_return_history`
  口径一致，确保最大回撤可对比。

**尚未实现**的完整逐笔一致性对比：研究端 verification.json 只含汇总指标，产品端
R1 实时从腾讯/东财拉取数据，无法在离线测试中重现同一原始数据。R2 计划引入离线
数据快照（价格+分红逐笔）作为 golden fixture，实现"相同原始数据 + 相同时间区间
+ 相同投资规则 = 产品端与研究端得到相同结果"的硬一致性测试。

## R1 当前状态

XIRR、最大回撤、交易日顺延、零碎股、分红回购、送股/转增、流水冲正和账户重建
均使用产品域内的确定性测试向量，见 `electron/domain/analysis.test.ts` 与
`electron/storage/database.test.ts`。
研究端 verification.json 仅作为口径基准参考（P0-3）。

因此，删除或移动 `research/`、`labs/` 不会影响产品构建与测试。后续若接收新的研究
结论，必须按上表固化为产品自有 fixture，经评审后再纳入产品测试。

## 已实现的业务规则

以下规则已在产品端回测引擎中实现，并由产品域内的确定性测试覆盖。

### 分红与送转

- `analysis.ts` 允许零碎股，定投资金和现金分红均以费用 0 的口径全额买入；
- 现金分红先产生到账流水，再产生回购流水，二者金额可以逐笔核对；
- 送股/转增字段按“每 10 股增加多少股”解释，使用登记日持股计算，并在除权日
  产生 `share_adjustment` 流水；
- 明细由主回测交易流水转换，不再单独模拟。

### P1-3：分红到账日模式区分

- **已实现**：`BacktestRequest.dividendTiming` 支持两种模式：
  - `ex_date`（默认，研究兼容）：除权日立即派息并再投资，对齐 research/bank-dca v1。
  - `payment_date`（真实交易）：分红在实际到账日（`paymentDate`，缺失时回退到除权日）
    处理，到账后才进入 `dividendCash` 并可再投资。股权登记日（`recordDate`）仍用于
    判定 entitled shares。
- **向后兼容**：默认 `ex_date` 模式，行为与研究端 v1 一致，P0-3 口径可对比。

### 累计金额

- `cumulativeContribution` 只统计用户外部投入；
- `cumulativeInvestment` 统计全部买入成交金额，包含定投买入与分红回购；
- 两者分别展示，避免“金额/分红”混列造成误导。
