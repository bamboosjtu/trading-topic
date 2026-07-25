# 攒股收息 R1 技术架构

> 状态：评审收敛版
>
> 更新日期：2026-07-25
>
> 配套需求：[PRD_R1.md](PRD_R1.md)
>
> 仓库边界决策：[Labs、Research、Src 隔离](../decisions/0001-labs-research-src-isolation.md)

## 1. 架构目标

R1 采用单机、单端、本地优先架构，并遵守一个优先级高于代码复用的约束：

> **Labs、Research、Src 是三个独立生命周期的域，不建立源码、运行时、构建时或环境依赖。**

具体目标：

1. 产品拥有自己的业务实现和发布节奏；
2. 每个 Research 主题拥有自己的代码、环境、数据、测试和报告；
3. Labs 保持探索性，不成为任何可发布系统的隐式基础设施；
4. 研究结论可以转化为产品验收契约，但研究代码不成为产品库；
5. 用户数据只保存在本机，应用不具备交易执行能力。

## 2. 三域边界

| 域 | 职责 | 自有资产 | 禁止依赖 |
| --- | --- | --- | --- |
| `labs/` | 学习、数据源试验、Notebook、快速验证 | `labs/pyproject.toml`、`labs/uv.lock`、实验代码和临时数据 | 不被 Research 或 Src import；不向产品提供运行时模块 |
| `research/<topic>/` | 可复现研究闭环 | 独立 `pyproject.toml`、`uv.lock`、`src/`、`tests/`、`data/`、`report/` | 不 import Labs 或 Src；不借用 Labs 环境 |
| `src/desktop/` | 可发布桌面产品 | Electron、React、Python sidecar、产品领域代码、数据库、产品测试和打包配置 | 不 import 或运行 `labs/`、`research/`；不读取其工作目录作为运行时数据源 |

三个域允许使用相同的第三方库，但必须各自在自己的清单和锁文件中声明。锁文件相同或依赖版本接近，不代表存在项目依赖。

## 3. 允许的知识转移

隔离不禁止复用结论，但转移必须是显式、可审计的所有权交接。

```text
Labs 实验结果
    ↓  人工评审、重新实现、记录来源
Research 研究问题与证据
    ↓  冻结行为契约和验收向量，复制到产品域并注明来源
Src 产品自有实现与测试
```

允许：

- 在文档中引用研究报告；
- 把经过评审的输入/预期输出复制成产品自有测试 fixture，并记录来源、截止时间和口径版本；
- 根据 Labs 的接口调查，在产品域重新实现数据源适配器；
- 对同一金融公式分别维护研究实现与产品实现，并用独立测试核验各自正确性。

禁止：

- 产品 import `research/bank-dca`；
- 产品测试在运行时读取 `research/bank-dca/data/`；
- 产品 import `labs/01_银行股定投回测/data_source_registry.py`；
- Research 使用 `uv run --project labs ...`；
- 用 Junction、symlink、`PYTHONPATH` 或相对路径绕过边界；
- 创建让 Labs、Research、Src 共同依赖的顶层共享业务核心。

当研究结果需要进入产品时，产品负责人必须在 `src/desktop/` 内接收一份带来源说明的契约或 fixture。此后产品测试不依赖原 Research 目录是否存在。

## 4. R1 总体架构

```text
Electron + React
        ↓  localhost HTTP / JSON
本地 Python sidecar
        ↓
产品自有领域层
        ↓
SQLite
```

### 各层责任

| 层 | 责任 | 禁止事项 |
| --- | --- | --- |
| Electron + React | 页面、输入校验、状态展示、导入导出交互 | 不实现金融公式，不直接读写 SQLite |
| Python sidecar | API、进程生命周期、请求校验、事务边界、数据源适配、日志 | 不 import Labs 或 Research |
| 产品领域层 | 回测、账本、公司行动、指标和领域校验 | 不依赖仓库中的实验或研究包 |
| SQLite | 流水、行情快照、设置、运行记录和迁移版本 | 不保存可独立修改的派生持仓 |

sidecar 仅监听 `127.0.0.1`，使用启动时生成的随机端口和会话令牌。Electron 主进程负责启动、健康检查和退出时关闭 sidecar；渲染进程不能直接获得 Node.js 或数据库权限。

## 5. 产品目录

R1 产品代码只放在 `src/desktop/`：

```text
src/
└── desktop/
    ├── README.md
    ├── electron/
    ├── renderer/
    ├── sidecar/
    │   ├── pyproject.toml
    │   ├── uv.lock
    │   ├── src/
    │   │   └── desktop_backend/
    │   │       ├── analysis.py
    │   │       ├── ledger.py
    │   │       ├── corporate_actions.py
    │   │       ├── data_sources/
    │   │       └── storage/
    │   └── tests/
    └── tests/
        └── fixtures/
```

这里的 `analysis.py`、`ledger.py` 和 `corporate_actions.py` 属于产品域，只服务桌面应用。它们不是从 Research import 的兼容层，也不向 Labs 或 Research 反向提供公共包。

## 6. 产品领域模块

### `analysis.py`

- 月度固定金额回测；
- 指定日与非交易日顺延；
- 100 股整数倍买入和现金结转；
- 简化费用；
- 日度资产序列；
- 累计投入、最终资产、累计盈亏、XIRR、最大回撤、累计分红和期末现金；
- 多标的同条件并排的独立运行与结果汇总。

### `ledger.py`

- 七类实际流水的领域模型与校验；
- 追加、冲正和修正；
- 从有效流水重建持仓、可用现金、逆回购资产和账户汇总；
- 实际账户累计盈亏和 XIRR。

### `corporate_actions.py`

- 现金分红事件标准化；
- 登记日持股数量判断；
- 分红入账和原标的回购指令；
- 对 R1 不支持的公司行动显式阻断或告警。

### `data_sources/`

- 产品域自行维护行情、证券主数据和公司行动适配器；
- 适配器输出产品自有 schema；
- 每条快照记录来源、获取时间、数据截止时间和转换版本；
- 可以参考 Labs 的数据源调查结论，但不能 import、复制路径或假设 Labs 环境存在。

## 7. Research 的角色

`research/bank-dca/` 是独立研究项目，不是产品后端原型，也不是产品包的上游源码目录。

它负责：

- 用自己的环境重放银行股研究；
- 保存研究口径、审计快照、验证代码和报告；
- 输出经过评审的事实、限制和可供产品讨论的行为契约。

它不负责：

- 提供产品运行时代码；
- 保证产品 API 兼容；
- 提供产品数据源注册模块；
- 与产品共用锁文件或虚拟环境。

产品若采用研究中的某项口径，必须在产品域重新实现，并把经过选择的最小验收向量复制到产品测试目录。Research 后续演进不会自动改变产品行为。

## 8. 数据与存储

R1 产品使用自己的 SQLite 数据库，至少区分以下逻辑表：

- `ledger_entries`：不可变业务流水及冲正关联；
- `instruments`：A 股证券主数据；
- `market_prices`：行情快照、来源和截止时间；
- `corporate_actions`：现金分红及来源字段；
- `backtest_runs`：输入参数、口径版本、来源、告警和结果摘要；
- `settings`：本地配置；
- `schema_migrations`：数据库版本。

Research 的 `data/` 只属于研究项目，不是产品数据库的种子数据目录。产品 fixture 必须复制到 `src/desktop/tests/fixtures/` 并带独立 manifest。

持仓、现金、总资产和累计盈亏是派生结果，应从流水和估值快照重建。金额与费用使用十进制定点数；数量使用整数股；日期保存 ISO 8601，交易日按 `Asia/Shanghai` 解释。

## 9. API、安全与本地能力

sidecar API 使用 `/api/v1` 前缀，R1 只暴露：

- 回测创建、结果读取和并排比较；
- 流水新增、查询、冲正和修正；
- 账户汇总；
- 数据来源与截止时间；
- JSON 备份、校验与恢复；
- 日志导出；
- 健康检查。

写操作必须在 SQLite 事务中完成。Electron 强制：

- `contextIsolation: true`；
- `nodeIntegration: false`；
- 渲染进程使用最小化 preload API；
- CSP 禁止任意远程脚本；
- sidecar 会话令牌只保存在进程内存。

R1 不包含券商连接、交易凭据或下单 API。

## 10. 测试策略

| 域 | 测试责任 |
| --- | --- |
| Labs | 验证实验自身可运行；结果仅作为探索证据 |
| Research | 用研究项目自己的环境运行单元测试、快照校验和报告重建 |
| Src | 用产品自有 fixture 测试日期顺延、整数手、费用、分红、账本、XIRR、回撤、API 和数据库 |

产品验收 fixture 应包含：

- 输入数据和来源说明；
- 截止时间；
- 金融口径版本；
- 预期逐笔流水；
- 预期汇总指标；
- 从 Research 转入时的评审记录。

复制完成后，删除或移动 Research 目录不应导致产品测试失败。

## 11. R1 架构验收

- [ ] `src/desktop/` 不 import、执行或读取 `labs/`、`research/`；
- [ ] `research/bank-dca/` 不 import `labs/`、`src/`；
- [ ] `research/bank-dca/` 有独立 `pyproject.toml` 和 `uv.lock`；
- [ ] Labs、Research、产品 sidecar 各自使用独立环境；
- [ ] 产品数据源适配器不复用 Labs 的 `data_source_registry.py`；
- [ ] 产品测试 fixture 位于产品域，且带来源和口径 manifest；
- [ ] 删除 Research 工作目录后，产品构建和测试仍可完成；
- [ ] 研究包在不安装 Labs 依赖的环境中能运行单元测试；
- [ ] 持仓和现金可从不可变流水完整重建；
- [ ] JSON 恢复失败时产品数据库保持原状；
- [ ] sidecar 只监听本机并要求会话令牌；
- [ ] 桌面应用不存在下单接口或券商权限。
