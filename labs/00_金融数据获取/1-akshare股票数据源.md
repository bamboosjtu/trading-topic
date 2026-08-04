# AKShare股票数据源

>  建议不要照搬 AKShare 现有文档结构，也不要直接复制 `a-stock-data` 的十层，面向投资研究的需求，重新按照7个领域进行组织。

## 1. `universe`：证券主数据与股票池

回答“市场里有哪些股票”。

包括：

- 股票代码与名称
- 交易所、市场板块
- 上市日期、退市日期
- ST、科创板、创业板、北交所标记
- 行业分类
- 指数、行业、概念成分股
- 自定义股票池

接口：

```text
stock_info_sh_name_code
stock_info_sz_name_code
stock_info_bj_name_code
stock_board_industry_cons_em
```

注意：行业成分属于股票池构建，但行业本身的行情和排名放在 `sector`。

------

## 2. `market`：行情与估值快照

回答“价格发生了什么”。

子类建议：

```text
market/
├── snapshot       实时行情、盘口
├── daily          日线
├── intraday       分钟线、分时
├── valuation      PE、PB、市值、股息率
├── adjustment     复权因子
└── trading_calendar
```

接口：

```text
stock_zh_a_hist_tx
stock_zh_a_daily
stock_zh_a_hist
stock_sse_summary
tencent_quote
```

注意： `_em`、`_tx`、`_sina` 是不同来源的类似功能实现。

------

## 3. `fundamentals`：公司与财务基本面

回答“这家公司经营得怎么样”。

子类：

```text
fundamentals/
├── company_profile
├── financial_statements
├── financial_indicators
├── business_segments
├── shareholders
└── forecasts
```

接口：

```text
stock_financial_abstract
stock_financial_report_sina
stock_individual_info_em
ths_eps_forecast
```

其中“一致预期”既可以放在研报，也可以放在基本面。建议：

- 原始机构预测记录：`research_disclosure`
- 聚合后的 EPS、净利润一致预期：`fundamentals/forecasts`

------

## 4. `corporate_actions`：公司行为与股本事件

回答“持有人的权益发生了什么”。

包括：

```text
corporate_actions/
├── dividend
├── split_and_bonus
├── rights_issue
├── issuance
├── repurchase
├── unlock
├── pledge
└── capital_change
```

接口：

```text
stock_history_dividend_detail
stock_fhps_detail_em
```

分红必须从基本面中独立出来，因为它直接影响复权、持仓数量和回测现金流。

------

## 5. `sector`：行业、概念与市场结构

回答“公司处于哪个行业，行业整体表现如何”。

子类：

```text
sector/
├── classification
├── constituents
├── quotes
├── history
├── valuation
├── fund_flow
└── industry_metrics
```

包含：

- 申万、中证、证监会、东方财富行业分类
- 概念板块
- 板块成分
- 板块行情
- 板块资金流
- 行业价格、产量、库存等中观数据

这里要区分：

```text
universe：构建某行业股票池
sector：研究某行业整体行情、估值和基本面
```

------

## 6. `flows_events`：资金、交易行为与市场事件

回答“资金和交易行为发生了什么”。

子类：

```text
flows_events/
├── fund_flow
├── margin
├── northbound
├── block_trade
├── unusual_trade
├── limit_up
├── unlock
└── sentiment
```

类似 `a-stock-data` 中的资金面、信号层和打板层，但不必拆成三个顶层。其十层设计中，这几部分的数据语义存在明显重叠。

例如：

- 龙虎榜是交易事件
- 涨停池是交易事件
- 主力资金流是交易行为
- 北向资金是资金行为

它们都可以放在同一个稳定领域下。

------

## 7. `research_disclosure`：研报、公告与资讯

回答“外部世界如何解释这家公司”。

子类：

```text
research_disclosure/
├── research_reports
├── announcements
├── news
├── investor_relations
├── analyst_forecasts
└── policy_and_industry_news
```

接口：

```text
eastmoney_latest_reports
stock_research_report_em
eastmoney_industry_reports
stock_institute_recommend_detail
stock_news_em
stock_notice_report
cninfo_announcements
cls_telegraph
iwencai.*
```

在同一领域中可标记可信度：

```text
official_disclosure   公告、交易所问询、公司回复
institution_research  券商研报
professional_media    财联社、证券时报
aggregated_news       东方财富新闻聚合
```

公告不能和普通新闻视为同等信源。