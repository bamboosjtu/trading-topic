# AkShare 股票接口可用性

> 接口总数:**385** 个  |  接口可调用:**198** 个  |  当前可用:**188** 个  |  过期:**10** 个  |  不可用:**187** 个
>
> 本文档由 `akshare_health_check.py` 自动生成；“接口可调用”只表示函数未抛错，“当前可用”还要求返回值未超过按子类设定的更新窗口；分类优先参考返回字段语义，再按 `1-akshare股票数据源.md` 的 7 个投资研究领域组织；下列表格仅列当前可用接口。
> 例如 `stock_sse_summary` 返回 `项目/股票/主板/科创板/报告时间`，表示交易所市场总体情况，因此归入 `market`，不是单只股票行情。
>
> 数据源: https://akshare.akfamily.xyz/data/stock/stock.html

---

## 一、universe：证券主数据与股票池

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `constituents` | **板块成份详情**, 部分行业数量大于统计数 | `stock_sector_detail` | 新浪/经济通 | sector |
| 2 | `listing_status` | 股票曾用名-新浪 | `stock_info_change_name` | 新浪 | symbol |
| 3 | `listing_status` | 上海证券交易所暂停/终止上市股票 | `stock_info_sh_delist` | 未识别 | symbol |
| 4 | `listing_status` | 深证证券交易所终止/暂停上市股票 | `stock_info_sz_delist` | 未识别 | symbol |
| 5 | `listing_status` | 深证证券交易所股票名称变更 | `stock_info_sz_change_name` | 未识别 | symbol |
| 6 | `security_master` | **沪深京A股股票代码和简称数据** | `stock_info_a_code_name` | 未识别 | null |
| 7 | `security_master` | 北京证券交易所股票代码和简称数据 | `stock_info_bj_name_code` | 北交所 | null |
| 8 | `security_master` | 上海证券交易所股票代码和简称数据 | `stock_info_sh_name_code` | 未识别 | symbol |
| 9 | `security_master` | 深证证券交易所股票代码和股票简称数据 | `stock_info_sz_name_code` | 未识别 | symbol |
| 10 | `security_master` | A+H 上市公司的代码和名称 | `stock_zh_ah_name` | 腾讯 | null |

## 二、market：行情与估值快照

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `daily` | 上海证券交易所每日股票情况 | `stock_sse_deal_daily` | 上交所 | date |
| 2 | `daily` | **A股历史行情数据-新浪**; | `stock_zh_a_daily` | 未识别 | symbol, start_date, end_date, adjust, timeout |
| 3 | `daily` | **A股历史行情数据-腾讯** | `stock_zh_a_hist_tx` | 腾讯 | symbol, start_date, end_date, adjust, timeout |
| 4 | `snapshot` | **A股实时行情数据-新浪**, 重复运行本函数会被新浪暂时封 IP, 建议增加时间间隔 | `stock_zh_a_spot` | 新浪 | null |
| 5 | `snapshot` | 港股实时行情数据-新浪 | `stock_hk_spot` | 新浪 | null |
| 6 | `snapshot` | 科创板实时行情数据-新浪 | `stock_zh_kcb_spot` | 新浪 | null |
| 7 | `snapshot` | A股新股实时行情数据-东方财富 | `stock_new_a_spot_em` | 东方财富 | null |
| 8 | `snapshot` | A股次新股实时行情数据-新浪 | `stock_zh_a_new` | 新浪 | null |
| 9 | `snapshot` | A+H股实时行情数据-腾讯 | `stock_zh_ah_spot` | 腾讯 | null |
| 10 | `snapshot` | B股实时行情数据-新浪 | `stock_zh_b_spot` | 新浪 |  |
| 11 | `snapshot` | 上海证券交易所-股票数据总貌 | `stock_sse_summary` | 上交所 | null |
| 12 | `snapshot` | 深圳证券交易所-市场总貌-地区交易排序 | `stock_szse_area_summary` | 深交所 | date |
| 13 | `snapshot` | 深圳证券交易所-市场总貌-证券类别统计 | `stock_szse_summary` | 深交所 | date |
| 14 | `valuation` | A股破净股统计数据 | `stock_a_below_net_asset_statistics` | 上交所/经济通 | symbol |
| 15 | `valuation` | 指数市净率 | `stock_index_pb_lg` | 乐估乐股 | symbol |
| 16 | `valuation` | 指数市盈率 | `stock_index_pe_lg` | 乐估乐股 | symbol |
| 17 | `valuation` | 主板市净率 | `stock_market_pb_lg` | 乐估乐股/经济通 | symbol |
| 18 | `valuation` | 主板市盈率 | `stock_market_pe_lg` | 乐估乐股/经济通 | symbol |
| 19 | `valuation` | 估值分析 | `stock_value_em` | 东方财富 | symbol |

## 三、fundamentals：公司与财务基本面

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `business_segments` | 同花顺-主营介绍 | `stock_zyjs_ths` | 同花顺 | symbol |
| 2 | `company_profile` | 巨潮资讯-个股-公司概况 | `stock_profile_cninfo` | 巨潮 | symbol |
| 3 | `financial_indicators` | 新浪财经-财务报表-关键指标 | `stock_financial_abstract` | 新浪 | symbol |
| 4 | `financial_indicators` | 同花顺-财务指标-重要指标；替换 stock_financial_abstract_ths 接口 | `stock_financial_abstract_new_ths` | 同花顺 | symbol, indicator |
| 5 | `financial_indicators` | 新浪财经-财务分析-财务指标 | `stock_financial_analysis_indicator` | 新浪 | symbol, start_year |
| 6 | `financial_indicators` | 东方财富网-数据中心-特色数据-商誉-A股商誉市场概况 | `stock_sy_profile_em` | 东方财富 | null |
| 7 | `financial_statements` | 同花顺-财务指标-利润表；替换 stock_financial_benefit_ths 接口 | `stock_financial_benefit_new_ths` | 同花顺 | symbol, indicator |
| 8 | `financial_statements` | 同花顺-财务指标-现金流量表；替换 stock_financial_cash_ths 接口 | `stock_financial_cash_new_ths` | 同花顺 | symbol, indicator |
| 9 | `financial_statements` | 同花顺-财务指标-资产负债表；替换 stock_financial_debt_ths 接口 | `stock_financial_debt_new_ths` | 同花顺 | symbol, indicator |
| 10 | `financial_statements` | 新浪财经-财务报表-三大报表 | `stock_financial_report_sina` | 新浪 | stock, symbol |
| 11 | `forecasts` | 经济通-公司资料-盈利预测 | `stock_hk_profit_forecast_et` | 经济通 | symbol, indicator |
| 12 | `forecasts` | 同花顺-盈利预测 | `stock_profit_forecast_ths` | 同花顺 | symbol, indicator |
| 13 | `shareholders` | 新浪财经-股东股本-流通股东 | `stock_circulate_stock_holder` | 新浪 | symbol |
| 14 | `shareholders` | 新浪财经-股本股东-基金持股 | `stock_fund_stock_holder` | 新浪 | symbol |
| 15 | `shareholders` | 东方财富网-数据中心-股东分析-股东持股分析-十大流通股东 | `stock_gdfx_free_holding_analyse_em` | 东方财富 | date |
| 16 | `shareholders` | 东方财富网-数据中心-股东分析-股东持股变动统计-十大流通股东 | `stock_gdfx_free_holding_change_em` | 东方财富 | date |
| 17 | `shareholders` | 东方财富网-数据中心-股东分析-股东持股明细-十大流通股东 | `stock_gdfx_free_holding_detail_em` | 东方财富/经济通 | date |
| 18 | `shareholders` | 东方财富网-数据中心-股东分析-股东持股分析-十大股东 | `stock_gdfx_holding_analyse_em` | 东方财富 | date |
| 19 | `shareholders` | 新浪财经-机构持股-机构持股一览表 | `stock_institute_hold` | 新浪 | symbol |
| 20 | `shareholders` | 新浪财经-机构持股-机构持股详情 | `stock_institute_hold_detail` | 新浪/经济通 | stock, quarter |
| 21 | `shareholders` | 新浪财经-股本股东-主要股东 | `stock_main_stock_holder` | 新浪 | stock |
| 22 | `shareholders` | 东方财富网-数据中心-特色数据-股东户数数据 | `stock_zh_a_gdhs` | 未识别 | symbol |
| 23 | `shareholders` | 东方财富网-数据中心-特色数据-股东户数详情 | `stock_zh_a_gdhs_detail_em` | 东方财富/经济通 | symbol |

## 四、corporate_actions：公司行为与股本事件

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `capital_change` | 东方财富网-数据中心-股东大会 | `stock_gddh_em` | 东方财富 | null |
| 2 | `capital_change` | 东方财富网-数据中心-特色数据-高管持股 | `stock_ggcg_em` | 东方财富 | symbol |
| 3 | `capital_change` | 巨潮资讯-数据中心-专题统计-股东股本-股本变动 | `stock_hold_change_cninfo` | 巨潮 | symbol |
| 4 | `capital_change` | 巨潮资讯-数据中心-专题统计-股东股本-高管持股变动明细 | `stock_hold_management_detail_cninfo` | 巨潮/经济通 | symbol |
| 5 | `capital_change` | 东方财富网-数据中心-特色数据-高管持股-董监高及相关人员持股变动明细 | `stock_hold_management_detail_em` | 东方财富/经济通 | null |
| 6 | `capital_change` | 东方财富-A股数据-股本结构 | `stock_zh_a_gbjg_em` | 东方财富/北交所 | symbol |
| 7 | `dividend` | 百度股市通-交易提醒-分红派息 | `news_trade_notify_dividend_baidu` | 百度 | date, cookie |
| 8 | `dividend` | 巨潮资讯-个股-历史分红 | `stock_dividend_cninfo` | 巨潮 | symbol |
| 9 | `dividend` | 东方财富网-数据中心-分红送配-分红送配详情 | `stock_fhps_detail_em` | 东方财富/经济通 | symbol |
| 10 | `dividend` | 同花顺-分红情况 | `stock_fhps_detail_ths` | 同花顺/经济通 | symbol |
| 11 | `dividend` | 新浪财经-发行与分配-历史分红 | `stock_history_dividend` | 新浪 | null |
| 12 | `dividend` | 新浪财经-发行与分配-分红配股 | `stock_history_dividend_detail` | 新浪/经济通 | symbol, indicator, date |
| 13 | `dividend` | 东方财富-港股-核心必读-分红派息 | `stock_hk_dividend_payout_em` | 东方财富 | symbol |
| 14 | `issuance` | 东方财富网-数据中心-新股申购-打新收益率 | `stock_dxsyl_em` | 东方财富 | null |
| 15 | `issuance` | 东方财富网-数据中心-新股申购-首发申报信息-首发申报企业信息 | `stock_ipo_declare_em` | 东方财富 | null |
| 16 | `issuance` | 同花顺-数据中心-新股申购与中签-港股 | `stock_ipo_hk_ths` | 同花顺 | null |
| 17 | `issuance` | 新浪财经-发行与分配-新股发行 | `stock_ipo_info` | 新浪 | stock |
| 18 | `issuance` | 东方财富网-数据中心-新股申购-新股上会信息 | `stock_ipo_review_em` | 东方财富 | null |
| 19 | `issuance` | 巨潮资讯-个股-上市相关 | `stock_ipo_summary_cninfo` | 巨潮 | symbol |
| 20 | `issuance` | 东方财富网-数据中心-新股申购-IPO辅导信息 | `stock_ipo_tutor_em` | 东方财富 | null |
| 21 | `issuance` | 巨潮资讯-数据中心-新股数据-新股发行 | `stock_new_ipo_cninfo` | 巨潮 | null |
| 22 | `issuance` | 东方财富网-数据中心-新股数据-增发-全部增发 | `stock_qbzf_em` | 东方财富 | null |
| 23 | `issuance` | 东方财富网-数据中心-新股数据-IPO审核信息-全部 | `stock_register_all_em` | 东方财富 | null |
| 24 | `issuance` | 东方财富网-数据中心-新股数据-IPO审核信息-北交所 | `stock_register_bj` | 北交所 | null |
| 25 | `issuance` | 东方财富网-数据中心-新股数据-IPO审核信息-创业板 | `stock_register_cyb` | 未识别 | null |
| 26 | `issuance` | 东方财富网-数据中心-新股数据-注册制审核-达标企业 | `stock_register_db` | 未识别 | null |
| 27 | `issuance` | 东方财富网-数据中心-新股数据-IPO审核信息-科创板 | `stock_register_kcb` | 未识别 | null |
| 28 | `issuance` | 东方财富网-数据中心-新股数据-IPO审核信息-上海主板 | `stock_register_sh` | 未识别 | null |
| 29 | `issuance` | 东方财富网-数据中心-新股数据-IPO审核信息-深圳主板 | `stock_register_sz` | 未识别 | null |
| 30 | `issuance` | 东方财富网-数据中心-新股数据-新股申购-新股申购与中签查询 | `stock_xgsglb_em` | 东方财富 | symbol |
| 31 | `issuance` | 同花顺-数据中心-新股数据-新股上市首日 | `stock_xgsr_ths` | 同花顺 | null |
| 32 | `pledge` | 巨潮资讯-数据中心-专题统计-公司治理-股权质押 | `stock_cg_equity_mortgage_cninfo` | 巨潮 | date |
| 33 | `pledge` | 东方财富网-数据中心-特色数据-股权质押-重要股东股权质押明细 | `stock_gpzy_pledge_ratio_detail_em` | 东方财富/经济通 | null |
| 34 | `pledge` | 东方财富网-数据中心-特色数据-股权质押-股权质押市场概况 | `stock_gpzy_profile_em` | 东方财富 | null |
| 35 | `repurchase` | 东方财富网-数据中心-股票回购-股票回购数据 | `stock_repurchase_em` | 东方财富 | null |
| 36 | `unlock` | 东方财富网-数据中心-限售股解禁-解禁详情一览 | `stock_restricted_release_detail_em` | 东方财富/经济通 | start_date, end_date |
| 37 | `unlock` | 东方财富网-数据中心-特色数据-限售股解禁 | `stock_restricted_release_summary_em` | 东方财富 | symbol, start_date, end_date |

## 五、sector：行业、概念与市场结构

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `history` | 申万宏源研究-行业分类-全部行业分类 | `stock_industry_clf_hist_sw` | 未识别 | null |
| 2 | `industry_metrics` | 东方财富网-数据中心-特色数据-股权质押-上市公司质押比例-行业数据 | `stock_gpzy_industry_data_em` | 东方财富 | null |
| 3 | `quotes` | 同花顺-板块-概念板块-指数日频率数据 | `stock_board_concept_index_ths` | 同花顺 | symbol, start_date, end_date |
| 4 | `quotes` | 同花顺-板块-行业板块-指数日频率数据 | `stock_board_industry_index_ths` | 同花顺 | symbol, start_date, end_date |
| 5 | `quotes` | 同花顺-同花顺行业一览表 | `stock_board_industry_summary_ths` | 同花顺 | null |
| 6 | `valuation` | 东方财富-港股-行业对比-成长性对比 | `stock_hk_growth_comparison_em` | 东方财富 | symbol |
| 7 | `valuation` | 东方财富-港股-行业对比-规模对比 | `stock_hk_scale_comparison_em` | 东方财富 | symbol |
| 8 | `valuation` | 东方财富-港股-行业对比-估值对比 | `stock_hk_valuation_comparison_em` | 东方财富 | symbol |
| 9 | `valuation` | 巨潮资讯-数据中心-行业分析-行业市盈率 | `stock_industry_pe_ratio_cninfo` | 巨潮 | symbol, date |
| 10 | `valuation` | 东方财富-行情中心-同行比较-成长性比较 | `stock_zh_growth_comparison_em` | 东方财富 | symbol |
| 11 | `valuation` | 东方财富-行情中心-同行比较-公司规模 | `stock_zh_scale_comparison_em` | 东方财富 | symbol |

## 六、flows_events：资金、交易行为与市场事件

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `block_trade` | 东方财富网-数据中心-大宗交易-活跃 A 股统计 | `stock_dzjy_hygtj` | 未识别 | symbol |
| 2 | `block_trade` | 东方财富网-数据中心-大宗交易-活跃营业部统计 | `stock_dzjy_hyyybtj` | 未识别 | symbol |
| 3 | `block_trade` | 东方财富网-数据中心-大宗交易-每日明细 | `stock_dzjy_mrmx` | 未识别 | symbol, start_date, end_date |
| 4 | `block_trade` | 东方财富网-数据中心-大宗交易-每日统计 | `stock_dzjy_mrtj` | 未识别 | start_date, end_date |
| 5 | `block_trade` | 东方财富网-数据中心-大宗交易-市场统计 | `stock_dzjy_sctj` | 未识别 | null |
| 6 | `block_trade` | 东方财富网-数据中心-大宗交易-营业部排行 | `stock_dzjy_yybph` | 未识别 | symbol |
| 7 | `fund_flow` | 同花顺-数据中心-资金流向-大单追踪 | `stock_fund_flow_big_deal` | 同花顺 | null |
| 8 | `limit_up` | 乐咕乐股网-赚钱效应分析数据 | `stock_market_activity_legu` | 乐估乐股/经济通 | null |
| 9 | `limit_up` | 东方财富网-行情中心-涨停板行情-跌停股池 | `stock_zt_pool_dtgc_em` | 东方财富 | date |
| 10 | `limit_up` | 东方财富网-行情中心-涨停板行情-涨停股池 | `stock_zt_pool_em` | 东方财富 | date |
| 11 | `limit_up` | 东方财富网-行情中心-涨停板行情-昨日涨停股池 | `stock_zt_pool_previous_em` | 东方财富 | date |
| 12 | `limit_up` | 东方财富网-行情中心-涨停板行情-强势股池 | `stock_zt_pool_strong_em` | 东方财富 | date |
| 13 | `limit_up` | 东方财富网-行情中心-涨停板行情-次新股池 | `stock_zt_pool_sub_new_em` | 东方财富 | date |
| 14 | `limit_up` | 东方财富网-行情中心-涨停板行情-炸板股池 | `stock_zt_pool_zbgc_em` | 东方财富 | date |
| 15 | `margin` | 东方财富网-数据中心-融资融券-融资融券账户统计-两融账户信息 | `stock_margin_account_info` | 未识别 | null |
| 16 | `margin` | 北京证券交易所-融资融券数据-融资融券汇总数据 | `stock_margin_bse` | 北交所 | date |
| 17 | `margin` | 北京证券交易所-融资融券数据-融资融券交易明细数据 | `stock_margin_detail_bse` | 北交所/经济通 | date |
| 18 | `margin` | 上海证券交易所-融资融券数据-融资融券明细数据 | `stock_margin_detail_sse` | 上交所/经济通 | date |
| 19 | `margin` | 深证证券交易所-融资融券数据-融资融券交易明细数据 | `stock_margin_detail_szse` | 深交所/经济通 | date |
| 20 | `margin` | 上海证券交易所-融资融券数据-融资融券汇总数据 | `stock_margin_sse` | 上交所 | start_date, end_date |
| 21 | `margin` | 深圳证券交易所-融资融券数据-融资融券汇总数据 | `stock_margin_szse` | 深交所 | date |
| 22 | `margin` | 北京证券交易所-融资融券数据-标的证券信息 | `stock_margin_underlying_info_bse` | 北交所 | date |
| 23 | `margin` | 深圳证券交易所-融资融券数据-标的证券信息 | `stock_margin_underlying_info_szse` | 深交所 | date |
| 24 | `northbound` | 东方财富网-数据中心-资金流向-沪深港通资金流向 | `stock_hsgt_fund_flow_summary_em` | 东方财富 | null |
| 25 | `northbound` | 东方财富-数据中心-沪深港通-市场概括-分时数据 | `stock_hsgt_fund_min_em` | 东方财富 | symbol |
| 26 | `northbound` | 东方财富网-数据中心-资金流向-沪深港通资金流向-沪深港通历史数据 | `stock_hsgt_hist_em` | 东方财富 | symbol |
| 27 | `northbound` | 沪港通-港股通信息披露-参考汇率 | `stock_sgt_reference_exchange_rate_sse` | 上交所 | null |
| 28 | `northbound` | 沪港通-港股通信息披露-结算汇兑 | `stock_sgt_settlement_exchange_rate_sse` | 上交所/经济通 | null |
| 29 | `sentiment` | 东方财富网-数据中心-特色数据-股票账户统计 | `stock_account_statistics_em` | 东方财富 | null |
| 30 | `sentiment` | 东方财富网-数据中心-特色数据-千股千评-市场热度-市场参与意愿 | `stock_comment_detail_scrd_desire_em` | 东方财富/经济通 | symbol |
| 31 | `sentiment` | 东方财富网-数据中心-特色数据-千股千评-市场热度-用户关注指数 | `stock_comment_detail_scrd_focus_em` | 东方财富/经济通 | symbol |
| 32 | `sentiment` | 东方财富网-数据中心-特色数据-千股千评-综合评价-历史评分 | `stock_comment_detail_zhpj_lspf_em` | 东方财富/经济通 | symbol |
| 33 | `sentiment` | 东方财富网-数据中心-特色数据-千股千评-主力控盘-机构参与度 | `stock_comment_detail_zlkp_jgcyd_em` | 东方财富/经济通 | symbol |
| 34 | `sentiment` | 东方财富-个股人气榜-人气榜-港股市场 | `stock_hk_hot_rank_em` | 东方财富 | null |
| 35 | `sentiment` | 东方财富-个股人气榜-最新排名 | `stock_hk_hot_rank_latest_em` | 东方财富 | symbol |
| 36 | `sentiment` | 雪球-沪深股市-热度排行榜-交易排行榜 | `stock_hot_deal_xq` | 雪球 | symbol |
| 37 | `sentiment` | 东方财富网站-股票热度 | `stock_hot_rank_em` | 东方财富 | null |
| 38 | `sentiment` | 东方财富-个股人气榜-最新排名 | `stock_hot_rank_latest_em` | 东方财富 | symbol |
| 39 | `sentiment` | 百度股市通-热搜股票 | `stock_hot_search_baidu` | 百度 | symbol, date, time |
| 40 | `sentiment` | 东方财富-个股人气榜-飙升榜 | `stock_hot_up_em` | 东方财富 | null |
| 41 | `sentiment` | 同花顺-数据中心-技术选股-持续放量 | `stock_rank_cxfl_ths` | 同花顺/财新 | null |
| 42 | `sentiment` | 同花顺-数据中心-技术选股-持续缩量 | `stock_rank_cxsl_ths` | 同花顺/财新 | null |
| 43 | `sentiment` | 同花顺-数据中心-技术选股-量价齐跌 | `stock_rank_ljqd_ths` | 同花顺 | null |
| 44 | `sentiment` | 同花顺-数据中心-技术选股-量价齐升 | `stock_rank_ljqs_ths` | 同花顺 | null |
| 45 | `sentiment` | 同花顺-数据中心-技术选股-连续上涨 | `stock_rank_lxsz_ths` | 同花顺 | null |
| 46 | `sentiment` | 同花顺-数据中心-技术选股-连续下跌 | `stock_rank_lxxd_ths` | 同花顺 | null |
| 47 | `sentiment` | 百度股市通- A 股或指数-股评-投票 | `stock_zh_vote_baidu` | 百度 | symbol, indicator |
| 48 | `unusual_trade` | 东方财富-行情中心-当日板块异动详情 | `stock_board_change_em` | 东方财富 | null |
| 49 | `unusual_trade` | 东方财富-行情中心-盘口异动数据 | `stock_changes_em` | 东方财富 | symbol |
| 50 | `unusual_trade` | 雪球-行情中心-沪深股市-内部交易 | `stock_inner_trade_xq` | 雪球 | null |
| 51 | `unusual_trade` | 龙虎榜-营业部排行-资金实力最强 | `stock_lh_yyb_capital` | 未识别 | null |
| 52 | `unusual_trade` | 龙虎榜-营业部排行-抱团操作实力 | `stock_lh_yyb_control` | 未识别 | null |
| 53 | `unusual_trade` | 龙虎榜-营业部排行-上榜次数最多 | `stock_lh_yyb_most` | 未识别 | null |
| 54 | `unusual_trade` | 新浪财经-龙虎榜-每日详情 | `stock_lhb_detail_daily_sina` | 新浪/经济通 | date |
| 55 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-龙虎榜详情 | `stock_lhb_detail_em` | 东方财富/经济通 | start_date, end_date |
| 56 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-每日活跃营业部 | `stock_lhb_hyyyb_em` | 东方财富 | start_date, end_date |
| 57 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-机构买卖每日统计 | `stock_lhb_jgmmtj_em` | 东方财富 | start_date, end_date |
| 58 | `unusual_trade` | 新浪财经-龙虎榜-机构席位成交明细 | `stock_lhb_jgmx_sina` | 新浪 | null |
| 59 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-机构席位追踪 | `stock_lhb_jgstatistic_em` | 东方财富 | symbol |
| 60 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-个股上榜统计 | `stock_lhb_stock_statistic_em` | 东方财富 | symbol |
| 61 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-营业部统计 | `stock_lhb_traderstatistic_em` | 东方财富 | symbol |
| 62 | `unusual_trade` | 东方财富网-数据中心-龙虎榜单-营业部排行 | `stock_lhb_yybph_em` | 东方财富 | symbol |
| 63 | `unusual_trade` | 新浪财经-龙虎榜-营业上榜统计 | `stock_lhb_yytj_sina` | 新浪 | symbol |
| 64 | `unusual_trade` | 同花顺-数据中心-技术选股-险资举牌 | `stock_rank_xzjp_ths` | 同花顺 | null |
| 65 | `unusual_trade` | 东方财富网-数据中心-特色数据-停复牌信息 | `stock_tfp_em` | 东方财富 | date |

## 七、research_disclosure：研报、公告与资讯

| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `analyst_forecasts` | 巨潮资讯-数据中心-评级预测-投资评级 | `stock_rank_forecast_cninfo` | 巨潮 | date |
| 2 | `announcements` | 百度股市通-交易提醒-停复牌 | `news_trade_notify_suspend_baidu` | 百度 | date |
| 3 | `announcements` | 巨潮资讯-数据中心-专题统计-公司治理-对外担保 | `stock_cg_guarantee_cninfo` | 巨潮 | symbol, start_date, end_date |
| 4 | `announcements` | 东方财富网-数据中心-股市日历-公司动态 | `stock_gsrl_gsdt_em` | 东方财富 | date |
| 5 | `announcements` | 东方财富网-数据中心-公告大全-个股 | `stock_individual_notice_report` | 未识别 | security, symbol, begin_date, end_date |
| 6 | `announcements` | 东方财富网-数据中心-重大合同-重大合同明细 | `stock_zdhtmx_em` | 东方财富 | start_date, end_date |
| 7 | `announcements` | 东方财富-科创板报告数据 | `stock_zh_kcb_report_em` | 东方财富 | from_page, to_page |
| 8 | `investor_relations` | 互动易-提问 | `stock_irm_cninfo` | 巨潮 | symbol |
| 9 | `investor_relations` | 上证e互动-提问与回答 | `stock_sns_sseinfo` | 上交所 | symbol |
| 10 | `news` | 百度股市通-财报发行 | `news_report_time_baidu` | 百度 | date |
| 11 | `news` | 东方财富-财经早餐 | `stock_info_cjzc_em` | 东方财富 | null |
| 12 | `news` | 财联社-电报 | `stock_info_global_cls` | 未识别 | symbol |
| 13 | `news` | 东方财富-全球财经快讯 | `stock_info_global_em` | 东方财富 | null |
| 14 | `news` | 富途牛牛-快讯 | `stock_info_global_futu` | 富途 | null |
| 15 | `news` | 新浪财经-全球财经快讯 | `stock_info_global_sina` | 新浪 | null |
| 16 | `news` | 同花顺财经-全球财经直播 | `stock_info_global_ths` | 同花顺 | null |
| 17 | `news` | 财新网-财新数据通-最新 | `stock_news_main_cx` | 财新 | null |
| 18 | `research_reports` | 东方财富网-数据中心-研究报告-东方财富分析师指数-分析师详情 | `stock_analyst_detail_em` | 东方财富/经济通 | analyst_id, indicator |
| 19 | `research_reports` | 东方财富网-数据中心-研究报告-东方财富分析师指数 | `stock_analyst_rank_em` | 东方财富 | year |
| 20 | `research_reports` | 东方财富网-数据中心-特色数据-千股千评 | `stock_comment_em` | 东方财富 | null |
| 21 | `research_reports` | 新浪财经-ESG评级中心-ESG评级-路孚特 | `stock_esg_rft_sina` | 新浪 | null |
| 22 | `research_reports` | 东方财富网-数据中心-特色数据-机构调研-机构调研统计 | `stock_jgdy_tj_em` | 东方财富 | date |
| 23 | `research_reports` | 东方财富网-数据中心-研究报告-个股研报 | `stock_research_report_em` | 东方财富 | symbol |
