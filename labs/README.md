# 学习实验

`labs/` 用于验证数据源、研究口径和回测想法。这里的代码可以是探索性的，但实验结果必须可解释、可复查。

## 实验路线

| 阶段 | 说明 | 当前材料 |
| --- | --- | --- |
| Lab 0 | 金融数据源架构与四层接口目录（行情、基础数据、研报、新闻与公告） | [00_金融数据获取/](00_金融数据获取/) |
| Lab 1 | 银行股定投回测：标准数据集、单标的、多标的并排、组合回测 | [01_银行股定投回测/](01_银行股定投回测/) |

### Lab 0 子文档

`00_金融数据获取/` 把金融数据获取相关的研究与教程收敛为一个 Lab，包含以下材料：

| 材料 | 职责 |
| --- | --- |
| [0-金融数据源架构.md](00_金融数据获取/0-金融数据源架构.md) | 基于 `a-stock-data` skill 的十层数据架构分析与本项目四层数据源规划 |
| [akshare_tutorial.ipynb](00_金融数据获取/akshare_tutorial.ipynb) | AKShare 接口教程与示例 |

> `data_source_registry.py` 原属 Lab 0，因被 Lab 1 直接依赖，已移至 `01_银行股定投回测/` 下与 `bank_dca.py` 同目录，详见 Lab 1 子文档表。
>
> `akshare_health_check.py` 与 `filter_stock_apis.py` 原属 Lab 0，实际服务于 `docs/tutorial/akshare_api.xlsx` 与配套 Notebook 的构建链路，已移至 `docs/tutorial/` 下与产物同目录，详见 `docs/tutorial/akshare.md` 末尾说明。

### Lab 1 子文档

`01_银行股定投回测/` 把银行股定投回测的完整研究链路收敛为一个 Lab，包含以下子文档：

| 子文档 | 职责 |
| --- | --- |
| [0-数据源体检.ipynb](01_银行股定投回测/0-数据源体检.ipynb) | Lab 1 前置：仅体检 Lab 1 依赖的行情与基础数据接口 |
| [1-银行股定投回测概要.md](01_银行股定投回测/1-银行股定投回测概要.md) | 研究框架：目标、数据路由、回测口径、指标、图表、验收标准 |
| [2-银行股标准数据集.md](01_银行股定投回测/2-银行股标准数据集.md) | 8 张标准表 schema、质量门禁、快照管理 |
| [3-单只银行定投回测.md](01_银行股定投回测/3-单只银行定投回测.md) | 工商银行为样本，逐笔交易流水验证 + 3 种费用模型 |
| [4-多家银行并排比较.md](01_银行股定投回测/4-多家银行并排比较.md) | 5 只银行同条件并排，5 核心指标 + 7 展示指标 + 滚动窗口 |
| [5-银行股组合回测.md](01_银行股定投回测/5-银行股组合回测.md) | 等权组合回测，组合 vs 单标的的回撤与收益对比 |
| [bank_dca_backtest.ipynb](01_银行股定投回测/bank_dca_backtest.ipynb) | 主执行入口：股票池 → 行情 → 分红 → 回测 → 指标 → 图表 |
| [bank_dca.py](01_银行股定投回测/bank_dca.py) | 数据获取 + 一手买入回测核心代码 |
| [data_source_registry.py](01_银行股定投回测/data_source_registry.py) | 数据源注册、路由与体检核心模块（被 `bank_dca.py` 直接依赖） |

更完整、带数据快照和自动校验的研究实现位于 `research/bank-dca/`。

### Notebook 职责

| Notebook | 职责 | 主要输出 |
| --- | --- | --- |
| [00_金融数据获取/akshare_tutorial.ipynb](00_金融数据获取/akshare_tutorial.ipynb) | AKShare 接口教程 | 教程示例 |
| [01_银行股定投回测/0-数据源体检.ipynb](01_银行股定投回测/0-数据源体检.ipynb) | 体检 Lab 1 依赖的行情与基础数据接口 | `data/lab0/source_healthcheck.csv` |
| [01_银行股定投回测/bank_dca_backtest.ipynb](01_银行股定投回测/bank_dca_backtest.ipynb) | 股票池 → 行情 → 分红 → 回测 → 指标 → 图表 | `01_银行股定投回测/data/bank_universe.csv`、`01_银行股定投回测/data/results/`、`01_银行股定投回测/data/charts/` |

`01_银行股定投回测/0-数据源体检.ipynb` 已精简为仅保留 Lab 1 依赖的前置接口（行情、基础数据、
`cninfo_announcements` 法定公告备查）；完整四层数据源体检见
`00_金融数据获取/0-金融数据源架构.md`。Lab 1 对质量不合格的股票保留结果行并标记阻断，
不带病继续回测。

## 运行环境

从仓库根目录运行：

```powershell
uv sync --project labs
uv run --project labs jupyter lab labs
```

实验数据统一写入各 Lab 子目录下的 `data/`（Lab 0 共享数据写入 `labs/data/lab0/`）。
