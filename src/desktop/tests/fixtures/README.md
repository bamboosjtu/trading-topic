# 产品测试 Fixture

本目录只接收经过评审、带来源版本、数据截止日和预期产品输出的静态验收向量。产品测试必须用向量驱动产品自己的实现并断言计算结果；只检查 Research 报告中的某个数字是否存在，不属于有效测试。

Labs、Research、Src 保持运行时隔离。任何产品测试都不得导入、执行或读取 Labs、Research 的源码、数据目录和环境。研究结论需要进入产品时，应复制必要的最小输入与预期结果，并记录来源提交、口径版本和评审记录。

当前金融边界条件由产品域内的确定性测试覆盖，见 `electron/domain/analysis.test.ts` 与 `electron/storage/database.test.ts`；本目录暂无跨域验收向量。
