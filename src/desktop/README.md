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
| 数据库 | SQLite（better-sqlite3，WAL，持久化到 userData） |
| 测试 | Vitest |

产品不 import、执行或读取 `labs/`、`research/`。Lab 01 的研究结论在产品域重新实现；产品测试使用 `tests/fixtures/` 内自有验收向量。

## 开发命令

从本目录运行：

```powershell
# 需要 Node.js 22 或更高版本
# 中国大陆网络如需 Electron 镜像，可在当前终端设置：
# $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
npm run dev
npm run typecheck
npm test
npm run build
# 生成 release/攒股收息-<版本>-portable-x64.exe
npm run pack:portable
```

`npm run dev:renderer` 只适合检查纯前端渲染；业务操作需要 Electron preload 和 main 进程。

## 已实现的 R1 能力

- 沪深京全 A 股代码/名称检索（交易所公开列表、本地完整快照），单标的或最多
  10 标的同条件并排；
- 每次点击创建一份不可变回测试验，相同参数重跑也保留独立历史记录；
- 历史回测分“运行回测 / 历史结果”，当前对比只展示同一次实验的标的；
- 退出后恢复上次标的、参数、图表选项和当前实验；首次读取失败时暂停自动保存，可重试或明确进入默认工作区；
- 活动实验失效时明确提示并清除工作区引用；历史页明确展示最近 500 次实验；
- 导出包含对比汇总和逐项明细 sheet 的 XLSX；
- 固定金额、上市前月份不积压、上市后指定日可跨月顺延且不占用下月投入、零碎股、费用 0、分红回购、送股/转增；
- 公司行动按方案身份去重并选择最终实施版本；配股只报告、不参与，除权后价格影响仍计入回测；真实响应 fixture 覆盖现金分红、转增和配股字段；
- 外部响应结构、错误码、限流和年度异常缺口严格校验；全部标的数据、实验与共享行情缓存原子提交；
- 七项回测指标、前复权真实 OHLCV K 线、收益率/最大回撤曲线、逐笔记录、数据来源和截止日；
- 持仓明细只读页：当前持仓、成本、估值、累计收益、组合/标的区间表现与详情抽屉；
- 交易流水只读页：日期、类型、资产、标的和备注筛选，领域汇总、分页、冲正状态、详情与 XLSX 导出；
- 收益日历只读页：月度、累计、年内收益，价格/分红日度归因、标的贡献与流水跳转；
- `loading / empty / stale / partial / error` 明确区分；缺行情不以成本价冒充市值；
- 实盘页面不提供账户切换、录入交易或导入流水；
- 本地 SQLite、JSON 备份恢复、脱敏日志导出；
- 明确不连接券商、不执行交易。
