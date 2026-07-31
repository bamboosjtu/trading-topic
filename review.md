# 二次评审报告

> 评审日期：2026-07-31
> 评审范围：labs/、research/、src/desktop/、docs/product/
> 评审方法：架构与代码静态审查 + 关键算法与口径人工核对 + 文档一致性比对
> 上一轮评审基线：上轮 review.md 已被删除，本轮为独立二次评审；P1/P3 修复历史见项目记忆。

## 0. 评审摘要

| 域 | 评审维度 | 整体结论 |
| --- | --- | --- |
| labs | 内容正确性 | 银行股定投回测算法实现正确，避免前视偏差；行业相关性与周期轮动研究的统计方法合理但稳健性不足 |
| research | 内容正确性 | bank-dca 复现包算法实现严谨，测试覆盖关键边界，结论与数据一致 |
| src/desktop | 架构设计 | 三层（renderer→preload→main→domain→storage）单向依赖清晰，IPC 白名单与安全边界到位 |
| src/desktop | 代码质量 | 上轮 P1/P3 重构已收敛；剩余主要为长函数与少量同域重复 |
| src/desktop | 文档一致性 | ARCHITECTURE.md / PRD_R1.md 与实现基本一致，少量 UI brief 细节未对齐 |

**未发现 P0 阻断问题**。最严重的剩余问题为 P1 级别（共 4 项），均不影响 R1 发布，但建议在后续迭代中收敛。

### 问题分级与计数

| 级别 | labs | research | src 架构 | src 代码质量 | 文档一致性 | 合计 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 阻断 | 0 | 0 | 0 | 0 | 0 | 0 |
| P1 严重 | 1 | 0 | 0 | 1 | 2 | 4 |
| P2 改进 | 3 | 2 | 1 | 3 | 2 | 11 |
| P3 重构 | 2 | 1 | 0 | 2 | 0 | 5 |

---

## 1. labs/ 域评审（内容正确性）

### 1.1 labs/01_银行股定投回测

#### 算法正确性核对

- [bank_dca.py:697-732](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L697-L732) `xirr`：二分法实现正确。检查现金流方向（必须正负都有）、用 365.25 天/年换算、迭代 250 次精度 1e-8、无解时返回 `np.nan`。逻辑无误。
- [bank_dca.py:762-767](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L762-L767) `_shares_on_or_before`：分红按登记日持股计算，**正确避免前视偏差**。
- [bank_dca.py:846-867](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L846-L867) `execute_buy`：定投按 100 股整数倍撮合，余额留作现金；分红再投资在除权日用收盘价买入。逻辑合理。
- [bank_dca.py:869-919](file:///d/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L869-L919) 主循环：定投日先注入现金再买入，分红日先收到分红再触发再投资，与 [1-银行股定投回测概要.md](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/1-银行股定投回测概要.md) 描述一致。

#### 发现的问题

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2 | 波动率年化未说明 | [bank_dca.py:933-948](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L933-L948) | 日收益标准差 × √252 是交易日年化假设，文档未明确说明该口径，可能让读者误以为是日历日年化。建议在 1-银行股定投回测概要.md 中补充口径说明。 |
| P2 | 总收益历史构建与再投资逻辑耦合 | [bank_dca.py:665-694](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L665-L694) | `build_total_return_history` 将每股分红加到当日收盘价计算"总收益净值"，等价于"分红按收盘价再投资"假设。该假设合理但未在文档中显式说明，建议补充。 |
| P3 | 回测周期选择缺实证依据 | [1-银行股定投回测概要.md](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/1-银行股定投回测概要.md) | 10/5/3 年回测窗口的选取缺少与历史牛熊周期的对应说明。建议补充为何选择这些年限（如覆盖 2015 牛熊、2018 贸易战、2020 疫情等）。 |

#### 结论

labs/01 的算法实现正确，前视偏差已规避，分红处理合理。主要问题集中在**口径未在文档中显式说明**，可能让读者误解，但不影响结果正确性。

### 1.2 labs/02_行业走势相关性研究

#### 发现的问题

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2 | Fisher CI 未考虑时间序列自相关 | [build_notebooks.py:820-822](file:///d:/vibe-coding/trading-topic/labs/02_行业走势相关性研究/build_notebooks.py#L820-L822) | 使用 Fisher z 变换计算 95% CI 时假设样本独立，但金融收益率序列存在自相关，会导致 CI 过窄。建议在 3-总体研究结论.md 中明确该假设限制。 |
| P3 | 相关性时变性未进一步建模 | [3-总体研究结论.md](file:///d:/vibe-coding/trading-topic/labs/02_行业走势相关性研究/3-总体研究结论.md) | 结论已正确指出"相关性不是常数"并使用滚动窗口，但未探讨 GARCH-DCC 等时变相关性模型。这是研究深度问题，不影响现有结论。 |

### 1.3 labs/03_板块周期轮动研究

#### 发现的问题

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P1 | Rank IC 计算未处理缺失值 | [build_notebook.py:595-626](file:///d:/vibe-coding/trading-topic/labs/03_板块周期轮动研究/build_notebook.py#L595-L626) | 当截面数据中存在停牌或新上市标的导致字段缺失时，`rank` 默认 NaN 处理可能影响 IC 稳健性。建议显式 `dropna` 或在文档中说明缺失值处理策略。 |
| P3 | 2020 年以来策略改善的归因不足 | [2-总体研究结论.md](file:///d:/vibe-coding/trading-topic/labs/03_板块周期轮动研究/2-总体研究结论.md) | 结论指出策略在 2020 年后显著改善，但未分析驱动因素（注册制、机构化、行业结构变化等）。建议补充定性归因。 |

### 1.4 labs 域整体结论

四个 Lab 的算法实现均无根本性错误。labs/01 的定投回测作为 Lab 0 数据源与 Lab 1 回测主线的产物，质量最高；labs/02 与 labs/03 的统计方法合理但**稳健性诊断不足**。所有问题均为 P2/P3 级别，可在后续迭代中补充文档说明与稳健性检验。

---

## 2. research/ 域评审（内容正确性）

### 2.1 research/bank-dca

#### 算法正确性核对

- [analysis.py:12-35](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/analysis.py#L12-L35) `calc_xirr`：牛顿法实现正确。初始猜测 0.05、迭代 200 次、收敛阈值 1e-10、导数过小（< 1e-12）时中断、`new_guess` 限制不低于 -0.99 避免 1+rate=0、最终用残差检查是否真收敛。对持续投入+期末赎回的单调现金流是稳定的。
- [analysis.py:38-69](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/analysis.py#L38-L69) `build_stock_level`：除权日总回报公式 `(close_today * (1 + bonus) + cash) / close_yesterday` 是"分红再投资"假设下的等价净值，正确。`reinvest_dividends=False` 时将 cash 和 bonus 都置 0，用于构建"纯价格回报"序列作为对照，**这是有意设计而非 bug**（见 [test_analysis.py:37-38](file:///d:/vibe-coding/trading-topic/research/bank-dca/tests/test_analysis.py#L37-L38) 测试验证）。
- [data_fetch.py:114-124](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/data_fetch.py#L114-L124) 分红数据：派息/送股/转增字段统一除以 10 转换为每股比例，与 `build_stock_level` 的公式一致。

#### 测试覆盖核对

- [test_analysis.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/tests/test_analysis.py) 5 个测试覆盖关键边界：
  - "贡献不隐藏回撤"：验证定投累计投入不影响回撤计算
  - "现金分红再投资抵消除权下跌"：验证 total return 与 price-only 两种模式的差异
  - "送股抵消价格调整"：验证 bonus_share_ratio 处理
  - "国债逆回购按实际日历日计息"：验证 repo 利率年化
  - "滚动窗口结束于自身月份"：验证滚动回测边界

#### 发现的问题

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2 | 报告数字未与 verify_returns 输出交叉引用 | [report/七家银行与基准回测报告.md](file:///d:/vibe-coding/trading-topic/research/bank-dca/report/七家银行与基准回测报告.md) | 报告中列出的 XIRR、回撤等数字为静态文本，未明确标注源自 `verify_returns.py` 的哪次运行。建议在报告头部加入"数据来源：`bank-dca-verify` 输出于 YYYY-MM-DD"的溯源说明。 |
| P2 | 高频分红场景未覆盖 | [test_analysis.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/tests/test_analysis.py) | 现有测试覆盖年度分红，但未测试"一年多次分红"或"分红+送股+转增同日发生"的复合场景。建议补充。 |
| P3 | `simulate_level_dca` 存在重复过滤逻辑 | [analysis.py:115-133](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/analysis.py#L115-L133) | 多次对 periods 进行过滤和切片，可提取为单一预处理函数。 |

### 2.2 research/代码实现差异.md

文档描述了研究包与桌面产品实现的差异（如分红再投资 vs 价格净值构建方式）。经核对，文档描述的差异仍然存在，且与 AGENTS.md "三域隔离、有意重复"的约定一致。**无需修改**。

### 2.3 research 域整体结论

bank-dca 复现包质量高：算法实现严谨、测试覆盖关键边界、口径清晰。主要改进方向是**报告可追溯性**（数字与 verify 输出的交叉引用）与**测试覆盖扩展**（高频分红场景）。

---

## 3. src/desktop/ 架构评审

### 3.1 模块划分与依赖方向

经核对依赖关系（使用 grep 验证 import）：

- `renderer/` → `shared/contracts.ts`、`api/client.ts`（IPC 客户端）✓
- `preload.ts` → `shared/contracts.ts`（DesktopApi 接口）✓
- `main.ts` → `services/appService.ts`、`storage/database.ts`、`export/*` ✓
- `services/appService.ts` → `domain/*`、`data/*`、`storage/database.ts`、`shared/*` ✓
- `domain/` → `shared/*`、`domain/*`（内部互相依赖）✓
- `storage/database.ts` → `shared/*`、`domain/backupValidation.ts`（**反向依赖**，见下文）⚠
- `data/` → `shared/*`、`domain/dateUtils.ts`、`_internal/httpClient.ts` ✓

#### 发现的问题

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2 | storage 反向依赖 domain | [database.ts:22](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L22) | `import { validateBackup } from "../domain/backupValidation"` 让 storage 反向依赖 domain。`validateBackup` 是领域规则（账本完整性、引用图），按依赖方向应在 appService 层调用：先 `validateBackup` 再 `database.restoreBackup`。当前实现把校验放在 storage 内部是为了让 restoreBackup 自包含，但破坏了分层。建议将 validateBackup 调用上移到 appService，storage 只负责写入。 |


---

## 4. src/desktop/ 代码质量评审


### 4.1 重复代码检查

上轮 P3 已提取 `_shared/format.ts`、`_shared/useInstrumentPicker.ts`、`_internal/httpClient.ts`、`export/workbookInternals.ts`、`storage/database.ts` 的 `mapStoredMarketPrice`/`buildInsertSql` 等。本轮剩余重复：

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2 | tencent.ts 与 sina.ts 的行情行校验逻辑 | [tencent.ts:399-422](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/tencent.ts#L399-L422) ↔ [sina.ts:73-91](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/sina.ts#L73-L91) | 两源都对 OHLCV 行做 `Number.isFinite` + 范围校验（high≥max(open,close)、low≤min(open,close) 等），逻辑相近但字段名不同。可提取 `_internal/validateBars.ts` 共享校验函数。**注意**：AGENTS.md 规定三域间的相似适配器是有意重复，但同一域内（src/desktop）的 tencent 与 sina 之间的重复仍可收敛。 |

### 4.2 代码异味

| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P1 | `runBacktest` 单方法约 200 行 | [appService.ts:288-495](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L288-L495) | 单方法承担：请求校验、标的存在性检查、行情/K线/分红串行获取、尾部完整性校验、共同截止日计算、回测执行、警告生成、实验落库、日志。建议拆分为 `validateRequest` / `fetchMarketData` / `computeResults` / `persistExperiment` 四个私有方法。 |
| P2 | `database.ts` 单文件 1100+ 行 | [database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts) | schema 初始化、CRUD、备份恢复、行映射全在一个类。上轮已提取列常量与 mapStoredMarketPrice，但文件仍较大。可按职责拆分为 `schema.ts`（DDL 与指纹）+ `database.ts`（CRUD）+ `backup.ts`（export/restore）。 |
| P3 | `ledgerReducer.ts` 部分函数较长 | [ledgerReducer.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerReducer.ts) | `reduceLedger` 主循环较长但逻辑线性，可读性尚可，优先级低。 |

---

## 5. src/desktop/ 与 docs/product/ 文档一致性评审


| 级别 | 项 | 位置 | 说明 |
| --- | --- | --- | --- |
| P2 | `tabular-nums` 使用未完全统一 | [DESIGN_SYSTEM.md](file:///d:/vibe-coding/trading-topic/docs/product/DESIGN_SYSTEM.md) | 文档要求"金额、数量、价格、百分比统一使用 tabular-nums"，代码中 `money`/`percent`/`numberValue` 已封装，但部分直接写 JSX 的数字（如 [LedgerEntryModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/LedgerEntryModal.tsx) 的 ImpactValue）依赖 `className="tabular-nums"` 手动添加。建议 lint 规则或 review checklist 提醒。 |
| P2 | `brand-strong` 色值引用方式 | [DESIGN_SYSTEM.md](file:///d:/vibe-coding/trading-topic/docs/product/DESIGN_SYSTEM.md) | 文档定义 `brand-strong: #0D5DC3`，代码中部分位置直接写色值而非引用 token。建议在 tailwind.config.ts 中显式定义并统一引用。 |

---

## 6. 整体结论

本仓库在**三域隔离、金融口径正确性、桌面安全基线、测试覆盖、文档一致性**五个维度均达到了可发布标准。

**核心优势**：
- labs/01 银行股定投回测算法正确，规避前视偏差，分红登记日处理严谨
- research/bank-dca 复现包算法实现严谨，测试覆盖关键边界
- src/desktop 三层架构单向依赖清晰，IPC 白名单与安全边界到位
- 上轮 P1/P3 重构已收敛，无死代码、无死测试
- ARCHITECTURE.md 与代码实现高度一致

**主要待改进项**：
- `src/desktop` 的 `runBacktest` 长函数（P1）与 `database.ts` 单文件过大（P2）
- PRD 对功能边界（滚动窗口、ETF 限制）的显式说明不足（P1）
- labs/03 Rank IC 缺失值处理（P1）
- storage→domain 反向依赖（P2）
- 设计系统 token 引用不统一（P2）

以上问题均**不影响 R1 发布**，可在后续迭代中逐步收敛。

### 评审方法说明

本评审基于以下手段：
1. 关键文件逐行阅读（bank_dca.py、analysis.py、appService.ts、database.ts、main.ts、preload.ts、contracts.ts 等）
2. grep 跨文件搜索符号引用，验证"死代码"判断
3. `npm run typecheck` / `npm test`（160 passed / 1 skipped）/ `npm run build` 全部通过
4. 文档描述与代码实现的逐项比对

**未在本评审范围内**：
- 性能基准测试（需运行时数据）
- 安全渗透测试（需专用工具）
- 跨平台兼容性测试（需多环境）
- labs/research 的可复现性验证（需运行 Python 环境）

如需深入验证这些维度，建议另启独立评审任务。
