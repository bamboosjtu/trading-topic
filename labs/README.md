# 学习实验

`labs/` 用于验证数据源、研究口径和回测想法。这里的代码可以是探索性的，但实验结果必须可解释、可复查。

## 实验路线

| 阶段 | 说明 | 当前材料 |
| --- | --- | --- |
| Lab 1 | 验证金融数据源及其字段、稳定性和局限 | [Lab1-金融数据源验证.md](Lab1-金融数据源验证.md)、`lab1_*` |
| Lab 2 | 建立银行股标准数据集 | [Lab2-银行股标准数据集.md](Lab2-银行股标准数据集.md) |
| Lab 3 | 验证单只银行定投流水与计算口径 | [Lab3-单只银行定投回测.md](Lab3-单只银行定投回测.md)、`lab2_etf.py`、`verify_dca.py` |
| Lab 4 | 多家银行在相同条件下比较 | [Lab4-多家银行并排比较.md](Lab4-多家银行并排比较.md)、`lab2_batch.py`、`lab2_rolling.py` |
| Lab 5 | 银行股组合回测 | [Lab5-银行股组合回测.md](Lab5-银行股组合回测.md) |

`report_charts.py` 是早期图表生成脚本，产物写入 `research/bank-dca/`。更完整、带数据快照和自动校验的研究实现也位于该目录。

## 运行环境

从仓库根目录运行：

```powershell
uv sync --project labs
uv run --project labs python labs/lab1_mootdx.py
```

实验数据统一写入本目录下的 `data/`。其中 CSV 等可再生数据通常不会被 Git 跟踪。
