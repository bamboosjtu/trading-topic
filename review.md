# 代码质量与架构评审结论

> 评审人：资深开发工程师（团队技术指导）
> 评审日期：2026-07-26
> 评审范围：`research/bank-dca/`（可复现研究端）、`labs/01_银行股定投回测/`（探索性 Lab）、`src/desktop/`（攒股收息桌面产品，Electron + TS + React）
> 评审方式：逐文件静态走查 + 架构边界核对（依据根目录 `AGENTS.md`）+ 测试与安全专项检查

---

## 一、总体结论

**综合评级：良好（架构清晰、金融口径严谨、安全卫生到位），但存在 3 项架构级债务需尽快收敛。**

| 维度 | 评级 | 说明 |
|------|------|------|
| 架构分层 | 中上 | 三层域（labs/research/desktop）职责划分思路正确，但 labs↔research 存在业务源码重复，违反 `AGENTS.md` 边界 |
| 金融口径严谨性 | 优秀 | 不复权/前复权/全收益指数区分清晰，分红再投资、送转股、XIRR、nav 回撤口径有详细注释与文档 |
| 代码安全 | 优秀 | 密钥脱敏、Electron 安全配置（contextIsolation/sandbox/nodeIntegration=false）、备份预校验均到位 |
| 测试覆盖 | 良好 | 边界单测充分（P0/P1、碎股精度、paymentDate），但**缺跨域数值一致性回归**与数据层 mock |
| 可维护性 | 中 | 存在双/三实现、魔法值散落、超大 React 单文件（1238 行）等问题 |

**一句话定位**：团队已经具备"把金融口径写对"的能力，下一步要解决的是"让正确口径只存在一处，并由测试守住"。

---

## 二、架构评审

### 2.1 分层与边界（对照 `AGENTS.md`）

`AGENTS.md` 明确要求：**Labs、Research、Src 只共享文档化结论和复制后的验收向量，不共享业务源码、数据目录或运行环境。**

现状发现违反或张力：

- **A3（高）· sidecar Python 后端未被集成（死代码/半成品）**
  - `src/desktop/sidecar/` 带有完整 Web 框架栈（starlette/uvicorn/pydantic/fastapi 风格依赖）。
  - 但 `electron/main.ts`、`appService.ts`、`data/tencent.ts` 中**没有任何 `localhost`/`127.0.0.1`/`sidecar`/`desktop_backend` 引用**（已 grep 确认）；桌面端行情完全由 `electron/data/tencent.ts` 经 preload 直接 `fetch` 获取。
  - 这是一个未接入或遗留的架构件，既增加维护负担，也误导后续开发者。

### 2.2 桌面端进程模型（Electron）

- 主进程（`main.ts`）通过 `ipcMain.handle` 暴露 13 个 handler，渲染端经 preload 白名单调用，模型清晰。
- `setWindowOpenHandler` 强制外部链接走 `shell.openExternal`，杜绝内嵌危险页面 —— 安全做法正确。
- 缺陷：`main.ts` 所有 handler 未做统一异常包装，service 抛出的裸 `Error` 直接 reject 到渲染端；错误仅以 `error.message` 呈现，缺少结构化错误码/可本地化 key（B5）。

---

## 三、代码质量：优点

值得在团队内作为标杆保留与推广的部分：

1. **金融口径注释质量高**：`analysis.ts` 对"nav 剔除外部现金流以避免回撤被投入抬高"（P0-2）、"分红用除权前持仓、再投资于除权后价格"、"碎股 6 位精度"等都有精确的推导注释与测试佐证。
2. **安全卫生到位**：
   - `data_source_registry.py::sanitize_error` 正则脱敏 token/api_key/authorization/cookie 与凭据 URL。
   - `database.ts::log` 对 `Bearer ...` 脱敏并截断 2000 字符。
   - `.gitignore` 已正确覆盖 `.venv/`、`node_modules/`、`out/`、`.userData/`（已 `check-ignore` 验证）。
3. **契约先行**：`shared/contracts.ts` 用 TypeScript 接口统一前后端数据契约；类型覆盖回测请求/结果/流水/账本/设置全链路。
4. **备份健壮性**：`database.ts::restoreBackup` 先写 `pre-restore-*.json` 安全备份，再校验 `schemaVersion + application` 后才覆盖，事务 + ROLLBACK 完整。
5. **边界测试充分**：`analysis.test.ts` 覆盖起始月跳过（P1-1）、跨月顺延（P1-2）、分红回购、零碎股精度、paymentDate 模式、分红不重复计入定投等关键边界。

---

## 四、代码质量：问题清单

### 高（架构/正确性风险）

- **A3 sidecar 未集成**（见 2.1）
  - 建议：二选一 —— 要么作为子进程/进程内后端统一行情与计算并接入 `main.ts`；要么从仓库移除或显式标记 `TODO(未集成)`，避免误导。

### 中（稳健性/可维护性）

- **B1 魔法值与时间戳散落**
  - `data_fetch.py`：`DATA_START="20060101"`、`DATA_END="20260720"`、`REPO_START` 硬编码；`build_report.py` 的 `START_YM/END_YM` 与 `verify_returns.py` 固定 `"2020-01"～"2026-07"` 多处重复。
  - `tencent.ts` 中 `r: "0.8205512681390605"` 疑似随机盐值被写死。
  - `caliberVersion: "bank-dca-r1-node-v3"` 在 `database.ts`、`tencent.ts`、`contracts.ts` 注释、`appService.ts` 过滤逻辑多处硬编码。
  - 风险：`DATA_END="20260720"` 过期后会**静默截断**数据而无人发现。建议集中到配置/常量模块，结束日参数化或动态取"今天"。

- **B2 月度投入调度对边界假设脆弱**
  - `simulateBacktest` 用 `monthsBetween` 生成自然月，再 `prices.find(row => row.date >= target)` 找首个 ≥ 目标日的交易日。某月目标日后无数据时顺延跨月，靠 `lastSelectedDate` 防双投，但 warning 文案"已被上月顺延占用"对用户不透明。
  - 建议：明确"目标月无可用交易日则跳过并在结果/报告中暴露 skipped months"，而非仅内部 warning。

- **B3 三个 `simulate*` 函数逻辑大量重复**
  - `simulateBacktest` 与 `simulateBacktestDetail` 的 scheduled 计算、分红/送股处理近乎逐字重复；`simulateBacktestSimple` 又从主回测流水二次转换。
  - 建议：抽取纯函数 `buildMonthlySchedule(prices, start, end, buyDay)` 与 `applyCorporateActions(...)`，三处复用，降低口径漂移风险。

- **B4 sql.js 全量落盘 I/O 开销**
  - `database.ts::persist()` 每次写操作都 `writeFileSync` 整个 SQLite 内存导出。批量/频繁写入 I/O 放大且无 WAL。
  - 建议：节流/异步落盘，或改用 `better-sqlite3` 获得增量写入与并发安全。

- **B5 IPC 异常未统一包装**（见 2.2）
  - 建议：定义带 `code` 的结构化错误类型，渲染端按 code 映射用户友好文案。

- **B6 渲染端 `BacktestPage.tsx` 超大单文件（1238 行）**
  - metrics/chartOption/Table 全部内联，未拆分 `ChartPanel`/`ComparisonTable`/`DetailModal` 子组件，可维护性与可测试性差。
  - 建议：按职责拆分组件；图表 option 抽到 `chartOptions.ts`。

### 低（风格/小问题）

- **C1 XIRR 年基不一致**：`research/analysis.py::calc_xirr` 用 `365.25`，`desktop/domain/finance.ts::xirr` 用 `365`（见 `daysBetween/365`）。长周期 XIRR 有微小偏差，建议统一为 `365.25` 或实际/365。
- **C2 银行清单重复**：7 家银行代码在 `BacktestPage.tsx`、`tencent.ts::STOCK_NAMES`、`appService.ts`、`contracts.ts` 注释多处硬编码；且带幸存者偏差，应在 UI/报告明确标注。
- **C3 跨目录相对路径脆弱**：渲染端 `import "../../shared/contracts"` 建议配 `tsconfig` paths 别名 `@shared`。
- **C4 依赖待清理**：`package.json` 含 `zustand`、`react-router-dom`，当前 `BacktestPage` 未使用（确认是否冗余或供其它页面）。
- **C5 labs 探索性代码的合理代价**：`bank_dca.py` 的 `MANUAL_BANK_SYMBOLS` 是 2026-07-24 人工核验快照，长期会过期；逐股 F10 串行 `sleep(0.05)` 大清单慢。建议标注"需定期重跑核验"，并将此类探索代码与可发布口径隔离。
- **C6 三套回测实现细节差异需文档化**（见 A2），否则易误用。

---

## 五、金融口径一致性（项目核心，重点核对）

| 口径项 | research (`analysis.py`) | labs (`bank_dca.py`) | desktop (`analysis.ts`) | 一致性 |
|--------|--------------------------|----------------------|--------------------------|--------|
| 价格基准 | 不复权收盘价 | 不复权收盘价 | 不复权收盘价 | ✅ 一致 |
| 现金分红 | 除权日税前每股，再投资 | 除权日税前，逐笔计入 | 除权日税前，分红池回购 | ⚠️ 实现不同，结果需测试兜底 |
| 送股/转增 | gross_return 含 bonus 因子 | `_shares_on_or_before` 单独处理 | `shareIncreaseRatio` 每10股→持股增幅 | ⚠️ 三套写法不同 |
| XIRR | 牛顿法，`365.25` | 二分法，`365.25` | 二分法，`365` | ❌ 年基不同 |
| 回撤 | 基于 nav（剔除外部现金流） | 基于 total_return_nav | 基于 nav（同口径） | ✅ 思路一致 |
| 最大浮亏 | 账户相对本金 | 账户 profit_rate | （仅 nav 回撤，未单列本金浮亏） | ⚠️ desktop 缺 max_principal_loss |

**核心结论**：价格基准与回撤思路一致，但"分红/送股合并方式"与"XIRR 年基"存在实质性分叉，且无数值一致性回归守护。这是当前最大的口径风险点。

---

## 六、测试评审

**已有（优秀部分）**
- `desktop` vitest 覆盖：P0-2 nav 回撤、P1-1/P1-2 调度边界、碎股 6 位精度、paymentDate、分红不重复计入定投、逆回购资产重建、冲正逻辑。
- `research` pytest 5 个确定性测试（回撤、分红抵消除权、送股、逆回购日历天数、滚动窗口结束月）。

**缺口（需补齐）**
1. **跨域数值一致性回归（最关键）**：同一行情+分红输入，驱动 research 与 desktop 两套引擎，断言 XIRR/期末市值/回撤残差 < ε。
2. **数据获取层 mock 测试**：`tencent.ts`、`data_fetch.py` 直接依赖网络，无 mock，CI 不可复现。
3. **真实快照回归**：`analysis.test.ts` 注释中规划的 R2 offline snapshot 未实现，目前仅合成数据。
4. **DB round-trip 测试**：`restoreBackup` 逻辑复杂（删除+重插+事务），仅类型校验，建议加"导出→恢复→再导出"一致性测试。

---

## 七、安全评审

| 项 | 状态 | 说明 |
|----|------|------|
| 密钥/凭据脱敏 | ✅ | `sanitize_error`、日志 `Bearer` 脱敏 |
| Electron 进程隔离 | ✅ | contextIsolation + sandbox + nodeIntegration=false + webSecurity=true |
| 外部链接处理 | ✅ | `setWindowOpenHandler` 强制 `shell.openExternal` |
| 备份预校验 | ✅ | pre-restore 安全备份 + schemaVersion/application 校验 |
| 窗口最小尺寸 | ⚠️ | `main.ts` 硬编码 `minWidth:1920, minHeight:900`，小屏不可用，建议可配置或降低下限 |
| IPC 错误结构化 | ⚠️ | 见 B5 |

整体安全态势在同体量项目中属上乘。

---

## 八、团队技术提升路线图（按优先级）

**P0（本迭代，消除架构债务）**
1. 决策并处置 sidecar：接入或移除（A3）。
2. 建立"单一口径源 + 验收向量"机制：research 为口径真源，desktop 受自动生成的 fixture 约束（A1/A2）。
3. 补齐跨域数值一致性回归测试（最关键，见六.1）。

**P1（下迭代，收敛重复与配置）**
4. 抽取 `buildMonthlySchedule` / `applyCorporateActions` 共用纯函数（B3）。
5. 集中魔法值与版本号到配置模块，`DATA_END` 参数化（B1）。
6. 统一 XIRR 年基为 `365.25`（C1）。
7. 拆分 `BacktestPage.tsx` 巨型组件（B6）。

**P2（持续，工程化）**
8. 数据获取层加 mock 测试 + 真实快照回归（六.2/3）。
9. DB round-trip 测试 + 评估 `better-sqlite3`（B4）。
10. 清理冗余依赖（C4）、配置 `@shared` 别名（C3）、统一错误结构（B5）。
11. 建立团队 Code Review Checklist：金融口径（复权/分红/费用）、安全（脱敏/Electron）、测试（边界+一致性）。

---

## 九、附录：关键评审对象

| 文件 | 角色 | 评审要点 |
|------|------|----------|
| `src/desktop/electron/domain/analysis.ts` | 产品端回测引擎 | 三 simulate 重复；XIRR 年基 365 |
| `src/desktop/electron/domain/finance.ts` | 金融纯函数 | xirr/maximumDrawdown |
| `src/desktop/electron/storage/database.ts` | SQLite 封装 | 全量落盘；备份健壮 |
| `src/desktop/electron/data/tencent.ts` | 行情/分红适配 | 盐值硬编码；P0-1/P0-4 口径处理优秀 |
| `src/desktop/renderer/src/pages/BacktestPage.tsx` | 回测页 | 1238 行巨型组件 |
| `src/desktop/shared/contracts.ts` | 前后端契约 | 类型覆盖完整 |
| `src/desktop/sidecar/` | Python 后端 | **未被集成** |

---

_本评审基于静态走查，未执行运行期验证（如需，可补充跑 `uv run --project research/bank-dca pytest` 与 `npm run test` 并对比双引擎数值）。_
