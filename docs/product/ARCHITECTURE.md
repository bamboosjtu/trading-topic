# 投资研究实验室

## 三域隔离

Labs、Research、Src 是三个独立生命周期的域。共享的是经过评审的结论、口径和验收向量，不是源码或运行环境。

- Labs 负责探索；
- Research 负责可复现地形成证据；
- Src 依据评审结论独立实现产品行为；
- 跨域验证使用带来源提交、截止日、口径版本和预期结果的最小复制向量；
- 目标域测试必须驱动本域实现，禁止在测试时导入、执行或读取另一个域。

特别强调：三个域各自存在相似的回测算法或数据适配器是隔离带来的有意重复，不构成“应抽取共享核心”的代码异味。

## 攒股收息桌面端

攒股收息（desktop） 是单机、单端、本地优先的 Electron 应用，产品域统一使用 Node.js/TypeScript：

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

### 1. 进程与安全边界

#### Renderer

- 负责表单、表格、图表、状态与错误展示；
- 不实现金融公式；
- `marketChartModel.ts` 只做前复权日 OHLCV 的周/月聚合、均线等展示转换；收益率和回撤序列直接消费领域层返回值；
- 图表使用 `loading / ready / unavailable / error` 判别联合，不以空数组同时表达多种状态；
- 不直接读取文件、SQLite 或网络凭据；
- 不使用任意 IPC channel。

#### Preload

- 在 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 下运行；
- 只暴露 `DesktopApi` 中声明的业务方法；
- 不暴露 `ipcRenderer`、`fs`、`shell` 或通用调用入口。

#### Electron main

- 管理窗口和应用生命周期；
- 注册白名单 IPC handler；
- 执行领域计算、数据获取、SQLite 事务、备份恢复与日志导出；
- 对外部链接使用系统浏览器打开；
- 不包含券商、交易凭据或下单接口。

取消 Python sidecar 后，R1 不再承担子进程管理、随机端口、会话令牌、CORS 和双语言打包成本。

### 2. 代码目录

```text
src/desktop/
├── electron/
│   ├── data/                 # 产品自有数据源适配器
│   ├── domain/               # 回测、账本、持仓估值、收益归因、XIRR、回撤
│   ├── export/               # XLSX 等本地导出
│   ├── services/             # 应用用例编排
│   ├── storage/              # SQLite schema 与持久化
│   ├── main.ts
│   └── preload.ts
├── renderer/                 # React 工作台
│   └── src/pages/            # 回测与三个实盘页面；live/ 为共享展示和录入组件
├── shared/                   # 产品进程间 TypeScript 契约
├── tests/fixtures/           # 产品自有验收向量
├── package.json
└── package-lock.json
```

`shared/` 只属于产品域，用于 main、preload 与 renderer 的类型契约；它不是跨 Labs、Research、Src 的共享核心。

### 3. 领域模块与界面索引

- 领域逻辑集中在 `electron/domain/`，界面集中在 `renderer/src/pages/`。
- 需求口径见 [PRD_R1.md](PRD_R1.md)。
- 金额在业务边界统一保留两位小数；回测股数允许零碎股，内部保留 6 位精度，界面默认显示 2 位。主结果与明细必须复用同一计算流水，不允许维护口径不同的第二套“简化回测”。

### 4. 数据来源

产品依据 Lab 01 已评审结论独立实现两个适配器：

| 数据              | 产品主源                       | 口径                                                        |
| ----------------- | ------------------------------ | ----------------------------------------------------------- |
| 全 A 股代码与名称 | 上交所、深交所、北交所公开列表 | 与 `stock_info_a_code_name()` 相同范围的沪深京代码/简称目录 |
| 境内交易所 ETF 目录 | 东方财富主源、新浪备用 | 保存实际来源、主源、兜底原因和获取时间 |
| 回测 A 股日线     | 腾讯主源、新浪整段备用          | 不复权收盘价；作为回测计算和审计快照                        |
| 快速走势 K 线     | 腾讯主源、新浪整段备用          | 前复权真实日 OHLCV；仅作浏览，不承担严格回测证据职责        |
| 实际投资估值日线  | 腾讯主源、新浪整段备用          | 不复权正式收盘价；按实际持有区间增量缓存                    |
| 已实施分红送转    | 东方财富 `RPT_SHAREBONUS_DET`  | 税前每股现金分红；每 10 股送股/转增比例                     |
| 已实施配股        | 东方财富 `RPT_IPO_ALLOTMENT`   | 只报告事件；R1 不认购，除权影响由不复权行情反映             |

- 代码表由产品自有 Node.js 适配器直接请求三家交易所公开接口，不执行 Python 或 AkShare。
- 股票代码在三地列表全部成功并通过全量完整性校验后才写入 SQLite；七天内直接使用完整快照，刷新失败时只回退到上次成功的完整快照。
- ETF 目录主源和备用源都返回结构化 provenance；服务层原样持久化，设置页展示实际来源和兜底原因。
- 多标的按顺序获取。

### 5. 本地数据库与文件

使用 `better-sqlite3` 在 Electron 主进程直接读写`app.getPath("userData")/stock-income.sqlite`。

持仓、流水和收益日历 XLSX 均在主进程生成；Renderer 不接触文件路径和文件系统。

R1 唯一数据库基线为 Schema 2，并写入固定 schema fingerprint。只允许创建空的新库或打开版本、表集合和 fingerprint 全部匹配的当前库。旧版本、同版本旧结构、缺表或指纹不匹配均保持原文件不变并阻止启动；不迁移、不自动删除、不从字段形状猜测版本。

备份契约与 Schema 2 的当前发布 fingerprint 同步，同版本旧 fingerprint 也不兼容。`validateBackup()` 在开启覆盖事务前依次验证账本 ID/数值/引用图、事实类型专属字段、`reduceLedger()` 完整性和关联组约束，回测试验与结果结构，行情正价格、请求区间、覆盖关系和公司行动，证券目录 provenance 与唯一性，以及工作区字段和实验引用。买卖事实不持久化可覆盖 `price × quantity` 的 `amount`，分红事实不得携带价格、数量或费用；每个原流水最多一个修正版本，修正不能指向 adjustment 且必须保持原关联关系。任一失败时现有数据库不发生删除或写入。旧备份或缺字段备份直接拒绝；恢复前由 main 进程生成当前库安全备份，但安全备份不替代输入校验。

### 6. 行情尾部与消费边界

价格和 K 线适配器共享 `MarketFetchResult<T>`：`rows`、`requestedThrough`、`dataCutoff`、`tailStatus`、`issues`、`provenance` 均不可省略。腾讯和新浪各自完成格式、请求区间、尾部和跨源一致性校验。

- 严格回测：只接受 `complete` 或独立交易日历确认的 `confirmed_non_trading`；`incomplete` 在领域计算和 SQLite 写入前终止。
- 实盘查看：可暂存两源中 `dataCutoff` 更新的不完整结果，但页面状态为 `partial`，覆盖只记录到实际截止日，下一次继续补齐尾部。
- 法定休市：由年度 official 日历证明；双源空响应本身不是证据。
- 个股停牌：必须具备证券级明确证据才能沿用前收盘估值并标记估值状态。R1 当前没有接入该证据，因此保守保持 `incomplete`，不伪造价格行或缩短实验冒充完成。

### 7. 收益归因状态

实盘领域统一通过 `InvestmentCashProjection` 从当前有效事实投影外部买入、外部分红、外部现金流、关联买入内部资金额和 `pendingReinvestmentCash`。分红到账增加内部投资现金，关联买入消耗，超额支出才属于外部投入；剩余现金跨日进入资本基数，并仅在其事实日期不晚于估值截止日时加入同日的期末 XIRR 资产。账本净投入、日度归因和 XIRR 共用该定义。若任一买入、卖出或分红晚于估值截止日，事实类累计指标继续重算，正式市值、投资总收益、XIRR、期间收益和对应日度归因统一进入 `null / partial`。该状态不单独持久化，修正或冲正后始终可审计地重算。

有关联编号的修正先继承原关联组，再对完整有效事实执行组级校验：同一标的、同一资产类型、分红日期不晚于买入日期、组内最多一个有效分红和一个有效买入。普通修正不能借机加入其他关联组。

### 8. 日历生命周期与诊断

年度日历文件显式区分 `official` 与 `pending_official_schedule`。`prebuild` 和测试要求构建当年为 official；运行时不以日历缺失阻断数据库打开或窗口创建。主界面显示当前年度告警。行情 Provider 允许长历史区间内部缺少年度日历，但要求请求结束日期所在年度为 official；缺失时在联网前以明确的尾部日历原因阻断，而不是泛化为行情源异常。历史浏览、备份、日志和设置始终可用。官方安排发布后更新年度 JSON 是发布维护项。应用不提供含义混杂的全局数据截止日，各页面展示自己的实验截止、估值截止或目录更新时间。

### 9. 界面风格

- 使用冷白画布、深墨蓝信息层级与亮蓝单一动作色。Tailwind、Ant Design 和手写 CSS 共用同一套冷蓝语义 token，不保留暖金、瓷色或第二套品牌主题。
- 每个 Tab 的详细设计见 [desktop_ui/](desktop_ui/)。

