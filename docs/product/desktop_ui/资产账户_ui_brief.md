# 资产账户 Tab 设计简述

> 所属文档：[PRD_R1.md](../PRD_R1.md) §3.2 / §4
>
> 架构约束：[ARCHITECTURE.md](../ARCHITECTURE.md)
>
> 实现代码：`src/desktop/electron/domain/ledger.ts`、`src/desktop/renderer/src/pages/AccountPage.tsx`

## 1. 页面结构

```text
页头
  ├─ 标题：资产账户
  └─ 标签：估值截止日期 / 暂无估值行情
指标带（5 列 grid）
  └─ 总资产 / 持仓市值 / 可用现金 / 累计盈亏 / XIRR
持仓表（Table）
  └─ 列：股票代码 / 持仓数量 / 平均成本 / 最新价格 / 持仓市值 / 持仓盈亏
页脚口径说明
```

## 2. 指标带

5 列等宽布局，使用 `tabular-nums` 等宽数字。

| 指标 | 取值 | 格式 |
| --- | --- | --- |
| 总资产 | `totalAsset` | 货币 |
| 持仓市值 | `marketValue` | 货币 |
| 可用现金 | `availableCash` | 货币 |
| 累计盈亏 | `totalPnl` | 货币 |
| XIRR | `xirr` | 百分比，null 显示"不可计算" |

## 3. 持仓表

| 列 | 取值 | 格式 |
| --- | --- | --- |
| 股票代码 | `symbol` | 文本 |
| 持仓数量 | `quantity` | 整数 |
| 平均成本 | `averageCost` | 货币 |
| 最新价格 | `lastPrice` | 货币，无数据显示"—" |
| 持仓市值 | `marketValue` | 货币 |
| 持仓盈亏 | `pnl` | 货币（涨绿跌红） |

- 表头右侧显示估值来源（`valuationSource`）
- 空数据显示"暂无有效买入流水"
- 无分页（持仓数量通常很少）

## 4. 口径说明

页脚显示：总资产 = 持仓市值 + 可用现金 + 未到期逆回购资产（显示当前金额）。

所有余额从有效流水重建，不维护可手工修改的持仓副本。估值使用最新行情快照，显示数据截止时间。

## 5. 数据刷新

- 进入页面时通过 `api.accountSummary` 拉取
- 流水页新增/冲正后自动刷新（`invalidateQueries({ queryKey: ["account"] })`）
