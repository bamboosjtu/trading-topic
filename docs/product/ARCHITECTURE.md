# 攒股收息 R1 技术架构

> 状态：R1 实现基线
>
> 更新日期：2026-07-26
>
> 配套需求：[PRD_R1.md](PRD_R1.md)
>
> 界面设计：[desktop_ui/](desktop_ui/) 目录下每个 Tab 的设计简述
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
- 用各域独立测试核验本域行为；必要时把同一份已评审向量分别复制到各域。

三个域出现相似算法或数据适配代码是隔离带来的有意重复，不是建立共享业务核心的理由。产品端实现对产品行为负责，Research 负责用可复现数据形成证据；任何一方都不是另一方的运行时库。

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

## 5. 领域模块与界面索引

R1 领域逻辑集中在 `electron/domain/`，界面集中在 `renderer/src/pages/`。需求口径见 [PRD_R1.md](PRD_R1.md)，每个 Tab 的设计细节见 [desktop_ui/](desktop_ui/)。

| 模块 | 领域代码 | 界面代码 | 需求 | 设计简述 |
| --- | --- | --- | --- | --- |
| 历史回测 | `domain/analysis.ts` | `pages/BacktestPage.tsx` | [PRD §3.1](PRD_R1.md) | [历史回测_ui_brief.md](desktop_ui/历史回测_ui_brief.md) |
| 持仓明细 | `domain/ledger.ts` | `pages/SkeletonPage.tsx`（占位） | [PRD §3.2](PRD_R1.md) | [持仓明细_ui_brief.md](desktop_ui/持仓明细_ui_brief.md) |
| 交易流水 | `domain/ledger.ts` | `pages/SkeletonPage.tsx`（占位） | [PRD §3.2](PRD_R1.md) | [交易流水_ui_brief.md](desktop_ui/交易流水_ui_brief.md) |
| 分红日历 | `domain/ledger.ts` | `pages/SkeletonPage.tsx`（占位） | [PRD §3.2](PRD_R1.md) | [分红日历_ui_brief.md](desktop_ui/分红日历_ui_brief.md) |
| 本地设置 | — | `pages/SkeletonPage.tsx`（占位） | [PRD §3.3](PRD_R1.md) | [本地设置_ui_brief.md](desktop_ui/本地设置_ui_brief.md) |

金额在业务边界统一保留两位小数；回测股数允许零碎股，内部保留 6 位精度，
界面默认显示 2 位。主结果与明细必须复用同一计算流水，不允许维护口径不同的
第二套“简化回测”。

## 6. 数据来源

产品依据 Lab 01 已评审结论独立实现两个适配器：

| 数据 | 产品主源 | 口径 |
| --- | --- | --- |
| A 股日线 | 腾讯财经 `newfqkline` | 不复权收盘价 |
| 已实施公司行动 | 东方财富 `RPT_SHAREBONUS_DET` | 税前每股现金分红；每 10 股送股/转增比例 |

每次回测记录来源、获取时间、实际数据截止日、复权口径和口径版本。多标的按顺序获取；东方财富请求之间至少间隔 1.2 秒，避免并发触发风控。

请求失败、响应结构变化、无数据或存在尚未实现的公司行动（如配股）时直接报错，
不生成虚构行情，也不静默切换来源。现金分红、送股和转增属于 R1 已支持事件。
已有 SQLite 快照仍可供账户估值和历史结果查看。

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

## 8. 界面风格

R1 使用冷白画布、深墨蓝信息层级与亮蓝单一动作色。Tailwind、Ant Design
和手写 CSS 共用同一套冷蓝语义 token，不保留暖金、瓷色或第二套品牌主题。
Electron 窗口与页面最小宽度均为 1920px；侧栏固定 256px，顶栏 56px。
导航只保留“研究 / 历史回测”、“实盘 / 持仓明细、交易流水、分红日历”和
“系统 / 设置”。历史回测是当前唯一完成态页面，其余四个入口统一渲染
`SkeletonPage`，避免把未接入的草稿页面误认为可用功能。每个 Tab 的详细设计见
[desktop_ui/](desktop_ui/)。

## 9. 测试与验收

| 范围 | 验证 |
| --- | --- |
| 领域单测 | 日期顺延、零碎股、费用 0、分红、送转、XIRR、回撤、账本冲正与逆回购 |
| 类型检查 | `npm run typecheck`，直接运行 TypeScript 编译器 |
| 构建 | `npm run build`，验证 main、preload、renderer 三个入口 |
| 隔离扫描 | `src/desktop/` 不含 Python，不引用、执行或读取 Labs、Research |
| 界面冒烟 | 1920×1080 下历史回测、图表切换、明细筛选与翻页；其余入口显示骨架屏 |
