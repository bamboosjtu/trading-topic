# 攒股收息 R1 桌面应用评审报告

> 评审日期：2026-08-01（第四轮，P1/P2 修复后收敛）
>
> 评审范围：`src/desktop/` 全量源码、`docs/product/` 文档一致性、`AGENTS.md` 工程约束
>
> 评审基线：`git status` 含本轮 P1/P2 修复改动；`npm run typecheck` / `npm test` / `npm run build` 均通过

## 1. 本轮验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | PASS |
| 单元测试 | `npm test` | 161/161 PASS（1 smoke 用例预期 skipped，发布前手动 `npm run smoke:market-data` 跑实） |
| 构建 | `npm run build` | PASS（main / preload / renderer / backupRestoreWorker 四入口） |
| 测试文件 | — | 17 passed / 1 skipped，覆盖领域、适配器、存储、服务、导出、冷启动恢复、备份往返 |

新增覆盖：
- [database.test.ts](electron/storage/database.test.ts) 新增 P1-2 回撤条件校验下的备份往返（单交易日、单调上涨、有回撤已恢复、有回撤未恢复共四种场景）；
- [marketCalendar.test.ts](electron/domain/marketCalendar.test.ts) 新增 `isConfirmedMarketClosureDate` 对 2024—2027 已确认休市日的判定；
- [marketDataProvider.test.ts](electron/data/marketDataProvider.test.ts) 新增结构化 `MarketDataIssue` 与请求区间 error 阻断严格回测的断言。

## 2. 本轮已修复的 P1/P2 问题

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 严格回测接受"已知丢失行情行"的新浪数据 | [shared/contracts.ts:41-47](shared/contracts.ts#L41-L47)、[services/appService.ts](electron/services/appService.ts)、[data/sina.ts](electron/data/sina.ts) | `MarketDataIssue` 改为结构化 `{date?, type, severity, message}`；新浪返回被丢弃 OHLCV 行的具体日期；`AppService.fetchBacktestMarketData()` 在请求范围内存在任何 `severity: "error"` 时立即终止严格回测；前复权问题降级为 warning 但写入结果 `warnings` |
| P1-2 | 无回撤的合法回测备份无法恢复 | [domain/finance.ts](electron/domain/finance.ts)、[domain/backupValidation.ts](electron/domain/backupValidation.ts) | `DrawdownProfile` 的四个日期字段改为 `string \| null`；`maxDrawdown === 0` 时日期必须为 `null`，`maxDrawdown < 0` 时必须为合法日期；最长回撤阶段按是否存在条件校验 |
| P2-1 | 严格行情只检查尾部，没有逐交易日验证内部完整性 | [data/marketDataProvider.ts:103](electron/data/marketDataProvider.ts#L103) | 新增 `detectDateCompletenessIssues()`，对 2024 年起有官方日历的区间按预期交易日逐日核对，更早区间至少进行腾讯/新浪日期集合交叉校验；工作日缺口生成 `warning` |
| P2-2 | 行情校验只排除周末，没有排除已确认法定休市日 | [data/marketDataProvider.ts:85](electron/data/marketDataProvider.ts#L85)、[domain/marketCalendar.ts:77](electron/domain/marketCalendar.ts#L77) | `assertDates()` 调用 `isConfirmedMarketClosureDate()`，对已有官方日历年度同时拒绝周末和确认休市日 |
| P2-3 | 备份校验验证结构，但没有验证核心财务恒等式 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 新增低成本恒等式校验：`totalPnl === endingAsset - totalContribution`、`actualEndDate === priceSeries 最后日期`、`endingAsset === equityCurve 最后资产`；XIRR 重算留作后续审计模式 |
| P2-4 | 实盘行情表依赖"请求区间永不重叠"的隐含前提 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts) | 拆分为 `live_market_prices`（行级来源 + `coverage_id` 外键）和 `live_market_coverage`（请求区间主键）；价格行不再携带请求区间归属 |
| P2-5 | 备份恢复在 Electron 主线程同步读取和解析大型 JSON | [main.ts](electron/main.ts)、[backupRestoreWorker.ts](electron/backupRestoreWorker.ts) | 上限降到 64 MiB；`readFile` / `writeFile` 改为异步；JSON 解析和领域校验在 `worker_threads` 完成，主进程不阻塞 |
| P2-6 | 外部 AbortSignal 监听器没有在正常完成时移除 | [data/_internal/httpClient.ts:54-83](electron/data/_internal/httpClient.ts#L54-L83) | 保存 `onExternalAbort` 引用，在 `finally` 中 `removeEventListener`；新增 `abortReason` 显式记录最先触发的取消原因 |
| P2-7 | `database.ts` 承担过多职责（约 1100 行） | [storage/schema.ts](electron/storage/schema.ts)、[storage/dbUtil.ts](electron/storage/dbUtil.ts)、[storage/ledgerRepository.ts](electron/storage/ledgerRepository.ts)、[storage/backtestRepository.ts](electron/storage/backtestRepository.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts)、[storage/backupRepository.ts](electron/storage/backupRepository.ts)、[storage/database.ts](electron/storage/database.ts) | 一次性结构性拆分：`schema`（版本与指纹）、`dbUtil`（SQL helper）、四个领域仓库、`database` 仅保留门面与设置/目录/日志。未做跨仓库的公共工具抽取 |

附带收敛：第三轮评审中"设置页 UI 缺失"的待处理项已在本轮之前完成。[SettingsPage.tsx](renderer/src/pages/SettingsPage.tsx) 已实现 Schema、固定费用/口径、A 股与 ETF 目录来源、年度交易日历状态、JSON 备份恢复和脱敏日志导出；[README.md:64](README.md#L64) 与 [docs/product/desktop_ui/本地设置_ui_brief.md](../../docs/product/desktop_ui/本地设置_ui_brief.md) 描述与实现一致。

## 3. 仍待处理的问题

### 3.1 P1-R：真实行情冒烟与便携包未在本轮验证

本轮代码改动覆盖腾讯/新浪 HTTP 客户端、新浪长短行情、前复权因子、行级问题结构、日历完整性、外部取消信号、证券目录代码、Schema 拆分，但发布验收清单中的两条独立命令未在本评审会话内执行：

| 命令 | 用途 | 状态 |
| --- | --- | --- |
| `npm run smoke:market-data` | 受控联网验证沪深京 A 股、ETF、腾讯不复权/前复权、新浪不复权/前复权、整段兜底、2011 年至今长区间、收盘前/后/周末/法定休市、来源与切换原因落库；证据写入 `artifacts/market-data-smoke.json` | 未执行 |
| `npm run pack:portable` | 生成 Windows 便携包并验证冷启动后 `better-sqlite3` 原生模块加载 | 未执行 |

发布前必须由具备真实联网环境的发布者完整跑通这两条命令，并保留 `artifacts/market-data-smoke.json` 与便携包冷启动证据。

### 3.2 文档不一致：设置页 UI 简述仍写"Schema 2"

[docs/product/desktop_ui/本地设置_ui_brief.md:39](../../docs/product/desktop_ui/本地设置_ui_brief.md#L39) 与 [:53](../../docs/product/desktop_ui/本地设置_ui_brief.md#L53) 出现"只导出当前 Schema 2"、"页面明确只接受当前 Schema 2"的描述，但 [storage/schema.ts:7](electron/storage/schema.ts#L7) `SCHEMA_VERSION = 1`，且本轮明确"数据库版本始终为 1，不发版不迁移"。两处需改为"Schema 1"。

### 3.3 第二轮评审登记的功能性待排期项

以下为第二轮评审报告 §7.3 登记、本轮未一并处理的功能性建议，按优先级保留：

| 类别 | 待办 | 优先级建议 |
| --- | --- | --- |
| 现金账户闭环 | 当前指标只覆盖累计买入/卖出/分红/净投入，缺少当前现金余额、可用现金、外部转入/转出、总资产 = 持仓市值 + 现金余额 等口径 | 高 |
| 时间口径统一 | 三页同时出现"行情更新 / 数据截止 / 数据截点 / 最近记录"四个相似但不同的概念，用户难推断 | 中 |
| 持仓页增加持仓占比、当日盈亏列 | 当前缺这两列，对组合管理价值高于"累计买入支出"逐行重复 | 中 |
| 持仓页指标名称精确化 | "累计投入"当前定义为 买入 − 卖出 − 分红，分红属于账户内部收益，不应等同撤回本金 | 中（涉及口径重定义） |
| 收益日历选中日期视觉状态 | 7 月 28 日格子同时出现蓝色选择边框和红色底部线条，视觉上像两个状态叠加 | 低 |
| 交易流水筛选栏密度优化 | 当前 5 个字段占满一行，MVP 阶段可收缩为 日期 \| 类型 \| 搜索 \| 查询 + 更多筛选 | 低 |

### 3.4 低优先级观察

1. **构建产物 chunk 较大**：`BacktestPage-*.js` 2.61 MB、`format-*.js` 1.04 MB（含 echarts）。R1 单端本地应用，体积不影响启动性能，未做 `manualChunks` 拆分属可接受现状。
2. **`AppSettings.commissionRate` / `minimumCommission` 硬编码为 0**：R1 费用口径固定为 0（PRD §3.1），现已在 [SettingsPage.tsx:208-215](renderer/src/pages/SettingsPage.tsx#L208-L215) 只读展示；若未来开放费用配置，需要同步打开写入路径与回测消费点。

## 4. 结论

| 维度 | 结论 |
| --- | --- |
| 三域隔离 | PASS |
| Electron 进程与安全边界 | PASS |
| IPC 通道一致性 | PASS |
| 领域分层 | PASS |
| 死代码 / 无效测试 / 无效样式 | PASS |
| 文档链接 | PASS |
| 文档与实现一致性 | **本地设置 UI 简述两处仍写 Schema 2**（见 §3.2） |
| 类型检查 / 测试 / 构建 | PASS |
| P1/P2 修复 | 9 项全部完成（P1-1、P1-2、P2-1～P2-7） |
| 发布前真实行情与便携包验证 | **未执行**（见 §3.1） |

**总体**：本轮 P1/P2 问题清单的代码层修复已全部收敛，单元测试与构建均通过。发布前剩余两件事：(1) 由具备联网环境的发布者执行 `npm run smoke:market-data` 与 `npm run pack:portable` 并保留证据；(2) 修正 [本地设置_ui_brief.md](../../docs/product/desktop_ui/本地设置_ui_brief.md) 两处 "Schema 2" 描述为 "Schema 1"。第二轮评审的功能性建议（现金账户闭环等）按 §3.3 优先级排期。
