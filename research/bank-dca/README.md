# 银行股定投研究

本目录是独立、可复现的 Research 项目，不是产品库，也不依赖 Labs 环境。

## 结构

```text
research/bank-dca/
├── pyproject.toml
├── uv.lock
├── src/bank_dca_research/
│   ├── analysis.py
│   ├── data_fetch.py
│   ├── verify_returns.py
│   └── build_report.py
├── tests/
├── data/
└── report/
```

`data/` 保存研究快照和校验结果，`report/` 保存由研究代码生成的报告与图表。产品不得在运行时读取这些目录。

## 复现

从仓库根目录运行：

```powershell
uv sync --project research/bank-dca
uv run --project research/bank-dca python -m unittest discover -s research/bank-dca/tests -v
uv run --project research/bank-dca bank-dca-verify
uv run --project research/bank-dca bank-dca-report
```

只有在明确刷新研究截止日时才获取新数据：

```powershell
uv run --project research/bank-dca bank-dca-fetch
```

刷新前后应比较 `data/manifest.json`、校验结果和报告关键数字，避免把数据变化误判为代码变化。
