# 攒股收息 R1 技术架构

> 状态：R1 实现基线
>
> 更新日期：2026-07-25
>
> 配套需求：[PRD_R1.md](PRD_R1.md)
>
> 仓库边界决策：[Labs、Research、Src 隔离](../decisions/0001-labs-research-src-isolation.md)

## 1. 架构结论

R1 是单机、单端、本地优先的 Electron 应用，产品域统一使用 Node.js/TypeScript：

```text
React Renderer
      ↓  受限 preload API
Electron IPC
      ↓
Node.js 领域服务
      ↓
SQLite（sql.js 持久化）
```

产品不启动 Python，不监听本地 HTTP 端口，也不运行 Labs 或 Research。渲染进程不直接获得 Node.js、文件系统或数据库权限。

## 2. 三域隔离

Labs、Research、Src 是三个独立生命周期的域。共享的是经过评审的结论、口径和验收向量，不是源码或运行环境。

| 域 | 职责 | 自有资产 | 禁止依赖 |
| --- | --- | --- | --- |
| `labs/` | Notebook、数据源试验、探索性验证 | `labs/pyproject.toml`、`labs/uv.lock`、实验代码与数据 | 不向 Research 或 Src 提供运行时模块 |
| `research/<topic>/` | 可复现研究闭环 | 独立 `pyproject.toml`、`uv.lock`、`src/`、`tests/`、`data/`、`report/` | 不 import Labs 或 Src；不借用 Labs 环境 |
| `src/desktop/` | 可发布桌面产品 | Electron、React、Node 领域代码、SQLite、产品测试与锁文件 | 不 import、执行或读取 Labs、Research |

允许的知识转移：

- 文档引用研究报告；
- 把已评审的输入和预期输出复制为产品自有 fixture，并记录来源、截止日和口径版本；
- 根据 Lab 01 的数据源与金融口径结论，在产品域重新实现；
- 用各域独立测试交叉核验结论。

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
│   ├── services/             # 应用用例编排
│   ├── storage/              # SQLite schema 与持久化
│   ├── main.ts
│   └── preload.ts
├── renderer/                 # React 工作台
├── shared/                   # 产品进程间 TypeScript 契约
├── tests/fixtures/           # 产品自有验收向量
├── package.json
└── package-lock.json
```

`shared/` 只属于产品域，用于 main、preload 与 renderer 的类型契约；它不是跨 Labs、Research、Src 的共享核心。

## 5. 领域模块

### 历史回测

`electron/domain/analysis.ts` 实现：

- 单标的回测与最多 4 个标的同条件独立并排；
- 每月固定金额、指定买入日、非交易日月内顺延；
- 100 股整数倍、现金结转；
- 买入佣金万分之 2.5、最低 5 元；
- 现金分红入账并按事件日回购原标的；
- 对送股、转增等 R1 不支持事件显式阻断；
- 累计投入、最终资产、累计盈亏、XIRR、最大回撤、累计分红、期末现金；
- 可追溯的逐笔流水与日度资产序列。

金额在业务边界统一保留两位小数，股数使用整数。R1 的费用模型固定，不在设置中切换。

### 实际账本

`electron/domain/ledger.ts` 实现：

- 资金转入、买入、卖出、现金分红、逆回购、资金转出和冲正；
- 已保存流水不可原地覆盖；
- 冲正通过新增关联记录使原记录失效；
- 修正由“冲正原记录 + 新增正确记录”完成；
- 从有效流水重建持仓、可用现金、逆回购资产、总资产、累计盈亏和 XIRR。

持仓和账户汇总是派生结果，不写入可独立修改的余额表。

## 6. 数据来源

产品依据 Lab 01 已评审结论独立实现两个适配器：

| 数据 | 产品主源 | 口径 |
| --- | --- | --- |
| A 股日线 | 腾讯财经 `newfqkline` | 不复权收盘价 |
| 已实施分红 | 东方财富 `RPT_SHAREBONUS_DET` | 税前每股现金分红 |

每次回测记录来源、获取时间、实际数据截止日、复权口径和口径版本。多标的按顺序获取；东方财富请求之间至少间隔 1.2 秒，避免并发触发风控。

请求失败、响应结构变化、无数据或存在不支持公司行动时直接报错，不生成虚构行情，也不静默切换来源。已有 SQLite 快照仍可供账户估值和历史结果查看。

## 7. SQLite 与本地文件

R1 使用 `sql.js` 在 Electron 主进程维护 SQLite，并把导出的数据库字节持久化到 `app.getPath("userData")/stock-income.sqlite`。

逻辑表：

- `ledger_entries`：不可变业务流水；
- `backtest_runs`：回测输入、结果、来源与告警；
- `market_prices`：产品自行获取的行情快照；
- `corporate_actions`：产品自行获取的公司行动；
- `settings`：固定口径与本地配置；
- `app_logs`：脱敏运行日志。

写操作完成后立即持久化。JSON 恢复先校验应用标识和 schema 版本，再生成恢复前安全备份，最后在事务中覆盖业务数据；校验或事务失败时不破坏当前数据库。

## 8. SaaS 风格界面

R1 只有四个一级入口：

- 历史回测：单个参数带、资产曲线、并排指标表与可追溯明细；
- 资产账户：关键指标带与持仓表；
- 资金流水：追加式记录表、新增表单与冲正入口；
- 本地设置：来源和口径只读说明、备份恢复、日志导出。

视觉使用墨蓝导航、雾白工作区与暖金单一强调色。信息层级依赖排版、留白和分隔线，避免卡片拼贴；动效仅用于页面进入、数据行反馈和图表更新。

## 9. 测试与验收

| 范围 | 验证 |
| --- | --- |
| 领域单测 | 日期顺延、整数手、费用、分红、XIRR、回撤、账本冲正与逆回购 |
| 类型检查 | `npm run typecheck`，直接运行 TypeScript 编译器 |
| 构建 | `npm run build`，验证 main、preload、renderer 三个入口 |
| 隔离扫描 | `src/desktop/` 不含 Python，不引用 Labs 或 Research |
| 手工冒烟 | 新建回测、录入流水、查看账户、备份恢复、导出日志 |

R1 架构验收：

- [x] 产品运行时为 Node.js/TypeScript，不包含 Python sidecar；
- [x] main、preload、renderer 入口明确；
- [x] 渲染层只通过受限 preload API 使用本地服务；
- [x] 产品数据源未复用 Labs 注册模块；
- [x] 产品构建和测试不读取 Research；
- [x] 持仓和现金可从不可变流水重建；
- [x] JSON 恢复前生成安全备份；
- [x] 应用不存在下单接口或券商权限。
