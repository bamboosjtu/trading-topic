# 攒股收息 R1 桌面应用评审报告

> 评审日期：2026-07-29
>
> 评审范围：`src/desktop/` 全量源码、`docs/product/` 文档一致性、`AGENTS.md` 工程约束
>
> 评审基线：commit 干净（`git status --short` 无输出）

## 1. 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | PASS |
| 单元测试 | `npm test` | 110/110 PASS（1 smoke test 预期 skipped） |
| 构建 | `npm run build` | PASS（main / preload / renderer 三入口） |
| 测试文件 | — | 16 passed / 1 skipped，覆盖领域、适配器、存储、服务、导出、冷启动恢复 |

构建产物体积（参考）：renderer `index-3gemjD6y.js` 968.09 kB、`BacktestPage` chunk 2.61 MB（含 ECharts）、CSS 43.68 kB。

## 2. 死代码与无效资产梳理

逐文件扫描 `src/desktop` 下 51 个源/测试/样式文件（不含 `out/`、`release/`、`node_modules/`），结论：

| 检查项 | 结果 |
| --- | --- |
| 未使用 export（shared/contracts.ts、constants.ts、backtestIdentity.ts、marketDate.ts 等） | 未发现 |
| 未使用 import | 未发现 |
| 未使用 CSS 类名 / 废弃样式块 | 未发现（上一轮已移除 `.header-icon-button`、`.date-field`、`.date-separator` 等 5 块） |
| `.skip` / `.only` / `xit` / 空测试体 | 仅 `electron/data/marketData.smoke.test.ts` 中 1 个 smoke 用例为预期 skip，需发布前手动 `npm run smoke:market-data` 跑实 |
| 大段注释死代码（≥10 行） | 未发现 |
| TODO / FIXME / HACK 标记 | 未发现 |
| 重复实现的工具函数 | 未发现（日期工具已统一在 [dateUtils.ts](electron/domain/dateUtils.ts)，被 finance / ledgerCommands / livePortfolio 共享） |

## 3. 架构一致性

### 3.1 三域隔离

| 检查 | 结果 |
| --- | --- |
| `src/desktop` 是否 import 或读取 `labs/`、`research/` | 否（`grep` 全量扫描仅在 [README.md](README.md) 第 19 行文字说明中提及，无代码引用） |
| 是否执行 Python / AkShare | 否 |
| `shared/` 是否被当作跨域共享核心 | 否，仅承载 main / preload / renderer 的 TypeScript 契约 |
| `tests/fixtures/` 是否为产品自有验收向量 | 是（`eastmoney-allotment-601916.json`、`eastmoney-sharebonus-*.json` 三份真实响应 fixture） |

### 3.2 Electron 进程边界

| 检查 | 结果 |
| --- | --- |
| `contextIsolation` / `nodeIntegration` / `sandbox` | [main.ts:48-54](electron/main.ts#L48-L54) `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`，符合 ARCHITECTURE.md §3 |
| preload 是否暴露 `ipcRenderer` / `fs` / `shell` | 否，[preload.ts](electron/preload.ts) 仅通过 `ipcRenderer.invoke` 暴露 31 个业务方法，未泄漏 `ipcRenderer` 对象本身 |
| renderer 是否直接调用 Node API | 否，`grep` 扫描 `renderer/src` 下无 `fs.` / `path.` / `os.` / `child_process` / `require(` 命中 |
| renderer 是否 import `electron/` | 否，仅 import `../../../shared/contracts` 和 `../../../shared/constants` |
| 外部链接处理 | [main.ts:57-60](electron/main.ts#L57-L60) `setWindowOpenHandler` 全部走 `shell.openExternal` 并 `deny`，不创建新 BrowserWindow |
| 是否接券商 / 下单 | 否 |

### 3.3 IPC 通道一致性

`main.ts` 注册 31 个 `ipcMain.handle` 通道，`preload.ts` 暴露 31 个方法，`renderer/src/api/client.ts` 调用 31 个方法，三者完全一一对应。通道分布：

| 域 | 通道数 | 通道前缀 |
| --- | --- | --- |
| 应用健康 | 1 | `app:` |
| 回测 | 9 | `backtest:`、`stocks:` |
| 持仓 | 3 | `positions:` |
| 账本查询/导出 | 3 | `ledger:query`、`ledger:export`、`ledger:record:get` |
| 账本写入 | 6 | `ledger:preview`、`ledger:add`、`ledger:correct`、`ledger:reverse`、`ledger:dividend-reinvestment:*` |
| 收益日历 | 2 | `income-calendar:` |
| 设置 / 备份 / 日志 | 4 | `settings:`、`backup:`、`logs:` |
| 实验/工作区 | 3 | `backtest:experiments:*`、`backtest:workspace:*` |

### 3.4 领域分层

- 领域逻辑全部集中在 [electron/domain/](electron/domain/)：`analysis.ts`（回测）、`ledgerReducer.ts`（账本归约）、`ledgerCommands.ts`（命令校验与预览）、`ledgerQuery.ts`、`positionsView.ts`、`dailyAttribution.ts`、`incomeCalendar.ts`、`finance.ts`（XIRR / 回撤）、`marketCalendar.ts`、`dateUtils.ts`、`liveViewSupport.ts`。
- Renderer 不实现金融公式：[renderer/src/pages/backtest/marketChartModel.ts](renderer/src/pages/backtest/marketChartModel.ts) 仅做前复权日 OHLCV 的周/月聚合与均线展示转换；收益率、回撤序列直接消费领域层返回值。
- `useBacktestWorkspace()` 是 Renderer 唯一的工作区写入口，符合 ARCHITECTURE.md §7 约束。
- 状态判别联合 `loading / ready / unavailable / empty / stale / partial / error` 在实盘三页统一使用，未以空数组表达多状态。

## 4. 文档一致性

### 4.1 失效链接检查

| 文档 | 链接 | 状态 |
| --- | --- | --- |
| [docs/README.md](../../docs/README.md) | `product/PRD_R1.md`、`product/ARCHITECTURE.md`、`product/DESIGN_SYSTEM.md`、`product/desktop_ui/`、`tutorial/akshare.md`、根 `AGENTS.md` | 全部存在 |
| [src/desktop/README.md](README.md) | `../../docs/product/PRD_R1.md`、`../../docs/product/ARCHITECTURE.md`、`THIRD_PARTY_NOTICES.md` | 全部存在 |
| [docs/product/PRD_R1.md](../../docs/product/PRD_R1.md) | `desktop_ui/历史回测_ui_brief.md` 等 5 个 Tab 设计简述 | 全部存在 |
| [docs/product/ARCHITECTURE.md](../../docs/product/ARCHITECTURE.md) | `PRD_R1.md`、`desktop_ui/` | 全部存在 |

### 4.2 PRD 与实现对应关系

| PRD / README 描述 | 实现位置 | 一致性 |
| --- | --- | --- |
| 五个一级入口（历史回测 / 持仓明细 / 交易流水 / 收益日历 / 设置） | [App.tsx:36-53](renderer/src/App.tsx#L36-L53) | 一致 |
| 历史回测、持仓、流水、收益日历四页 | 已实现并经过 110 个测试覆盖 | 一致 |
| 设置 Tab：数据来源、截止时间、费用口径、JSON 备份恢复和日志导出 | [App.tsx:53](renderer/src/App.tsx#L53) `<Route path="/settings" element={<SkeletonPage />} />`，导航中可见入口但未实现 UI | **不一致**（已知暂缓项） |
| 设置页 IPC：`settings:get`、`backup:export`、`backup:restore`、`logs:export` | [main.ts:216, 218, 234, 272](electron/main.ts#L216) 已注册；[preload.ts:55-58](electron/preload.ts#L55-L58) 已暴露；[client.ts:55-58](renderer/src/api/client.ts#L55-L58) 已声明 | 后端三件套完整，仅缺 UI 消费 |
| README 第 64 行「本地 SQLite、JSON 备份恢复、脱敏日志导出」 | 仅后端实现，UI 未提供 | **不一致**（同上） |

### 4.3 文档完整性（AGENTS.md 要求「范围、非目标、验收标准」）

| 文档 | 范围 | 非目标 | 验收标准 |
| --- | --- | --- | --- |
| PRD_R1.md §3、§5、§9 | 有 | 有（§5） | 有（§9 表格） |
| ARCHITECTURE.md §1、§2、§9 | 有 | 有（§2 禁止清单） | 有（§9 表格） |

## 5. 低优先级观察

以下不属于阻塞项，仅作记录：

1. **`AppSettings` 接口字段未消费**：[shared/contracts.ts:491-497](shared/contracts.ts#L491-L497) 保留 `commissionRate`、`minimumCommission`，在 [database.ts:23-24, 414-415](electron/storage/database.ts#L23-L24) 硬编码为 0。R1 费用口径固定为 0（PRD §3.1），暂无读取方；待设置页落地时再决定保留或删除。
2. **设置页设计简述为空**：[docs/product/desktop_ui/本地设置_ui_brief.md](../../docs/product/desktop_ui/本地设置_ui_brief.md) 仅一行「待定」。设置 Tab 是否在 R1 收尾或顺延到下一版本，建议明确。
3. **构建产物 chunk 较大**：`BacktestPage-*.js` 2.61 MB、`GiftOutlined-*.js` 1.05 MB（含 echarts）。R1 单端本地应用，体积不影响启动性能，未做 manualChunks 拆分属可接受现状。

## 6. 结论

| 维度 | 结论 |
| --- | --- |
| 三域隔离 | PASS |
| Electron 进程与安全边界 | PASS |
| IPC 通道一致性 | PASS（main / preload / client 三方 31 通道一一对应） |
| 领域分层 | PASS（金融计算在 domain/，renderer 不实现公式） |
| 死代码 / 无效测试 / 无效样式 | PASS（无残留） |
| 文档链接 | PASS（无失效链接） |
| 文档与实现一致性 | **设置页 UI 缺失**（后端 IPC 已就绪，UI 仍为 SkeletonPage；README 第 64 行描述与现状不符） |
| 类型检查 / 测试 / 构建 | PASS |

**总体**：R1 桌面应用在架构、代码质量、隔离边界、测试覆盖上达到评审收敛标准，唯一待处理项是设置页 UI 的实现或文档降级。建议在 R1 收尾时明确设置页的处置：要么补齐 UI，要么从 PRD/README 的「已实现能力」中下调到「R1 不提供」，并删除导航中的「设置」入口与 4 个未消费的 IPC handler。

## 7. 实盘核算口径修复（评审报告第二轮）

> 触发：另一份评审报告指出"用专业视觉呈现了若干容易误导的收益指标"，要求优先收紧账户核算口径。

### 7.1 已修复项

| # | 问题 | 修复位置 | 修复方式 |
| --- | --- | --- | --- |
| 1 | XIRR 短期年化产生极端值（7 天 5.6% 年化为 ~1620%） | [positionsView.ts:309-314](electron/domain/positionsView.ts#L309-L314) | 样本期不足 30 天时 `investmentXirr` 返回 `null`；前端 helper 改为"样本期不足 30 天，暂不展示" |
| 2 | 区间收益（近一月/三月/六月/一年）用成立以来收益填充 | [positionsView.ts:256-264](electron/domain/positionsView.ts#L256-L264) | `periodPerformance` 检测区间起点早于账户最早可用日期时返回 `null`；前端显示"数据不足" |
| 3 | 持仓成本价展示精度丢失，与累计买入支出无法对账 | [positionsView.ts:369](electron/domain/positionsView.ts#L369) | `averageCost = position.cost / position.quantity` 不再 `roundMoney`，保留原始精度；表格统一显示 3 位小数 |
| 4 | 现金流金额用红涨绿跌配色，A 股语境下会被误解 | [TradesPage.tsx:56-64](renderer/src/pages/TradesPage.tsx#L56-L64) | 移除 `amountClass`，所有发生金额统一 `finance-flat`，方向由正负号 + 文字表达 |
| 5 | 已冲正流水与有效流水视觉无区分 | [TradesPage.tsx:400-402](renderer/src/pages/TradesPage.tsx#L400-L402) + [index.css:1954-1967](renderer/src/index.css#L1954-L1967) | 表格 `rowClassName` 应用 `ledger-row-reversed`，CSS 整行降级为灰色 + 浅底 + tag 半透明 |
| 6 | "流水记录 N 条"含审计事件，无法区分有效/冲正 | [ledgerQuery.ts](electron/domain/ledgerQuery.ts) + [contracts.ts:402-408](shared/contracts.ts#L402-L408) + [TradesPage.tsx:367-375](renderer/src/pages/TradesPage.tsx#L367-L375) | `LedgerQueryResult.metrics` 新增 `effectiveCount` / `reversedCount`；顶部指标改为"有效流水 N 笔"，helper 显示"另已冲正 N 笔" |
| 7 | 收益日历累计收益与本月/年内数值相同，被误读为重复展示 | [IncomeCalendarPage.tsx:248-252](renderer/src/pages/IncomeCalendarPage.tsx#L248-L252) + [index.css:2146-2156](renderer/src/index.css#L2146-L2156) | 累计收益下方追加归因解释行"累计收益 = 市场价格 + 分红 + 交易影响"，明确收益来源构成 |

### 7.2 验证结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | PASS |
| 单元测试 | `npm test -- --run` | 110/110 PASS（1 smoke 预期 skipped） |
| 构建 | `npm run build` | PASS（renderer CSS 44.28 kB，新增归因样式约 0.6 kB） |

测试新增覆盖：[liveViews.test.ts:355-364](electron/domain/liveViews.test.ts#L355-L364) 验证 `effectiveCount` / `reversedCount` 在含修正流水的场景下正确计数。

### 7.3 评审报告中暂未处理项（建议后续排期）

评审报告还提出了若干需要新建功能或较大改动的建议，本轮按"先收紧核算口径、再加功能"的原则未一并处理，登记如下供后续排期：

| 类别 | 待办 | 优先级建议 |
| --- | --- | --- |
| 现金账户闭环 | 当前指标只覆盖累计买入/卖出/分红/净投入，缺少当前现金余额、可用现金、外部转入/转出、总资产 = 持仓市值 + 现金余额 等口径 | 高（评审报告第五节"必须立即修改"第 5 项） |
| 时间口径统一 | 三页同时出现"行情更新 / 数据截止 / 数据截点 / 最近记录"四个相似但不同的概念，用户难推断 | 中 |
| 持仓页增加持仓占比、当日盈亏列 | 当前缺这两列，对组合管理价值高于"累计买入支出"逐行重复 | 中 |
| 收益日历选中日期视觉状态 | 7 月 28 日格子同时出现蓝色选择边框和红色底部线条，视觉上像两个状态叠加 | 低 |
| 持仓页指标名称精确化 | "累计投入"当前定义为 买入 − 卖出 − 分红，分红属于账户内部收益，不应等同撤回本金 | 中（涉及口径重定义） |
| 交易流水筛选栏密度优化 | 当前 5 个字段占满一行，MVP 阶段可收缩为 日期 \| 类型 \| 搜索 \| 查询 + 更多筛选 | 低 |

**本轮修复结论**：评审报告中"必须立即修改"的第 1～4 项已完成，第 5 项（现金账户闭环）属于新功能建设，已登记待排期；其余二、三、四、五节的优化建议均不影响核算严谨性，按优先级登记后续处理。
