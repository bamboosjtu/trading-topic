# 测试分层

测试与产品源码同域，运行时不读取或执行 `labs/`、`research/`。各层由
`vitest.config.mts` 显式编组：

| 层 | 目录或命名 | 职责 | 是否进入 `npm test` |
| --- | --- | --- | --- |
| unit | `electron/domain/**/*.test.ts`、`shared/**/*.test.ts`、Renderer 纯模型测试、`*.unit.test.ts` | 纯计算、领域规则、格式化与小型策略函数 | 是 |
| contract | `electron/data/**/*.test.ts`，排除 `*.smoke.test.ts` | 外部响应解析、来源切换、错误与完整性契约；网络均应 mock | 是 |
| integration | `electron/services/`、`electron/storage/`、`electron/export/` 下普通测试 | SQLite、事务、服务编排、备份恢复与工作簿 | 是 |
| smoke | `electron/data/**/*.smoke.test.ts` | 受控真实联网验证与证据落盘 | 否，单独运行 |

常用命令：

```powershell
npm test
npm run test:unit
npm run test:contract
npm run test:integration
npm run smoke:market-data
```

测试选择原则：

- 纯规则优先在 unit 层形成最小输入/输出断言；
- contract 层只验证应用声明的数据源契约，不验证第三方实现细节；
- integration 层覆盖跨模块边界和事务，不重复穷举 unit 层分支；
- smoke 层允许联网，但必须显式触发并保留 `artifacts/market-data-smoke.json`；
- 日期相关测试使用固定时钟或已结束区间，不让断言随自然日过期。
