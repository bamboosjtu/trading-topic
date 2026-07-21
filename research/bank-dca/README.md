# 银行股定投研究

本目录是一个可复现研究包，包含数据获取、回测引擎、验证、图表和研究报告。

## 主要文件

- `data_fetch.py`：获取行情、分红、指数和逆回购数据；
- `analysis.py`：纯计算与回测逻辑；
- `test_analysis.py`：确定性单元测试；
- `verify_returns.py`：数据与收益口径校验；
- `build_report.py`：基于快照重建图表和 Markdown 报告；
- `data/`：用于重算和审计的小型研究快照及校验结果；
- `七家银行与基准回测报告.md`：当前完整研究报告；
- `四大行定投回测报告.md`：早期实验报告。

## 复现

从仓库根目录运行：

```powershell
uv sync --project labs
uv run --project labs python research/bank-dca/test_analysis.py
uv run --project labs python research/bank-dca/verify_returns.py
uv run --project labs python research/bank-dca/build_report.py
```

只有在需要刷新研究截止日时才重新获取数据：

```powershell
uv run --project labs python research/bank-dca/data_fetch.py
```

刷新前后应比较 `data/manifest.json`、校验结果和报告关键数字，避免将数据变化误判为代码变化。
