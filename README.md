# 投资研究实验室

本项目同时服务于三个目标：

1. **学习**：用小型实验理解金融数据、回测方法与投资研究框架；
2. **研究**：形成数据、方法、校验和结论均可追溯的研究成果；
3. **开发**：把验证有效的方法逐步沉淀为可复用工具或产品。

本仓库只提供研究与工程支持，不构成投资建议，也不会执行实盘交易。

## 目录结构

```text
trading-topic/
├── .agents/              # Codex 可用的投资研究 skills
├── .claude/              # Claude 的 skills 与本地配置
├── docs/
│   └── product/          # 产品需求、设计与开发决策
├── labs/                 # Lab 1～5 研究主线、Notebook 与原型脚本
│   ├── Lab1-*.md         # 各阶段的研究目标、口径和步骤
│   └── data/             # Lab 产生和消费的本地实验数据
├── research/
│   └── bank-dca/         # 可复现的银行股定投研究包
├── reports/              # 面向阅读者的最终研究成稿
├── AGENTS.md             # AI Agent 在本仓库工作的统一约定
└── README.md             # 项目入口
```

本地可能存在 `quant-for-beginners/`。它是被 `.gitignore` 排除的独立学习仓库，不属于本项目，也不应成为本项目代码的运行依赖。

## 三类工作如何归档

| 工作类型 | 放置位置 | 最低要求 |
| --- | --- | --- |
| 学习实验 | `labs/` | 能运行，记录假设、输入与观察结果 |
| 可复现研究 | `research/<主题>/` | 数据来源、计算代码、校验、图表和报告形成闭环 |
| 最终成稿 | `reports/` | 面向读者、结论先行、来源可核查 |
| 产品开发 | `docs/product/`，后续按需增加 `src/`、`tests/` 或 `apps/` | 先写清需求和验收标准，再沉淀实现 |

不要在仓库根目录堆放新的实验文件或报告；为新主题选择上述归属。

## 快速开始

Python 实验环境由 `labs/pyproject.toml` 和 `labs/uv.lock` 管理。在仓库根目录运行：

```powershell
uv sync --project labs
uv run --project labs python labs/lab1_mootdx.py
```

运行银行股定投研究的测试与校验：

```powershell
uv run --project labs python research/bank-dca/test_analysis.py
uv run --project labs python research/bank-dca/verify_returns.py
```

使用已有数据快照重新生成研究报告：

```powershell
uv run --project labs python research/bank-dca/build_report.py
```

更具体的研究与协作规则见 [AGENTS.md](AGENTS.md)。
