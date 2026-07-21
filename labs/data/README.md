# 实验数据

本目录保存 `labs/` 产生或消费的本地数据。CSV、Excel、Parquet 等可再生数据默认被 `.gitignore` 排除，不会随仓库提交。

当前约定：

- `lab1_akshare/`、`lab1_tushare/`：按数据源隔离的 Lab 1 结果；
- 本目录根层现有银行行情与清单 CSV：早期 `mootdx` 和定投实验仍在使用的兼容路径；
- 新实验优先写入 `labs/data/<lab-or-topic>/`，避免继续向本目录根层增加文件。

不要在未同步修改消费脚本和 Notebook 的情况下移动现有数据。需要随研究成果审计的小型快照，应放入 `research/<topic>/data/`，并记录来源、获取时间和口径。
