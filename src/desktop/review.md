# 投资研究实验室 R1 桌面应用评审报告

> 评审日期：2026-08-08
> 评审范围：`src/desktop/` 产品域
> 审计起点提交：`943dac8e4c706e6dac3dbb2306852854cf01f525`
> 约束：保持现有业务功能；数据库 Schema 版本固定为 `1`；不读取、导入或执行 Labs / Research

## 结论

本轮发现并处理了三类实质问题：同一 Schema 内残留的旧回测质量兼容分支、服务层重复的质量/行情区间规则，以及未分层且包含过期自然日假设的测试。默认测试现在按
unit、contract、integration 三层运行，真实联网 smoke 独立执行；产品域边界检查在测试和构建前自动执行。

未改变回测、持仓、流水、收益日历、备份恢复或导出的业务口径；未修改数据库 DDL，`PRAGMA user_version` 仍为 `1`。鉴于项目明确不迁移、不兼容旧库，本轮只刷新同版本契约指纹，缺少结构化 `dataQuality` 的旧库会明确失败，不再从旧字段或 warning 文案猜测为 `strict`。

当前没有由本轮改动引入的发布阻断项。真实上游仍有单点与未版本化接口风险，详见[数据源文档](docs/数据源.md)和“剩余风险”。

## 代码评审与重构

| 发现 | 处理 | 验收 |
| --- | --- | --- |
| `dataQualityStatus`、`degraded_common_gap` 与 warning 文案推断属于未发布 Schema 1 的死兼容层，可能把损坏数据静默归为 strict | 从共享契约、服务、仓库、SQL 聚合、测试和导出/渲染兜底中删除；`dataQuality` 改为必填 | 持久化入口和备份恢复统一执行结构化质量断言；旧字段全仓零引用 |
| 结果级和实验级质量聚合在服务、仓库多处重复 | 提取 [backtestDataQuality.ts](electron/domain/backtestDataQuality.ts)，统一三级状态、原因顺序与年份集合 | unit 覆盖 strict/research/degraded、空集合、优先级、年份合并与非法结构 |
| `AppService` 同时承载实盘覆盖确认、区间归并和收益日历持仓区间推导 | 提取 [livePriceRanges.ts](electron/services/livePriceRanges.ts)，服务层只保留编排 | unit 覆盖 partial、空覆盖证据、完整覆盖及同日首尾重合区间 |
| 渲染与工作簿导出仍以 `?.level ?? "strict"` 吞掉缺失质量数据 | 删除这些死兜底和一段注释掉的 UI | 当前 Schema 1 的非法数据在边界处失败，不在展示层伪装 |
| 历史实验 SQL 摘要把正式/未覆盖日历年份固定为空数组，导致列表与详情提示不一致 | 从每个实验的结构化结果 JSON 去重并排序聚合两个年份集合 | integration 验证历史摘要保留 2024—2026 official 与 2016—2023 uncovered |
| 两个包装层测试把结束日写到 2026-12-31，随自然日进入 2026 年后开始触发真实兜底逻辑 | 改为固定的已结束区间 2026-07-31 | contract 层稳定通过，仍真正驱动包装函数 |
| 收益日历测试把当前日期上界误当成查询月份上界 | 断言改为查询月末 2026-07-31 | integration 层验证月份边界而非系统当前日 |

## 测试清理与分层

删除了 5 个低价值测试：4 个旧 `dataQualityStatus` / warning 文案兼容测试，以及 1 个与区间规则重复、依赖大量数据库与网络 mock 的服务级测试。无回撤的 4 组重复断言改为表驱动测试。新增 9 个聚焦用例覆盖被提取规则与持久化契约，因此清理后覆盖面没有下降。

| 层 | 文件 | 用例 | 责任 |
| --- | ---: | ---: | --- |
| unit | 12 | 105 | 纯领域计算、格式化、区间与质量规则 |
| contract | 4 | 73 | 外部响应解析、来源切换和完整性契约；全部 mock |
| integration | 4 | 61 | SQLite、事务、服务编排、冷启动、备份与 XLSX |
| smoke | 1 | 1 | 显式真实联网；不进入默认测试 |

默认 `npm test` 共 20 个文件、239 个用例；没有 `.skip`、`.todo` 或 `.only`。分层规则、命名和命令见 [测试分层说明](tests/README.md)。

## 数据源审计

产品运行时不安装、不 import、也不执行 Python 或 AKShare。当前真实源为：

- 沪深京 A 股目录：上交所、深交所、北交所公开列表组成的复合主源；
- ETF 目录：东方财富主源，新浪整表备用；
- 不复权/前复权日线：腾讯主源，新浪同语义整段备用；
- 分红送转、配股、自动停复牌：东方财富数据中心；
- 交易日历：随应用打包的上交所年度休市安排。

2026-08-08 的真实 smoke 已刷新

[证据文件](artifacts/market-data-smoke.json)：东方财富主源返回 1,564 只 ETF；腾讯与新浪对沪、深、北及 ETF 的不复权/前复权短区间均通过；新浪 15 年长历史返回 3,640行；腾讯最新已完成交易日为 2026-08-07；受控主源故障可整段切换新浪并保存来源。

完整端点、口径、缓存、门禁、AKShare 边界和失败策略见[数据源文档](docs/数据源.md)。

## 最终验证

| 命令或检查 | 结果 |
| --- | --- |
| `npm run check:domain-boundaries` | PASS；没有指向 `labs/` 或 `research/` 的运行时引用 |
| `npm run typecheck` | PASS |
| `npm test` | PASS；20 files / 239 tests |
| `npm run build` | PASS；main、preload、renderer、backup worker 均生成 |
| `npm run smoke:market-data` | PASS；1/1，证据已落盘 |
| `npm ls --depth=0` | PASS；未报告缺失或无效依赖 |
| `git diff --check` | PASS |

未执行 `npm run pack:portable`：仓库完成标准要求的是 typecheck、test、build，本轮也已额外执行联网 smoke；便携包生成不属于本次重构验收范围。

## 剩余风险

1. **公司行动与自动停复牌仍是东方财富单点。** 失败会保留旧证据或报错，不会伪装成“无事件”，但尚缺第二个同语义自动核验源。
2. **腾讯、新浪、东方财富接口均为未版本化网页后端。** 当前解析和完整性门禁能阻止一部分静默错误，不能承诺可用性；发布候选必须重新跑 smoke。
3. **现有 smoke 有覆盖盲区。** 它未真实请求三家交易所的完整股票目录，也未覆盖东方财富公司行动和停复牌端点；这些路径目前主要依赖 fixture/contract tests。
4. **交易日历长历史不完整。** 2024—2026 为 official；15 年回测中的 2011—2023会明确标记为 `research`。2027 仍为 `pending_official_schedule`，正式安排发布后需更新打包 JSON，Schema 版本仍保持 1。
5. **Renderer 产物偏大。** 本次构建中 Backtest 页面 chunk 约 2.59 MB（未压缩），另有约 1 MB 级 chunk；不影响正确性，但后续可按 Excel/ECharts 边界继续延迟加载。
