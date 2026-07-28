# 攒股收息 R1 桌面应用评审报告

> 评审范围：`src/desktop/` 全部代码与配套文档（`docs/product/`、`docs/README.md`、`README.md`）
>
> 评审日期：2026-07-28
>
> 评审基线：commit `18267d1`（feat(trades): 实现实盘交易流水录入与修正功能）

## 1. 评审结论

本轮复核确认了实盘账本排序、逆回购、历史行情覆盖、收益归因、市场业务日期与实际数量录入问题，并已统一修复。三域隔离、进程边界和核心金融口径均有测试覆盖。仍待后续迭代的是**设置页未实现**导致的文档与实现不一致，以及与该页面对应的尚未被 UI 消费的 IPC 通道。

| 维度 | 结论 |
| --- | --- |
| 三域隔离 | 通过 |
| 进程与安全边界 | 通过 |
| 领域分层 | 通过 |
| 类型契约 | 通过 |
| 测试覆盖 | 通过（95/95） |
| 类型检查 | 通过 |
| 构建 | 通过 |
| 文档一致性 | **部分不一致**（仅剩设置页一项，暂缓处理） |
| 死代码 | 已清理（详见 §6） |

## 2. 验证执行

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS（`tsc --noEmit` 退出码 0） |
| `npm test` | PASS（13 文件 / 95 用例） |
| `npm run build` | PASS（main 140.77 KB、preload 2.37 KB、renderer 3693 模块） |

测试覆盖范围与 [ARCHITECTURE.md §9](../../docs/product/ARCHITECTURE.md) 声明一致：领域单测、适配器、持久化、导出、冷启动、实盘领域均有用例；冷启动用例 `appService.coldStart.test.ts` 验证 SQLite 重开后四标的实验、工作区、收益/回撤序列、K 线和逐笔明细仍完整可读。

## 3. 架构评审

### 3.1 三域隔离

- `src/desktop/` 不 import、不执行、不读取 `labs/` 与 `research/`，符合 [AGENTS.md](../../AGENTS.md) 与 [ARCHITECTURE.md §2](../../docs/product/ARCHITECTURE.md) 的隔离约束。
- 产品使用 `src/desktop/tests/fixtures/` 内的自有验收向量（`eastmoney-allotment-601916.json` 等），测试时不读取 `research/bank-dca/data/verification.json`。
- `shared/` 目录仅含产品进程间契约，未演化为跨域共享核心。

### 3.2 进程与安全边界

- `main.ts` 创建 `BrowserWindow` 时显式启用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`，符合 [ARCHITECTURE.md §3](../../docs/product/ARCHITECTURE.md)。
- `preload.ts` 仅通过 `contextBridge.exposeInMainWorld("desktop", api)` 暴露 `DesktopApi`，未泄露 `ipcRenderer`、`fs` 或通用调用入口。
- `main.ts` 中所有 `ipcMain.handle` 通道与 `preload.ts`、`renderer/src/api/client.ts` 一一对应，未发现孤立通道或未注册通道。
- `webContents.setWindowOpenHandler` 把外部链接转交系统浏览器并 `deny` 内嵌打开，避免新窗口绕过 preload。

### 3.3 领域分层

- 领域逻辑集中在 [electron/domain/](electron/domain/)：`analysis.ts`（回测）、`ledgerReducer.ts`（唯一账本顺序与归约）、`ledgerCommands.ts`（命令校验/预览）、`ledgerQuery.ts`（流水查询）、`positionsView.ts`（持仓视图）、`dailyAttribution.ts`（日度归因）、`incomeCalendar.ts`（收益日历）、`liveViewSupport.ts`（只读映射）以及 `finance.ts`（XIRR、回撤、金额舍入）。旧 `ledger.ts` 只把统一 reducer 适配为账户汇总，不再维护第二套账本公式。
- 渲染层 [renderer/src/pages/](renderer/src/pages/) 只消费领域层返回值，未实现金融公式。`marketChartModel.ts` 仅做前复权日 OHLCV 的周/月聚合和均线，符合 ARCHITECTURE.md §3 的约束。
- 主结果与明细共用同一计算流水：`simulateBacktest` 生成 `BacktestResult`，`backtestResultToSimpleResult` 从持久化快照转换出 `SimpleBacktestResult`，详情弹窗和 XLSX 导出共用此转换，未维护第二套简化回测。

### 3.4 数据持久化

- SQLite 启用 WAL、`foreign_keys`、`synchronous=NORMAL`，符合 ARCHITECTURE.md §7。
- `saveBacktestExperimentWithMarketData` 在单个事务中提交行情缓存、公司行动缓存、实验与结果，任一失败全部回滚。
- `deleteBacktestExperiment` 同时删除实验、结果与工作区活动引用，无悬挂外键。
- 历史摘要查询返回最近 500 次（`RECENT_BACKTEST_EXPERIMENT_LIMIT`），界面已明示窗口；数据库保留全部实验。
- 回测 `market_prices` 与实盘 `live_market_prices` 分表保存。持仓刷新只补齐当前持仓最近 13 个月；收益日历从首笔持仓事实按实际持有区间增量补齐，历史已清仓标的不会再截断当前持仓。

## 4. 代码质量

### 4.1 整体表现

- 全仓库无 `TODO/FIXME/XXX/HACK` 注释，无 `console.log/debugger` 残留，无 `.skip/.only` 测试。
- `BACKTEST_CALIBER_VERSION = "bank-dca-r1-node-v4"`，与 `research/bank-dca` 的口径版本号独立维护，符合“共享结论不共享源码”的隔离原则。
- `assertBacktestRequest` 在任何联网请求前完成请求校验（重复标的、严格日期、有限金额、快捷区间、分红处理枚举），符合 ARCHITECTURE.md §6 的“先校验后联网”约束。
- `AppService.runBacktest` 在多标的之间使用 `DATA_SOURCE_THROTTLE_MS = 1200ms` 节流，避免触发东方财富风控。

### 4.2 可改进项

#### 4.2.1 日期工具重复实现（已修复）

`validDate`、`addDays`、`daysBetween` 原在三处独立实现：

| 文件 | 函数 |
| --- | --- |
| [electron/domain/finance.ts](electron/domain/finance.ts) | `daysBetween` |
| [electron/domain/ledgerCommands.ts](electron/domain/ledgerCommands.ts) | `validDate`、`addDays` |
| 原 `electron/domain/livePortfolio.ts` | `validDate`、`addDays`、`daysBetween` |

`finance.ts` 的 `daysBetween` 直接除以 86_400_000，原 `livePortfolio.ts` 的版本使用 `Math.floor`，精度差异在历史日期上无影响，但语义重复。

**已修复**：抽取 [electron/domain/dateUtils.ts](electron/domain/dateUtils.ts) 作为共享模块，三个文件改为 `import { validDate, addDays, daysBetween } from "./dateUtils"`。由于输入只到日精度，`daysBetween` 返回值恒为整数，`Math.floor` 是无意义包裹，已统一移除。

#### 4.2.2 `getSettings` 实质为常量

[electron/storage/database.ts:207-221](electron/storage/database.ts#L207-L221) 的 `getSettings()` 读取存储后强制覆盖：

```typescript
return {
  ...stored,
  commissionRate: 0,
  minimumCommission: 0,
  caliberVersion: DEFAULT_SETTINGS.caliberVersion,
};
```

这与 [PRD_R1.md §3.1 简化费用](../../docs/product/PRD_R1.md) “回测买入费用固定为 0” 一致，但 `AppSettings` 接口仍保留 `commissionRate`、`minimumCommission` 字段，会让读者误以为可配置。**优先级：低**——R1 范围内合理，若 R2 引入费用模型再扩展。

#### 4.2.3 LiveEmpty 按钮文字被描述区 CSS 覆盖（已修复）

[PositionsPage.tsx](renderer/src/pages/PositionsPage.tsx#L301) 的“前往交易流水”与 [TradesPage.tsx](renderer/src/pages/TradesPage.tsx#L405-L414) 的“录入第一笔交易”均使用 `<Button type="primary">`，但实际渲染时按钮文字呈灰色而非白色。

**根因**：[index.css](renderer/src/index.css) 原有规则 `.live-empty .ant-empty-description span { color: #74859a; }` 选择器过宽。Ant Design 5 的 Button 把文字包裹在 `<span>` 内，而 `LiveEmpty` 把 `action` 节点放在 `<div class="ant-empty-description">` 内部，导致按钮内 `<span>` 被命中，文字颜色被覆盖为 `#74859a`。由于 antd v5 的 CSS-in-JS 使用 `:where()` 降低特异性，普通选择器轻易盖过主题样式。

**已修复**：把 `strong`、`span` 选择器改为直接子选择器 `.live-empty .ant-empty-description > div > strong` 与 `> div > span`，仅匹配 `LiveEmpty` 模板中的标题与说明，不再命中按钮内部的 `<span>`。两个按钮现在正确显示蓝底白字。

### 4.3 实盘账本与收益归因复核（已修复）

- 唯一顺序：`canonicalLedgerOrder()` 固定为业务日期、录入时间、内部 ID 升序；账本归约使用该顺序，列表使用其稳定倒序。同一批流水不再因数据库读取顺序不同而得出不同持仓。
- 显式截止日：`reduceLedger(entries, asOfDate)` 会过滤未来事实；`businessDate` 统一按 `Asia/Shanghai` 生成并拒绝未来普通流水，`recordedAt` 继续使用 UTC。
- 逆回购：未到期待到账资产只确认本金；实际到期日现金增加实际到期金额，收益仅确认为实际到期金额减本金。到期日和实际到期金额为必填事实，年化率和名义期限不参与自动结算。
- 实际数量：领域层和表单都直接记录股数/份额，卖出允许零股清仓且校验不超过可用持仓，不再做“手数 × 100”转换。
- 收益恒等式：`totalPnl = marketPricePnl + dividendPnl + tradingCostPnl + reverseRepoIncome`；手续费与不利成交以负的交易影响体现，不再混入市场价格收益。
- 行情覆盖：收益日历按标的实际持有区间补齐实盘专用缓存；总截止日由所选历史月份或当前可用最新日期确定；只有当日确实持有且缺行情的标的会使对应日期进入 `partial`。

## 5. 文档一致性

### 5.1 设置页：PRD 与实现不一致（**主要问题，暂缓处理**）

> 决策：设置页留空待后续迭代开发，本问题暂缓处理。下方保留原始记录供后续追踪。

[PRD_R1.md §4](../../docs/product/PRD_R1.md) 列出五个一级入口，其中第 5 个是“设置”页，责任为“数据来源、截止时间、费用口径、JSON 备份恢复和日志导出”。配套的 [docs/product/desktop_ui/本地设置_ui_brief.md](../../docs/product/desktop_ui/本地设置_ui_brief.md) 内容仅“待定”两字。

实际实现：

- [renderer/src/App.tsx:53](renderer/src/App.tsx#L53) 把 `/settings` 路由指向 `SkeletonPage`（加载占位骨架，不是真实页面）。
- [renderer/src/components/AppLayout.tsx:45](renderer/src/components/AppLayout.tsx#L45) 在导航栏暴露“设置”入口，用户点击后会看到永不结束的加载骨架。
- IPC 通道 `backup:export`、`backup:restore`、`logs:export`、`settings:get`、`account:summary` 已在 [main.ts](electron/main.ts) 注册、在 [preload.ts](electron/preload.ts) 暴露、在 [client.ts](renderer/src/api/client.ts) 转发，但 [renderer/src/pages/](renderer/src/pages/) 下没有任何组件调用 `api.exportBackup` / `api.restoreBackup` / `api.exportLogs` / `api.getSettings` / `api.accountSummary`。
- [README.md](README.md) “已实现的 R1 能力”列表中已写明“本地 SQLite、JSON 备份恢复、脱敏日志导出”，但用户无法通过 UI 触发。

影响：

- 文档承诺的能力在 UI 层缺失，用户无法自助备份/恢复/导出日志；
- 已注册的 IPC 通道在 Renderer 端无消费者，是“已接线但未点亮”的代码。

建议二选一：

1. **补齐设置页**：实现 `SettingsPage.tsx`，提供 JSON 备份导出/恢复、日志导出、数据来源与截止时间只读展示；
2. **暂且回退**：在 `AppLayout.tsx` 中隐藏“设置”入口，把 `/settings` 路由改为重定向到 `/backtest`，同步修改 README 表述为“R1 通过命令行/文件系统直接管理 SQLite 与日志”，并将 `exportBackup`、`restoreBackup`、`exportLogs`、`getSettings`、`accountSummary` 暂时从 `DesktopApi` 中移除（保留 `database.ts` 内部实现，等设置页落地再暴露）。

### 5.2 docs/README.md 引用了不存在的文件（已修复）

[docs/README.md](../../docs/README.md) 原列出两个失效链接：

- `product/PRODUCT_BRIEF.md` —— 不存在（`docs/product/` 下只有 `ARCHITECTURE.md`、`DESIGN_SYSTEM.md`、`PRD_R1.md`）；
- `decisions/0001-labs-research-src-isolation.md` —— 不存在（`docs/decisions/` 目录未创建）。

**已修复**：

- 移除 `PRODUCT_BRIEF.md` 链接，产品定位与范围边界统一在 [`PRD_R1.md`](../../docs/product/PRD_R1.md) 中描述；
- 移除 `decisions/0001-labs-research-src-isolation.md` 链接，三域隔离决策直接引用根目录 [`AGENTS.md`](../../AGENTS.md) 与 [`ARCHITECTURE.md` §2](../../docs/product/ARCHITECTURE.md)；
- 新增 `DESIGN_SYSTEM.md`、`desktop_ui/`、`tutorial/` 三个既有但未在 README 中索引的资源链接。

### 5.3 其他一致性确认

- ARCHITECTURE.md §4 的目录结构与实际 `src/desktop/` 一致（`electron/data|domain|export|services|storage`、`renderer/src/pages/backtest|live`、`shared`、`tests/fixtures`）。
- ARCHITECTURE.md §6 数据来源表与 [electron/data/](electron/data/) 实现的 `tencent.ts`、`stockUniverse.ts` 一致。
- PRD_R1.md §3.1 投入与买入规则与 [analysis.ts](electron/domain/analysis.ts) 中 `scheduled` 计算逻辑一致：上市前月份不积压、上市后跨月顺延且不占下月投入、首可用月份内指定日早于首行情日只投入一次。
- PRD_R1.md §6 验收标准中“四标的实验在数据库关闭重开后仍完整可读”由 `appService.coldStart.test.ts` 覆盖。

## 6. 死代码与未使用导出

### 6.1 未使用常量（已修复）

| 常量 | 位置 | 状态 |
| --- | --- | --- |
| `LIVE_LEDGER_PAGE_SIZES` | [shared/constants.ts:19](shared/constants.ts#L19) | **已修复**。[TradesPage.tsx](renderer/src/pages/TradesPage.tsx) 原内联 `type LedgerPageSize = 20 \| 50 \| 100` 与 `pageSizeOptions: [20, 50, 100]`，已改为 `type LedgerPageSize = (typeof LIVE_LEDGER_PAGE_SIZES)[number]` 与 `pageSizeOptions: [...LIVE_LEDGER_PAGE_SIZES]`，魔法值由常量统一治理。 |

### 6.2 已暴露但无 UI 消费的 IPC 通道

下列方法在 `DesktopApi`、`preload.ts`、`main.ts`、`client.ts` 中完整接线，但 [renderer/src/pages/](renderer/src/pages/) 下无任何组件调用。它们与 §5.1 设置页未实现强相关，**在设置页补齐前不属于“可删除的死代码”**，但当前确实没有 UI 消费者：

- `api.accountSummary`（仅在 [appService.test.ts:543](electron/services/appService.test.ts#L543) 中作为测试断言使用）
- `api.getSettings`
- `api.exportBackup`
- `api.restoreBackup`
- `api.exportLogs`

类型 `AccountSummary`、`AppSettings`、`RestoreResult` 在 [client.ts:57-89](renderer/src/api/client.ts#L57-L89) 中重新导出，但无任何页面组件 import 这些类型。

### 6.3 已确认非死代码

- `BACKTEST_DETAIL_PAGE_SIZE`：被 [BacktestDetailModal.tsx](renderer/src/pages/backtest/BacktestDetailModal.tsx) 多处使用。
- `BACKTEST_DIVIDEND_TIMINGS`：在 [analysis.ts:90](electron/domain/analysis.ts#L90) 校验中使用。
- `assertLedgerReversal`：在 [appService.ts:431](electron/services/appService.ts#L431) 中调用，非仅测试使用。
- `runSimpleBacktest`（测试辅助）：在 [analysis.test.ts](electron/domain/analysis.test.ts) 中驱动 `simulateBacktest + backtestResultToSimpleResult`，符合“目标域测试必须驱动本域实现”约束。

## 7. R1 验收标准对照

依据 [PRD_R1.md §6](../../docs/product/PRD_R1.md) 与 [ARCHITECTURE.md §9](../../docs/product/ARCHITECTURE.md)：

| 验收项 | 状态 | 依据 |
| --- | --- | --- |
| 给定同一输入快照，重复运行结果一致 | ✅ | `analysis.test.ts` 多用例验证 |
| 跨月顺延不占下月投入、同日落多计划累计正确 | ✅ | `analysis.test.ts` 跨月用例 |
| 上市前月份不积压、首可用月份只投一次 | ✅ | `analysis.test.ts` 上市日用例 |
| 零碎股、现金不为负 | ✅ | `analysis.test.ts` 零碎股用例 |
| 分红、回购、送转、累计分红可逐笔追踪 | ✅ | `analysis.test.ts` 分红用例 + `backtestResultToSimpleResult` 用例 |
| 七项输出可由交易流水和日度资产序列重算 | ✅ | `analysis.test.ts` 指标用例 |
| 多标的并排与单标的分别运行结果一致 | ✅ | `analysis.test.ts` 多标的用例 |
| 检索全 A 股、单次最多 10 标的 | ✅ | `assertBacktestRequest` + `stockUniverse.test.ts` |
| 每次点击创建新实验，不覆盖历史 | ✅ | `appService.test.ts` |
| 当前对比只含当前实验标的，按 XIRR 排序 | ✅ | `BacktestPage.tsx` + `CurrentExperimentTable.tsx` |
| 历史结果展示最近 500 次，更早实验不删除 | ✅ | `RECENT_BACKTEST_EXPERIMENT_LIMIT` |
| 重启后恢复工作区 | ✅ | `appService.coldStart.test.ts` |
| 工作区首次读取失败不写默认参数 | ✅ | `useBacktestWorkspace.ts` |
| 四标的冷启动完整可读 | ✅ | `appService.coldStart.test.ts` |
| XLSX 汇总 + 每标的明细 sheet | ✅ | `backtestWorkbook.test.ts` |
| 合法空响应与限流/错误结构可区分 | ✅ | `tencent.test.ts`、`stockUniverse.test.ts` |
| 配股事件逐项报告“不参与”假设 | ✅ | `appService.test.ts` 配股用例 |
| fixture 不读 research/ | ✅ | `tests/fixtures/README.md` + 隔离扫描 |
| 七类流水可新增和查看 | ✅ | `ledgerCommands.test.ts` + `liveViews.test.ts` |
| 冲正/修正不修改原记录，余额正确 | ✅ | `ledgerCommands.test.ts` |
| 持仓、现金、总资产、XIRR 可由流水重建 | ✅ | `liveViews.test.ts` + `appService.test.ts` |
| 同日流水在列表与账户中采用唯一稳定顺序 | ✅ | `ledgerReducer.test.ts` + `liveViews.test.ts` |
| 未来普通流水不污染当前持仓 | ✅ | `ledgerCommands.test.ts` + `ledgerReducer.test.ts` |
| 逆回购到期前按本金、到期日才确认实际收益 | ✅ | `ledgerReducer.test.ts` + `analysis.test.ts` |
| 零股/实际份额可录入，卖出不超过持仓 | ✅ | `ledgerCommands.test.ts` |
| 四项日度收益归因满足恒等式 | ✅ | `liveViews.test.ts` |
| 已清仓标的不截断当前收益日历 | ✅ | `liveViews.test.ts` |
| 实盘行情独立缓存并按持有区间补齐 | ✅ | `appService.test.ts` + `database.test.ts` |
| 估值结果显示价格来源和截止时间 | ✅ | `PositionsPage.tsx` + `valuationSource` 字段 |
| 断网可查既有数据 | ✅ | 本地 SQLite + 缓存快照 |
| JSON 导出可在空库恢复 | ✅ | `database.test.ts` 备份恢复用例 |
| 不兼容备份被拒绝且不破坏现有库 | ✅ | `database.test.ts` |
| 日志导出不含密钥/Cookie/敏感信息 | ✅ | `database.log` 仅记录 level + message |
| 不存在任何下单入口或券商交易权限 | ✅ | 全仓库无下单/券商相关代码 |
| **设置页：JSON 备份恢复、日志导出** | ❌ | §5.1，UI 未实现 |

## 8. 后续建议

按优先级排序：

1. **补齐设置页**（高，暂缓）：消除 PRD/README 与实现的差距。建议优先补齐，因为 IPC 与数据库实现均已就绪，只差 UI 层。当前决策为暂缓处理，待后续迭代开发。
2. ~~**补齐 docs/README.md 失效链接**（中）~~：已在本次修复，详见 §5.2。
3. ~~**清理 `LIVE_LEDGER_PAGE_SIZES`**（低）~~：已在本次修复，详见 §6.1。
4. ~~**统一日期工具**（低）~~：已在本次修复，详见 §4.2.1。
5. ~~**LiveEmpty 按钮文字颜色**~~：已在本次修复，详见 §4.2.3。

## 9. 评审输出

- 本报告：`src/desktop/review.md`
- 类型检查、测试、构建均通过，无回归
- 本轮新增并拆分：
  - [shared/marketDate.ts](shared/marketDate.ts)：A 股市场自然日唯一入口；
  - [electron/domain/ledgerReducer.ts](electron/domain/ledgerReducer.ts)：账本唯一排序、有效事实选择和显式截止日归约；
  - [electron/domain/ledgerQuery.ts](electron/domain/ledgerQuery.ts)、[positionsView.ts](electron/domain/positionsView.ts)、[dailyAttribution.ts](electron/domain/dailyAttribution.ts)、[incomeCalendar.ts](electron/domain/incomeCalendar.ts)：分别承担查询、持仓、日度归因和收益日历；
  - `live_market_prices`：实盘独立行情缓存，不再消费回测证据缓存。
- 配套修改覆盖领域命令、AppService、SQLite schema/备份、实盘 XLSX、交易录入与收益日历 UI，以及 PRD、UI Brief、架构和 README。
