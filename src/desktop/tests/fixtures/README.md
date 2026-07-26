# 产品测试 Fixture

本目录只接收经过评审、带来源版本、数据截止日和预期产品输出的静态验收向量。产品测试必须用向量驱动产品自己的实现并断言计算结果；只检查 Research 报告中的某个数字是否存在，不属于有效测试。

Labs、Research、Src 保持运行时隔离。任何产品测试都不得导入、执行或读取 Labs、Research 的源码、数据目录和环境。研究结论需要进入产品时，应复制必要的最小输入与预期结果，并记录来源提交、口径版本和评审记录。

当前包含两份在 2026-07-27 获取的东方财富
`RPT_SHAREBONUS_DET` 最小真实响应：

- `eastmoney-sharebonus-601398.json`：年度与中期现金分红实施方案；
- `eastmoney-sharebonus-300750.json`：包含 `IT_RATIO` 的现金分红与转增方案。

Fixture 只保留适配器需要的原始字段及请求地址，不作为 Research 金标准。金融边界条件仍由产品域确定性测试覆盖，见
`electron/domain/analysis.test.ts`、`electron/domain/finance.test.ts` 与
`electron/storage/database.test.ts`。
