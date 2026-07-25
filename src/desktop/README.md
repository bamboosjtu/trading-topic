# 攒股收息桌面端

`src/desktop/` 是 R1 产品代码的唯一归属。

边界：

- 不 import、执行或读取 `labs/`；
- 不 import、执行或读取 `research/`；
- 产品领域逻辑、数据源适配器、SQLite 迁移和测试 fixture 均由本目录自行维护；
- 从研究结论转入的测试向量必须复制到本目录，并记录来源、数据截止时间和口径版本；
- 删除 Labs 或 Research 后，桌面端仍应能够构建、测试和运行。

当前尚未开始产品实现。目标结构与验收标准见 [R1 技术架构](../../docs/product/ARCHITECTURE.md)。
