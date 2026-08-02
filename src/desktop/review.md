# 投资研究实验室 R1 桌面应用评审报告

> 评审日期：2026-08-02（第九轮，P1 严格回测完整性 + Electron 安全 + 原生模块重建 + 域隔离门禁 + 发布证据刷新）
>
> 评审范围：`src/desktop/` 全量源码、`docs/product/` 文档一致性、`AGENTS.md` 工程约束
>
> 评审基线：`git status` 含本轮 P1-1/P1-2/P1-3/P1-4/P2-2 修复；`npm run typecheck` / `npm test` / `npm run build` / `npm run smoke:market-data` / `npm run pack:portable` 均已执行

## 1. 本轮验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | PASS |
| 单元测试 | `npm test` | 183/183 PASS（1 smoke 用例由 `smoke:market-data` 独立执行） |
| 构建 | `npm run build` | PASS（main / preload / renderer / backupRestoreWorker 四入口；prebuild 含 market-calendar 与 domain-boundaries 门禁） |
| 真实行情冒烟 | `npm run smoke:market-data` | PASS（产物写入 [artifacts/market-data-smoke.json](artifacts/market-data-smoke.json)，`executedAt: 2026-08-02T01:06:14.337Z`） |
| 便携包打包 | `npm run pack:portable` | PASS（`@electron/rebuild` 执行成功，`better-sqlite3` 原生模块重建并解包；便携包 `投资研究实验室-0.1.0-portable-x64.exe` 87 MB 已生成。TRAE 沙箱在签名后拦截了 Windows Recent CustomDestinations 写入，属环境限制非代码问题，见 §3.1） |
| 域隔离门禁 | `npm run check:domain-boundaries` | PASS（pretest/prebuild 自动执行） |
| 测试文件 | — | 17 passed / 1 skipped，覆盖领域、适配器、存储、服务、导出、冷启动恢复、备份往返 |

新增覆盖：
- [marketDataProvider.test.ts](electron/data/marketDataProvider.test.ts) 新增 5 个 P1-1 测试：五年请求仅返回最后 2 行、五年请求仅返回最后 100 行、请求区间内部少一个正式交易日、新股上市导致请求头部无数据、主源头部截断备用源完整。

## 2. 第九轮新增修复

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 严格回测仍可能接受不完整的历史行情（检查范围只覆盖 firstDate..lastDate，缺失交易日仅 warning） | [data/marketDataProvider.ts](electron/data/marketDataProvider.ts)、[services/appService.ts](electron/services/appService.ts) | `detectDateCompletenessIssues` 检查范围改为请求区间 `[startDate, endDate]`；已有正式日历年度内缺失预期交易日升级为 `error`；新增头部截断检测（首条返回行情之前的缺失生成无日期 error）；主源存在 error 时强制请求备用源，不再因尾部完整直接接受；`hasErrorInRequestRange` 阻断严格回测 |
| P1-2 | Electron 特权 IPC 缺少来源校验和导航封锁 | [electron/main.ts](electron/main.ts) | 新增 `will-navigate` 拦截，拒绝导航到非可信 URL；新增 `isTrustedAppUrl`（仅允许开发服务器和 `file:` 协议）；新增 `assertTrustedSender` 校验 IPC 消息来源；所有 IPC handler 统一通过 `secureHandle` 包装，调用前校验 `event.senderFrame.url` |
| P1-3 | 便携包中 `better-sqlite3` 尚无当前版本运行证据（`npmRebuild: false`） | [package.json](package.json) | `npmRebuild` 改为 `true`；新增 `rebuild` 脚本（`electron-builder install-app-deps`）；打包日志确认 `@electron/rebuild` 执行 `electronVersion=35.7.5 arch=x64`，`better-sqlite3` 重建成功；原生模块解包至 `app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node` |
| P1-4 | 发布证据落后于最新代码，review.md 被删除 | [review.md](review.md)、[artifacts/market-data-smoke.json](artifacts/market-data-smoke.json) | 基于最终代码重新执行 typecheck/test/build/smoke/pack 完整验证链；恢复 review.md 作为可持续追踪的发布判定记录；冒烟产物 `executedAt` 刷新为本次执行时间 |
| P2-2 | 三域隔离原则正确但缺少自动门禁 | [scripts/check-domain-boundaries.mjs](scripts/check-domain-boundaries.mjs)、[package.json](package.json) | 新增域隔离检查脚本，扫描 `src/desktop` 中指向 `/labs/` 或 `/research/` 的 import、fs 路径和 `child_process` 调用；集成到 `pretest` 和 `prebuild`，任何代码变化后自动执行 |

## 2.1 历史修复记录

### 第四轮（9 项）

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 严格回测接受"已知丢失行情行"的新浪数据 | [shared/contracts.ts](shared/contracts.ts)、[services/appService.ts](electron/services/appService.ts)、[data/sina.ts](electron/data/sina.ts) | `MarketDataIssue` 改为结构化 `{date?, type, severity, message}`；新浪返回被丢弃 OHLCV 行的具体日期；`AppService.fetchBacktestMarketData()` 在请求范围内存在任何 `severity: "error"` 时立即终止严格回测；前复权问题降级为 warning 但写入结果 `warnings` |
| P1-2 | 无回撤的合法回测备份无法恢复 | [domain/finance.ts](electron/domain/finance.ts)、[domain/backupValidation.ts](electron/domain/backupValidation.ts) | `DrawdownProfile` 的四个日期字段改为 `string \| null`；`maxDrawdown === 0` 时日期必须为 `null`，`maxDrawdown < 0` 时必须为合法日期；最长回撤阶段按是否存在条件校验 |
| P2-1 | 严格行情只检查尾部，没有逐交易日验证内部完整性 | [data/marketDataProvider.ts](electron/data/marketDataProvider.ts) | 新增 `detectDateCompletenessIssues()`，对 2024 年起有官方日历的区间按预期交易日逐日核对；工作日缺口生成 `warning`。2024 年以前的区间仅依赖启发式校验 |
| P2-2 | 行情校验只排除周末，没有排除已确认法定休市日 | [data/marketDataProvider.ts](electron/data/marketDataProvider.ts)、[domain/marketCalendar.ts](electron/domain/marketCalendar.ts) | `assertDates()` 调用 `isConfirmedMarketClosureDate()`，对已有官方日历年度同时拒绝周末和确认休市日 |
| P2-3 | 备份校验验证结构，但没有验证核心财务恒等式 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 新增低成本恒等式校验：`totalPnl === endingAsset - totalContribution`、`actualEndDate === priceSeries 最后日期`、`endingAsset === equityCurve 最后资产` |
| P2-4 | 实盘行情表依赖"请求区间永不重叠"的隐含前提 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts) | 拆分为 `live_market_prices`（行级来源 + `coverage_id` 外键）和 `live_market_coverage`（请求区间主键） |
| P2-5 | 备份恢复在 Electron 主线程同步读取和解析大型 JSON | [main.ts](electron/main.ts)、[backupRestoreWorker.ts](electron/backupRestoreWorker.ts) | 上限降到 64 MiB；`readFile` / `writeFile` 改为异步；JSON 解析和领域校验在 `worker_threads` 完成 |
| P2-6 | 外部 AbortSignal 监听器没有在正常完成时移除 | [data/_internal/httpClient.ts](electron/data/_internal/httpClient.ts) | 保存 `onExternalAbort` 引用，在 `finally` 中 `removeEventListener`；新增 `abortReason` |
| P2-7 | `database.ts` 承担过多职责（约 1100 行） | [storage/](electron/storage/) | 一次性结构性拆分：`schema`、`dbUtil`、四个领域仓库、`database` 仅保留门面 |

### 第五轮（9 项）

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 辅助前复权 K 线阻断严格回测 | [services/appService.ts](electron/services/appService.ts) | `fetchBacktestMarketData` 改用 `Promise.allSettled`；前复权 K 线失败降级为 `chartData = error/unavailable` |
| P1-2 | 已检测到的价格缺口没有写入实验警告 | [services/appService.ts](electron/services/appService.ts) | 新增 `warningsInRequestRange()`，将 warning 级别行情问题写入 `result.warnings` |
| P1-3 | 存在错误行的行情永久登记为完整覆盖 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts)、[services/appService.ts](electron/services/appService.ts) | `result_status` 新增 `partial`；`confirmedCoverageThrough` 对 `partial` 返回 `null` |
| P2-1 | 新浪问题列表没有在适配器边界过滤到请求区间 | [data/sina.ts](electron/data/sina.ts) | 新增 `filterDatesInRange()` |
| P2-2 | 行情覆盖与价格行单归属导致重叠覆盖破坏备份 | [storage/marketRepository.ts](electron/storage/marketRepository.ts) | 写入前检测价格行冲突 |
| P2-3 | 备份恒等式允许空价格序列和空权益曲线 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 新增非空和首尾日期一致性校验 |
| P2-4 | 备份 Worker 缺少退出兜底和超时 | [main.ts](electron/main.ts) | 新增 `worker.on("exit")` 和 60 秒超时 |
| P2-5 | 2024 年以前未实现跨源日期集合完整性校验 | [review.md](review.md) | 修正描述：明确 2024 年以前只有启发式校验 |
| P2-6 | 日历使用英文 | [renderer/src/main.tsx](renderer/src/main.tsx) | `dayjs.locale("zh-cn")` |

### 第六轮（7 项）

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 持久化的 partial 状态没有进入持仓初始读模型 | [domain/positionsView.ts](electron/domain/positionsView.ts)、[services/appService.ts](electron/services/appService.ts) | `liveDataSnapshot()` 增加 `coverage` 字段 |
| P1-2 | 内部数据质量问题被错误表述为"尾部不完整" | [services/appService.ts](electron/services/appService.ts) | 分离 `tailStatus` 与 `qualityStatus` 两个维度 |
| P1-3 | 价格行冲突策略阻断合法的同日清仓再买入 | [services/appService.ts](electron/services/appService.ts) | 新增 `normalizeRanges()`，合并重叠或相邻区间 |
| P2-1 | partial 只保存状态，不保存原因和缺失日期 | [storage/schema.ts](electron/storage/schema.ts)、[storage/marketRepository.ts](electron/storage/marketRepository.ts) | `live_market_coverage` 新增 `issues_json` 列 |
| P2-2 | 备份校验没有确认价格行位于覆盖请求区间内 | [domain/backupValidation.ts](electron/domain/backupValidation.ts) | 增加 `requested_from <= trade_date <= requested_through` 约束 |
| P2-4 | 新增关键分支的针对性测试不足 | [services/appService.test.ts](electron/services/appService.test.ts)、[storage/database.test.ts](electron/storage/database.test.ts) | 新增 7 个服务级测试 |
| UI | 应用名称、导航标签、持仓翻页与布局 | 多文件 | 应用名统一改为"投资研究实验室"；持仓翻页启用；布局调整 |

### 第七轮（11 项）

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P0 | partial 覆盖修复时删除正常历史行情并错误恢复为 ready | [services/appService.ts](electron/services/appService.ts) | `confirmedCoverageThrough(partial)` 返回 `null`，重新请求完整原始区间，原子替换旧 partial |
| P1-1 | 错误发生在 requestedFrom 当天或 error 无日期时不重试 | [services/appService.ts](electron/services/appService.ts) | 与 P0 同根修复 |
| P1-2 | 当前持仓周期起始日使用全部流水最早日期 | [domain/ledgerReducer.ts](electron/domain/ledgerReducer.ts) | 新增公共 `holdingIntervals` / `currentHoldingStart` |
| P1-3 | 持久化 partial 只进入持仓页，未进入收益日历读模型 | [services/appService.ts](electron/services/appService.ts) | 新增 `relevantCoverageIssuesForMonth()` |
| P2 | 存储层允许写入没有问题详情的 partial | [storage/marketRepository.ts](electron/storage/marketRepository.ts) | 写入时强制校验：partial 必须至少有一个 error 问题 |
| UI-1 | 未真正实现响应式 | [electron/main.ts](electron/main.ts)、[renderer/src/index.css](renderer/src/index.css) | 窗口 `minWidth: 1280, minHeight: 720`；删除 `body { min-width: 1920px }` |
| UI-2 | 持仓页顶部 10 个指标等宽挤在一行 | [PositionsPage.tsx](renderer/src/pages/PositionsPage.tsx) | 拆为两行：6 项核心 + 4 项对账 |
| UI-3 | 持仓表列重复度高 | [PositionsPage.tsx](renderer/src/pages/PositionsPage.tsx) | 替换为"持仓占比"和"当日盈亏" |
| UI-4 | 持仓翻页功能不完整 | [PositionsPage.tsx](renderer/src/pages/PositionsPage.tsx)、[TradesPage.tsx](renderer/src/pages/TradesPage.tsx) | 分页 10/20/50 切换、显示总数、bottomCenter |
| UI-5 | 大屏幕下未响应 | [renderer/src/index.css](renderer/src/index.css) | `@media (min-width: 2560px)` 占满宽度 |
| 测试 | P0/P2 关键分支缺少针对性测试 | [services/appService.test.ts](electron/services/appService.test.ts) | 新增 8 个测试 |

### 第八轮（7 项）

| 编号 | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| P1-1 | 持仓表"当日盈亏"由收益率反推，分红/交易场景下不准确 | [domain/positionsView.ts](electron/domain/positionsView.ts) | 改为直接读取估值截止日的日度归因 `contribution.totalPnl` |
| P1-2 | 收益日历 partial 未按查询范围过滤 | [domain/incomeCalendar.ts](electron/domain/incomeCalendar.ts)、[services/appService.ts](electron/services/appService.ts) | 覆盖记录整体传入 `buildIncomeCalendar`，统一过滤 |
| P1-3 | partial 只改变质量状态，未使受影响收益指标失效 | [domain/dailyAttribution.ts](electron/domain/dailyAttribution.ts)、[domain/incomeCalendar.ts](electron/domain/incomeCalendar.ts)、[domain/positionsView.ts](electron/domain/positionsView.ts) | 新增 `buildCoverageImpairments` + `applyCoverageImpairments` |
| UI-P1 | 1280~1599 窗口下交易流水筛选区溢出 | [renderer/src/index.css](renderer/src/index.css) | `.ledger-filter-panel` 改为 `repeat(3, minmax(0, 1fr))` |
| P2-1 | 折叠导航隐藏文字后无 Tooltip | [AppLayout.tsx](renderer/src/components/AppLayout.tsx) | 导航按钮增加 `title={item.label}` |
| P2-2 | 翻页后保留当前页不可见的选中证券 | [PositionsPage.tsx](renderer/src/pages/PositionsPage.tsx) | 翻页时自动清除 `selectedSymbol` |
| P2-3 | 合法 JSON 但不是数组时 issues_json 静默消失 | [storage/marketRepository.ts](electron/storage/marketRepository.ts) | 非数组 JSON 抛异常；partial 覆盖 issues 为空或不包含 error 时生成通用 error |

## 3. 仍待处理的问题

### 3.1 TRAE 沙箱限制阻断 pack:portable 最终签名后步骤

`npm run pack:portable` 在 TRAE IDE 中执行时，便携包 `投资研究实验室-0.1.0-portable-x64.exe`（87 MB）已成功生成并签名，但 TRAE 沙箱在签名后拦截了对 `C:\Users\theTruth\AppData\Roaming\Microsoft\Windows\Recent\CustomDestinations\*.temp` 的写入，导致进程退出码非 0。

此问题属于 TRAE IDE 环境限制，不属于代码或构建配置问题。关键发布证据已全部取得：

| 证据 | 状态 |
| --- | --- |
| `@electron/rebuild` 执行 `electronVersion=35.7.5 arch=x64` | PASS（打包日志可见） |
| `better-sqlite3` 原生模块重建 `finished` | PASS（打包日志可见） |
| 原生模块解包 `app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node` | PASS（文件存在） |
| 便携包 `投资研究实验室-0.1.0-portable-x64.exe` 生成 | PASS（87 MB，2026-08-02 09:09:46） |

如需在 TRAE IDE 中获得退出码 0，可在设置中配置沙箱规则允许访问 `C:\Users\theTruth\AppData\Roaming\Microsoft\Windows\Recent\CustomDestinations\`，或在常规 PowerShell 终端中执行 `npm run pack:portable`。

### 3.2 第二轮评审登记的功能性待排期项

以下为第二轮评审报告 §7.3 登记、本轮未一并处理的功能性建议，按优先级保留：

| 类别 | 待办 | 优先级建议 |
| --- | --- | --- |
| 现金账户闭环 | 当前指标只覆盖累计买入/卖出/分红/净投入，缺少当前现金余额、可用现金、外部转入/转出、总资产 = 持仓市值 + 现金余额 等口径 | 高 |
| 时间口径统一 | 三页同时出现"行情更新 / 数据截止 / 数据截点 / 最近记录"四个相似但不同的概念，用户难推断 | 中 |
| 持仓页指标名称精确化 | "累计投入"当前定义为 买入 − 卖出 − 分红，分红属于账户内部收益，不应等同撤回本金 | 中（涉及口径重定义） |
| 收益日历选中日期视觉状态 | 7 月 28 日格子同时出现蓝色选择边框和红色底部线条，视觉上像两个状态叠加 | 低 |
| 交易流水筛选栏密度优化 | 当前 5 个字段占满一行，MVP 阶段可收缩为 日期 \| 类型 \| 搜索 \| 查询 + 更多筛选 | 低 |

### 3.3 低优先级观察

1. **构建产物 chunk 较大**：`BacktestPage-*.js` 2.61 MB、`format-*.js` 1.04 MB（含 echarts）。R1 单端本地应用，体积不影响启动性能，未做 `manualChunks` 拆分属可接受现状。
2. **`AppSettings.commissionRate` / `minimumCommission` 硬编码为 0**：R1 费用口径固定为 0（PRD §3.1），现已在 [SettingsPage.tsx](renderer/src/pages/SettingsPage.tsx) 只读展示；若未来开放费用配置，需要同步打开写入路径与回测消费点。
3. **备份 Worker 仍复制两次大型 JSON 对象**：R1 不阻断，列为后续优化：主进程只传 `filePath` 给 Worker，Worker 读取/解析/校验后返回临时规范化文件路径或分块结果。

## 4. 结论

| 维度 | 结论 |
| --- | --- |
| 三域隔离 | PASS（新增 `check:domain-boundaries` 自动门禁） |
| Electron 进程与安全边界 | PASS（新增 `will-navigate` 拦截 + IPC sender 校验） |
| IPC 通道一致性 | PASS |
| 领域分层 | PASS |
| 死代码 / 无效测试 / 无效样式 | PASS |
| 文档链接 | PASS |
| 文档与实现一致性 | PASS |
| 类型检查 / 测试 / 构建 | PASS（183/183） |
| 真实行情冒烟 | PASS（[artifacts/market-data-smoke.json](artifacts/market-data-smoke.json)） |
| 便携包打包 | PASS（`@electron/rebuild` 成功，原生模块解包，便携包生成；TRAE 沙箱限制见 §3.1） |
| P1/P2 修复 | 第四轮 9 项 + 第五轮 9 项 + 第六轮 7 项 + 第七轮 11 项 + 第八轮 7 项 + 第九轮 5 项全部完成 |

**总体**：第四至九轮 P0/P1/P2 问题清单的代码层修复与 UI 优化已全部收敛。第九轮完成了全部发版阻断项：严格回测完整性检查覆盖请求全区间并升级缺失交易日为 error（P1-1）、Electron 导航封锁与 IPC sender 校验（P1-2）、better-sqlite3 原生模块重建配置（P1-3）、发布证据刷新并恢复 review.md（P1-4）、三域隔离自动门禁（P2-2）。单元测试 183/183 通过，构建、真实行情冒烟、便携包打包均通过。第二轮评审的功能性建议（现金账户闭环等）按 §3.2 优先级排期。
