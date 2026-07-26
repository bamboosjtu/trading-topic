# 历史回测 Tab 设计简述

> 所属文档：[PRD_R1.md](../PRD_R1.md) §3.1 / §4
>
> 架构约束：[ARCHITECTURE.md](../ARCHITECTURE.md)
>
> 实现代码：`src/desktop/electron/domain/analysis.ts`、`src/desktop/renderer/src/pages/BacktestPage.tsx`

## 1. 页面结构

```text
参数带（Form）
  ├─ A 股标的（多选，最多 4 个）
  ├─ 开始日期 / 结束日期
  ├─ 每月投入 / 指定买入日
  └─ 开始回测按钮
资产曲线（ECharts 折线图）
  └─ X 轴：日期；Y 轴：资产（万元）；多条线对应多标的
同条件比较（Table）
  └─ 列：标的 / 累计外部投入 / 最终资产 / 累计盈亏 / XIRR / 最大回撤 / 累计分红 / 期末现金
明细抽屉（Drawer，宽度 1152px）
  ├─ 指标带：实际区间 / 明细行数 / 累计外部投入 / 累计买入金额 / 当前盈亏率
  ├─ Tabs：R1 回测明细（默认）| 原始交易流水
  │   ├─ 审计明细表（由 simulateBacktest transactions 转换）
  │   └─ 原始交易表（simulateBacktest transactions）
  └─ 数据来源（provenance）
```

## 2. 参数带

| 字段 | 控件 | 约束 |
| --- | --- | --- |
| A 股标的 | `Select mode="tags" maxCount={4}` | 6 位代码，预设 7 只银行股 |
| 开始日期 | `Input type="date"` | 默认近 5 年 |
| 结束日期 | `Input type="date"` | 默认今天 |
| 每月投入 | `InputNumber` | min=100，step=500，默认 3000 |
| 指定买入日 | `InputNumber` | 1–28，默认 1 |

快捷区间：近 3 年 / 近 5 年 / 近 10 年，点击后自动填充开始与结束日期。

口径说明（参数带底部）：不复权收盘价 · 非交易日顺延 · 允许零碎股 ·
费用 0 元 · 现金分红自动回购 · 送股/转增按除权日入账。

## 3. 同条件比较表

点击任意行打开明细抽屉。列定义：

| 列 | 取值 | 格式 |
| --- | --- | --- |
| 标的 | name + symbol | 文本 |
| 累计外部投入 | `metrics.totalContribution` | 货币 |
| 最终资产 | `metrics.endingAsset` | 货币 |
| 累计盈亏 | `metrics.totalPnl` | 货币（涨绿跌红） |
| XIRR | `metrics.xirr` | 百分比 |
| 最大回撤 | `metrics.maxDrawdown` | 百分比 |
| 累计分红 | `metrics.totalDividend` | 货币 |
| 期末现金 | `metrics.endingCash` | 货币 |

## 4. 明细抽屉（Drawer）

- 宽度：1152px；审计字段完整，表格允许水平滚动
- 打开方式：点击同条件比较表行
- 布局：指标带 → 告警标签 → Tabs → 数据来源

### 4.1 R1 回测明细 Tab（默认）

`simulateBacktestSimple` 不再独立计算，而是把 `simulateBacktest` 的原始交易流水
转换成面向阅读的审计行。主指标、资产曲线与明细因此共享同一事实来源。

**事件类型**：

- `buy`：月度定投买入；
- `dividend`：现金分红到账；
- `dividend_reinvest`：分红资金回购原标的；
- `share_adjustment`：送股/转增入账。

同日顺序为送转入账 → 分红到账 → 分红回购 → 定投买入。现金分红的除息价格
变化不再伪装成“不改变股数的除权调整”行。

**列定义**：

| 列 | 宽 | 排序 | 筛选 | 说明 |
| --- | --- | --- | --- | --- |
| 日期 | 110 | ✓ | 按年 | |
| 事件 | 90 | ✓ | 按类型 | buy / dividend / dividend_reinvest / share_adjustment |
| 期初现金 | 110 | ✓ | | 本事件发生前现金 |
| 收盘价 | 90 | ✓ | | 当日不复权收盘价 |
| 本次新增股数 | 120 | ✓ | | 买入、分红回购或送转增加的股数 |
| 累计股数 | 100 | ✓ | | |
| 本期外部投入 | 120 | ✓ | | 仅定投买入行大于 0 |
| 发生金额 | 120 | | | 成交金额、分红金额或每 10 股送转比例 |
| 累计外部投入 | 125 | ✓ | | 用于 XIRR 与盈亏率分母 |
| 累计买入金额 | 125 | ✓ | | 定投买入 + 分红回购成交金额 |
| 期末现金 | 110 | ✓ | | = dcaCash + dividendCash |
| 盈亏率 | 100 | ✓ | | 百分比 |

**分页**：固定每页 20 条，`showSizeChanger: false`。

现金分红到账行先增加现金，紧随其后的分红回购行全额消耗该笔分红并增加零碎股。
送股/转增不产生现金或买入金额，只改变股数。

### 4.2 原始交易流水 Tab

基于 `simulateBacktest` 的 `transactions`，展示计算引擎的原始事件流水。

**列定义**：

| 列 | 宽 | 排序 | 筛选 | 说明 |
| --- | --- | --- | --- | --- |
| 日期 | 110 | ✓ | 按年 | |
| 类型 | 120 | ✓ | 按类型 | contribution / buy / dividend / dividend_reinvest / share_adjustment |
| 数量 | 80 | ✓ | | 零碎股内部精度 |
| 价格 | 80 | ✓ | | |
| 金额 | 110 | ✓ | | |
| 费用 | 90 | ✓ | | R1 固定为 0 |
| 现金 | 110 | ✓ | | 交易后现金余额 |

**分页**：固定每页 20 条，`showSizeChanger: false`。

## 5. 计算与展示一致性

- `simulateBacktest` 是 R1 唯一计算事实来源；
- `simulateBacktestSimple` 只负责把原始交易转换为抽屉表格，不重新模拟；
- 费用为 0，定投资金与分红资金均可全额买入零碎股；
- 现金分红按登记日持股计算，到账后立即回购；
- 送股/转增按每 10 股比例计算新增股数，在除权日入账；
- 累计外部投入与累计买入金额必须同时展示，禁止使用含义不明的“金额/分红”列。

## 6. 数据来源展示

抽屉底部展示 provenance：来源名 · 数据截止日 · 获取时间。每个标的独立记录。

## 7. 视觉风格

- 墨蓝导航、雾白工作区、暖金单一强调色
- 信息层级依赖排版、留白和分隔线，避免卡片拼贴
- 动效仅用于页面进入、数据行反馈和图表更新
- 数值列使用 `tabular-nums` 等宽数字字体
