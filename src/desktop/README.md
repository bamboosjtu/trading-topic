# 攒股收息 R1 桌面应用

R1 是纯 Node.js/TypeScript 的本地 Electron 应用。范围见
[PRD_R1.md](../../docs/product/PRD_R1.md)，进程与隔离边界见
[ARCHITECTURE.md](../../docs/product/ARCHITECTURE.md)。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Electron + electron-vite |
| 前端 | React 18 + TypeScript + Ant Design + Tailwind CSS |
| 状态与请求 | TanStack Query |
| 图表 | ECharts |
| 本地服务 | Electron main + 受限 IPC |
| 数据库 | SQLite（sql.js，持久化到 userData） |
| 测试 | Vitest |

产品不 import、执行或读取 `labs/`、`research/`。Lab 01 的研究结论在产品域重新实现；产品测试使用 `tests/fixtures/` 内自有验收向量。

## 开发命令

从本目录运行：

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev:renderer` 只适合检查纯前端渲染；业务操作需要 Electron preload 和 main 进程。

## 已实现的 R1 能力

- A 股不复权日线回测，单标的或最多 4 标的同条件并排；
- 固定金额、指定日顺延、整数手、现金结转、简化费用、分红回购；
- 七项回测指标、资产曲线、逐笔记录、数据来源和截止日；
- 六类业务流水录入与追加式冲正/修正流程；
- 持仓、现金、总资产、累计盈亏和 XIRR 重建；
- 本地 SQLite、JSON 备份恢复、脱敏日志导出；
- 明确不连接券商、不执行交易。
