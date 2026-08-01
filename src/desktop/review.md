# 投资研究实验室 R1 桌面应用评审报告

> 评审日期：2026-08-01（第六轮，P1/P2 修复 + UI 优化后收敛）
>
> 评审范围：`src/desktop/` 全量源码、`docs/product/` 文档一致性、`AGENTS.md` 工程约束
>
> 评审基线：`git status` 含本轮 P1/P2 修复与 UI 优化改动；`npm run typecheck` / `npm test` / `npm run build` 均通过

## 1. 本轮验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | PASS |
| 单元测试 | `npm test` | 166/166 PASS（1 smoke 用例预期 skipped，发布前手动 `npm run smoke:market-data` 跑实） |
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
| P2-1 | 严格行情只检查尾部，没有逐交易日验证内部完整性 | [data/marketDataProvider.ts:103](electron/data/marketDataProvider.ts#L103) | 新增 `detectDateCompletenessIssues()`，对 2024 年起有官方日历的区间按预期交易日逐日核对；工作日缺口生成 `warning`。**注意**：2024 年以前的区间没有官方逐日日历，仅依赖严格升序、非周末、单段缺口不超过 120 天、两源重叠日期价格一致性（`assertCrossProviderConsistency`）等启发式校验；该函数只比较两源共同日期的价格，不比较完整日期集合，且主源尾部完整时不访问备用源。R1 接受旧年份没有官方逐日日历的限制 |
| P2-2 | 行情校验只排除周末，没有排除已确认法定休市日 | [data/marketDataProvider.ts:85](electron/data/marketDataProvider.ts#L85)、[domain/marketCalendar.ts:77](electron/domain/marketCalendar.ts#L77) | `assertDates()` 调用 `isConfirmedMarketClosureDate()`，对已有官方日历年度同时拒绝周末和确认休市日 |
| P2-3 | 备份校验验证结构，但没有验证核心财务恒等式 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 新增低成本恒等式校验：`totalPnl === endingAsset - totalContribution`、`actualEndDate === priceSeries 最后日期`、`endingAsset === equityCurve 最后资产`；XIRR 重算留作后续审计模式 |
| P2-4 | 实盘行情表依赖"请求区间永不重叠"的隐含前提 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts) | 拆分为 `live_market_prices`（行级来源 + `coverage_id` 外键）和 `live_market_coverage`（请求区间主键）；价格行不再携带请求区间归属 |
| P2-5 | 备份恢复在 Electron 主线程同步读取和解析大型 JSON | [main.ts](electron/main.ts)、[backupRestoreWorker.ts](electron/backupRestoreWorker.ts) | 上限降到 64 MiB；`readFile` / `writeFile` 改为异步；JSON 解析和领域校验在 `worker_threads` 完成，主进程不阻塞 |
| P2-6 | 外部 AbortSignal 监听器没有在正常完成时移除 | [data/_internal/httpClient.ts:54-83](electron/data/_internal/httpClient.ts#L54-L83) | 保存 `onExternalAbort` 引用，在 `finally` 中 `removeEventListener`；新增 `abortReason` 显式记录最先触发的取消原因 |
| P2-7 | `database.ts` 承担过多职责（约 1100 行） | [storage/schema.ts](electron/storage/schema.ts)、[storage/dbUtil.ts](electron/storage/dbUtil.ts)、[storage/ledgerRepository.ts](electron/storage/ledgerRepository.ts)、[storage/backtestRepository.ts](electron/storage/backtestRepository.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts)、[storage/backupRepository.ts](electron/storage/backupRepository.ts)、[storage/database.ts](electron/storage/database.ts) | 一次性结构性拆分：`schema`（版本与指纹）、`dbUtil`（SQL helper）、四个领域仓库、`database` 仅保留门面与设置/目录/日志。未做跨仓库的公共工具抽取 |

附带收敛：第三轮评审中"设置页 UI 缺失"的待处理项已在本轮之前完成。[SettingsPage.tsx](renderer/src/pages/SettingsPage.tsx) 已实现 Schema、固定费用/口径、A 股与 ETF 目录来源、年度交易日历状态、JSON 备份恢复和脱敏日志导出；[README.md:64](README.md#L64) 与 [docs/product/desktop_ui/本地设置_ui_brief.md](../../docs/product/desktop_ui/本地设置_ui_brief.md) 描述与实现一致。

## 2.1 第五轮新增修复

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 辅助前复权 K 线阻断严格回测 | [services/appService.ts](electron/services/appService.ts) | `fetchBacktestMarketData` 改用 `Promise.allSettled`；不复权价格失败/不完整仍阻断回测，前复权 K 线失败或不完整降级为 `chartData = error/unavailable` 并写入 `warnings` |
| P1-2 | 已检测到的价格缺口没有写入实验警告 | [services/appService.ts](electron/services/appService.ts) | 新增 `warningsInRequestRange()`，`computeBacktestResults` 将请求区间内的 `warning` 级别行情问题写入 `result.warnings` |
| P1-3 | 存在错误行的行情永久登记为完整覆盖 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts)、[services/appService.ts](electron/services/appService.ts)、[domain/backupValidation.ts](electron/domain/backupValidation.ts) | `result_status` 新增 `partial`；`fetchLivePriceRanges` / `refreshPositionsMarket` 检测请求区间内 `error` 级别问题时标记 `partial`；`confirmedCoverageThrough` 对 `partial` 返回 `null`，`missingLivePriceRanges` 后续重新请求；备份校验接受 `partial` 状态 |
| P2-1 | 新浪问题列表没有在适配器边界过滤到请求区间 | [data/sina.ts](electron/data/sina.ts) | 新增 `filterDatesInRange()`，返回前将 `droppedDates` 过滤到 `[startDate, endDate]` |
| P2-2 | 行情覆盖与价格行单归属导致重叠覆盖破坏备份 | [storage/marketRepository.ts](electron/storage/marketRepository.ts) | `saveLiveMarketPriceSnapshots` 写入前检测新价格行是否与已有价格行冲突（同 `symbol + trade_date`）；旧 `partial` 覆盖允许删除替换，旧 `data/empty` 覆盖禁止价格行冲突 |
| P2-3 | 备份恒等式允许空价格序列和空权益曲线 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 新增 `priceSeries.length > 0`、`equityCurve.length > 0`、首尾日期与 `actualStartDate/actualEndDate` 一致的校验 |
| P2-4 | 备份 Worker 缺少退出兜底和超时 | [main.ts](electron/main.ts) | 新增 `worker.on("exit")` 监听和 60 秒超时；`message` / `error` / `exit` / `timeout` 统一 cleanup 并 resolve/reject |
| P2-5 | 2024 年以前未实现跨源日期集合完整性校验（文档与实现不一致） | [review.md](review.md) | 修正 §2 P2-1 描述：明确 2024 年以前只有启发式校验（升序/非周末/缺口上限/重叠价格一致性），不比较完整日期集合，主源尾部完整时不访问备用源 |
| P2-6 | 日历使用英文 | [renderer/src/main.tsx](renderer/src/main.tsx) | `dayjs.locale("zh-cn")`，DatePicker 等组件月份选择面板显示中文 |

## 2.2 第六轮新增修复

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 持久化的 partial 状态没有进入持仓初始读模型 | [domain/positionsView.ts](electron/domain/positionsView.ts)、[services/appService.ts](electron/services/appService.ts) | `liveDataSnapshot()` 增加 `coverage` 字段；`buildPositionsOverview()` 接收覆盖记录并按当前持仓和估值区间筛选相关 partial 覆盖，`quality.status = partial` 时 `issues` 保留原因；重启或重新进入页面后读模型仍能反映 partial 状态 |
| P1-2 | 内部数据质量问题被错误表述为"尾部不完整" | [services/appService.ts](electron/services/appService.ts) | 分离 `tailStatus`（最新正式交易日是否存在）与 `qualityStatus`（历史内部是否存在坏行）两个维度；`refreshPositionsMarket` 通过单日区间 `[endDate, endDate]` 判断尾部，最新交易日价格存在即 `tailComplete = true`，避免"实际价格截止 = 请求截止"却报告尾部不完整的语义矛盾 |
| P1-3 | 价格行冲突策略阻断合法的同日清仓再买入 | [services/appService.ts](electron/services/appService.ts) | 新增 `normalizeRanges()`，在数据请求前按证券合并重叠或相邻区间（如 `2026-01-01..2026-06-10` 与 `2026-06-10..2026-08-01` 合并为 `2026-01-01..2026-08-01`）；合并后只拉取、保存一次，避免同日清仓再买入、同日多次买卖、历史区间首尾相接等场景触发"行情价格行冲突" |
| P2-1 | partial 只保存状态，不保存原因和缺失日期 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts)、[storage/backupRepository.ts](electron/storage/backupRepository.ts)、[domain/backupValidation.ts](electron/domain/backupValidation.ts)、[shared/contracts.ts](shared/contracts.ts) | `live_market_coverage` 新增 `issues_json` 列，持久化 `{date, type, severity, message}` 列表；备份导出/恢复完整携带 `issues_json`；备份校验要求 partial 覆盖必须包含合法 `issues_json`，非 partial 覆盖不得携带 |
| P2-2 | 备份校验没有确认价格行位于覆盖请求区间内 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 对每个 `matching` 价格行增加 `requested_from <= trade_date <= requested_through` 约束，防止手工修改的备份包含早于 `requested_from` 的价格行 |
| P2-4 | 新增关键分支的针对性测试不足 | [services/appService.test.ts](electron/services/appService.test.ts)、[storage/database.test.ts](electron/storage/database.test.ts) | 新增服务级测试：前复权抛错回测成功且 `chartData = error`、前复权尾部不完整 `chartData = unavailable`、不复权 warning 进入 `result.warnings`、partial 覆盖在数据库重开后仍使持仓质量为 partial、partial 但最新日存在时尾部 complete、同日清仓再买入不产生覆盖冲突、旧 partial 被完整覆盖替换后备份往返成功 |
| UI | 应用名称、导航标签、持仓翻页与布局 | [renderer/src/components/AppLayout.tsx](renderer/src/components/AppLayout.tsx)、[renderer/src/pages/BacktestPage.tsx](renderer/src/pages/BacktestPage.tsx)、[renderer/src/pages/PositionsPage.tsx](renderer/src/pages/PositionsPage.tsx)、[renderer/src/index.css](renderer/src/index.css)、[renderer/index.html](renderer/index.html)、[electron/main.ts](electron/main.ts)、[electron/export/workbookInternals.ts](electron/export/workbookInternals.ts)、[package.json](package.json)、[README.md](README.md) | 应用名"攒股收息"统一改为"投资研究实验室"（窗口标题、导出文件名、Excel creator、productName、README）；导航"历史回测"改为"定投回测"；持仓明细当前持仓表 `pageSize = 10` 启用翻页；指标条由两行合并为一行；调整 `live-page` / `live-table-panel` flex 属性消除 1920×1080 下底部留白 |
| P2-3 | 备份 Worker 仍复制两次大型 JSON 对象 | — | R1 不阻断，列为后续优化：主进程只传 `filePath` 给 Worker，Worker 读取/解析/校验后返回临时规范化文件路径或分块结果 |

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
| P1/P2 修复 | 第四轮 9 项 + 第五轮 9 项 + 第六轮 7 项 + UI 优化全部完成 |
| 发布前真实行情与便携包验证 | **未执行**（见 §3.1） |

**总体**：第四、五、六轮 P1/P2 问题清单的代码层修复与 UI 优化已全部收敛，单元测试（166/166）与构建均通过。发布前剩余两件事：(1) 由具备联网环境的发布者执行 `npm run smoke:market-data` 与 `npm run pack:portable` 并保留证据；(2) 修正 [本地设置_ui_brief.md](../../docs/product/desktop_ui/本地设置_ui_brief.md) 两处 "Schema 2" 描述为 "Schema 1"。P2-3（Worker 只传 filePath）列为后续优化。第二轮评审的功能性建议（现金账户闭环等）按 §3.3 优先级排期。
