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

XIRR、最大回撤、交易日顺延、整数手、分红再投资、流水冲正和账户重建均使用产品域内
的确定性测试向量，见 `electron/domain/analysis.test.ts` 与 `electron/storage/database.test.ts`。
研究端 verification.json 仅作为口径基准参考（P0-3）。

因此，删除或移动 `research/`、`labs/` 不会影响产品构建与测试。后续若接收新的研究
结论，必须按上表固化为产品自有 fixture，经评审后再纳入产品测试。

## 已实现的业务规则（P1-4 / P1-5）

以下规则已在产品端回测引擎中实现。默认行为保持"对齐研究端 v1 口径"以保证
P0-3 口径基准可对比；通过 `BacktestRequest` 选项可启用真实交易规则。

### P1-4：分红现金隔离

- **已实现**：`analysis.ts` 将现金拆分为 `dcaCash`（定投待用）与 `dividendCash`
  （分红待再投资）。定投买入只用 `dcaCash`，分红再投资只用 `dividendCash`，
  互不借用。剩余定投资金滚动至下一次计划投资日，分红优先回购原标的。
- **向后兼容**：默认行为下（分红再投资不足一手时），`endingCash` = 两池之和，
  与旧逻辑的 `cash` 一致，不破坏现有测试。
- **与研究端差异**：研究端 `simulate_bank_dca` 的 `execute_buy` 用全部 `cash`，
  产品端隔离后会偏离研究端结果（在分红日与定投日相邻且分红池不足一手时）。
  P0-3 的 fixture 测试不覆盖此边界场景，nav 口径仍可对比。

### P1-3：分红到账日模式区分

- **已实现**：`BacktestRequest.dividendTiming` 支持两种模式：
  - `ex_date`（默认，研究兼容）：除权日立即派息并再投资，对齐 research/bank-dca v1。
  - `payment_date`（真实交易）：分红在实际到账日（`paymentDate`，缺失时回退到除权日）
    处理，到账后才进入 `dividendCash` 并可再投资。股权登记日（`recordDate`）仍用于
    判定 entitled shares。
- **向后兼容**：默认 `ex_date` 模式，行为与研究端 v1 一致，P0-3 口径可对比。

### P1-5：逆回购计息

- **已实现**：`BacktestRequest.repoRate`（默认 0，不计息，向后兼容）。大于 0 时，
  每个交易日对 `dcaCash` 与 `dividendCash` 按实际日历天数计息，利息加入各自池，
  并记录 `repo_interest` 类型流水。对齐 research verification 的 `repo_assumption`
  "前一交易日 204001 定盘利率按实际日历天数计息至下一交易日"。
- **R1 限制**：R1 用固定保守年化利率（由调用方传入）；R2 接入历史 204001 定盘利率
  逐日利率，替代固定值。
- **向后兼容**：默认 `repoRate=0`，不计息，`totalRepoInterest=0`，无 `repo_interest`
  流水，行为与旧版完全一致。

## 已知口径偏离（待 R2 实现）

### 完整逐笔一致性对比

研究端 verification.json 只含汇总指标，产品端 R1 实时从腾讯/东财拉取数据，无法在
离线测试中重现同一原始数据。R2 计划引入离线数据快照（价格+分红逐笔）作为 golden
fixture，实现"相同原始数据 + 相同时间区间 + 相同投资规则 = 产品端与研究端得到相同
结果"的硬一致性测试。
