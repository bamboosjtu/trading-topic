# Lab 02：行业走势相关性研究

## 实验目标

1. 研究 A 股股票与 ETF 标的的行业分类获取方法；
2. 以最后完整交易日的总市值选出 A 股市值最大的十个申万一级行业；
3. 研究这些行业与沪深300、中证500的日收益率相关性；
4. 汇总方法、结果、限制与后续研究建议。

## 文件

| 文件 | 职责 |
| --- | --- |
| `1-标的行业分类.ipynb` | 构造申万一级行业股票分类、市值快照和 ETF 行业初筛，执行质量检查 |
| `2-前十行业与大盘相关性.ipynb` | 计算前十行业与两个宽基指数的 Pearson/Spearman 相关、beta 和 60 日滚动相关 |
| `3-总体研究结论.md` | 汇总数据口径、主要发现、解释边界和下一步建议 |
| `build_notebooks.py` | 以可审阅的 Python 源生成两个 Notebook；不负责研究数据获取 |

可再生数据与图表写入本目录的 `data/`，由仓库 `.gitignore` 排除。

## 运行

从仓库根目录依次执行：

```powershell
uv sync --project labs
uv run --project labs jupyter nbconvert --to notebook --execute --inplace `
  "labs\02_行业走势相关性研究\1-标的行业分类.ipynb" `
  --ExecutePreprocessor.timeout=900
uv run --project labs jupyter nbconvert --to notebook --execute --inplace `
  "labs\02_行业走势相关性研究\2-前十行业与大盘相关性.ipynb" `
  --ExecutePreprocessor.timeout=900
```

第二个 Notebook 读取第一个 Notebook 生成的分类与市值快照，因此必须按顺序运行。

## 固定研究口径

- 市值快照：2026-07-29 收盘；
- 历史区间：2021-01-01 至 2026-07-29；
- 股票行业：申万一级行业；
- 市值：腾讯当前总市值乘以 `昨收/现价`，回推至最后完整交易日；
- 相关性：日对数收益率 Pearson 为主，Spearman、beta 与 60 日滚动相关为辅；
- ETF 分类：双源清单加名称关键词初筛，正式结论仍需核验跟踪指数和基金法律文件。

本实验不构成投资建议。
