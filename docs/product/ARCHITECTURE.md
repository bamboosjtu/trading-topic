# 攒股收息 R1 技术架构

> 状态：R1 实现基线
>
> 更新日期：2026-07-26
>
> 配套需求：[PRD_R1.md](PRD_R1.md)
>
> 界面设计：[desktop_ui/](desktop_ui/) 目录下每个 Tab 的设计简述

## 1. 架构结论

R1 是单机、单端、本地优先的 Electron 应用，产品域统一使用 Node.js/TypeScript：

```text
React Renderer
      ↓  受限 preload API
Electron IPC
      ↓
Node.js 领域服务
      ↓
SQLite（better-sqlite3 / WAL）
```

产品不启动 Python，不监听本地 HTTP 端口，也不运行 Labs 或 Research。渲染进程不直接获得 Node.js、文件系统或数据库权限。

## 2. 三域隔离

Labs、Research、Src 是三个独立生命周期的域。共享的是经过评审的结论、口径和验收向量，不是源码或运行环境。

禁止：

- 产品 import 或运行 `research/bank-dca`；
- 产品读取 `research/bank-dca/data/` 作为运行时数据；
- 产品复用 `labs/01_银行股定投回测/data_source_registry.py`；
- Research 使用 `uv run --project labs ...`；
- 创建让三个域共同依赖的顶层业务核心；
- 使用 Junction、symlink、`PYTHONPATH` 或相对路径绕过边界。

## 3. 进程与安全边界

### Renderer

- 负责表单、表格、图表、状态与错误展示；
- 不实现金融公式；
- `marketChartModel.ts` 只做前复权日 OHLCV 的周/月聚合、均线等展示转换；收益率和回撤序列直接消费领域层返回值；
- 图表使用 `loading / ready / unavailable / error` 判别联合，不以空数组同时表达多种状态；
- 不直接读取文件、SQLite 或网络凭据；
- 不使用任意 IPC channel。

### Preload

- 在 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 下运行；
- 只暴露 `DesktopApi` 中声明的业务方法；
- 不暴露 `ipcRenderer`、`fs`、`shell` 或通用调用入口。

### Electron main

- 管理窗口和应用生命周期；
- 注册白名单 IPC handler；
- 执行领域计算、数据获取、SQLite 事务、备份恢复与日志导出；
- 对外部链接使用系统浏览器打开；
- 不包含券商、交易凭据或下单接口。

取消 Python sidecar 后，R1 不再承担子进程管理、随机端口、会话令牌、CORS 和双语言打包成本。

## 4. 产品目录

```text
src/desktop/
├── electron/
│   ├── data/                 # 产品自有数据源适配器
│   ├── domain/               # 回测、账本、XIRR、回撤
│   ├── export/               # XLSX 等本地导出
│   ├── services/             # 应用用例编排
│   ├── storage/              # SQLite schema 与持久化
│   ├── main.ts
│   └── preload.ts
├── renderer/                 # React 工作台
│   └── src/pages/backtest/   # 回测配置、指标、图表、表格、Modal 与 hooks
├── shared/                   # 产品进程间 TypeScript 契约
├── tests/fixtures/           # 产品自有验收向量
├── package.json
└── package-lock.json
```

`shared/` 只属于产品域，用于 main、preload 与 renderer 的类型契约；它不是跨 Labs、Research、Src 的共享核心。

## 5. 领域模块与界面索引

- 领域逻辑集中在 `electron/domain/`，界面集中在 `renderer/src/pages/`。
- 需求口径见 [PRD_R1.md](PRD_R1.md)，每个 Tab 的设计细节见 [desktop_ui/](desktop_ui/)。
- 金额在业务边界统一保留两位小数；回测股数允许零碎股，内部保留 6 位精度，界面默认显示 2 位。主结果与明细必须复用同一计算流水，不允许维护口径不同的第二套“简化回测”。

## 6. 数据来源

产品依据 Lab 01 已评审结论独立实现两个适配器：

| 数据              | 产品主源                       | 口径                                                        |
| ----------------- | ------------------------------ | ----------------------------------------------------------- |
| 全 A 股代码与名称 | 上交所、深交所、北交所公开列表 | 与 `stock_info_a_code_name()` 相同范围的沪深京代码/简称目录 |
| 回测 A 股日线     | 腾讯财经 `newfqkline`          | 不复权收盘价；作为回测计算和审计快照                        |
| 快速走势 K 线     | 腾讯财经 `newfqkline`          | 前复权真实日 OHLCV；仅作浏览，不承担严格回测证据职责        |
| 已实施分红送转    | 东方财富 `RPT_SHAREBONUS_DET`  | 税前每股现金分红；每 10 股送股/转增比例                     |
| 已实施配股        | 东方财富 `RPT_IPO_ALLOTMENT`   | 只报告事件；R1 不认购，除权影响由不复权行情反映             |

- 代码表由产品自有 Node.js 适配器直接请求三家交易所公开接口，不执行 Python 或 AkShare。
- 股票代码在三地列表全部成功并通过全量完整性校验后才写入 SQLite；七天内直接使用完整快照，刷新失败时只回退到上次成功的完整快照。少量示例标的或旧的不完整缓存不得作为全 A 股目录返回。每次回测记录来源、获取时间、实际数据截止日、复权口径和口径版本。
- 多标的按顺序获取；东方财富请求之间至少间隔 1.2 秒，避免并发触发风控。
- 东方财富公司行动先做完整行去重，再依次使用源方案 ID、报告期、方案公告日识别同一方案；同一方案的多个版本只保留最终已实施记录。只有方案身份明确不同但除权日相同的记录才累加。转增字段按顺序寻找首个可解析的非负数字，占位符 `-` 不得遮蔽后续有效字段；`BONUS_IT_RATIO` 仅作送转合计回退。
- 数据适配器把“成功且空数组”或东方财富明确的 `9201/返回数据为空` 识别为合法空结果；HTTP 错误、限流、源错误码、缺少 `result.data`、腾讯缺少 `day/qfqday`、无效 OHLCV，以及已知行情前后之间的整年空洞均视为异常并终止实验。
- 配股属于 R1 已报告但不参与的公司行动：结果记录事件和“不追加资金”假设，不复权价格保留除权后的市场影响。其他无法确定处理口径的公司行动必须阻断。
- 前复权 K 线是独立的非证据型浏览数据，但新实验仍要求数据源返回结构完整的真实 OHLCV；响应异常时终止实验。历史快照缺失时使用 `unavailable/error` 状态说明原因；严禁用不复权收盘价伪造 OHLC。
- 日 K 直接展示真实前复权数据；周 K、月 K 由日线聚合：开盘取首日开盘、最高/最低取周期极值、收盘取末日收盘、成交量求和。
- 已有 SQLite 快照仍可供账户估值和历史结果查看。

## 7. SQLite 与本地文件

使用 `better-sqlite3` 在 Electron 主进程直接读写
`app.getPath("userData")/stock-income.sqlite`。数据库启用 WAL、
`foreign_keys` 和 `synchronous=NORMAL`；批量写入和实验保存使用同步事务，
不再导出整库字节后覆盖文件。Electron 35 与应用开发环境统一使用
Node.js 22 / N-API 10，避免原生模块 ABI 双构建。

- 写操作由 SQLite 事务提交并立即持久化；列表摘要使用一次聚合查询，不逐个实验反序列化全部明细。
- 每次运行先在任何联网前校验请求（含重复标的），再以同一请求和共同数据截止时间计算全部标的。只有全部数据获取和计算成功后，行情缓存、公司行动缓存、实验与结果才在同一个事务中提交；任一步失败全部回滚。删除实验时同时删除其全部结果，并清除工作区可能存在的活动引用。
- `useBacktestWorkspace()` 是 Renderer 唯一的工作区写入口；页面事件只更新 React 状态。保存 Promise 必须捕获失败、记录控制台错误并向用户提示“工作区未能保存”。活动实验读取失败时显示错误、清除 `activeExperimentId` 并回到空白运行态，不自动选择其他实验。
- 历史摘要查询只返回最近 500 次实验，界面必须明确这一窗口；上限不代表数据库只保存 500 次。
- 回测详情只从 `backtest_results` 的结果快照转换，不重新联网或二次模拟。
- XLSX 在 Electron 主进程按实验生成：汇总 sheet 后跟该实验每个标的的明细 sheet，渲染层只通过受限 IPC 发起保存。

当前没有用户数据且不要求向后兼容，不保留双写、迁移适配或旧备份恢复分支。

## 8. 界面风格

- 使用冷白画布、深墨蓝信息层级与亮蓝单一动作色。Tailwind、Ant Design 和手写 CSS 共用同一套冷蓝语义 token，不保留暖金、瓷色或第二套品牌主题。
- 每个 Tab 的详细设计见 [desktop_ui/](desktop_ui/)。

## 9. 测试与验收

| 范围     | 验证                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| 领域单测 | 跨月顺延且不占下月投入、重复标的、零碎股、费用 0、分红、送转、配股报告、XIRR、最大回撤与最长回撤周期、账本冲正与逆回购 |
| 适配器   | 合法空响应、源错误码、结构损坏、占位符数值、真实配股 fixture、腾讯缺字段与年度异常缺口                              |
| 类型检查 | `npm run typecheck`，直接运行 TypeScript 编译器                                                                       |
| 构建     | `npm run build`，验证 main、preload、renderer 三个入口                                                                |
| 隔离扫描 | `src/desktop/` 不含 Python，不引用、执行或读取 Labs、Research                                                         |
| 持久化   | 每次运行新增不可变实验、结果归属与删除、实验与共享行情缓存原子回滚、工作区活动实验和股票目录重开恢复、四标的完整冷启动链路、schema v5 备份恢复 |
| 导出     | XLSX 汇总字段与每个“标的 + 参数”明细 sheet 名称、内容                                                                 |
| 界面冒烟 | 1920×1080 下双 Tab、全市场搜索、最多 10 标的、当前实验图表/对比、历史实验三项操作、明细筛选与翻页；其余入口显示骨架屏 |
