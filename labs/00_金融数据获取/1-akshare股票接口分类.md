# AKShare股票数据接口

>  目前的 AKShare 文档结构偏向于**数据功能模块**的并列展示（例如“股票质押”和“商誉”作为独立专题），但实际需要的是一套**投资策略开发的工作流**。

按照投资研究分析的逻辑来组织接口，比单纯按“数据源”或“数据板块”分类更能提高研究效率。从**静态数据**（主数据、报表）到**动态行为**（资金流、盘口）再到**定性分析**（研报资讯）的层层递进，符合从“选股”到“择时”再到“风险监控”的实操流程。

基于提供的(https://akshare.akfamily.xyz/data/stock/stock.html)，我们可以将 AKShare 的现有接口重新归纳为面向投资研究的分类体系中：

```text
定义股票池
→ 观察价格和估值
→ 研究公司基本面
→ 识别公司事件
→ 分析行业环境
→ 关注新股发行
→ 观察资金与交易行为
→ 阅读研报、新闻和市场情绪
```

## 1. 股票池与主数据：universe
这是研究的起点，用于定义“选股空间”。包括：股票代码、名称、交易所、上市退市、风险警示、曾用名、行业归属、板块成分。

> 市场中有哪些股票，这只股票属于什么范围？

*   **基础名单**：A 股列表（`stock_info_a_code_name`）、沪深京各交易所股票（`stock_info_sh_name_code` 等）。
*   **状态过滤**：终止/暂停上市名单（`stock_info_sz_delist`）、曾用名变动（`stock_info_change_name`）。

## 2. 行情与估值：market
涵盖A股、港股、美股的所有定价相关的静态与动态数据。包括：市场总貌；实时行情；日线、周线、月线；分钟行情；逐笔成交；盘口；PE、PB、股息率；停复牌。

> 股票现在多少钱，过去怎么走，目前贵不贵，能不能交易？

*   **市场总貌 (Market Overview)**：交易所每日概况（`stock_sse_summary`, `stock_sse_deal_daily`）、深交所证券类别统计（`stock_szse_summary`）。
*   **行情报价 (Quotes)**：实时行情（`stock_zh_a_spot_em`）、历史日线（`stock_zh_a_hist`）、分时与逐笔成交（`stock_intraday_em`）、盘前行情（`stock_zh_a_hist_pre_min_em`）。
*   **估值数据 (Valuation)**：个股估值快照（`stock_value_em`）、A股/港股/美股估值指标（`stock_zh_valuation_baidu` 等）。
*   **交易状态 (Trading Status)**：**停复牌信息**（`stock_tfp_em`）、百度股市通交易提醒（`news_trade_notify_suspend_baidu`）。

## 3. 公司与财务基本面：fundamentals

覆盖公司所有经营数据，包括：公司资料；A股、港股、美股财务报表；财务指标；主营业务；股东持仓；盈利预测；商誉；ESG。

> 公司做什么业务，赚了多少钱，财务质量怎么样？

*   **财务报表**：三大报表（`stock_zcfz_em`, `stock_lrb_em`, `stock_xjll_em`）、已退市公司报表（`stock_balance_sheet_by_report_delisted_em`）。
*   **分析指标**：财务对比（`stock_zh_dupont_comparison_em`）、主要财务指标（`stock_financial_analysis_indicator_em`）。
*   **业务画像**：主营介绍与构成（`stock_zyjs_ths`, `stock_zygc_em`）。
*   股东和机构持仓
*   盈利预测
*   ESG 与非财务评价

## 4. 公司行为与股权事件：corporate_events
涵盖了除基本面经营外的所有权益和控制关系变化，包括：分红送转；股本变化；增发、配股；回购；限售解禁；股权质押；高管增减持；一致行动人；股东大会。

> 有哪些会改变股东权益、股本结构或控制关系的事件？

*   **分红派息**：分红配送详情（`stock_fhps_em`）、历史分红统计（`stock_dividend_cninfo`）。
*   **股本变动**：股本结构（`stock_zh_a_gbjg_em`）、**限售解禁**（`stock_restricted_release_detail_em`）、增发与配股实施（`stock_qbzf_em`, `stock_pg_em`）、股份回购（`stock_repurchase_em`）。
*   **股权与治理**：**董监高持股变动**（`stock_hold_management_detail_em`）、**股权质押**（`stock_gpzy_pledge_ratio_em`）、一致行动人（`stock_yzxdr_em`）、股东大会提案（`stock_gddh_em`）。

## 5. 行业、概念与市场结构：sector
覆盖所有所有行业、概念和市场宽度数据，包括：行业分类；概念分类；板块成分；板块行情；行业估值；行业资金流；同行业公司比较；创新高、创新低；破净数量；涨跌家数。

> 市场当前由哪些行业和概念驱动，整体市场强弱如何？

*   **板块行情**：行业/概念板块实时行情（`stock_board_industry_name_em`）、板块指数日线（`stock_board_concept_hist_em`）。
*   **行业属性**：行业估值与市盈率（`stock_industry_pe_ratio_cninfo`）、板块成份股查询（`stock_board_concept_cons_em`）。
*   **市场宽度**：**创新高/低数量统计**（`stock_a_high_low_statistics`）、破净股统计（`stock_a_below_net_asset_statistics`）。

## 6. 一级市场 IPO：primary_market

覆盖所有所有上市前及新股发行数据，包括：IPO辅导；申报；审核；注册；招股书；发行；申购；中签；上市首日表现。

> 公司如何进入资本市场，新股如何发行和定价？

*   **审核流程**：IPO审核状态（`stock_register_all_em`）、首发申报信息（`stock_ipo_declare_em`）。
*   **发行上市**：新股发行详情（`stock_ipo_info`）、申购与中签（`stock_xgsglb_em`）、首日表现（`stock_xgsr_ths`）。

## 7. 资金与交易行为：flows_events
覆盖所有成交资金和交易行为，包括：个股资金流；行业资金流；沪深港通；融资融券；龙虎榜；大宗交易；筹码分布；涨停、跌停；盘口异动；技术形态排名。

> 哪些资金正在买卖，市场交易行为有没有异常？

*   **资金流向**：个股/行业资金流排名（`stock_individual_fund_flow_rank`）、沪深港通持股（`stock_hsgt_hold_stock_em`）。
*   **博弈行为**：**龙虎榜详情**（`stock_lhb_detail_em`）、筹码分布（`stock_cyq_em`）。
*   **交易异动**：**盘口异动**（`stock_changes_em`）、板块异动详情（`stock_board_change_em`）、大宗交易明细（`stock_dzjy_mrmx`）。

## 8. 研报、公告、资讯与市场情绪：research_sentiment

覆盖所有市场评价，包括：研报；分析师排名；公司公告；机构调研；投资者互动；新闻；财经快讯；千股千评；热度排名；涨跌投票；市场情绪。

> 市场如何理解公司，目前的关注度和情绪怎样？

*   **定性分析**：个股研报（`stock_research_report_em`）、分析师指数（`stock_analyst_rank_em`）。
*   **资讯与评价**：个股新闻（`stock_news_em`）、千股千评（`stock_comment_em`）、机构调研统计（`stock_jgdy_tj_em`）。
*   **市场情绪**：**涨跌投票**（`stock_zh_vote_baidu`）、**热门关键词与热度**（`stock_hot_keyword_em`, `stock_hot_rank_em`）、赚钱效应分析（`stock_market_activity_legu`）。

## 说明

- 接口目录：这个接口是什么
- 健康快照：这个接口现在能不能运行
- 差异报告：与上一次相比发生了什么

```text
labs/00_金融数据获取/
├── akshare_health_check.py
├── akshare_health_compare.py
├── akshare_stock_api.xlsx       # 人工分类目录
├── akshare_api.md               # 渐进式学习文档
└── health/
    ├── latest.json
    ├── latest.xlsx
    ├── runs/
    └── compare/
```

