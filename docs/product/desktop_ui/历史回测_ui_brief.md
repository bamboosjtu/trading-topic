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
  └─ 列：标的 / 累计投入 / 最终资产 / 累计盈亏 / XIRR / 最大回撤 / 累计分红 / 期末现金
明细抽屉（Drawer，宽度 1152px）
  ├─ 指标带：实际区间 / 交易记录数 / 告警数
  ├─ 告警标签
  ├─ Tabs：简化明细（默认）| 实际交易
  │   ├─ 简化明细表（simulateBacktestSimple）
  │   └─ 实际交易表（simulateBacktest transactions）
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

口径说明（参数带底部）：不复权收盘价 · 非交易日顺延 · 100 股整数倍 · 佣金万 2.5 最低 5 元 · 分红税前口径并回购原标的。

## 3. 同条件比较表

点击任意行打开明细抽屉。列定义：

| 列 | 取值 | 格式 |
| --- | --- | --- |
| 标的 | name + symbol | 文本 |
| 累计投入 | `metrics.totalContribution` | 货币 |
| 最终资产 | `metrics.endingAsset` | 货币 |
| 累计盈亏 | `metrics.totalPnl` | 货币（涨绿跌红） |
| XIRR | `metrics.xirr` | 百分比 |
| 最大回撤 | `metrics.maxDrawdown` | 百分比 |
| 累计分红 | `metrics.totalDividend` | 货币 |
| 期末现金 | `metrics.endingCash` | 货币 |

## 4. 明细抽屉（Drawer）

- 宽度：1152px（适配 10 列表格，避免横向滚动）
- 打开方式：点击同条件比较表行
- 布局：指标带 → 告警标签 → Tabs → 数据来源

### 4.1 简化明细 Tab（默认）

基于 `simulateBacktestSimple`，提供面向阅读的简化视图。

**口径**：

| 维度 | 实际回测 | 简化视图 |
| --- | --- | --- |
| 股数 | 100 股整数倍 | 零碎股，2 位小数 |
| 手续费 | 万 2.5 最低 5 元 | 0（不纳入成本） |
| 资金投入与买入 | 分两笔 | 合并为一行 buy |
| 分红 | 进入分红池回购 | 现金到账，不再投资 |
| 除权日 | 隐式体现 | 独立 ex_right 信息行 |
| 收益口径 | XIRR、最大回撤 | 累计盈亏率 = (收盘价 × 累计股数 + 期末现金) / 累计投入 − 1 |

**事件类型**：`buy` / `dividend` / `ex_right`，同日顺序 `ex_right → dividend → buy`。

**列定义**：

| 列 | 宽 | 排序 | 筛选 | 说明 |
| --- | --- | --- | --- | --- |
| 日期 | 110 | ✓ | 按年 | |
| 事件 | 90 | ✓ | 按类型 | buy / dividend / ex_right |
| 期初现金 | 110 | ✓ | | buy 行 = dcaCash + 本期投入（不含分红池） |
| 收盘价 | 90 | ✓ | | 当日不复权收盘价 |
| 本期买入 | 100 | ✓ | | buy 行的零碎股数 |
| 累计股数 | 100 | ✓ | | |
| 累计投入 | 110 | ✓ | | |
| 期末现金 | 110 | ✓ | | = dcaCash + dividendCash |
| 盈亏率 | 100 | ✓ | | 百分比 |
| 金额/分红 | 110 | ✓ | | buy 行为投入金额，dividend 行为分红金额 |

`ex_right` 行额外展示 `prevClose → price` 价格变化；`dividend` 行的金额列展示分红到账总额。

**分页**：固定每页 20 条，`showSizeChanger: false`。

**现金池隔离**（修复分红重复计入 bug）：

- `dcaCash`（定投池）与 `dividendCash`（分红池）分离
- `buy` 行期初现金 = `dcaCash + 本期投入`（不含分红池）→ 始终为月度投入金额
- `buy` 行期末现金 = `dcaCash + dividendCash`（反映账户实际现金余额）
- 由于零碎股全额消耗本期投入，`dcaCash` 始终为 0；`dividendCash` 累积历次分红
- `dividend` 行期初/期末现金均包含 `dcaCash + dividendCash`

### 4.2 实际交易 Tab

基于 `simulateBacktest` 的 `transactions`，展示含费用的实际交易流水。

**列定义**：

| 列 | 宽 | 排序 | 筛选 | 说明 |
| --- | --- | --- | --- | --- |
| 日期 | 110 | ✓ | 按年 | |
| 类型 | 120 | ✓ | 按类型 | buy / sell / dividend_reinvest / repo_interest 等 |
| 数量 | 80 | ✓ | | 100 股整数倍 |
| 价格 | 80 | ✓ | | |
| 金额 | 110 | ✓ | | |
| 费用 | 90 | ✓ | | 佣金 |
| 现金 | 110 | ✓ | | 交易后现金余额 |

**分页**：固定每页 20 条，`showSizeChanger: false`。

## 5. 回测明细列表（同条件比较，研究对齐）

`simulateBacktestDetail` 在 `simulateBacktest` 之上提供理论持仓曲线视图，用于与研究端同条件对比。

| 维度 | `simulateBacktest`（实际回测） | `simulateBacktestDetail`（明细列表） |
| --- | --- | --- |
| 股数 | 100 股整数倍 | 零碎股，保留 2 位小数 |
| 手续费 | 万 2.5 最低 5 元 | 无（纯理论曲线） |
| 现金结转 | 有（dcaCash / dividendCash 隔离） | 无（分红全额再投资，不留现金） |
| 逆回购 | `repoRate > 0` 时计息 | 不计息 |
| 分红处理 | 进入分红池，不足一手结转 | 当日全额按除权后价格买入零碎股 |
| 收益口径 | XIRR、最大回撤（基于 nav） | 累计收益率 = 期末市值 / 累计投入 − 1 |

**后复权总收益口径**：采用"不复权价格 + 显式分红再投资"模型，数学上等价于后复权总收益——除权日分红按除权后价格全额买入零碎股，持仓市值在除权日保持连续。除权日处理顺序：先用除权前持仓计算分红并再投资，再处理当月定投买入。

每行输出：日期、事件类型（`monthly_buy` / `dividend_reinvest`）、当次买入股数、累计股数、当日不复权收盘价、当次投入金额、累计投入、累计分红再投资股数、当日持仓市值、累计盈亏；分红再投资行额外输出每股分红与分红金额。

## 6. 数据来源展示

抽屉底部展示 provenance：来源名 · 数据截止日 · 获取时间。每个标的独立记录。

## 7. 视觉风格

- 墨蓝导航、雾白工作区、暖金单一强调色
- 信息层级依赖排版、留白和分隔线，避免卡片拼贴
- 动效仅用于页面进入、数据行反馈和图表更新
- 数值列使用 `tabular-nums` 等宽数字字体
