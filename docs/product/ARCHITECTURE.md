# 攒股收息 R1 技术架构

> 状态：评审收敛版
>
> 更新日期：2026-07-25
>
> 配套需求：[PRD_R1.md](PRD_R1.md)

## 1. 架构目标

R1 采用单机、单端、本地优先架构，优先保证：

1. 金融计算只有一份事实标准；
2. 回测、账本和公司行动可以独立测试；
3. 研究包能用固定数据证明核心库正确；
4. 用户数据不依赖远程服务；
5. 应用不具备交易执行能力。

## 2. 范围与非目标

架构范围：

- Electron + React 桌面界面；
- 本地 Python sidecar；
- `trading_topic_core` Python 核心库；
- 本地 SQLite；
- JSON 备份恢复和脱敏日志导出。

安卓端延后到 R2，本文不做移动端技术选型。R1 也不设计远程后端、云同步、微服务、消息队列、跨端数据模型或多语言回测引擎。

## 3. 总体架构

```text
Electron + React
        ↓  localhost HTTP / JSON
本地 Python sidecar
        ↓
trading_topic_core
        ↓
SQLite
```

### 3.1 各层责任

| 层 | 责任 | 禁止事项 |
| --- | --- | --- |
| Electron + React | 页面、输入校验、状态展示、导入导出交互 | 不实现金融公式，不直接读写 SQLite |
| Python sidecar | API、进程生命周期、请求校验、事务边界、日志 | 不复制核心计算，不 import 研究脚本 |
| `trading_topic_core` | 回测、账本、公司行动、指标和领域校验 | 不依赖 Electron、sidecar、`apps/`、`labs/` 或 `research/` |
| SQLite | 流水、快照、设置、运行记录和迁移版本 | 不保存可独立修改的派生持仓 |

sidecar 仅监听 `127.0.0.1`，使用启动时生成的随机端口和会话令牌。Electron 主进程负责启动、健康检查和退出时关闭 sidecar；渲染进程不能直接获得 Node.js 或数据库权限。

## 4. 依赖方向

目标目录：

```text
src/
└── trading_topic_core/
    ├── analysis.py
    ├── ledger.py
    └── corporate_actions.py

research/
└── bank-dca/
    ├── data/
    ├── tests/
    └── reports/

labs/
└── ...

apps/
└── desktop/
    ├── electron/
    ├── renderer/
    └── sidecar/
```

唯一允许的业务依赖方向：

```text
research ─┐
labs ─────┼──> trading_topic_core
apps ─────┘
```

禁止：

- `trading_topic_core` import `research/`、`labs/` 或 `apps/`；
- sidecar import `research/bank-dca/analysis.py`；
- 在前端、sidecar 或研究包复制一份 XIRR、回撤、账本或分红算法；
- 以 notebook 输出替代核心库测试。

结论：**核心库是事实标准，研究包用数据证明它正确。**

## 5. 核心模块

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

模块返回结构化结果和领域错误，不写 UI 文案，不自行访问网络。

## 6. 研究代码迁移

当前 `research/bank-dca/analysis.py` 和 `labs/01_银行股定投回测/bank_dca.py` 只能作为迁移输入，不能继续被产品后端直接 import。

迁移顺序：

1. 提取纯计算到 `src/trading_topic_core/`，先保持现有行为；
2. 为 R1 新口径补齐 100 股、现金结转、费用、分红回购和实际账本测试；
3. 将 `research/bank-dca/` 改为 import `trading_topic_core`；
4. 使用研究快照生成 golden fixtures，断言关键指标与逐笔流水；
5. 将 Labs 改为调用核心库，只保留数据探索和解释；
6. sidecar 只调用核心库公开 API；
7. 删除或缩减重复实现，确保算法只有一个维护点。

迁移完成的判据不是“产品能启动”，而是：

- `rg` 检查不存在产品 import 研究脚本；
- 研究校验、核心单元测试和 sidecar API 测试使用同一核心实现；
- 同一固定快照在研究命令和产品 API 中输出一致。

## 7. 数据与存储

R1 使用一个 SQLite 数据库，至少区分以下逻辑表：

- `ledger_entries`：不可变业务流水及冲正关联；
- `instruments`：A 股证券主数据；
- `market_prices`：行情快照、来源和截止时间；
- `corporate_actions`：现金分红及来源字段；
- `backtest_runs`：输入参数、口径版本、来源、告警和结果摘要；
- `settings`：本地配置；
- `schema_migrations`：数据库版本。

持仓、现金、总资产和累计盈亏是派生结果，应从流水和估值快照重建。可缓存，但缓存必须可删除重算，不能成为第二份事实标准。

金额与费用使用十进制定点数；数据库以最小货币单位整数或规范化十进制字符串保存。数量使用整数股。日期保存 ISO 8601，交易日按 `Asia/Shanghai` 解释。

## 8. API 与进程边界

sidecar API 使用 `/api/v1` 前缀，R1 只暴露：

- 回测创建、结果读取和并排比较；
- 流水新增、查询、冲正和修正；
- 账户汇总；
- 数据来源与截止时间；
- JSON 备份、校验与恢复；
- 日志导出；
- 健康检查。

写操作必须在 SQLite 事务中完成。请求和响应使用显式 schema；领域错误返回稳定错误码，前端只负责翻译和展示。

## 9. 备份、日志与安全

### JSON 备份

- 包含 `schema_version`、`exported_at`、应用版本、口径版本和业务数据；
- 恢复前先校验结构与版本；
- 覆盖恢复前自动导出当前备份；
- 导入失败必须回滚，不留下半恢复状态。

### 日志

- 记录时间、级别、组件、请求编号、错误码和脱敏上下文；
- 不记录 Token、Cookie、完整备份内容或个人敏感信息；
- 日志导出不包含数据库文件。

### Electron

- `contextIsolation: true`；
- `nodeIntegration: false`；
- 渲染进程使用最小化 preload API；
- CSP 禁止任意远程脚本；
- sidecar 会话令牌只保存在进程内存。

R1 不包含券商连接、交易凭据或下单 API。

## 10. 测试策略

| 层级 | 重点 |
| --- | --- |
| 核心单元测试 | 日期顺延、整数手、现金结转、费用、分红、XIRR、回撤、冲正 |
| 属性/不变量测试 | 现金不为负、持仓可由流水重建、并排结果等于逐个运行 |
| Golden tests | 固定研究快照的逐笔交易、日度资产和七项回测输出 |
| 数据库测试 | 迁移、事务回滚、备份恢复前后一致 |
| API 测试 | schema、错误码、幂等冲正、来源与截止时间 |
| 桌面端测试 | sidecar 生命周期、主流程、断网使用和无交易入口 |

## 11. R1 架构验收

- [ ] 产品代码不 import `research/bank-dca/analysis.py` 或 Labs 脚本；
- [ ] `research/`、`labs/` 和 `apps/` 都只依赖 `trading_topic_core`；
- [ ] 核心库不依赖 UI、sidecar、研究目录或网络客户端；
- [ ] 同一研究快照在研究命令和 sidecar API 中结果一致；
- [ ] 持仓和现金可从不可变流水完整重建；
- [ ] JSON 恢复失败时数据库保持原状；
- [ ] 断网可查看并计算本地已有数据；
- [ ] 日志无密钥和敏感信息；
- [ ] sidecar 只监听本机并要求会话令牌；
- [ ] 桌面应用不存在下单接口或券商权限。
