# 投资研究实验室 · 全面技术评审报告

> **评审范围**：`d:\vibe-coding\trading-topic` 全仓库
> **评审日期**：2026-07-31
> **评审依据**：`AGENTS.md`、`README.md`、`docs/product/`、各域 `README.md`
> **评审维度**：代码质量、架构设计、性能优化、安全性、可维护性、文档完整性
> **专项分析**：`src/desktop` 死代码 / 重复代码 / 测试执行
> **执行命令**：`npm test`（161 passed / 1 skipped）、`npm run typecheck`（0 error）

---

## 目录

- [一、整体概览](#一整体概览)
- [二、Labs 域评审](#二labs-域评审)
- [三、Research 域评审](#三research-域评审)
- [四、src/desktop 架构与质量评审](#四srcdesktop-架构与质量评审)
- [五、src/desktop 死代码专项分析](#五srcdesktop-死代码专项分析)
- [六、src/desktop 重复代码专项分析](#六srcdesktop-重复代码专项分析)
- [七、src/desktop 测试执行专项分析](#七srcdesktop-测试执行专项分析)
- [八、改进建议优先级汇总](#八改进建议优先级汇总)

---

## 一、整体概览

### 1.1 仓库结构

仓库严格遵循 `AGENTS.md` 三域隔离原则，目录职责清晰：

| 路径 | 职责 | 评审结论 |
| --- | --- | --- |
| `labs/` | 学习与探索（4 个 Lab） | 设计严谨，文档完整 |
| `research/bank-dca/` | 可复现研究闭环 | 完整闭环，测试聚焦金融口径 |
| `src/desktop/` | Electron 桌面产品 | 架构与安全基线高，存在性能与维护改进点 |
| `reports/` | 最终研究成稿 | 4 篇面向读者的文章 |
| `docs/product/` | 产品需求与架构 | PRD、ARCHITECTURE、DESIGN_SYSTEM 齐全 |
| `.agents/skills/` | 投资研究 Skill 源 | 21 个 skill，受版本控制 |

### 1.2 总体强项

1. **三域隔离严格落实**：Labs、Research、Src 各自独立环境（`pyproject.toml`/`uv.lock` 或 `package.json`），无跨域 import 或运行时依赖；相似算法的有意重复有 `research/代码实现差异.md` 论证。
2. **金融口径正确性高**：XIRR（二分法/牛顿法双实现）、复权、分红送转、回撤等关键公式经多域独立实现交叉验证。
3. **桌面产品安全基线扎实**：进程隔离、IPC 白名单、SQL 全参数绑定、Schema 双重 fingerprint、`validateBackup` 完整覆盖引用图。
4. **测试覆盖优秀**：`src/desktop` 161 个测试通过（1 个 smoke 测试默认 skip），覆盖 storage/domain/data/services 各层关键边界。
5. **文档体系完整**：每个域有 README，关键决策有中文注释，跨域差异有专门文档论证。

### 1.3 总体弱项

| 严重程度 | 项 | 摘要 |
| --- | --- | --- |
| Major | CSP 允许本地端口 | `connect-src` 含 `http://127.0.0.1:*`，与 PRD 矛盾 |
| Major | 主进程同步计算阻塞 | `runBacktest` 10 标的 × 15 年计算阻塞 IPC |
| Major | `listLedger` 全表加载 | 多个写操作触发全表 + JSON.parse |
| Major | domain 反向依赖 storage | `positionsView/dailyAttribution/incomeCalendar` 导入 storage 类型 |
| P1 | Lab 1 文档规划未实现 | `3-单只银行定投回测.md` 的新口径在代码中缺失 |
| P1 | Research `calc_xirr` 缺测试 | 边界条件未直接验证 |
| P1 | `listInstruments` 整条 IPC 链死代码 | renderer 已弃用，主进程仍注册 |

---

## 二、Labs 域评审

### 2.1 总评

Labs 域整体设计严谨、文档体系完整、工程机制扎实。四个 Lab 按阶段递进，从数据源架构（Lab 0）到银行股定投（Lab 1）、行业相关性（Lab 2）、板块轮动（Lab 3），形成清晰的研究主线。

**亮点**：
- `data_source_registry.py` 提供完整的接口登记、体检、降级机制（`HealthStatus` 枚举、`InterfaceSpec` 数据类、`probe_interfaces` 体检、`fetch_first_available` 降级），工程质量在研究代码中罕见。
- `sanitize_error` 函数（[data_source_registry.py](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/data_source_registry.py#L103-L110)）主动过滤 Token/Cookie/代理凭据，安全意识到位。
- `direct_domains` 上下文管理器（[data_source_registry.py](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/data_source_registry.py#L120-L147)）精确控制 `NO_PROXY`，不清空系统代理，不影响其他程序。
- 每个 Lab 的 README 都明确标注了固定研究口径（市值快照日、历史区间、复权口径等），可复现性强。
- `.gitignore` 设计合理：`labs/data/*` 排除大文件，`!labs/data/README.md` 保留说明。

### 2.2 分 Lab 评审

#### Lab 0（00_金融数据获取）

- **代码质量**：无独立代码文件，主要是文档和教程 Notebook。
- **架构设计**：`0-金融数据源架构.md` 系统分析了 `a-stock-data` skill 的十层数据架构，并转换为项目可执行的四层规划（行情、基础数据、研报、新闻与公告），数据流向清晰。
- **文档完整性**：完整，包含十层架构表、宏观/中观/微观横向视角、数据源选择策略、与 Notebook 的映射关系。
- **数据与安全**：明确"Notebook 只读取当前进程环境变量，不读取或打印 `.env`"。
- **可维护性**：文档版本化（标注 skill v3.4.0、整理时间 2026-07-24）。

#### Lab 1（01_银行股定投回测）

- **代码质量**：
  - [bank_dca.py](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py)（982 行）：纯计算与数据获取分离，函数职责清晰。`PriceBundle`、`BacktestOutput` 数据类封装清晰。
  - 金融口径正确：`build_total_return_history`（L665-694）用不复权收盘价 + 现金分红构建总收益净值；`xirr`（L697-732）用二分法，处理了同号现金流退化；三类风险指标（`max_drawdown`、`max_loss_vs_contribution`、`volatility`）语义分离。
  - 分红处理正确：`normalize_dividends`（L541-582）统一新浪/东方财富口径，`cash_per_10 / 10.0` 转换为每股派息，只保留"实施"状态。
- **架构设计**：股票池 → 行情 → 分红 → 回测 → 指标 → 图表，链路清晰；双源价格校验（腾讯主源、新浪备源）+ 双源分红校验（新浪主源、东方财富备源）。
- **文档完整性**：6 个子文档覆盖概要、标准数据集、单标的、多标的、组合回测，验收标准明确（42 家银行 × 3 周期 = 126 行）。
- **测试覆盖**：`1-银行股定投回测概要.md` 提到 `test_bank_dca.py`，但仓库中未见该文件（见 P1-3）。

#### Lab 2（02_行业走势相关性研究）

- **代码质量**：
  - [build_notebooks.py](file:///d:/vibe-coding/trading-topic/labs/02_行业走势相关性研究/build_notebooks.py)（1078 行）：用 Python 源生成 Notebook，便于代码审阅和 diff。
  - 金融口径清晰：日对数收益率 Pearson 为主，Spearman 用 `rank().corr(method="pearson")` 实现避免引入 SciPy，Fisher CI 用 `NormalDist().inv_cdf`。
  - 数据质量门禁严格：`assert len(sw_industries) == 31`、`assert stock_classification["quote_available"].mean() >= 0.95`、`assert history_quality["row_count"].min() >= 1_000`。
  - 解释边界明确：明确说明选择时点偏差、幸存者偏差、行业指数与基准成分重叠的机械性相关。
- **架构设计**：两阶段 Notebook（分类 → 相关性），第二个 Notebook 读取第一个的 parquet 快照，依赖关系明确。

#### Lab 3（03_板块周期轮动研究）

- **代码质量**：
  - [build_notebook.py](file:///d:/vibe-coding/trading-topic/labs/03_板块周期轮动研究/build_notebook.py)（1079 行）：研究设计严谨，**预设参考规则在看结果前固定**（12 月动量 Top3、单边成本 20bp），避免数据挖掘指控。
  - 无前视处理正确：`held = target.shift(1)`（L699），月末信号下一月持有；`future_returns = sector_returns.shift(-1)`（L585）用于 Rank IC。
  - Rank IC 计算正确：`pair["signal"].rank().corr(pair["future"].rank(), method="pearson")`（L579-581）。
  - 成本敏感性分析：0/10/20/50 bp 四档，子区间（2011-2014、2015-2019、2020-2026H1）分析阶段敏感性。
- **文档完整性**：README + 0-研究大纲.md + 2-总体研究结论.md，tl;dr 部分直接给出关键数字（89.34% 冠军变更率、0.071 平均 Rank IC、10.41% CAGR）。
- **测试覆盖**：通过 Notebook 内 `assert` 做质量门禁（11 条数据质量断言 + 5 条结果断言），包括 `math.isclose(reference_metrics["ending_wealth"], (1 + reference_net20.dropna()).prod(), rel_tol=1e-12)` 的数值一致性校验。

### 2.3 Labs 域问题清单

#### P1（重要问题）

**P1-1：Lab 1 文档规划的新口径在代码中未实现**
- 文件：`labs/01_银行股定投回测/3-单只银行定投回测.md`（全文） vs `labs/01_银行股定投回测/bank_dca.py`
- 问题：文档第 26-34 行规划了"剩余现金按 204001 定盘利率逐日计息"，第 38-50 行规划了"三种费用模型（不计费/简化/精确）"，第 112-114 行规划了 `max_loss_duration_days` 指标，但 `bank_dca.py` 中均未实现。文档验收标准全部为 `[ ]` 未勾选状态，说明是未完成的规划。
- 风险：研究者按文档预期使用时会发现功能缺失，影响信任。
- 建议：要么在文档顶部明确标注"本口径为规划，未实现"，要么补充实现。考虑到 AGENTS.md 的"不过度工程化"原则，建议先标注规划状态。

**P1-2：Lab 2 ETF 分类置信度逻辑可能有误**
- 文件：[build_notebooks.py](file:///d:/vibe-coding/trading-topic/labs/02_行业走势相关性研究/build_notebooks.py#L488-L492)
- 问题：
  ```python
  etf_universe["classification_confidence"] = np.where(
      etf_universe["industry_initial"].eq("非行业ETF"),
      "中",
      np.where(etf_universe["industry_initial"].eq("待核验"), "低", "低"),
  )
  ```
  按语义，行业 ETF（匹配到行业关键词）应该是"高"或"中"置信度，"待核验"是"低"，"非行业ETF"是"中"（名称规则较可靠）。但当前代码把行业 ETF 和待核验都设为"低"，逻辑反了。
- 建议：改为 `np.where(eq("非行业ETF"), "中", np.where(eq("待核验"), "低", "高"))` 或在文档中说明"行业 ETF 初筛置信度也低，需基金合同核验"。

**P1-3：Lab 1 测试文件缺失**
- 文件：`labs/01_银行股定投回测/1-银行股定投回测概要.md:85` 提到 `test_bank_dca.py`，但 `labs/01_银行股定投回测/` 目录下无该文件。
- 问题：验收标准要求"`test_bank_dca.py` 通过"，但测试文件不存在。
- 建议：补充测试文件，或更新文档移除该验收项。

#### P2（次要问题）

**P2-1：data_source_registry.py 存在死代码**
- 文件：[data_source_registry.py:506](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/data_source_registry.py#L506)
- 问题：`_ = time.perf_counter() - started` 计算结果赋值给 `_` 后未使用。
- 建议：删除该行，或改为实际记录耗时到 trace。

**P2-2：bank_dca.py 风格小问题**
- 文件：[bank_dca.py:757](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L757)
- 问题：`if len(candidates):` 隐式布尔转换，PEP 8 建议显式 `if len(candidates) > 0:`。

**P2-3：Lab 3 Rank IC 与 spread 的最低样本数门槛不一致**
- 文件：[build_notebook.py:576-577, 607](file:///d:/vibe-coding/trading-topic/labs/03_板块周期轮动研究/build_notebook.py#L576-L607)
- 问题：Rank IC 用 `if len(pair) < 5` 允许 5 个以上，但 spread 用 `if len(pair) != len(SECTOR_NAMES)` 严格要求 10 个。两个门槛不一致，可能导致 IC 有值但 spread 跳过该月。
- 建议：统一门槛，或在文档中说明为何 spread 要求更严格（Top3 vs Rest 需要全样本）。

**P2-4：Lab 1 build_total_return_history 直接修改可能影响 dtype**
- 文件：[bank_dca.py:684](file:///d:/vibe-coding/trading-topic/labs/01_银行股定投回测/bank_dca.py#L684)
- 问题：`frame.loc[frame.index[0], "daily_total_return"] = 0.0` 在 cumprod 后的 float64 列上赋值通常无害，但若列是 float32 可能引发 dtype 提升。

---

## 三、Research 域评审

### 3.1 总评

Research 域目前只有一个子项 `bank-dca/`，但已完成完整的可复现研究闭环。架构清晰、测试覆盖金融口径边界、与 Labs 域有意重复（符合 `AGENTS.md` 隔离原则）。

**亮点**：
- 完全独立的环境：自己的 `pyproject.toml`、`uv.lock`、`src/`、`tests/`、`data/`、`report/`，不依赖 Labs。
- 四层分离：`data_fetch.py`（数据获取）→ `analysis.py`（纯分析）→ `verify_returns.py`（校验）→ `build_report.py`（报告），职责单一。
- [代码实现差异.md](file:///d:/vibe-coding/trading-topic/research/代码实现差异.md)（207 行）详细论证了与 Src 域的有意隔离，是优秀的跨域文档。
- `verify_returns.py` 实现端到端校验：nav 一致性（误差 ≤ 1e-10）、分红再投资提高 XIRR、官方全收益指数高于价格指数，校验结果保存到 `verification.json` 入库便于审计。
- `data/manifest.json` 入库便于复现，大文件（CSV）被 `.gitignore` 的 `*.csv` 规则排除，设计合理。

### 3.2 bank-dca 子项评审

#### 代码质量

**[analysis.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/analysis.py)**（208 行）：
- 简洁清晰，函数职责单一。`calc_xirr`（L12-35）用牛顿法，与 Labs 的二分法有意隔离。
- `build_stock_level`（L38-69）构建总回报净值，数学公式正确：`gross_return = (closes[t] × (1 + bonus[t]) + cash[t]) / closes[t-1]`，分红和送股都正确计入。
- `simulate_level_dca`（L102-178）净值驱动回测，与桌面域事件推进有意隔离。三种净值并排（`asset_nav`、`strategy_nav`、`pnl_on_principal`）便于学术对比。
- `rolling_backtest`（L181-207）生成滚动窗口，`valuation_end_ym` 参数确保每个窗口在自己的结束月估值，避免前视。

**[data_fetch.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/data_fetch.py)**（266 行）：
- 用 `requests` 直接调用，不依赖 AKShare（与 Labs 域隔离）。
- `fetch_stock_prices`（L60-91）按 2 年窗口分批拉取腾讯行情，`fetch_dividends`（L94-136）解析新浪 HTML 表格，`fetch_repo_204001`（L180-212）用 `ThreadPoolExecutor` 加速。
- `fetch_csi_index`（L139-164）明确处理中证接口的合成行问题（L160-161 注释说明 2006-01-01 是周日，接口会注入下一交易日收盘值，显式移除）。

**[verify_returns.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/verify_returns.py)**（102 行）：
- 端到端校验脚本，检查项明确：价格非正、分红有效、nav 一致性、分红再投资提高 XIRR、官方全收益高于价格指数、逆回购单调递增。
- 校验结果保存到 `verification.json`，便于跨版本对比。

**[build_report.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/build_report.py)**（557 行）：
- 5 张图表 + Markdown 报告自动生成。`format_pct`/`format_rate` 正确处理 NaN。
- `rolling_comparisons`（L162-203）对少于 12 个可比起点的窗口不报告胜率，避免"2 个高度重叠的十年窗口包装成稳定概率"，统计素养到位。

#### 架构设计

- 净值驱动设计简洁：阶段 1 构建 `level`，阶段 2 对 `level` 做定投，结构最简。
- 数学等价点：`build_stock_level` 的 `gross_return` 公式与桌面域 `simulateBacktest` 等价（见 `代码实现差异.md` 第 4 节），但实现独立。
- 三个 `console_scripts` 入口（`bank-dca-fetch`/`bank-dca-verify`/`bank-dca-report`）职责清晰。

#### 测试覆盖

- [tests/test_analysis.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/tests/test_analysis.py)（74 行）5 个单元测试覆盖金融口径边界：
  1. `test_contribution_does_not_hide_drawdown`：定投投入不被计入回撤（asset=-20%, strategy=-20%, principal=-10%）。
  2. `test_cash_dividend_reinvestment_offsets_ex_dividend_drop`：分红再投资抵消除权下跌。
  3. `test_bonus_shares_offset_price_adjustment`：送股抵消除权。
  4. `test_repo_rate_uses_actual_calendar_days`：逆回购按实际日历天数计息。
  5. `test_rolling_window_ends_in_its_own_month`：滚动窗口在自己的结束月估值。
- 测试聚焦金融口径正确性，与桌面域测试聚焦账户行为正确性有意互补。

### 3.3 Research 域问题清单

#### P1（重要问题）

**P1-1：测试用例数较少，缺乏 `calc_xirr` 边界条件测试**
- 文件：[tests/test_analysis.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/tests/test_analysis.py)
- 问题：5 个测试用例都聚焦于 `build_stock_level`/`simulate_level_dca`/`build_repo_level`，但 `calc_xirr` 函数（[analysis.py:12-35](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/analysis.py#L12-L35)）缺乏独立单元测试。`calc_xirr` 的边界条件（空现金流、单笔现金流、全部同号现金流、导数趋零、牛顿法不收敛）未被直接验证。
- 风险：`calc_xirr` 在退化情形下可能返回 NaN 或错误值，影响报告中的 XIRR 指标。
- 建议：补充 `calc_xirr` 的单元测试，覆盖空输入、单笔、同号、正常定投等场景。

**P1-2：data_fetch.py 缺乏数据质量校验**
- 文件：[data_fetch.py](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/data_fetch.py)
- 问题：`fetch_stock_prices`/`fetch_dividends`/`fetch_csi_index` 只做基本清洗（dropna、drop_duplicates），但未校验数据完整性（如日期范围覆盖、价格非负、分红字段合理）。质量校验推迟到 `verify_returns.py`，但 `verify_returns.py` 只检查 `close > 0` 和 `cash_dividend_per_share > 0`，未检查日期覆盖。
- 风险：若上游返回部分数据（如腾讯接口只返回 1 年数据），`verify_returns.py` 可能不报错，但回测结果失真。
- 建议：在 `fetch_stock_prices` 中增加日期范围断言（如 `assert frame["date"].min() <= pd.Timestamp("2020-01-02")`）。

#### P2（次要问题）

**P2-1：analysis.py 用 get_loc 设置首行值，可读性可改进**
- 文件：[analysis.py:153](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/analysis.py#L153)
- 问题：`daily.iloc[0, daily.columns.get_loc("strategy_return")] = 0.0` 用 `iloc` + `get_loc` 组合，可读性不如 `daily.loc[daily.index[0], "strategy_return"] = 0.0`。
- 建议：与 Labs 域 `bank_dca.py:684` 风格统一。

**P2-2：data_fetch.py 2 年窗口可能跨年遗漏**
- 文件：[data_fetch.py:66](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/data_fetch.py#L66)
- 问题：`for year in range(int(DATA_START[:4]), int(DATA_END[:4]) + 1, 2)` 用 2 年窗口，若腾讯接口在跨年边界有数据延迟，可能遗漏。但有 `drop_duplicates("date", keep="last")` 兜底，风险较低。
- 建议：可在注释中说明"2 年窗口有重叠覆盖，drop_duplicates 去重"。

**P2-3：build_report.py 硬编码日期字符串**
- 文件：[build_report.py:151-157, 241, 257](file:///d:/vibe-coding/trading-topic/research/bank-dca/src/bank_dca_research/build_report.py#L151-L257)
- 问题：`pd.Timestamp("2026-07-20")`、`"2020-01-01"` 等日期硬编码在多处，与 `data_fetch.py` 的 `DATA_END = "20260720"` 重复。
- 风险：若数据截止日变更，需多处修改，易遗漏。
- 建议：从 `manifest.json` 读取 `data_end` 并派生日期，减少硬编码。

**P2-4：verification.json 中 divident_events 字段类型不一致**
- 文件：[verification.json:64, 72](file:///d:/vibe-coding/trading-topic/research/bank-dca/data/verification.json#L64-L72)
- 问题：银行项的 `dividend_events` 是整数（如 22），但指数项是字符串 `"官方全收益指数内含"`，类型不一致，不利于程序化解析。
- 建议：统一为字符串或用单独字段标注。

### 3.4 跨域隔离执行情况

依据 `AGENTS.md` L9-13、L53，三域隔离是设计目标。评审确认：

- Labs 与 Research 各有独立的 `pyproject.toml`、`uv.lock`，不互相 import。
- XIRR 算法有意分叉：Labs 用二分法（`bank_dca.py:697-732`），Research 用牛顿法（`analysis.py:12-35`），`代码实现差异.md` 第 2 节详细论证。
- 回测架构有意分叉：Labs 是事件驱动（逐笔交易流水），Research 是净值驱动（level 序列），`代码实现差异.md` 第 3 节详细论证。
- 数据适配器有意分叉：Labs 用 AKShare 封装，Research 用 requests 直连。
- 测试焦点有意互补：Labs 测试口径正确性，Research 测试净值构建正确性，桌面测试账户行为正确性。

隔离原则执行良好，无违规跨域 import 或运行时依赖。

### 3.5 安全与 .gitignore 评审

**密钥泄露**：Grep 搜索 `(?i)(token|api[_-]?key|authorization|secret|password|cookie)` 在 Labs 和 Research 域均无实际密钥泄露。所有 Token 提及都是文档说明（如"需 Token/积分"）或 `data_source_registry.py:89-92` 的密钥过滤正则。

**.gitignore**：
- `labs/data/*` + `!labs/data/README.md`：正确排除大文件，保留说明。
- `labs/0X_*/data/`：各 Lab 子目录的 data 被排除。
- `*.csv`, `*.xlsx`, `*.parquet`, `*.feather`：全局排除数据文件，但可能误伤应入库的 CSV（如 Lab 2 的 `industry_market_cap.csv` 是研究结果）。经 `git check-ignore` 验证，Lab 2/3 的 data 目录确实被排除，符合"可再生数据不入库"原则。
- `research/bank-dca/data/manifest.json` 和 `verification.json` 被 git 跟踪（入库），大文件 CSV 被排除，设计合理。
- `.env`, `.env.*`, `*.token`：环境变量和密钥文件被排除。

**潜在风险**：`*.csv` 全局规则可能误伤未来需要入库的 CSV 文件。建议未来若需入库特定 CSV，用 `!path/to/file.csv` 例外规则。

---

## 四、src/desktop 架构与质量评审

### 4.1 架构设计

#### 强项

| 项目 | 评估 | 证据 |
| --- | --- | --- |
| 进程隔离 | **优秀** | [main.ts:48-54](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L48-L54) 严格设置 `contextIsolation: true / nodeIntegration: false / sandbox: true / webSecurity: true` |
| Preload 白名单 | **优秀** | [preload.ts:12-62](file:///d:/vibe-coding/trading-topic/src/desktop/electron/preload.ts#L12-L62) 仅通过 `contextBridge.exposeInMainWorld("desktop", api)` 暴露 `DesktopApi`；未暴露 `ipcRenderer`/`fs`/`shell`/`require`；仅使用 `ipcRenderer.invoke`，无 `.on/.send` |
| IPC 白名单 | **优秀** | [main.ts:67-283](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L67-L283) 所有 handler 显式静态注册，无动态 channel 构造 |
| shared/ 契约 | **优秀** | [shared/contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts) 定义 `DesktopApi` 接口，main/preload/renderer 三处统一引用 |
| 三域隔离 | **优秀** | 仅引入 `node:crypto`、`node:fs`、`node:path` 等内置模块，不 import Labs/Research |
| appService 编排 | **良好** | [appService.ts:202-1031](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L202-L1031) 校验在前、I/O 在中、事务提交在后；`runBacktest` 在外部请求前先 `assertBacktestRequest` |

#### 弱项

**Major — D1：domain 层反向依赖 storage 层**

- 文件：[positionsView.ts:17](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/positionsView.ts#L17)、[dailyAttribution.ts:5](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/dailyAttribution.ts#L5)、[incomeCalendar.ts:8](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/incomeCalendar.ts#L8)、[liveViews.test.ts:7](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/liveViews.test.ts#L7)、[investmentCashProjection.test.ts:3](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/investmentCashProjection.test.ts#L3)
- 问题：domain 模块从 `../storage/database` 导入 `StoredMarketPrice` 类型。这违反了"领域层不依赖持久化层"的分层原则，使领域逻辑耦合到具体存储实现。
- 建议：把 `StoredMarketPrice`、`StoredMarketCoverage` 等被领域层消费的类型上移到 `shared/contracts.ts`，或在 `domain/` 下定义独立的 `MarketPriceRow` 接口，由 storage 层适配。

**Minor — A1：`runBacktest` 单方法过长**

- 文件：[appService.ts:309-511](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L309-L511)（约 200 行）
- 问题：单方法承担请求规范化、目录校验、行情拉取、K 线拉取、分红事件拉取、节流、共同截止日计算、结果构造、警告附加、事务提交、日志写入 11 项职责。
- 建议：拆分为 `validateAndResolveInstruments`、`fetchMarketEvidence`、`assembleExperiment`、`persistExperiment` 等私有方法。

**Minor — A2：`getDirectoryProvenance` 全表扫描**

- 文件：[database.ts:677-693](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L677-L693)
- 问题：`getDirectoryProvenance("stock")` 内部调用 `listStockUniverse()` 全表加载所有 stock + etf 行，再 `.find()` 过滤类型。多个调用点触发 5000+ 行遍历。
- 建议：改为 `WHERE security_type = ?` SQL 过滤。

### 4.2 安全性

#### 强项

| 项目 | 评估 | 证据 |
| --- | --- | --- |
| SQL 注入防护 | **优秀** | 全部 `prepare` 使用 `?` 占位符；`IN (${placeholders})` 处用 `symbols.map(() => "?").join(", ")` 生成占位符 |
| 环境变量使用 | **优秀** | 仅 `process.env["ELECTRON_RENDERER_URL"]`（dev URL）和 `process.env["RUN_MARKET_SMOKE"]`（测试开关）使用，无 .env / API token / cookie 处理 |
| 北交所挑战 Cookie | **良好** | [stockUniverse.ts:318-363](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/stockUniverse.ts#L318-L363) 仅在请求生命周期内短时使用，不持久化、不入日志、不写入 SQLite |
| validateBackup 完整性 | **优秀** | [backupValidation.ts:530-568](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/backupValidation.ts#L530-L568) 校验顺序完整；[database.test.ts:300-885](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.test.ts#L300-L885) 覆盖 19+ 种非法备份 payload |
| 危险 API | **优秀** | 全仓库无 `eval(`、`new Function(`、`child_process`（除测试辅助）、`innerHTML`、`dangerouslySetInnerHTML` |
| 日志脱敏 | **良好** | [database.ts:386-395](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L386-L395) 内置 `Bearer [REDACTED]` 正则替换与 2000 字符截断 |

#### 弱项

**Major — S1：CSP 允许本地任意端口连接，与 PRD 矛盾**

- 文件：[renderer/index.html:6](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/index.html#L6)
- 问题：CSP `connect-src` 设置为 `'self' http://127.0.0.1:* http://localhost:*`。但 [ARCHITECTURE.md:29](file:///d:/vibe-coding/trading-topic/docs/product/ARCHITECTURE.md#L29) 明确"产品不监听本地 HTTP 端口，也不运行 Labs 或 Research"。这条规则是不必要的，反而为本地端口扫描/攻击打开门：若渲染层被 XSS，攻击者可向本机任意本地服务发起请求。
- 建议：收紧为 `connect-src 'self'`，并补充 `object-src 'none'; frame-ancestors 'none'; base-uri 'self'`。

**Minor — S2：`shell.openExternal` 未做协议白名单**

- 文件：[main.ts:57-60](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L57-L60)
- 问题：`setWindowOpenHandler` 把任意 `url` 直接交给 `shell.openExternal`，未校验协议。若页面被注入 `<a target="_blank" href="file:///...">` 等非 http(s) 协议链接，仍可能尝试交给系统处理。
- 建议：增加 `if (!url.startsWith("http://") && !url.startsWith("https://")) return { action: "deny" };`。

**Minor — S3：备份恢复未限制文件大小**

- 文件：[main.ts:235-271](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L235-L271)
- 问题：`backup:restore` handler 用 `readFileSync(filePath, "utf8")` + `JSON.parse` 同步加载用户选择的 JSON 文件，无大小上限。`dialog.showOpenDialog` 仅过滤扩展名，用户可选任意大文件，触发同步阻塞 + JSON 解析 OOM。
- 建议：在读入前用 `statSync` 检查大小（如 100 MB 上限），超限直接报错；或改用流式 + 限制长度的 JSON 解析器。

**Minor — S4：日志脱敏规则覆盖面窄**

- 文件：[database.ts:387-389](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L387-L389)
- 问题：仅匹配 `Bearer xxx`。若未来某处误传 `Authorization: Basic ...`、`Cookie: ...`、`api-key: ...` 等头字段，不会被脱敏。
- 建议：扩展正则至 `/(Bearer|Authorization|Cookie|api-key|token)\s*[:=]?\s*[A-Za-z0-9._~-]+/gi`。

**Info — S5：`webContents` 未限制导航与跳转**

- 文件：[main.ts:38-65](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L38-L65)
- 问题：未监听 `will-navigate`、`did-create-window` 事件，理论上若渲染层被注入 iframe/对象标签或触发主帧导航，可加载非预期资源。CSP 已限制 `default-src 'self'`，但仍建议显式阻断。
- 建议：增加 `win.webContents.on("will-navigate", (e, url) => { if (url !== devUrl) e.preventDefault(); })`。

### 4.3 性能优化

#### 强项

| 项目 | 评估 | 证据 |
| --- | --- | --- |
| SQLite WAL | **优秀** | [database.ts:172-173](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L172-L173) 在 schema 校验通过后才启用 `journal_mode = WAL` + `synchronous = NORMAL` |
| 行情增量缓存 | **优秀** | [appService.ts:564-599](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L564-L599) `missingLivePriceRanges()` 计算真实缺口区间，只拉缺失部分 |
| 节流与兜底 | **良好** | [appService.ts:376-380](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L376-L380) 多标的之间 `DATA_SOURCE_THROTTLE_MS = 1_200ms` 节流；[sina.ts:124-141](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/sina.ts#L124-L141) 全局请求队列 + 300ms 间隔 |
| 大数据量限制 | **良好** | `RECENT_BACKTEST_EXPERIMENT_LIMIT = 500`、`BACKTEST_MAX_SYMBOLS = 10`、`SINA_RECENT_LIMIT = 1_970` |
| React Query 缓存 | **良好** | [main.tsx:8-16](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/main.tsx#L8-L16) `staleTime: 30_000`，`retry: 1`，`refetchOnWindowFocus: false` |
| 事务批写 | **优秀** | [database.ts:430-441/484-496/763-833/1078-1206](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L430-L441) 多条 ledger/experiment/price 写入都包在单个 `transaction()` 内 |

#### 弱项

**Major — P1：主进程同步计算阻塞事件循环**

- 文件：[appService.ts:309-511](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L309-L511)（`runBacktest`）、[analysis.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/analysis.ts)（`simulateBacktest`）、[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts)（所有 better-sqlite3 调用）
- 问题：`runBacktest` 在主进程中串行执行：10 标的 × 每标的 2 次网络请求 + 1 次分红请求 + `simulateBacktest` 同步计算 + better-sqlite3 同步事务提交。对于 15 年回测 + 10 标的，`simulateBacktest` 处理约 3,650 × 10 = 36,500 行行情 + 分红送转事件，全部在主进程同步执行，会阻塞 IPC 响应、UI 事件、其他查询。better-sqlite3 本身是同步 API。
- 建议：
  1. 将 `simulateBacktest` 重计算移到 Worker 线程（`worker_threads`）；
  2. 或将单次 `runBacktest` 拆成多步 IPC，前端显示进度；
  3. 至少在 `runBacktest` 期间向渲染层发送 "计算中" 心跳，避免用户误以为卡死。

**Major — P2：`listLedger()` 全表加载到内存**

- 文件：[database.ts:443-448](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L443-L448)、[appService.ts:553/784/899/968/1012](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L553)
- 问题：`listLedger()` 直接 `SELECT payload_json FROM ledger_entries ORDER BY business_date DESC, recorded_at DESC`，无分页、无 WHERE，把全部流水（含已冲正与审计事件）JSON 反序列化到内存。`reduceLedger`、`queryLedger`、`previewLedger`、`correctLedger`、`reverseLedger`、`previewDividendReinvestment`、`getIncomeCalendar` 都触发这一路径。长期使用后流水可能数千条，每次操作都全量加载 + JSON.parse。
- 建议：在 storage 层增加按 `business_date` 区间和 `id` 精确查询的方法；`getLedgerRecord(entryId)` 已是按 id 查询，但 `correctLedger`/`reverseLedger` 仍走全表。

**Minor — P3：`ledger:export` 逐页查询拼装**

- 文件：[main.ts:147-168](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L147-L168)
- 问题：导出交易流水时按 pageSize=100 逐页 `service.queryLedger`，每次查询内部又调用 `listLedger()` 全表加载 + `reduceLedger` 全量归约。N 页 = N 次全表扫描 + N 次归约。
- 建议：直接 `SELECT * FROM ledger_entries WHERE ...` 一次性导出，跳过分页与归约（导出场景不需要归约结果）。

**Minor — P4：`assertLedgerGraph` 存在 O(N²) 嵌套**

- 文件：[backupValidation.ts:137-148](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/backupValidation.ts#L137-L148)
- 问题：对每个 `correctsEntryId` 都执行 `entries.some(...)` 找对应冲正记录，复杂度 O(N²)。备份校验通常 N 较小（<1k），实际可接受。
- 建议：先建立 `reversesEntryIdSet` / `correctsEntryIdMap`，O(N) 完成。

**Minor — P5：500 行实验表格无虚拟化**

- 文件：[ExperimentHistoryTable.tsx:72-74](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/ExperimentHistoryTable.tsx#L72-L74)
- 问题：`pagination={experiments.length > 12 ? { pageSize: 12 } : false}` 使用 antd Table 默认分页，500 条数据时一次拉取全量再前端分页。
- 建议：实际 500 行 antd Table 性能可接受，若未来上限提高建议改用虚拟列表。

**Minor — P6：无任何 `React.memo`**

- 文件：`renderer/src/` 全目录（grep `React.memo|memo(` 0 命中）
- 问题：表格行组件、Modal 子组件、Card 子组件未做 memo，父组件状态变化可能触发全表 re-render。
- 建议：对纯展示的子组件（如 `BacktestMetrics`、`CurrentExperimentTable`、`QualityNotice`）加 `React.memo`，配 `useMemo` 派生数据。

### 4.4 可维护性

#### 强项

| 项目 | 评估 | 证据 |
| --- | --- | --- |
| 测试覆盖 | **优秀** | 18 个测试文件，161 测试用例通过 / 1 skipped。覆盖 storage（version/fingerprint/迁移/备份恢复 19+ 异常 payload）、domain、data、services 各层 |
| 类型严格 | **优秀** | [tsconfig.json:8-15](file:///d:/vibe-coding/trading-topic/src/desktop/tsconfig.json#L8-L15) 开启 `strict / noUnusedLocals / noUnusedParameters / noFallthroughCasesInSwitch`；通过 `tsc --noEmit` |
| 文档完整性 | **优秀** | README、THIRD_PARTY_NOTICES、PRD、ARCHITECTURE 完整；代码中关键决策有中文注释 |
| 错误处理联合判别 | **优秀** | `ChartDataState = loading/ready/unavailable/error` 四态；`LiveDataStatus = ready/empty/stale/partial`；`XirrStatus`；`MarketTailStatus` |
| 三域隔离 | **优秀** | 不 import/执行/读取 Labs、Research；测试 fixture 自包含 |
| 无 TODO/FIXME/HACK | **优秀** | 全仓库 0 命中 |

#### 弱项

**Minor — M1：`console.error` 残留**

- 文件：[useBacktestWorkspace.ts:76](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/useBacktestWorkspace.ts#L76)
- 问题：工作区保存失败时同时 `console.error` + `setSaveError`，前者会在生产环境控制台留下错误日志，与"统一日志到 SQLite"策略不一致。
- 建议：移除 `console.error`，仅保留 `setSaveError` UI 提示。

**Minor — M2：`useBacktestWorkspace` 防抖定时器无清除保证**

- 文件：[useBacktestWorkspace.ts:52-82](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/useBacktestWorkspace.ts#L52-L82)
- 问题：若 `api.saveBacktestWorkspace` 已触发未完成时组件卸载，promise 仍会 `setSaveError`，触发 React 卸载后 setState 警告。
- 建议：增加 `mountedRef` 或在 cleanup 中标记 cancelled。

**Info — M3：`finance.ts` 的 XIRR 二分法未处理极端场景**

- 文件：[finance.ts:28-51](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/finance.ts#L28-L51)
- 问题：`low = -0.9999`、`high = 1`，若两端同号则最多倍增 24 次（最高到 8,388,608），若仍同号返回 null。极端现金流可能找不到解。
- 建议：增加单元测试覆盖极端场景。

### 4.5 数据库 Schema 与备份

#### 强项

| 项目 | 评估 | 证据 |
| --- | --- | --- |
| 双重 fingerprint | **优秀** | [database.ts:24-25](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L24-L25) `SCHEMA_FINGERPRINT = "stock-income-r1-schema-2-2026-07-30-valuation-boundary-v3"` + `schemaShapeFingerprint()`（DDL 结构 sha256） |
| 不迁移策略 | **优秀** | [database.ts:194-198/247-251](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L194-L198) 旧版本、未标记版本、缺表、指纹不匹配均抛错并保持原文件不变 |
| 备份契约 | **优秀** | `validateBackup` 在覆盖事务前完整校验；同版本旧 fingerprint 也不兼容；`assertLedgerGraph` 校验类型专属字段 |
| 表结构约束 | **优秀** | [database.ts:252-366](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L252-L366) 所有枚举字段加 `CHECK` 约束；外键 + `ON DELETE CASCADE` |
| 索引设计 | **良好** | 三个索引覆盖主查询路径 |

#### 弱项

**Minor — D2：`restoreBackup` 不校验 `app_logs` 与 `schema_metadata`**

- 文件：[database.ts:1078-1206](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L1078-L1206)、[backupValidation.ts:530-568](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/backupValidation.ts#L530-L568)
- 问题：备份契约覆盖 9 张表，但 `app_logs` 和 `schema_metadata` 不在备份中。`schema_metadata` 由当前数据库自身持有合理；`app_logs` 不备份是设计选择（日志不属于业务数据），但应在 `BackupPayload` 类型注释中显式说明。
- 建议：在 `BackupPayload` 接口注释中说明 "app_logs 与 schema_metadata 不纳入备份契约"。

**Minor — D3：`shape_fingerprint` 对 DDL 空白敏感**

- 文件：[database.ts:140-159](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L140-L159)
- 问题：`schemaShapeFingerprint` 用 `sql.replace(/\s+/g, " ").trim()` 标准化空白后 sha256。若 SQLite 版本升级导致 `sqlite_master.sql` 输出格式微调（如缩进、换行），可能触发误报"指纹不匹配"。
- 建议：在 `database.test.ts` 增加 SQLite 版本注记；或在 README 说明 `shape_fingerprint` 是 DDL 字节级哈希，升级 SQLite 后需重新生成。

**Info — D4：`backup:restore` 失败时安全备份不回滚**

- 文件：[main.ts:254-271](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L254-L271)
- 问题：恢复失败时，`pre-restore-${timestamp}.json` 已写入磁盘但当前数据库未变更。这是合理设计，但 UX 上失败提示未明确告知安全备份路径。
- 建议：失败对话框中显示 `safetyBackupPath`。

---

## 五、src/desktop 死代码专项分析

### 5.1 分析方法

- 列出全部 73 个 `.ts/.tsx` 文件
- 对 `shared/contracts.ts`、`shared/constants.ts`、`electron/storage/database.ts`、`electron/services/appService.ts`、`electron/domain/*`、`electron/data/*`、`renderer/src/**/*` 中所有 `export` 符号反向 Grep 引用
- 运行 `tsc --noEmit`（已开启 `noUnusedLocals` + `noUnusedParameters`）排查未使用 import / 局部变量
- Grep `if (false)`、`if (true)`、`debugger;`、`console.*`、注释代码块等模式
- 检查 `.bak/.old/_v2/_deprecated` 等命名

### 5.2 死代码识别结果

#### 类别 1：未引用的导出（生产链路断链）

**🔴 高风险 — `listInstruments` 整条 IPC 链路死代码**

renderer 从不调用 `api.listInstruments`，但主进程仍注册 IPC、preload 仍暴露、AppService 仍实现并测试。

| 文件 | 行号 | 内容 |
| --- | --- | --- |
| [shared/contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L653) | 653 | `listInstruments(): Promise<StockInfo[]>;` |
| [preload.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/preload.ts#L16) | 16 | `listInstruments: () => ipcRenderer.invoke("instruments:list"),` |
| [main.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L81) | 81 | `ipcMain.handle("instruments:list", () => service.listInstruments());` |
| [appService.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L301-L307) | 301-307 | `async listInstruments(): Promise<StockInfo[]> { ... }` |
| [appService.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L108-L115) | 108-115 | `function mergeInstrumentUniverse(...)`（仅被 `listInstruments` 调用） |
| [client.ts](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/api/client.ts#L22) | 22 | `listInstruments: () => bridge().listInstruments(),` |

- **判断依据**：Grep `api\.listInstruments` / `listInstruments` 在整个 `renderer/` 下零调用；唯一引用在 `appService.test.ts:255` 与 `appService.coldStart.test.ts`（测试）。
- **风险等级**：高 — renderer 完全改用 `listAStocks` + `listEtfs` 分批加载，此 API 已成孤立链路。
- **建议**：删除时需同步移除 `DesktopApi.listInstruments` 接口声明 + preload + ipcMain + AppService 方法 + `mergeInstrumentUniverse` 辅助函数 + 2 个相关测试用例。

#### 类别 2：仅在测试中引用的生产实现

**🟡 中风险 — 三个 `LocalDatabase` 方法已被新接口取代**

| 文件 | 行号 | 符号 | 判断依据 |
| --- | --- | --- | --- |
| [database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L484-L486) | 484-486 | `saveBacktestExperiment(experiment)` | 生产代码改用 `saveBacktestExperimentWithMarketData()`（[appService.ts:497](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L497)）；此方法只在 `database.test.ts:185,509,512,573` 调用 |
| [database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L939-L1008) | 939-1008 | `listMarketPrices(symbols?)` | 生产代码改用 `listLiveMarketPrices()`；此方法只在 `appService.test.ts:1017` 调用 |
| [database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L1010-L1026) | 1010-1026 | `latestPrices()` | 生产代码改用 `listLiveMarketPrices()` + 在 [positionsView.ts:177-183](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/positionsView.ts#L177-L183) 自建 Map；此方法只在 `database.test.ts:562` 和 `appService.test.ts:637,708` 调用 |

- **风险等级**：中 — 删除前需确认测试是否仍需这些方法做断言；若测试改写为通过新 API 断言则可一并清理。

**🟡 中风险 — `assertCurrentYearCalendarOfficial`**

| 文件 | 行号 | 内容 |
| --- | --- | --- |
| [marketCalendar.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/marketCalendar.ts#L56-L66) | 56-66 | `export function assertCurrentYearCalendarOfficial(now = new Date()): void { ... }` |

- **判断依据**：Grep 显示生产代码改用 `assertMarketCalendarOfficialForRange()`（被 [marketDataProvider.ts:212](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/marketDataProvider.ts#L212) 调用）；此函数只在 `marketCalendar.test.ts:84` 调用。
- **风险等级**：中 — 函数体本身有逻辑，但生产链路无任何调用点。

#### 类别 3：导出但仅在本文件内部使用的类型/接口（`export` 关键字冗余）

这些都是已导出但仅被同文件其他导出符号内部引用的类型，**代码本身不死**，只是 `export` 修饰符冗余。删除 `export` 不会影响功能。

| 文件 | 行号 | 符号 | 内部使用位置 |
| --- | --- | --- | --- |
| [contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L618) | 618 | `BacktestExperimentStatus` | `BacktestExperimentSummary.status`（626 行） |
| [contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L300) | 300 | `LiveDataStatus` | `LiveDataQuality.status`（312 行） |
| [contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L577) | 577 | `ExportResult` | `DesktopApi` 多个方法签名 + `RestoreResult extends` |
| [contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L582) | 582 | `RestoreResult` | `DesktopApi.restoreBackup`（689 行） |
| [contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L482) | 482 | `IncomeCalendarEvent` | `IncomeCalendarDay.events`（502 行） |
| [contracts.ts](file:///d:/vibe-coding/trading-topic/src/desktop/shared/contracts.ts#L505) | 505 | `IncomeMetric` | `IncomeCalendarView.metrics`（519-524 行） |
| [finance.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/finance.ts#L54) | 54 | `DrawdownProfile` | `drawdownProfile` 返回类型（66 行） |
| [investmentCashProjection.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/investmentCashProjection.ts#L4) | 4 | `InvestmentCashflow` | `InvestmentCashProjection.externalCashflows` 等 |
| [investmentCashProjection.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/investmentCashProjection.ts#L9) | 9 | `InvestmentCashProjection` | `projectInvestmentCash` 返回类型 |
| [dailyAttribution.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/dailyAttribution.ts#L15) | 15 | `ContributionAttribution` | `DailyAttribution.contributions`（36 行） |
| [liveFormat.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/liveFormat.tsx#L120) | 120 | `LiveMetricItem` | `LiveMetricStrip` 参数（132 行） |
| [database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L23) | 23 | `SCHEMA_VERSION` | 多处内部使用（186,194,206,226,242,377,1030,1075） |

- **风险等级**：低 — 不删也可；删除 `export` 可减小公开 API 表面。

#### 类别 4-7：未发现死代码

| 类别 | 结果 |
| --- | --- |
| **未使用的 import** | 无。`tsc --noEmit` 通过 `noUnusedLocals: true` 检查零报错 |
| **注释掉的代码块** | 无匹配 |
| **不可达代码**（`if (false)`、`if (true)` 另一半分支、`return` 后语句） | 无匹配 |
| **`debugger;` / `console.*`** | 无匹配（生产代码统一用 `database.log()`，仅 `useBacktestWorkspace.ts:76` 一处 `console.error` 残留） |
| **废弃文件命名**（`.bak/.old/_v2/_deprecated/_obsolete/.backup/~`） | 无匹配 |
| **`TODO/FIXME/HACK/@deprecated`** | 无匹配 |

### 5.3 死代码专项结论

1. **唯一明确的"高优先级清理项"是 `listInstruments` 整条 IPC 链**——从 `DesktopApi` 接口、preload、ipcMain、AppService 到 `mergeInstrumentUniverse` 辅助函数，再加上 `client.ts` 的包装，全部孤立。renderer 已改用 `listAStocks` + `listEtfs`。
2. **4 个生产方法仅在测试中调用**（`saveBacktestExperiment`、`listMarketPrices`、`latestPrices`、`assertCurrentYearCalendarOfficial`）——是"被新 API 取代但旧实现保留给测试"的典型模式。建议先确认测试能否改写为通过新 API 断言，再决定删除。
3. **12 个类型/常量导出冗余**——`export` 关键字可去掉，但代码本身有内部使用，不属于真正死代码。
4. **代码质量整体很高**：tsc 严格模式 + noUnusedLocals/noUnusedParameters 通过，无 console/debugger/注释代码块/废弃文件。死代码集中在"API 演进留下的旧路径"上，而非随手遗留的实验代码。

---

## 六、src/desktop 重复代码专项分析

> **重要约束**：依据 `AGENTS.md`，本项目三域隔离是设计意图：`labs/`、`research/`、`src/` 各自实现相似算法属于预期，**不构成代码异味**。本节仅分析 `src/desktop` 内部重复。

### 6.1 完全相同的代码块（≥10 行连续重复）

#### 1.1 Excel 工作表样式函数 `styleWorksheet`

- **文件**：
  - [backtestWorkbook.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/backtestWorkbook.ts#L52-L67) 第 52-67 行
  - [liveWorkbooks.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/liveWorkbooks.ts#L8-L23) 第 8-23 行
- **重复类型**：高度相似（仅一处 argb 颜色字面量不同：`FF0F2747` vs `FF112543`）
- **代码片段**：
  ```typescript
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: "A1", to: worksheet.getRow(1).getCell(worksheet.columnCount).address };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FF..." } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F7FC" } };
  worksheet.eachRow((row) => { row.alignment = { vertical: "middle" }; });
  ```
- **建议**：提取为 `electron/export/_internal/workbookStyle.ts` 中的 `styleWorksheet(worksheet, accentColor)` 工具函数；同时统一颜色字面量。
- **优先级**：高（重复 2 次，且 `liveWorkbooks.ts` 内部还重复调用 4 次）

#### 1.2 工作簿转 Buffer 模式

- **文件**：
  - [backtestWorkbook.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/backtestWorkbook.ts#L225-L228) 第 225-228 行
  - [liveWorkbooks.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/liveWorkbooks.ts#L25-L30) 第 25-30 行
- **重复类型**：完全相同
- **代码片段**：
  ```typescript
  const output = await workbook.xlsx.writeBuffer();
  const arrayBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(arrayBuffer).set(new Uint8Array(output));
  return Buffer.from(arrayBuffer);
  ```
- **建议**：与 1.1 一起放入 `electron/export/_internal/workbookStyle.ts`，导出 `workbookToBuffer(workbook)`。
- **优先级**：中

#### 1.3 `workbook.creator = "攒股收息"` 与 workbook 初始化

- **文件**：[backtestWorkbook.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/backtestWorkbook.ts#L219-L221) 第 219-221 行；[liveWorkbooks.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/liveWorkbooks.ts#L35-L37) 第 35-37、114-116、204-206 行
- **重复类型**：完全相同
- **建议**：与 1.1、1.2 一并提取 `createWorkbook()` 工厂函数。
- **优先级**：中

#### 1.4 "行情来源"工作表配置（同文件内 3 次重复）

- **文件**：[liveWorkbooks.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/liveWorkbooks.ts#L88-L107) 第 88-107 行（Positions）、178-197 行（IncomeCalendar）、隐式存在于 LedgerWorkbook 流程
- **重复类型**：完全相同（columns 定义、provenance 数据填充逻辑、`source === "tencent" ? "腾讯" : "新浪"` 转换）
- **代码片段**：
  ```typescript
  const provenance = workbook.addWorksheet("行情来源");
  provenance.columns = [ { header: "实际来源", key: "source", width: 14 }, ... ];
  for (const row of overview.provenance) {
    provenance.addRow({ ...row, source: row.source === "tencent" ? "腾讯" : "新浪",
      primarySource: "腾讯", fallbackUsed: row.fallbackUsed ? "是" : "否",
      adjustment: row.adjustment === "qfq" ? "前复权" : "不复权" });
  }
  ```
- **建议**：提取 `addProvenanceSheet(workbook, provenance)` 单一函数。
- **优先级**：高（同文件内 3 次重复，扩展时极易遗漏）

#### 1.5 `entryAmount` vs `ledgerEntryAmount` 与 `entryOrder` vs `canonicalLedgerOrder`

- **文件**：
  - [investmentCashProjection.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/investmentCashProjection.ts#L28-L46) 第 28-46 行
  - [ledgerReducer.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerReducer.ts#L31-L59) 第 31-59 行
- **重复类型**：完全相同
- **代码片段**：
  ```typescript
  function entryAmount(entry: LedgerEntry): number {
    if (entry.amount !== undefined) return roundMoney(entry.amount);
    if ((entry.type === "buy" || entry.type === "sell") && entry.price !== undefined && entry.quantity !== undefined) {
      return roundMoney(entry.price * entry.quantity);
    }
    return 0;
  }
  ```
- **建议**：`investmentCashProjection.ts` 直接从 `ledgerReducer.ts` 复用 `ledgerEntryAmount` 和 `canonicalLedgerOrder`；不需新建文件。
- **优先级**：高（已有公开导出，删除本地副本即可）
- **风险评估**：极低；`investmentCashProjection.test.ts` 与 `ledgerReducer.test.ts` 已分别覆盖。

#### 1.6 `recordedOrder` 变体

- **文件**：
  - [liveViewSupport.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/liveViewSupport.ts#L9-L15) 第 9-15 行（先 recordedAt 后 businessDate）
  - [ledgerReducer.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerReducer.ts#L31-L40) 第 31-40 行（先 businessDate 后 recordedAt）
- **重复类型**：高度相似（仅字段优先级不同，是有意差异）
- **建议**：保持现状但建议在 `liveViewSupport.ts` 顶部加一行注释说明"刻意使用 recordedAt 优先级，区别于 canonicalLedgerOrder"。**不要抽象**。
- **优先级**：低

### 6.2 重复的辅助函数（小工具）

#### 2.1 金额与百分比格式化

- **文件**：
  - [backtest/formatters.ts](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/formatters.ts#L1-L13) 第 1-13 行
  - [live/liveFormat.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/liveFormat.tsx#L5-L29) 第 5-29 行
- **重复类型**：模式重复（同名 `money`/`percent`，签名不同）
- **代码片段**：
  ```typescript
  // backtest/formatters.ts
  export function money(value: number): string { return CNY_FORMATTER.format(value); }
  export function percent(value: number | null): string { return value === null ? "—" : `${(value * 100).toFixed(2)}%`; }

  // live/liveFormat.tsx
  export function money(value: number | null, signed = false): string { ... }
  export function percent(value: number | null, signed = false): string { ... }
  ```
- **建议**：在 `renderer/src/pages/_shared/format.ts` 中合并为单一 `money(value, options?)` 与 `percent(value, options?)`，兼容 null 与 signed；backtest 与 live 各自 re-export。
- **优先级**：高（两套语义不一致容易导致 UI 显示差异）
- **风险评估**：中；需检查 backtest 页面所有调用点。

#### 2.2 日期正则 `/^\d{4}-\d{2}-\d{2}$/`

- **文件**：
  - [dateUtils.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/dateUtils.ts#L10) 第 10 行（`validDate`）
  - [tencent.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/tencent.ts#L48) 第 48 行（`dateValue`）、411 行
  - [sina.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/sina.ts#L56) 第 56 行
- **建议**：在 `electron/data/_internal/parse.ts` 暴露 `parseDateString(value: unknown): string` 统一处理；不要直接复用 `validDate`。
- **优先级**：中

#### 2.3 有限数解析 `finiteNumber` / `nonnegativeNumber`

- **文件**：
  - [sina.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/sina.ts#L67-L70) 第 67-70 行（`finiteNumber`）
  - [tencent.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/tencent.ts#L22-L25) 第 22-25 行（`nonnegativeNumber`）、27-44 行（`firstNonnegativeNumber`）
- **代码片段**：
  ```typescript
  // sina.ts
  function finiteNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // tencent.ts
  function nonnegativeNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  ```
- **建议**：与 2.2 一起放入 `electron/data/_internal/parse.ts`。
- **优先级**：中

#### 2.4 backtest/dateUtils 与 electron/domain/dateUtils 同名但语义不同

- **文件**：
  - [backtest/dateUtils.ts](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/dateUtils.ts)（renderer 端，仅 12 行）
  - [dateUtils.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/dateUtils.ts)（domain 端）
- **建议**：不需要合并（跨进程边界，AGENTS.md 强调隔离）。保留现状。
- **优先级**：低

### 6.3 高度相似代码块（结构相同，≥15 行）

#### 3.1 数据源 fetch-with-timeout 模式

- **文件**：
  - [tencent.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/tencent.ts#L296-L313) 第 296-313 行（`fetchJson`）+ 457-484 行
  - [sina.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/sina.ts#L92-L122) 第 92-122 行（`executeTextRequest`）
  - [stockUniverse.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/data/stockUniverse.ts#L66-L96) 第 66-96 行（`request`）
- **重复类型**：高度相似（核心三段式：`new AbortController` → `setTimeout(abort)` → `fetch(url, { headers: UA, signal })` → 错误处理 → `clearTimeout`）
- **代码片段**：
  ```typescript
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Referer: "..." } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.{json|text|arrayBuffer}();
  } finally { clearTimeout(timeout); }
  ```
- **建议**：在 `electron/data/_internal/httpClient.ts` 提取 `fetchWithTimeout(url, { label, timeoutMs, headers, responseType })`；UA 常量单独导出 `DEFAULT_HTTP_USER_AGENT`。注意 sina.ts 额外需要 `HttpStatusError` 子类和请求队列，应保留扩展点。
- **优先级**：高（4 处 User-Agent 字面量重复，UA 字符串变更需 4 处修改）
- **风险评估**：中；tencent/sina/stockUniverse 各有独立测试，重构后需复跑 mock 测试。

#### 3.2 `LedgerEntryModal` 与 `DividendReinvestmentModal` 表单结构

- **文件**：
  - [LedgerEntryModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/LedgerEntryModal.tsx) 全文 480 行
  - [DividendReinvestmentModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/DividendReinvestmentModal.tsx) 全文 403 行
- **重复类型**：高度相似
- **重复内容**：
  1. `InstrumentCatalogStatus` / `InstrumentOption` 类型定义（第 44-53 行 vs 第 41-50 行，完全相同）
  2. `stockBySymbol` Map 构建（第 137-140 行 vs 第 75-78 行，完全相同）
  3. `symbolOptions` useMemo 过滤逻辑（第 141-154 行 vs 第 79-92 行，完全相同）
  4. `displayedSymbolOptions` 三态降级（第 157-169 行 vs 第 95-107 行，完全相同）
  5. `AutoComplete` + `filterOption` + `onSelect` + `onDropdownVisibleChange` 配置（第 322-359 行 vs 第 224-251 行，几乎完全相同）
  6. 资产类型 `Select` + `onChange` 重置 symbol/instrumentName（第 297-312 行 vs 第 260-275 行，完全相同）
  7. Modal footer 三按钮（取消/校验并预览/确认）+ `runPreview` → `submit` 流程（第 192-227 行 vs 第 140-170 行，结构完全一致）
- **建议**：
  - 类型与选项逻辑提取到 `renderer/src/pages/live/_internal/instrumentPicker.tsx`，导出 `useInstrumentPicker(stocks, securityType)` Hook 返回 `{ stockBySymbol, symbolOptions, displayedSymbolOptions, activeCatalogStatus }`。
  - 抽取 `<InstrumentAutoComplete />` 组件包装 `AutoComplete` + `filterOption` + catalog 重试。
  - 抽取 `useLedgerFormPreview<TInput, TPreview>(previewFn)` Hook 统一 previewing/saving/preview state 管理。
- **优先级**：高（两个 Modal 共享约 80 行完全相同代码，未来新增类似流水录入时还会复制）
- **风险评估**：中；无单元测试覆盖，建议先补 smoke test。

#### 3.3 database.ts 中 `listMarketPrices` 与 `listLiveMarketPrices`

- **文件**：[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L836-L880) `listLiveMarketPrices` 第 836-880 行；`listMarketPrices` 第 939-1008 行
- **重复类型**：高度相似（前者多 2 个字段 `requested_from`、`requested_through`；后者有 symbols undefined 双分支）
- **建议**：提取私有方法 `private mapStoredMarketPrice(row): StoredMarketPrice`，消除 6+ 处 `...(row.fallback_reason ? { fallbackReason: ... } : {})` 重复。
- **优先级**：中

#### 3.4 Excel 导出 numberFmt 设置

- **文件**：
  - [backtestWorkbook.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/backtestWorkbook.ts#L132-L143) 第 132-143 行（summary）、190-203 行（detail）
  - [liveWorkbooks.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/export/liveWorkbooks.ts#L68-L86) 第 68-86、141-149、168-176、251-255 行
- **重复类型**：模式重复（`'¥#,##0.00;[Red]-¥#,##0.00'` 出现 8+ 次；`"0.00%;[Green]-0.00%"` 出现 6+ 次）
- **建议**：在 `electron/export/_internal/numberFormats.ts` 导出常量：
  ```typescript
  export const CURRENCY_FMT = '¥#,##0.00;[Red]-¥#,##0.00';
  export const PERCENT_FMT = "0.00%;[Green]-0.00%";
  export const PRICE_FMT = "0.000";
  export const QUANTITY_FMT = "#,##0.00";
  ```
- **优先级**：中

### 6.4 重复的错误处理/校验模式

#### 4.1 "必须是合法的 YYYY-MM-DD" 校验

- **文件**：
  - [ledgerReducer.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerReducer.ts#L75-L77) 第 75-77 行
  - [ledgerCommands.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerCommands.ts#L68-L70) 第 68-70、116-118 行
  - [ledgerQuery.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerQuery.ts#L107-L119) 第 107-119 行
  - [incomeCalendar.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/incomeCalendar.ts#L58-L60) 第 58-60 行
- **建议**：`electron/domain/dateUtils.ts` 已有 `validDate`；新增 `assertValidDate(value, label = "日期")` 与 `assertValidMonth(value, label = "月份")` 抛出统一错误。
- **优先级**：中

#### 4.2 "冲正/修正记录不能再次冲正" 双重校验

- **文件**：[ledgerCommands.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerCommands.ts#L186)
  - `previewLedgerMutation` 第 186 行：`if (target?.type === "adjustment") throw new Error("冲正/修正记录不能再次修正");`
  - `assertLedgerReversal` 第 255 行：`if (target.type === "adjustment") throw new Error("冲正/修正记录不能再次冲正");`
- **建议**：抽取 `assertReversibleTarget(target, mode: "reverse" | "correct")` 内部函数。
- **优先级**：低

#### 4.3 `requireFinite` / `optionalFinite` 通用校验工具

- **文件**：[ledgerCommands.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/ledgerCommands.ts#L21-L53) 第 21-53 行
- **现状**：仅本文件内使用，但 `analysis.ts`、`backupValidation.ts`、`marketDataProvider.ts` 都有类似的 `Number.isFinite` + 抛错模式。
- **建议**：**不建议强行抽象**，各调用点语义差异较大（analysis 不抛错而是 fallback，marketDataProvider 抛特定文案）。
- **优先级**：低（边际收益）
- **风险评估**：高（强行抽象会扭曲语义）

### 6.5 重复的 SQL 查询片段

#### 5.1 market_prices INSERT 语句

- **文件**：[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L720-L725)
  - `insertMarketData` 第 720-725 行：`INSERT OR REPLACE INTO market_prices(...) VALUES (...)`
  - `restoreBackup` 第 1106-1111 行：`INSERT INTO market_prices(...) VALUES (...)`
- **重复类型**：高度相似（仅 `INSERT OR REPLACE` vs `INSERT`）
- **建议**：将列定义提取为常量 `MARKET_PRICE_COLUMNS`，构造 SQL 字符串；或提取私有方法。
- **优先级**：中

#### 5.2 live_market_prices INSERT 语句

- **文件**：[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L749-L755) `saveLiveMarketPriceSnapshots` 第 749-755 行；`restoreBackup` 第 1126-1132 行
- **重复类型**：高度相似
- **优先级**：中

#### 5.3 live_market_coverage INSERT 语句

- **文件**：[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L756-L762) `saveLive` 第 756-762 行；`restoreBackup` 第 1149-1155 行
- **优先级**：中

#### 5.4 SELECT 列表与 `fallback_reason ?` 条件展开映射

- **文件**：[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts) 多处（`listLiveMarketPrices` 第 856-862 行、`listLiveMarketCoverage` 第 905-911 行、`listMarketPrices` 第 956-960、990-993 行、`exportBackup` 第 1040-1059 行）
- **代码片段**：
  ```typescript
  ...(row.fallback_reason ? { fallbackReason: row.fallback_reason } : {})
  ```
  在 database.ts 中出现 6 次；`...(row.empty_evidence ? { emptyEvidence: row.empty_evidence } : {})` 出现 2 次。
- **建议**：提取工具函数 `withOptional<T extends string>(value: T | null, key: string)` 或直接使用 `compactObject`。SELECT 列表可定义为常量字符串。
- **优先级**：中

#### 5.5 `INSERT INTO settings(key, value_json) VALUES ('app', ?)`

- **文件**：[database.ts](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L380-L382) 第 380-382 行（initializeSchema）+ 第 1178-1180 行（restoreBackup）
- **重复类型**：完全相同
- **优先级**：低

### 6.6 重复的 React 组件模式

#### 6.1 `pnlClass` 内联三元表达式

- **文件**：
  - [CurrentExperimentTable.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/CurrentExperimentTable.tsx#L138-L144) 第 138-144、161 行
  - [ExperimentHistoryTable.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/ExperimentHistoryTable.tsx#L126-L132) 第 126-132、144 行
  - [BacktestDetailModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/BacktestDetailModal.tsx#L113-L121) 第 113-121、264-273 行
- **重复类型**：模式重复（backtest 子目录用 CSS 类 `stock-flat`/`stock-profit`/`stock-loss`；live 子目录用 `finance-flat`/`finance-profit`/`finance-loss`）
- **代码片段**：
  ```tsx
  className={value === null || value === 0 ? "stock-flat" : value > 0 ? "stock-profit" : "stock-loss"}
  ```
- **建议**：在 `renderer/src/pages/_shared/pnlClass.ts` 中暴露 `pnlClass(value, scheme?: "stock" | "finance")`；或直接统一 CSS 类名。
- **优先级**：高（6 处内联三元，且 backtest 与 live 两套类名语义实际相同）
- **风险评估**：中；需先核对 `index.css` 中 `.stock-profit` 与 `.finance-profit` 颜色是否完全一致。

#### 6.2 `LiveMetricStrip` items 数组构造模式

- **文件**：
  - [PositionsPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/PositionsPage.tsx#L248-L264) 第 248-264 行
  - [IncomeCalendarPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/IncomeCalendarPage.tsx#L254-L262) 第 254-262 行
  - [TradesPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/TradesPage.tsx#L386-L394) 第 386-394 行
- **建议**：现状已通过 `LiveMetricStrip` 组件抽象，但 items 数组仍需手写。**不强制抽象**。
- **优先级**：低

#### 6.3 `QualityNotice` + `PageError` + `LiveLoading` + `LiveEmpty` 渲染序列

- **文件**：[PositionsPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/PositionsPage.tsx#L240-L364) 第 240-364 行、[IncomeCalendarPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/IncomeCalendarPage.tsx#L247-L415) 第 247-415 行、[TradesPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/TradesPage.tsx#L370-L450) 第 370-450 行
- **重复类型**：模式重复
- **代码片段**：
  ```tsx
  {query.isLoading ? (
    <section className="workspace-panel"><LiveLoading rows={13} /></section>
  ) : query.isError ? (
    <PageError title="..." error={query.error} onRetry={() => void query.refetch()} />
  ) : query.data ? (<>...</>) : null}
  ```
- **建议**：抽取 `<LiveQueryBoundary query={query} title="..." loadingRows={13} empty={...}>{(data) => <>...</>}</LiveQueryBoundary>` 组件。
- **优先级**：中

#### 6.4 资产类型 `Select` options 配置

- **文件**：[PositionsPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/PositionsPage.tsx#L300-L305)、[TradesPage.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/TradesPage.tsx#L306-L310)、[LedgerEntryModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/LedgerEntryModal.tsx#L302-L308)、[DividendReinvestmentModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/DividendReinvestmentModal.tsx#L265-L270)
- **重复类型**：完全相同
  ```typescript
  [
    { label: "A 股股票", value: "stock" },
    { label: "ETF", value: "etf" },
  ]
  ```
- **建议**：在 `renderer/src/pages/live/_internal/securityTypeOptions.ts` 暴露常量 `SECURITY_TYPE_OPTIONS`。
- **优先级**：中

#### 6.5 RangePicker / DatePicker `disabledDate` 周末判断

- **文件**：[LedgerEntryModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/LedgerEntryModal.tsx#L289-L292) 第 289-292 行、[DividendReinvestmentModal.tsx](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/live/DividendReinvestmentModal.tsx#L320-L325) 第 320-325 行
- **重复类型**：`value.day() === 0 || value.day() === 6`
- **建议**：抽取 `isWeekendDay(value: Dayjs): boolean` 工具函数。
- **优先级**：低

### 6.7 重复代码专项结论

| 优先级 | 项目 | 文件路径 | 建议位置 |
| --- | --- | --- | --- |
| 高 | 1.5 `entryAmount`/`entryOrder` 重复 | investmentCashProjection.ts ↔ ledgerReducer.ts | 直接复用 `ledgerReducer` 导出 |
| 高 | 1.4 "行情来源"工作表（同文件 3 次） | liveWorkbooks.ts | `electron/export/_internal/provenanceSheet.ts` |
| 高 | 1.1 + 1.2 + 1.3 Excel 样式与初始化 | backtestWorkbook.ts ↔ liveWorkbooks.ts | `electron/export/_internal/workbookStyle.ts` |
| 高 | 2.1 `money`/`percent` 双套格式化 | backtest/formatters.ts ↔ live/liveFormat.tsx | `renderer/src/pages/_shared/format.ts` |
| 高 | 6.1 `pnlClass` 内联三元 | 3 个 backtest 组件 | `renderer/src/pages/_shared/pnlClass.ts` |
| 高 | 3.1 数据源 fetch-with-timeout | tencent/sina/stockUniverse | `electron/data/_internal/httpClient.ts` |
| 高 | 3.2 两个 Modal 表单重复 | LedgerEntryModal ↔ DividendReinvestmentModal | `renderer/src/pages/live/_internal/instrumentPicker.tsx` |
| 中 | 3.4 Excel numberFmt 常量 | 2 个 export 文件 | `electron/export/_internal/numberFormats.ts` |
| 中 | 3.3 database.ts 行映射重复 | database.ts | 私有 `mapStoredMarketPrice` |
| 中 | 5.1-5.4 SQL 重复 INSERT/SELECT | database.ts | 私有绑定方法或列常量 |
| 中 | 4.1 YYYY-MM-DD 校验文案 | 4 个 domain 文件 | `assertValidDate` 加入 dateUtils.ts |
| 中 | 6.3 LiveQueryBoundary | 3 个页面 | `renderer/src/pages/_shared/LiveQueryBoundary.tsx` |
| 中 | 6.4 资产类型 options | 4 个组件 | `renderer/src/pages/live/_internal/securityTypeOptions.ts` |
| 中 | 2.2-2.3 data 模块日期/数字解析 | tencent/sina | `electron/data/_internal/parse.ts` |
| 低 | 1.6 `recordedOrder` 与 `canonicalLedgerOrder` | liveViewSupport ↔ ledgerReducer | **不抽象**，加注释说明差异 |
| 低 | 4.2-4.3 ledgerCommands 内部校验 | ledgerCommands.ts | 同文件内抽象，可选 |
| 低 | 6.2 LiveMetricStrip items 工厂 | 3 个页面 | 可选 |
| 低 | 6.5 周末 disabledDate | 2 个 Modal | 可选 |

**建议落地顺序**：先做无测试风险的项目（1.5 删除本地副本、1.4 提取 provenanceSheet、3.4 numberFmt 常量），再做需要补充测试的项目（2.1 统一格式化、3.1 HTTP 客户端、3.2 Modal 重构）。

---

## 七、src/desktop 测试执行专项分析

### 7.1 执行命令与结果

执行命令：`npm test`（在 `src/desktop` 目录下，等价于 `vitest run`）

```
✓ electron/data/marketDataProvider.test.ts (14 tests) 122ms
✓ electron/domain/liveViews.test.ts (27 tests) 130ms
✓ electron/domain/analysis.test.ts (29 tests) 59ms
✓ electron/domain/marketCalendar.test.ts (9 tests) 50ms
✓ electron/domain/investmentCashProjection.test.ts (5 tests) 49ms
✓ electron/data/tencent.test.ts (12 tests) 39ms
✓ electron/storage/database.test.ts (13 tests) 1256ms
✓ electron/domain/ledgerCommands.test.ts (5 tests) 55ms
✓ shared/marketDate.test.ts (1 test) 31ms
✓ electron/data/sina.test.ts (2 tests) 22ms
✓ electron/domain/ledgerReducer.test.ts (4 tests) 28ms
✓ electron/domain/finance.test.ts (3 tests) 6ms
✓ renderer/src/pages/backtest/marketChartModel.test.ts (4 tests) 27ms
✓ electron/services/appService.test.ts (24 tests) 2352ms
↓ electron/data/marketData.smoke.test.ts (1 test | 1 skipped)
✓ electron/export/backtestWorkbook.test.ts (1 test) 149ms
✓ electron/data/stockUniverse.test.ts (7 tests) 279ms
✓ electron/services/appService.coldStart.test.ts (1 test) 3733ms

Test Files  17 passed | 1 skipped (18)
     Tests  161 passed | 1 skipped (162)
  Duration  16.90s
```

`npm run typecheck`（`tsc --noEmit`）：**0 error**。

### 7.2 失效测试分析

**未发现失效测试。** 所有 161 个测试用例均通过，1 个 skipped（`marketData.smoke.test.ts`）。

### 7.3 Skipped 测试详情

**`electron/data/marketData.smoke.test.ts`（1 test | 1 skipped）**

- **跳过原因**：该测试是真实联网冒烟测试，需要访问腾讯/新浪/东方财富等真实数据接口，受 `RUN_MARKET_SMOKE` 环境变量控制（默认不启用）。
- **设计意图**：避免 CI/日常测试中触发真实网络请求与可能的限流；发布前通过 `npm run smoke:market-data` 显式执行，结果写入 `artifacts/market-data-smoke.json` 作为发布证据。
- **结论**：**不是失效测试**，是设计性跳过，符合 [README.md:33-38](file:///d:/vibe-coding/trading-topic/src/desktop/README.md#L33-L38) 描述的"发布前受控联网验证"流程。

### 7.4 测试用例数与耗时分布

| 测试文件 | 测试数 | 耗时 | 关注点 |
| --- | --- | --- | --- |
| `appService.coldStart.test.ts` | 1 | 3733ms | 冷启动恢复（SQLite 重开后实验/工作区完整性） |
| `appService.test.ts` | 24 | 2352ms | AppService 用例编排（含一个跨区间配股测试 1248ms） |
| `database.test.ts` | 13 | 1256ms | Schema/fingerprint/备份恢复（19+ 异常 payload） |
| `liveViews.test.ts` | 27 | 130ms | 持仓/收益日历/交易流水视图 |
| `analysis.test.ts` | 29 | 59ms | 回测/归约/现金流/回撤 |
| `marketDataProvider.test.ts` | 14 | 122ms | 双源兜底/跨源一致性 |
| `stockUniverse.test.ts` | 7 | 279ms | 沪深京 ETF 目录 |
| `tencent.test.ts` | 12 | 39ms | 腾讯行情解析/尾部校验 |
| `ledgerCommands.test.ts` | 5 | 55ms | 账本命令预览/冲正/修正 |
| `marketCalendar.test.ts` | 9 | 50ms | 年度日历 official/pending |
| `investmentCashProjection.test.ts` | 5 | 49ms | 现金流投影 |
| `marketChartModel.test.ts` | 4 | 27ms | K 线周/月聚合 |
| `ledgerReducer.test.ts` | 4 | 28ms | 账本归约 |
| `finance.test.ts` | 3 | 6ms | XIRR/回撤 |
| `sina.test.ts` | 2 | 22ms | 新浪行情/KLC 解码 |
| `backtestWorkbook.test.ts` | 1 | 149ms | XLSX 导出 |
| `marketDate.test.ts` | 1 | 31ms | 当前交易日 |
| `marketData.smoke.test.ts` | 0（1 skipped） | — | 联网冒烟 |

### 7.5 测试覆盖维度评估

#### 强覆盖

- **storage 层**：Schema 双重 fingerprint、不迁移策略、19+ 种非法备份 payload、覆盖事务原子性、跨表一致性校验。
- **domain 层**：金融口径边界（同号现金流、分红除权、送股除权、逆回购计息）、关联组约束（同标同资产类型同日期顺序、最多一个修正版本）。
- **data 层**：双源兜底、跨源一致性、空响应、尾部校验、422 异常 HTTP 状态。
- **services 层**：冷启动恢复、跨区间配股、组合回测。

#### 待补覆盖

| 项 | 现状 | 建议 |
| --- | --- | --- |
| `calc_xirr`（finance.ts）边界条件 | 3 个测试覆盖常规场景 | 补充空现金流、单笔、同号、不收敛等极端场景 |
| `LedgerEntryModal`/`DividendReinvestmentModal` | 0 单元测试 | 抽象前先补 smoke test |
| `electron/data/sina.ts` | 2 个测试 | KLC 解码与全量前复权因子覆盖不足 |
| `electron/export/liveWorkbooks.ts` | 0 单元测试（仅 backtestWorkbook 有 1 个） | 3 个导出函数（Positions/IncomeCalendar/Ledger）无测试 |
| `renderer/src/pages/*` 页面组件 | 仅 marketChartModel 有 4 个测试 | 其他页面 0 单元测试 |

### 7.6 测试专项结论

1. **测试执行状态健康**：161 个测试全部通过，1 个 smoke 测试设计性跳过，0 失效。
2. **测试质量高**：覆盖金融口径边界、安全边界（19+ 异常备份 payload）、双源一致性、冷启动恢复等关键场景。
3. **测试覆盖有空白**：renderer 页面组件、`liveWorkbooks.ts`、`sina.ts` KLC 解码、Modal 组件缺少测试，是后续补充重点。
4. **测试耗时合理**：总耗时 16.90s，最长单测试 3.7s（冷启动恢复，涉及多次 SQLite 重开），可接受。

---

## 八、改进建议优先级汇总

### 8.1 全仓库改进建议

#### P0（阻塞性）

无。

#### P1（重要，建议优先处理）

| 编号 | 域 | 项 | 文件 |
| --- | --- | --- | --- |
| P1 | desktop | CSP 允许本地端口与 PRD 矛盾 | [renderer/index.html:6](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/index.html#L6) |
| P1 | desktop | 主进程同步计算阻塞 IPC | [appService.ts:309-511](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L309-L511) |
| P1 | desktop | `listLedger()` 全表加载 | [database.ts:443-448](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L443-L448) |
| P1 | desktop | domain 反向依赖 storage | [positionsView.ts:17](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/positionsView.ts#L17) 等 |
| P1 | desktop | `listInstruments` 整条 IPC 链死代码 | 见 [5.2 类别 1](#类别-1未引用的导出生产链路断链) |
| P1 | labs | Lab 2 ETF 分类置信度逻辑可能有误 | [build_notebooks.py:488-492](file:///d:/vibe-coding/trading-topic/labs/02_行业走势相关性研究/build_notebooks.py#L488-L492) |

#### P2（次要，可在相关文件下次修改时顺手修复）

| 编号 | 域 | 项 | 文件 |
| --- | --- | --- | --- |
| P2 | desktop | `shell.openExternal` 无协议白名单 | [main.ts:57-60](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L57-L60) |
| P2 | desktop | 备份恢复无文件大小限制 | [main.ts:235-271](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L235-L271) |
| P2 | desktop | 日志脱敏规则窄 | [database.ts:387-389](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L387-L389) |
| P2 | desktop | `ledger:export` 逐页查询拼装 | [main.ts:147-168](file:///d:/vibe-coding/trading-topic/src/desktop/electron/main.ts#L147-L168) |
| P2 | desktop | `assertLedgerGraph` O(N²) 嵌套 | [backupValidation.ts:137-148](file:///d:/vibe-coding/trading-topic/src/desktop/electron/domain/backupValidation.ts#L137-L148) |
| P2 | desktop | 500 行表格无虚拟化 | [ExperimentHistoryTable.tsx:72-74](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/ExperimentHistoryTable.tsx#L72-L74) |
| P2 | desktop | 无 `React.memo` | `renderer/src/` 全目录 |
| P2 | desktop | `console.error` 残留 | [useBacktestWorkspace.ts:76](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/useBacktestWorkspace.ts#L76) |
| P2 | desktop | `useBacktestWorkspace` 防抖定时器无清除保证 | [useBacktestWorkspace.ts:52-82](file:///d:/vibe-coding/trading-topic/src/desktop/renderer/src/pages/backtest/useBacktestWorkspace.ts#L52-L82) |
| P2 | desktop | `app_logs`/`schema_metadata` 未文档化排除 | [database.ts:1078-1206](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L1078-L1206) |
| P2 | desktop | `shape_fingerprint` 对 DDL 空白敏感 | [database.ts:140-159](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L140-L159) |
| P2 | desktop | `runBacktest` 单方法 200 行 | [appService.ts:309-511](file:///d:/vibe-coding/trading-topic/src/desktop/electron/services/appService.ts#L309-L511) |
| P2 | desktop | `getDirectoryProvenance` 全表扫描 | [database.ts:677-693](file:///d:/vibe-coding/trading-topic/src/desktop/electron/storage/database.ts#L677-L693) |

#### P3（重构机会，按收益排序）

| 项 | 文件 | 建议 |
| --- | --- | --- |
| `entryAmount`/`entryOrder` 重复 | investmentCashProjection.ts ↔ ledgerReducer.ts | 直接复用 `ledgerReducer` 导出 |
| "行情来源"工作表（同文件 3 次） | liveWorkbooks.ts | 提取 `addProvenanceSheet` |
| Excel 样式与初始化 | backtestWorkbook.ts ↔ liveWorkbooks.ts | 提取 `createWorkbook`/`styleWorkbook`/`workbookToBuffer` |
| `money`/`percent` 双套格式化 | backtest/formatters.ts ↔ live/liveFormat.tsx | 合并为 `_shared/format.ts` |
| `pnlClass` 内联三元 | 3 个 backtest 组件 | 提取 `_shared/pnlClass.ts` |
| 数据源 fetch-with-timeout | tencent/sina/stockUniverse | 提取 `_internal/httpClient.ts` |
| 两个 Modal 表单重复 | LedgerEntryModal ↔ DividendReinvestmentModal | 提取 `useInstrumentPicker` Hook |
| Excel numberFmt 常量 | 2 个 export 文件 | 提取 `_internal/numberFormats.ts` |
| database.ts 行映射重复 | database.ts | 私有 `mapStoredMarketPrice` |
| SQL 重复 INSERT/SELECT | database.ts | 私有绑定方法或列常量 |

### 8.2 整体结论

该仓库在**三域隔离、金融口径正确性、桌面安全基线、测试覆盖**四个方面达到了高标准，体现了"结果算得对、来源说得清、数据拿得走"的产品目标。

**主要待改进项**集中在：
- `src/desktop` 的 **CSP 收紧**（P1-S1）、**主进程同步计算阻塞**（P1）、**全表加载内存压力**（P2）、**domain 反向依赖 storage**（P1-D1）四个 Major 项；
- Labs 域的 **Lab 1 文档与代码同步**（P1）；
- Research 域的 **`calc_xirr` 测试覆盖**（P1）；
- `src/desktop` 内部的 **`listInstruments` 死代码清理**（P1）与 **7 个高优先级重构机会**（P3）。

其余 P2/P3 项可在后续迭代逐步收敛，**不影响 R1 发布**。

---

**评审完成，未修改任何源文件。**
