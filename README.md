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
│   ├── product/          # 产品需求与架构
│   └── tutorial/         # 教程资料
├── labs/                 # 每个研究主题收敛为一个 Lab，目录形如 01_银行股定投回测/
│   ├── 00_金融数据获取/    # 金融数据源架构、AKShare 教程、接口体检与筛选脚本
│   ├── 01_银行股定投回测/  # 银行股定投回测完整链路：子文档 + 前置体检 + 主入口 Notebook + 核心代码 + data_source_registry + data/
│   └── data/             # Lab 0 共享数据（如 source_healthcheck.csv）；Lab 1 自带 data/ 子目录
├── research/
│   └── bank-dca/         # 独立环境的银行股定投研究包
├── src/
│   └── desktop/          # Electron + React + Node.js 桌面产品
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
| 产品开发 | `src/desktop/` 与 `docs/product/` | 产品代码、环境和数据均不依赖 Labs 或 Research |

不要在仓库根目录堆放新的实验文件或报告；为新主题选择上述归属。

## 快速开始

Labs、Research 与 Src 使用各自环境，不共享运行时依赖。

启动 Labs：

```powershell
uv sync --project labs
uv run --project labs jupyter lab labs
```

复现银行股定投 Research：

```powershell
uv sync --project research/bank-dca
uv run --project research/bank-dca python -m unittest discover -s research/bank-dca/tests -v
uv run --project research/bank-dca bank-dca-verify
uv run --project research/bank-dca bank-dca-report
```

启动桌面产品：

```powershell
Set-Location src/desktop
# Electron 35 与 better-sqlite3 13 的开发环境要求 Node.js 22+
npm install
npm run dev
```

更具体的研究与协作规则见 [AGENTS.md](AGENTS.md)。
