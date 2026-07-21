# AkShare 股票接口分类总览

> 数据来源:`docs/tutorial/akshare_api.xlsx`(工作表「AkShare 股票接口测试」)

> 接口总数:**375** 个  |  可用:**134** 个  |  不可用:**241** 个

> 分类依据:以**接口函数名与真实用途**为准(原表「接口名称」首段存在归类错位,已校正)


## 分类速览

| 大类 | 子类数 | 接口数 | 可用 | 不可用 |
| --- | ---: | ---: | ---: | ---: |
| 一、市场总览与统计 | 3 | 20 | 6 | 14 |
| 二、标的列表与基础信息 | 4 | 26 | 10 | 16 |
| 三、行情数据 | 9 | 62 | 11 | 51 |
| 四、财务与估值 | 8 | 53 | 9 | 44 |
| 五、股东与股本变动 | 5 | 31 | 12 | 19 |
| 六、资金与筹码 | 9 | 74 | 35 | 39 |
| 七、IPO 与资本运作 | 6 | 36 | 26 | 10 |
| 八、机构与研究 | 7 | 20 | 7 | 13 |
| 九、公告与事件异动 | 10 | 26 | 12 | 14 |
| 十、市场情绪、互动与 ESG | 6 | 27 | 6 | 21 |

## 一、市场总览与统计

### 市场总貌与每日概况  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 1 | 股票市场总貌-上海证券交易所 | `stock_sse_summary` | 上海证券交易所 | null | ✅可用 |
| 2 | 股票市场总貌-深圳证券交易所 | `stock_szse_summary` | 深圳证券交易所 | date | ✅可用 |
| 3 | 股票市场总貌-深圳证券交易所 | `stock_szse_area_summary` | 深圳证券交易所 | date | ✅可用 |
| 4 | 股票市场总貌-深圳证券交易所 | `stock_szse_sector_summary` | 深圳证券交易所 | symbol, date | ❌不可用 |
| 5 | 股票市场总貌-上海证券交易所-每日概况 | `stock_sse_deal_daily` | 上海证券交易所 | date | ✅可用 |

### 账户与活跃度统计  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 90 | 股票账户统计月度 | `stock_account_statistics_em` | 东方财富 | null | ✅可用 |
| 363 | 跌停股池 | `stock_market_activity_legu` | 乐估乐股 | null | ✅可用 |

### 大盘估值水位  (13)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 251 | A 股股息率 | `stock_a_gxl_lg` | 乐估乐股 | symbol | ❌不可用 |
| 252 | 恒生指数股息率 | `stock_hk_gxl_lg` | 乐估乐股 | null | ❌不可用 |
| 253 | 大盘拥挤度 | `stock_a_congestion_lg` | 乐估乐股 | null | ❌不可用 |
| 254 | 股债利差 | `stock_ebs_lg` | 乐估乐股 | null | ❌不可用 |
| 255 | 巴菲特指标 | `stock_buffett_index_lg` | 乐估乐股 | null | ❌不可用 |
| 256 | A 股等权重与中位数市盈率 | `stock_a_ttm_lyr` | 乐估乐股 | null | ❌不可用 |
| 257 | A 股等权重与中位数市净率 | `stock_a_all_pb` | 乐估乐股 | null | ❌不可用 |
| 258 | 主板市盈率 | `stock_market_pe_lg` | 乐估乐股 | symbol | ❌不可用 |
| 259 | 指数市盈率 | `stock_index_pe_lg` | 乐估乐股 | symbol | ❌不可用 |
| 260 | 主板市净率 | `stock_market_pb_lg` | 乐估乐股 | symbol | ❌不可用 |
| 261 | 指数市净率 | `stock_index_pb_lg` | 乐估乐股 | symbol | ❌不可用 |
| 268 | 创新高和新低的股票数量 | `stock_a_high_low_statistics` | 乐估乐股 | symbol | ❌不可用 |
| 269 | 破净股统计 | `stock_a_below_net_asset_statistics` | 乐估乐股 | symbol | ❌不可用 |


## 二、标的列表与基础信息

### 股票列表与代码字典  (8)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 50 | A+H股票字典 | `stock_zh_ah_name` | 腾讯 | null | ✅可用 |
| 217 | 股票列表-A股 | `stock_info_a_code_name` | 其他 | null | ✅可用 |
| 218 | 股票列表-上证 | `stock_info_sh_name_code` | 上海证券交易所 | symbol | ❌不可用 |
| 219 | 股票列表-深证 | `stock_info_sz_name_code` | 深圳证券交易所 | symbol | ❌不可用 |
| 220 | 股票列表-北证 | `stock_info_bj_name_code` | 北京证券交易所 | null | ✅可用 |
| 221 | 终止/暂停上市-深证 | `stock_info_sz_delist` | 深圳证券交易所 | symbol | ❌不可用 |
| 222 | 两网及退市 | `stock_staq_net_stop` | 东方财富 | null | ❌不可用 |
| 223 | 暂停/终止上市-上证 | `stock_info_sh_delist` | 上海证券交易所 | symbol | ❌不可用 |

### 个股基础信息  (8)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 6 | 个股信息查询-东财 | `stock_individual_info_em` | 东方财富 | symbol, timeout | ❌不可用 |
| 7 | 个股信息查询-雪球 | `stock_individual_basic_info_xq` | 雪球 | symbol, token, timeout | ✅可用 |
| 54 | 个股信息查询-雪球 | `stock_individual_basic_info_us_xq` | 雪球 | symbol, token, timeout | ❌不可用 |
| 62 | 个股信息查询-雪球 | `stock_individual_basic_info_hk_xq` | 雪球 | symbol, token, timeout | ✅可用 |
| 67 | 证券资料 | `stock_hk_security_profile_em` | 东方财富 | symbol | ❌不可用 |
| 68 | 公司资料 | `stock_hk_company_profile_em` | 东方财富 | symbol | ❌不可用 |
| 134 | 公司概况-巨潮资讯 | `stock_profile_cninfo` | 巨潮资讯 | symbol | ✅可用 |
| 135 | 上市相关-巨潮资讯 | `stock_ipo_summary_cninfo` | 巨潮资讯 | symbol | ✅可用 |

### 股票更名与名称变更  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 224 | 股票更名 | `stock_info_change_name` | 新浪财经 | symbol | ✅可用 |
| 225 | 名称变更-深证 | `stock_info_sz_change_name` | 深圳证券交易所 | symbol | ❌不可用 |

### 行业/板块分类  (8)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 130 | 行业分类数据-巨潮资讯 | `stock_industry_category_cninfo` | 巨潮资讯 | symbol | ❌不可用 |
| 131 | 上市公司行业归属的变动情况-巨潮资讯 | `stock_industry_change_cninfo` | 巨潮资讯 | symbol, start_date, end_date | ✅可用 |
| 233 | 机构推荐-申万个股行业分类变动历史 | `stock_industry_clf_hist_sw` | 申万宏源研究 | null | ❌不可用 |
| 234 | 机构推荐-行业市盈率 | `stock_industry_pe_ratio_cninfo` | 巨潮资讯 | symbol, date | ❌不可用 |
| 322 | 同花顺-概念板块简介 | `stock_board_concept_info_ths` | 同花顺 | symbol | ❌不可用 |
| 323 | 东方财富-概念板块 | `stock_board_concept_name_em` | 东方财富 | null | ❌不可用 |
| 329 | 同花顺-同花顺行业一览表 | `stock_board_industry_summary_ths` | 同花顺 | null | ✅可用 |
| 331 | 东方财富-行业板块 | `stock_board_industry_name_em` | 东方财富 | null | ❌不可用 |


## 三、行情数据

### A股实时行情  (17)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 8 | 行情报价 | `stock_bid_ask_em` | 东方财富 | symbol | ❌不可用 |
| 9 | 实时行情数据-东财 | `stock_zh_a_spot_em` | 东方财富 | null | ❌不可用 |
| 10 | 实时行情数据-东财 | `stock_sh_a_spot_em` | 东方财富 | null | ❌不可用 |
| 11 | 实时行情数据-东财 | `stock_sz_a_spot_em` | 东方财富 | null | ❌不可用 |
| 12 | 实时行情数据-东财 | `stock_bj_a_spot_em` | 东方财富 | null | ❌不可用 |
| 13 | 实时行情数据-东财 | `stock_new_a_spot_em` | 东方财富 | null | ❌不可用 |
| 14 | 实时行情数据-东财 | `stock_cy_a_spot_em` | 东方财富 | null | ❌不可用 |
| 15 | 实时行情数据-东财 | `stock_kc_a_spot_em` | 东方财富 | null | ❌不可用 |
| 16 | 实时行情数据-东财 | `stock_zh_ab_comparison_em` | 东方财富 | null | ❌不可用 |
| 17 | 实时行情数据-新浪 | `stock_zh_a_spot` | 新浪财经 | null | ❌不可用 |
| 18 | 实时行情数据-雪球 | `stock_individual_spot_xq` | 雪球 | symbol, token, timeout | ✅可用 |
| 32 | 历史行情数据 | `stock_zh_a_cdr_daily` | 新浪财经 | symbol, start_date, end_date | ✅可用 |
| 37 | 历史行情数据-分时数据 | `stock_zh_a_new` | 新浪财经 | null | ✅可用 |
| 39 | 公司动态 | `stock_zh_a_st_em` | 东方财富 | null | ❌不可用 |
| 40 | 公司动态 | `stock_zh_a_new_em` | 东方财富 | null | ❌不可用 |
| 43 | 公司动态 | `stock_zh_a_stop_em` | 东方财富 | null | ❌不可用 |
| 44 | 实时行情数据 | `stock_zh_kcb_spot` | 新浪财经 | null | ✅可用 |

### B股/科创板/创业板实时行情  (6)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 33 | 实时行情数据-东财 | `stock_zh_b_spot_em` | 东方财富 | null | ❌不可用 |
| 34 | 实时行情数据-新浪 | `stock_zh_b_spot` | 新浪财经 | null | ✅可用 |
| 35 | 历史行情数据 | `stock_zh_b_daily` | 新浪财经 | symbol, start_date, end_date, adjust | ❌不可用 |
| 36 | 历史行情数据-分时数据 | `stock_zh_b_minute` | 新浪财经 | symbol, period, adjust | ❌不可用 |
| 45 | 历史行情数据 | `stock_zh_kcb_daily` | 新浪财经 | symbol, adjust | ✅可用 |
| 46 | 科创板公告 | `stock_zh_kcb_report_em` | 东方财富 | from_page, to_page | ✅可用 |

### A股历史行情与分时  (9)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 19 | 历史行情数据-东财 | `stock_zh_a_hist` | 东方财富 | symbol, period, start_date, end_date, adjust, timeout | ❌不可用 |
| 20 | 历史行情数据-新浪 | `stock_zh_a_daily` | 新浪财经 | symbol, start_date, end_date, adjust | ✅可用 |
| 21 | 历史行情数据-腾讯 | `stock_zh_a_hist_tx` | 腾讯 | symbol, start_date, end_date, adjust, timeout | ✅可用 |
| 22 | 历史行情数据-分时数据-新浪 | `stock_zh_a_minute` | 新浪财经 | symbol, period, adjust | ❌不可用 |
| 23 | 历史行情数据-分时数据-东财 | `stock_zh_a_hist_min_em` | 东方财富 | symbol, start_date, end_date, period, adjust | ❌不可用 |
| 24 | 历史行情数据-日内分时数据-东财 | `stock_intraday_em` | 东方财富 | symbol | ❌不可用 |
| 25 | 历史行情数据-日内分时数据-新浪 | `stock_intraday_sina` | 新浪财经 | symbol, date | ❌不可用 |
| 26 | 历史行情数据-盘前数据 | `stock_zh_a_hist_pre_min_em` | 东方财富 | symbol, start_time, end_time | ❌不可用 |
| 27 | 历史分笔数据-腾讯财经 | `stock_zh_a_tick_tx` | 腾讯 | null | ❌不可用 |

### AH股行情  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 47 | 实时行情数据-东财 | `stock_zh_ah_spot_em` | 东方财富 | null | ❌不可用 |
| 48 | 实时行情数据-腾讯 | `stock_zh_ah_spot` | 腾讯 | null | ✅可用 |
| 49 | 历史行情数据 | `stock_zh_ah_daily` | 腾讯 | symbol, start_year, end_year, adjust | ❌不可用 |

### 港股行情  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 59 | 实时行情数据-东财 | `stock_hk_spot_em` | 东方财富 | null | ❌不可用 |
| 60 | 港股主板实时行情数据-东财 | `stock_hk_main_board_spot_em` | 东方财富 | null | ❌不可用 |
| 61 | 实时行情数据-新浪 | `stock_hk_spot` | 新浪财经 | null | ✅可用 |
| 63 | 分时数据-东财 | `stock_hk_hist_min_em` | 东方财富 | symbol, period, adjust, start_date, end_date | ❌不可用 |
| 64 | 历史行情数据-东财 | `stock_hk_hist` | 东方财富 | symbol, period, start_date, end_date, adjust | ❌不可用 |
| 65 | 历史行情数据-新浪 | `stock_hk_daily` | 新浪财经 | symbol, adjust | ❌不可用 |
| 66 | 知名港股 | `stock_hk_famous_spot_em` | 东方财富 | null | ❌不可用 |

### 美股行情  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 51 | 实时行情数据-东财 | `stock_us_spot_em` | 东方财富 | null | ❌不可用 |
| 52 | 实时行情数据-新浪 | `stock_us_spot` | 新浪财经 | null | ❌不可用 |
| 53 | 历史行情数据-东财 | `stock_us_hist` | 东方财富 | symbol, period, start_date, end_date, adjust | ❌不可用 |
| 55 | 分时数据-东财 | `stock_us_hist_min_em` | 东方财富 | symbol, start_date, end_date | ❌不可用 |
| 56 | 历史行情数据-新浪 | `stock_us_daily` | 新浪财经 | symbol, adjust | ❌不可用 |
| 57 | 粉单市场 | `stock_us_pink_spot_em` | 东方财富 | null | ❌不可用 |
| 58 | 知名美股 | `stock_us_famous_spot_em` | 东方财富 | symbol | ❌不可用 |

### 概念板块行情  (6)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 321 | 同花顺-概念板块指数 | `stock_board_concept_index_ths` | 同花顺 | symbol, start_date, end_date | ❌不可用 |
| 324 | 东方财富-概念板块-实时行情 | `stock_board_concept_spot_em` | 东方财富 | null | ❌不可用 |
| 325 | 东方财富-成份股 | `stock_board_concept_cons_em` | 东方财富 | symbol | ❌不可用 |
| 326 | 东方财富-指数 | `stock_board_concept_hist_em` | 东方财富 | symbol, period, start_date, end_date, adjust | ❌不可用 |
| 327 | 东方财富-指数-分时 | `stock_board_concept_hist_min_em` | 东方财富 | symbol, period | ❌不可用 |
| 328 | 富途牛牛-美股概念-成分股 | `stock_concept_cons_futu` | 富途 | symbol | ❌不可用 |

### 行业板块行情  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 330 | 同花顺-指数 | `stock_board_industry_index_ths` | 同花顺 | symbol, start_date, end_date | ❌不可用 |
| 332 | 东方财富-行业板块-实时行情 | `stock_board_industry_spot_em` | 东方财富 | symbol | ❌不可用 |
| 333 | 东方财富-成份股 | `stock_board_industry_cons_em` | 东方财富 | symbol | ❌不可用 |
| 334 | 东方财富-指数-日频 | `stock_board_industry_hist_em` | 东方财富 | symbol, start_date, end_date, period, adjust | ❌不可用 |
| 335 | 东方财富-指数-分时 | `stock_board_industry_hist_min_em` | 东方财富 | symbol, period | ❌不可用 |

### 新浪板块行情  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 215 | 板块行情 | `stock_sector_spot` | 新浪财经 | indicator | ❌不可用 |
| 216 | 板块详情 | `stock_sector_detail` | 新浪财经 | sector | ❌不可用 |


## 四、财务与估值

### 三大报表-东财  (15)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 136 | 资产负债表-沪深 | `stock_zcfz_em` | 东方财富 | date | ❌不可用 |
| 137 | 资产负债表-北交所 | `stock_zcfz_bj_em` | 东方财富 | date | ❌不可用 |
| 138 | 利润表 | `stock_lrb_em` | 东方财富 | date | ❌不可用 |
| 139 | 现金流量表 | `stock_xjll_em` | 东方财富 | date | ❌不可用 |
| 164 | 财务报表-东财-资产负债表-按报告期 | `stock_balance_sheet_by_report_em` | 东方财富 | symbol | ❌不可用 |
| 165 | 财务报表-东财-资产负债表-按年度 | `stock_balance_sheet_by_yearly_em` | 东方财富 | symbol | ❌不可用 |
| 166 | 财务报表-东财-利润表-按报告期 | `stock_profit_sheet_by_report_em` | 东方财富 | symbol | ❌不可用 |
| 167 | 财务报表-东财-利润表-按年度 | `stock_profit_sheet_by_yearly_em` | 东方财富 | symbol | ❌不可用 |
| 168 | 财务报表-东财-利润表-按单季度 | `stock_profit_sheet_by_quarterly_em` | 东方财富 | symbol | ❌不可用 |
| 169 | 财务报表-东财-现金流量表-按报告期 | `stock_cash_flow_sheet_by_report_em` | 东方财富 | symbol | ❌不可用 |
| 170 | 财务报表-东财-现金流量表-按年度 | `stock_cash_flow_sheet_by_yearly_em` | 东方财富 | symbol | ❌不可用 |
| 171 | 财务报表-东财-现金流量表-按单季度 | `stock_cash_flow_sheet_by_quarterly_em` | 东方财富 | symbol | ❌不可用 |
| 175 | 财务报表-东财-已退市股票-资产负债表-按报告期 | `stock_balance_sheet_by_report_delisted_em` | 东方财富 | symbol | ❌不可用 |
| 176 | 财务报表-东财-已退市股票-利润表-按报告期 | `stock_profit_sheet_by_report_delisted_em` | 东方财富 | symbol | ❌不可用 |
| 177 | 财务报表-东财-已退市股票-现金流量表-按报告期 | `stock_cash_flow_sheet_by_report_delisted_em` | 东方财富 | symbol | ❌不可用 |

### 三大报表-同花顺/新浪/港股/美股  (6)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 163 | 财务报表-新浪 | `stock_financial_report_sina` | 新浪财经 | stock, symbol | ❌不可用 |
| 172 | 财务报表-同花顺-资产负债表 | `stock_financial_debt_new_ths` | 同花顺 | symbol, indicator | ✅可用 |
| 173 | 财务报表-同花顺-利润表 | `stock_financial_benefit_new_ths` | 同花顺 | symbol, indicator | ✅可用 |
| 174 | 财务报表-同花顺-现金流量表 | `stock_financial_cash_new_ths` | 同花顺 | symbol, indicator | ✅可用 |
| 178 | 港股财务报表 | `stock_financial_hk_report_em` | 东方财富 | stock, symbol, indicator | ❌不可用 |
| 179 | 美股财务报表 | `stock_financial_us_report_em` | 东方财富 | stock, symbol, indicator | ❌不可用 |

### 财务指标与关键指标  (8)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 69 | 财务指标 | `stock_hk_financial_indicator_em` | 东方财富 | symbol | ❌不可用 |
| 180 | 关键指标-新浪 | `stock_financial_abstract` | 新浪财经 | symbol | ✅可用 |
| 181 | 关键指标-同花顺 | `stock_financial_abstract_new_ths` | 同花顺 | symbol, indicator | ✅可用 |
| 182 | 主要指标-东方财富 | `stock_financial_analysis_indicator_em` | 东方财富 | symbol, indicator | ❌不可用 |
| 183 | 财务指标 | `stock_financial_analysis_indicator` | 新浪财经 | symbol, start_year | ✅可用 |
| 184 | 港股财务指标 | `stock_financial_hk_analysis_indicator_em` | 东方财富 | symbol, indicator | ❌不可用 |
| 185 | 美股财务指标 | `stock_financial_us_analysis_indicator_em` | 东方财富 | symbol, indicator | ❌不可用 |
| 265 | 港股个股指标 | `stock_hk_indicator_eniu` | 亿牛 | symbol, indicator | ❌不可用 |

### 业绩报表/快报/预告/披露时间  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 123 | 业绩报表 | `stock_yjbb_em` | 东方财富 | date | ❌不可用 |
| 124 | 业绩快报 | `stock_yjkb_em` | 东方财富 | date | ❌不可用 |
| 125 | 业绩预告 | `stock_yjyg_em` | 东方财富 | date | ❌不可用 |
| 126 | 预约披露时间-东方财富 | `stock_yysj_em` | 东方财富 | symbol, date | ❌不可用 |
| 127 | 预约披露时间-巨潮资讯 | `stock_report_disclosure` | 巨潮资讯 | market, period | ❌不可用 |
| 128 | 信息披露公告-巨潮资讯 | `stock_zh_a_disclosure_report_cninfo` | 巨潮资讯 | symbol, market, keyword, category, start_date, end_date | ❌不可用 |
| 129 | 信息披露调研-巨潮资讯 | `stock_zh_a_disclosure_relation_cninfo` | 巨潮资讯 | symbol, market, start_date, end_date | ❌不可用 |

### 估值指标  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 262 | A 股估值指标 | `stock_zh_valuation_baidu` | 百度股市通 | symbol, indicator, period | ✅可用 |
| 263 | 个股估值 | `stock_value_em` | 东方财富 | symbol | ✅可用 |
| 266 | 港股估值指标 | `stock_hk_valuation_baidu` | 百度股市通 | symbol, indicator, period | ❌不可用 |
| 267 | 美股估值指标 | `stock_us_valuation_baidu` | 百度股市通 | symbol, indicator, period | ❌不可用 |

### 同行/行业对比  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 28 | 同行比较-成长性比较 | `stock_zh_growth_comparison_em` | 东方财富 | symbol | ❌不可用 |
| 29 | 同行比较-估值比较 | `stock_zh_valuation_comparison_em` | 东方财富 | symbol | ❌不可用 |
| 30 | 同行比较-杜邦分析比较 | `stock_zh_dupont_comparison_em` | 东方财富 | symbol | ❌不可用 |
| 31 | 同行比较-公司规模 | `stock_zh_scale_comparison_em` | 东方财富 | symbol | ❌不可用 |
| 71 | 行业对比-成长性对比 | `stock_hk_growth_comparison_em` | 东方财富 | symbol | ❌不可用 |
| 72 | 行业对比-估值对比 | `stock_hk_valuation_comparison_em` | 东方财富 | symbol | ❌不可用 |
| 73 | 行业对比-规模对比 | `stock_hk_scale_comparison_em` | 东方财富 | symbol | ❌不可用 |

### 商誉  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 85 | A股商誉市场概况 | `stock_sy_profile_em` | 东方财富 | null | ✅可用 |
| 86 | 商誉减值预期明细 | `stock_sy_yq_em` | 东方财富 | date | ❌不可用 |
| 87 | 个股商誉减值明细 | `stock_sy_jz_em` | 东方财富 | date | ❌不可用 |
| 88 | 个股商誉明细 | `stock_sy_em` | 东方财富 | date | ❌不可用 |
| 89 | 行业商誉 | `stock_sy_hy_em` | 东方财富 | date | ❌不可用 |

### 港股分红派息(财务口径)  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 70 | 分红派息 | `stock_hk_dividend_payout_em` | 东方财富 | symbol | ❌不可用 |


## 五、股东与股本变动

### 十大股东/十大流通股东  (13)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 187 | 十大流通股东(个股) | `stock_gdfx_free_top_10_em` | 东方财富 | symbol, date | ❌不可用 |
| 188 | 十大股东(个股) | `stock_gdfx_top_10_em` | 东方财富 | symbol, date | ❌不可用 |
| 189 | 股东持股变动统计-十大流通股东 | `stock_gdfx_free_holding_change_em` | 东方财富 | date | ✅可用 |
| 190 | 股东持股变动统计-十大股东 | `stock_gdfx_holding_change_em` | 东方财富 | date | ❌不可用 |
| 192 | 股东持股变动统计 | `stock_shareholder_change_ths` | 同花顺 | symbol | ✅可用 |
| 193 | 股东持股分析-十大流通股东 | `stock_gdfx_free_holding_analyse_em` | 东方财富 | date | ✅可用 |
| 194 | 股东持股分析-十大股东 | `stock_gdfx_holding_analyse_em` | 东方财富 | date | ✅可用 |
| 195 | 股东持股明细-十大流通股东 | `stock_gdfx_free_holding_detail_em` | 东方财富 | date | ✅可用 |
| 196 | 股东持股明细-十大股东 | `stock_gdfx_holding_detail_em` | 东方财富 | date, indicator, symbol | ❌不可用 |
| 197 | 股东持股统计-十大流通股东 | `stock_gdfx_free_holding_statistics_em` | 东方财富 | date | ❌不可用 |
| 198 | 股东持股统计-十大股东 | `stock_gdfx_holding_statistics_em` | 东方财富 | date | ❌不可用 |
| 199 | 股东协同-十大流通股东 | `stock_gdfx_free_holding_teamwork_em` | 东方财富 | symbol | ❌不可用 |
| 200 | 股东协同-十大股东 | `stock_gdfx_holding_teamwork_em` | 东方财富 | symbol | ❌不可用 |

### 股东户数  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 201 | 股东户数 | `stock_zh_a_gdhs` | 东方财富 | symbol | ❌不可用 |
| 202 | 股东户数详情 | `stock_zh_a_gdhs_detail_em` | 东方财富 | symbol | ✅可用 |
| 240 | 机构推荐-股东人数及持股集中度 | `stock_hold_num_cninfo` | 巨潮资讯 | date | ❌不可用 |

### 高管与董监高持股变动  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 191 | 高管持股变动统计 | `stock_management_change_ths` | 同花顺 | symbol | ✅可用 |
| 237 | 机构推荐-董监高及相关人员持股变动-上证 | `stock_share_hold_change_sse` | 上海证券交易所 | symbol | ✅可用 |
| 238 | 机构推荐-董监高及相关人员持股变动-深证 | `stock_share_hold_change_szse` | 深圳证券交易所 | symbol | ❌不可用 |
| 239 | 机构推荐-董监高及相关人员持股变动-北证 | `stock_share_hold_change_bse` | 北京证券交易所 | symbol | ❌不可用 |
| 243 | 机构推荐-高管持股变动明细 | `stock_hold_management_detail_cninfo` | 巨潮资讯 | symbol | ❌不可用 |
| 244 | 机构推荐-董监高及相关人员持股变动明细 | `stock_hold_management_detail_em` | 东方财富 | null | ❌不可用 |
| 245 | 机构推荐-人员增减持股变动明细 | `stock_hold_management_person_em` | 东方财富 | symbol, name | ❌不可用 |

### 股本结构与股本变动  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 132 | 公司股本变动-巨潮资讯 | `stock_share_change_cninfo` | 巨潮资讯 | symbol, start_date, end_date | ✅可用 |
| 133 | 配股实施方案-巨潮资讯 | `stock_allotment_cninfo` | 巨潮资讯 | symbol, start_date, end_date | ❌不可用 |
| 241 | 机构推荐-股本变动 | `stock_hold_change_cninfo` | 巨潮资讯 | symbol | ❌不可用 |
| 300 | 股本结构 | `stock_zh_a_gbjg_em` | 东方财富 | symbol | ✅可用 |

### 主要股东/流通股东/实控人  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 140 | 股东增减持 | `stock_ggcg_em` | 东方财富 | symbol | ❌不可用 |
| 214 | 流通股东 | `stock_circulate_stock_holder` | 新浪财经 | symbol | ✅可用 |
| 227 | 主要股东 | `stock_main_stock_holder` | 新浪财经 | stock | ✅可用 |
| 242 | 机构推荐-实际控制人持股变动 | `stock_hold_control_cninfo` | 巨潮资讯 | symbol | ❌不可用 |


## 六、资金与筹码

### 个股/大盘资金流  (8)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 145 | 同花顺-个股资金流 | `stock_fund_flow_individual` | 同花顺 | symbol | ❌不可用 |
| 146 | 同花顺-概念资金流 | `stock_fund_flow_concept` | 同花顺 | symbol | ❌不可用 |
| 147 | 同花顺-行业资金流 | `stock_fund_flow_industry` | 同花顺 | symbol | ❌不可用 |
| 148 | 同花顺-大单追踪 | `stock_fund_flow_big_deal` | 同花顺 | null | ✅可用 |
| 149 | 东方财富-个股资金流 | `stock_individual_fund_flow` | 东方财富 | stock, market | ❌不可用 |
| 150 | 东方财富-个股资金流排名 | `stock_individual_fund_flow_rank` | 东方财富 | indicator | ❌不可用 |
| 151 | 东方财富-大盘资金流 | `stock_market_fund_flow` | 东方财富 | null | ❌不可用 |
| 153 | 东方财富-主力净流入排名 | `stock_main_fund_flow` | 东方财富 | symbol | ❌不可用 |

### 板块资金流  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 152 | 东方财富-板块资金流排名 | `stock_sector_fund_flow_rank` | 东方财富 | indicator, sector_type | ❌不可用 |
| 154 | 东方财富-行业个股资金流 | `stock_sector_fund_flow_summary` | 东方财富 | symbol, indicator | ❌不可用 |
| 155 | 东方财富-行业历史资金流 | `stock_sector_fund_flow_hist` | 东方财富 | symbol | ❌不可用 |
| 156 | 东方财富-概念历史资金流 | `stock_concept_fund_flow_hist` | 东方财富 | symbol | ❌不可用 |

### 沪深港通-持股与统计  (11)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 98 | 市场热度-市场参与意愿 | `stock_hsgt_fund_flow_summary_em` | 东方财富 | null | ✅可用 |
| 103 | 港股通成份股 | `stock_hk_ggt_components_em` | 东方财富 | null | ❌不可用 |
| 104 | 沪深港通分时数据 | `stock_hsgt_fund_min_em` | 东方财富 | symbol | ✅可用 |
| 105 | 板块排行 | `stock_hsgt_board_rank_em` | 东方财富 | symbol, indicator | ❌不可用 |
| 106 | 个股排行 | `stock_hsgt_hold_stock_em` | 东方财富 | market, indicator | ❌不可用 |
| 107 | 每日个股统计 | `stock_hsgt_stock_statistics_em` | 东方财富 | symbol, start_date, end_date | ❌不可用 |
| 108 | 机构排行 | `stock_hsgt_institution_statistics_em` | 东方财富 | market, start_date, end_date | ❌不可用 |
| 109 | 沪深港通-港股通(沪&gt;港)实时行情 | `stock_hsgt_sh_hk_spot_em` | 东方财富 | null | ❌不可用 |
| 110 | 沪深港通历史数据 | `stock_hsgt_hist_em` | 东方财富 | symbol | ❌不可用 |
| 111 | 沪深港通持股-个股 | `stock_hsgt_individual_em` | 东方财富 | symbol | ✅可用 |
| 112 | 沪深港通持股-个股详情 | `stock_hsgt_individual_detail_em` | 东方财富 | symbol, start_date, end_date | ✅可用 |

### 沪深港通-汇率  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 99 | 结算汇率-深港通 | `stock_sgt_settlement_exchange_rate_szse` | 深圳证券交易所 | null | ❌不可用 |
| 100 | 结算汇率-沪港通 | `stock_sgt_settlement_exchange_rate_sse` | 上海证券交易所 | null | ✅可用 |
| 101 | 参考汇率-深港通 | `stock_sgt_reference_exchange_rate_szse` | 深圳证券交易所 | null | ❌不可用 |
| 102 | 参考汇率-沪港通 | `stock_sgt_reference_exchange_rate_sse` | 上海证券交易所 | null | ✅可用 |

### 融资融券  (11)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 307 | 营业部排行 | `stock_yzxdr_em` | 东方财富 | date | ❌不可用 |
| 308 | 标的证券名单及保证金比例查询 | `stock_margin_ratio_pa` | 平安证券 | symbol, date | ❌不可用 |
| 309 | 两融账户信息 | `stock_margin_account_info` | 东方财富 | null | ✅可用 |
| 310 | 上海证券交易所-融资融券汇总 | `stock_margin_sse` | 上海证券交易所 | start_date, end_date | ✅可用 |
| 311 | 上海证券交易所-融资融券明细 | `stock_margin_detail_sse` | 上海证券交易所 | date | ✅可用 |
| 312 | 深圳证券交易所-融资融券汇总 | `stock_margin_szse` | 深圳证券交易所 | date | ✅可用 |
| 313 | 深圳证券交易所-融资融券明细 | `stock_margin_detail_szse` | 深圳证券交易所 | date | ✅可用 |
| 314 | 深圳证券交易所-标的证券信息 | `stock_margin_underlying_info_szse` | 深圳证券交易所 | date | ✅可用 |
| 315 | 北京证券交易所-融资融券汇总 | `stock_margin_bse` | 北京证券交易所 | date | ✅可用 |
| 316 | 北京证券交易所-融资融券明细 | `stock_margin_detail_bse` | 北京证券交易所 | date | ✅可用 |
| 317 | 北京证券交易所-标的证券信息 | `stock_margin_underlying_info_bse` | 北京证券交易所 | date | ✅可用 |

### 龙虎榜  (17)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 272 | 龙虎榜-东财 | `stock_lhb_detail_em` | 东方财富 | start_date, end_date | ✅可用 |
| 273 | 龙虎榜-东财 | `stock_lhb_stock_statistic_em` | 东方财富 | symbol | ❌不可用 |
| 274 | 龙虎榜-东财 | `stock_lhb_jgmmtj_em` | 东方财富 | start_date, end_date | ✅可用 |
| 275 | 龙虎榜-东财 | `stock_lhb_jgstatistic_em` | 东方财富 | symbol | ❌不可用 |
| 276 | 龙虎榜-东财 | `stock_lhb_hyyyb_em` | 东方财富 | start_date, end_date | ❌不可用 |
| 277 | 营业部详情数据-东财 | `stock_lhb_yyb_detail_em` | 东方财富 | symbol | ❌不可用 |
| 278 | 营业部详情数据-东财-营业部排行 | `stock_lhb_yybph_em` | 东方财富 | symbol | ❌不可用 |
| 279 | 营业部详情数据-东财-营业部统计 | `stock_lhb_traderstatistic_em` | 东方财富 | symbol | ❌不可用 |
| 280 | 营业部详情数据-东财-个股龙虎榜详情 | `stock_lhb_stock_detail_em` | 东方财富 | symbol, date, flag | ❌不可用 |
| 281 | 营业部详情数据-东财-龙虎榜-营业部排行 | `stock_lh_yyb_most` | 同花顺 | null | ✅可用 |
| 282 | 营业部详情数据-东财-龙虎榜-营业部排行 | `stock_lh_yyb_capital` | 同花顺 | null | ✅可用 |
| 283 | 营业部详情数据-东财-龙虎榜-营业部排行 | `stock_lh_yyb_control` | 同花顺 | null | ✅可用 |
| 284 | 营业部详情数据-东财-龙虎榜-每日详情 | `stock_lhb_detail_daily_sina` | 新浪财经 | date | ✅可用 |
| 285 | 营业部详情数据-东财-龙虎榜-个股上榜统计 | `stock_lhb_ggtj_sina` | 新浪财经 | symbol | ❌不可用 |
| 286 | 营业部详情数据-东财-龙虎榜-营业上榜统计 | `stock_lhb_yytj_sina` | 新浪财经 | symbol | ❌不可用 |
| 287 | 营业部详情数据-东财-龙虎榜-机构席位追踪 | `stock_lhb_jgzz_sina` | 新浪财经 | symbol | ✅可用 |
| 288 | 营业部详情数据-东财-龙虎榜-机构席位成交明细 | `stock_lhb_jgmx_sina` | 新浪财经 | null | ✅可用 |

### 大宗交易  (6)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 301 | 市场统计 | `stock_dzjy_sctj` | 东方财富 | null | ✅可用 |
| 302 | 每日明细 | `stock_dzjy_mrmx` | 东方财富 | symbol, start_date, end_date | ❌不可用 |
| 303 | 每日统计 | `stock_dzjy_mrtj` | 东方财富 | start_date, end_date | ✅可用 |
| 304 | 活跃 A 股统计 | `stock_dzjy_hygtj` | 东方财富 | symbol | ❌不可用 |
| 305 | 活跃营业部统计 | `stock_dzjy_hyyybtj` | 东方财富 | symbol | ❌不可用 |
| 306 | 营业部排行 | `stock_dzjy_yybph` | 东方财富 | symbol | ❌不可用 |

### 股权质押  (8)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 78 | 股权质押市场概况 | `stock_gpzy_profile_em` | 东方财富 | null | ✅可用 |
| 79 | 上市公司质押比例 | `stock_gpzy_pledge_ratio_em` | 东方财富 | date | ✅可用 |
| 80 | 重要股东股权质押明细 | `stock_gpzy_pledge_ratio_detail_em` | 东方财富 | null | ❌不可用 |
| 81 | 个股重要股东股权质押明细 | `stock_gpzy_individual_pledge_ratio_detail_em` | 东方财富 | symbol | ✅可用 |
| 82 | 质押机构分布统计-证券公司 | `stock_gpzy_distribute_statistics_company_em` | 东方财富 | null | ❌不可用 |
| 83 | 质押机构分布统计-银行 | `stock_gpzy_distribute_statistics_bank_em` | 东方财富 | null | ❌不可用 |
| 84 | 上市公司质押比例 | `stock_gpzy_industry_data_em` | 东方财富 | null | ✅可用 |
| 248 | 机构推荐-股权质押 | `stock_cg_equity_mortgage_cninfo` | 巨潮资讯 | date | ✅可用 |

### 主力控盘与市场热度(筹码视角)  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 94 | 主力控盘-机构参与度 | `stock_comment_detail_zlkp_jgcyd_em` | 东方财富 | symbol | ✅可用 |
| 95 | 综合评价-历史评分 | `stock_comment_detail_zhpj_lspf_em` | 东方财富 | symbol | ✅可用 |
| 96 | 市场热度-用户关注指数 | `stock_comment_detail_scrd_focus_em` | 东方财富 | symbol | ✅可用 |
| 97 | 市场热度-市场参与意愿 | `stock_comment_detail_scrd_desire_em` | 东方财富 | symbol | ✅可用 |
| 157 | 东方财富-概念历史资金流 | `stock_cyq_em` | 东方财富 | symbol, adjust | ❌不可用 |


## 七、IPO 与资本运作

### 新股发行与申购  (9)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 41 | 公司动态 | `stock_xgsr_ths` | 同花顺 | null | ❌不可用 |
| 42 | 公司动态 | `stock_ipo_benefit_ths` | 同花顺 | null | ❌不可用 |
| 119 | 打新收益率 | `stock_dxsyl_em` | 东方财富 | null | ✅可用 |
| 120 | 新股申购与中签 | `stock_xgsglb_em` | 东方财富 | symbol | ❌不可用 |
| 121 | 新股申购与中签-同花顺 | `stock_ipo_ths` | 同花顺 | symbol | ❌不可用 |
| 122 | 新股申购与中签-港股-同花顺 | `stock_ipo_hk_ths` | 同花顺 | null | ✅可用 |
| 205 | 新股发行 | `stock_ipo_info` | 新浪财经 | stock | ✅可用 |
| 235 | 机构推荐-新股过会 | `stock_new_gh_cninfo` | 巨潮资讯 | null | ❌不可用 |
| 236 | 机构推荐-新股发行 | `stock_new_ipo_cninfo` | 巨潮资讯 | null | ✅可用 |

### IPO审核与辅导  (10)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 206 | 新股上会信息 | `stock_ipo_review_em` | 东方财富 | null | ✅可用 |
| 207 | IPO辅导信息 | `stock_ipo_tutor_em` | 东方财富 | null | ✅可用 |
| 289 | 首发申报信息 | `stock_ipo_declare_em` | 东方财富 | null | ✅可用 |
| 290 | IPO审核信息-全部 | `stock_register_all_em` | 东方财富 | null | ✅可用 |
| 291 | IPO审核信息-科创板 | `stock_register_kcb` | 东方财富 | null | ✅可用 |
| 292 | IPO审核信息-科创板 | `stock_register_cyb` | 东方财富 | null | ✅可用 |
| 293 | IPO审核信息-科创板 | `stock_register_sh` | 东方财富 | null | ✅可用 |
| 294 | IPO审核信息-科创板 | `stock_register_sz` | 东方财富 | null | ✅可用 |
| 295 | IPO审核信息-科创板 | `stock_register_bj` | 东方财富 | null | ✅可用 |
| 296 | IPO审核信息-达标企业 | `stock_register_db` | 东方财富 | null | ✅可用 |

### 增发/配股/回购  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 208 | 股票增发 | `stock_add_stock` | 新浪财经 | symbol | ✅可用 |
| 297 | 增发 | `stock_qbzf_em` | 东方财富 | null | ✅可用 |
| 298 | 配股 | `stock_pg_em` | 东方财富 | null | ✅可用 |
| 299 | 股票回购数据 | `stock_repurchase_em` | 东方财富 | null | ✅可用 |

### 限售解禁  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 209 | 限售解禁-个股限售解禁-新浪 | `stock_restricted_release_queue_sina` | 新浪财经 | symbol | ✅可用 |
| 210 | 限售解禁-限售股解禁 | `stock_restricted_release_summary_em` | 东方财富 | symbol, start_date, end_date | ❌不可用 |
| 211 | 限售解禁-限售股解禁详情 | `stock_restricted_release_detail_em` | 东方财富 | start_date, end_date | ✅可用 |
| 212 | 限售解禁-解禁批次 | `stock_restricted_release_queue_em` | 东方财富 | symbol | ✅可用 |
| 213 | 限售解禁-解禁股东 | `stock_restricted_release_stockholder_em` | 东方财富 | symbol, date | ❌不可用 |

### 分红与历史分红  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 141 | 分红配送-东财 | `stock_fhps_em` | 东方财富 | date | ❌不可用 |
| 142 | 分红配送详情-东财 | `stock_fhps_detail_em` | 东方财富 | symbol | ✅可用 |
| 143 | 分红情况-同花顺 | `stock_fhps_detail_ths` | 同花顺 | symbol | ✅可用 |
| 144 | 分红配送详情-港股-同花顺 | `stock_hk_fhpx_detail_ths` | 同花顺 | symbol | ❌不可用 |
| 186 | 历史分红 | `stock_history_dividend` | 新浪财经 | null | ✅可用 |
| 203 | 分红配股 | `stock_history_dividend_detail` | 新浪财经 | symbol, indicator, date | ❌不可用 |
| 204 | 历史分红 | `stock_dividend_cninfo` | 巨潮资讯 | symbol | ✅可用 |

### 股东大会  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 158 | 股东大会 | `stock_gddh_em` | 东方财富 | null | ✅可用 |


## 八、机构与研究

### 机构调研  (4)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 74 | 机构调研-统计 | `stock_jgdy_tj_em` | 东方财富 | date | ✅可用 |
| 75 | 机构调研-详细 | `stock_jgdy_detail_em` | 东方财富 | date | ❌不可用 |
| 76 | 机构调研-详细 | `stock_zyjs_ths` | 同花顺 | symbol | ✅可用 |
| 77 | 机构调研-详细 | `stock_zygc_em` | 东方财富 | symbol | ❌不可用 |

### 机构持股  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 226 | 基金持股 | `stock_fund_stock_holder` | 新浪财经 | symbol | ✅可用 |
| 228 | 机构持股一览表 | `stock_institute_hold` | 新浪财经 | symbol | ❌不可用 |
| 229 | 机构持股详情 | `stock_institute_hold_detail` | 新浪财经 | stock, quarter | ❌不可用 |
| 270 | 基金持股 | `stock_report_fund_hold` | 东方财富 | symbol, date | ❌不可用 |
| 271 | 基金持股明细 | `stock_report_fund_hold_detail` | 东方财富 | symbol, date | ❌不可用 |

### 机构推荐与评级  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 230 | 机构推荐池 | `stock_institute_recommend` | 新浪财经 | symbol | ❌不可用 |
| 231 | 机构推荐-股票评级记录 | `stock_institute_recommend_detail` | 新浪财经 | symbol | ❌不可用 |
| 232 | 机构推荐-投资评级 | `stock_rank_forecast_cninfo` | 巨潮资讯 | date | ✅可用 |

### 个股研报  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 160 | 个股研报 | `stock_research_report_em` | 东方财富 | symbol | ✅可用 |

### 分析师  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 91 | 分析师指数排行 | `stock_analyst_rank_em` | 东方财富 | year | ✅可用 |
| 92 | 分析师详情 | `stock_analyst_detail_em` | 东方财富 | analyst_id, indicator | ❌不可用 |
| 93 | 分析师详情 | `stock_comment_em` | 东方财富 | null | ✅可用 |

### 盈利预测  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 318 | 北京证券交易所-标的证券信息 | `stock_profit_forecast_em` | 东方财富 | symbol | ❌不可用 |
| 319 | 北京证券交易所-标的证券信息 | `stock_hk_profit_forecast_et` | 香港经济通 | symbol, indicator | ❌不可用 |
| 320 | 北京证券交易所-标的证券信息 | `stock_profit_forecast_ths` | 同花顺 | symbol, indicator | ❌不可用 |

### 券商业绩  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 250 | 券商业绩月报 | `stock_qsjy_em` | 东方财富 | date | ❌不可用 |


## 九、公告与事件异动

### 公告与信息披露  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 161 | 沪深京 A 股公告 | `stock_notice_report` | 东方财富 | symbol, date | ❌不可用 |
| 162 | 沪深京 A 股个股公告 | `stock_individual_notice_report` | 东方财富 | security, symbol, begin_date, end_date | ❌不可用 |

### 重大合同  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 159 | 重大合同 | `stock_zdhtmx_em` | 东方财富 | start_date, end_date | ✅可用 |

### 公司动态  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 38 | 公司动态 | `stock_gsrl_gsdt_em` | 东方财富 | date | ✅可用 |

### 停复牌与除权除息通知  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 113 | 沪深港通持股-个股详情 | `stock_tfp_em` | 东方财富 | date | ✅可用 |
| 114 | 沪深港通持股-个股详情 | `news_trade_notify_suspend_baidu` | 百度股市通 | date | ✅可用 |
| 115 | 沪深港通持股-个股详情 | `news_trade_notify_dividend_baidu` | 百度股市通 | date, cookie | ✅可用 |

### 异动股池  (7)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 355 | 相关股票 | `stock_changes_em` | 东方财富 | symbol | ❌不可用 |
| 357 | 涨停股池 | `stock_zt_pool_em` | 东方财富 | date | ❌不可用 |
| 358 | 昨日涨停股池 | `stock_zt_pool_previous_em` | 东方财富 | date | ❌不可用 |
| 359 | 强势股池 | `stock_zt_pool_strong_em` | 东方财富 | date | ❌不可用 |
| 360 | 次新股池 | `stock_zt_pool_sub_new_em` | 东方财富 | date | ❌不可用 |
| 361 | 炸板股池 | `stock_zt_pool_zbgc_em` | 东方财富 | date | ❌不可用 |
| 362 | 跌停股池 | `stock_zt_pool_dtgc_em` | 东方财富 | date | ❌不可用 |

### 板块/成份变动  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 356 | 相关股票 | `stock_board_change_em` | 东方财富 | null | ✅可用 |

### 内部交易与险资举牌  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 350 | 内部交易 | `stock_inner_trade_xq` | 雪球 | null | ✅可用 |
| 370 | 险资举牌 | `stock_rank_xzjp_ths` | 同花顺 | null | ✅可用 |

### 对外担保/公司诉讼  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 246 | 机构推荐-对外担保 | `stock_cg_guarantee_cninfo` | 巨潮资讯 | symbol, start_date, end_date | ❌不可用 |
| 247 | 机构推荐-公司诉讼 | `stock_cg_lawsuit_cninfo` | 巨潮资讯 | symbol, start_date, end_date | ❌不可用 |

### 技术形态选股  (6)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 364 | 持续放量 | `stock_rank_cxfl_ths` | 同花顺 | null | ✅可用 |
| 365 | 持续缩量 | `stock_rank_cxsl_ths` | 同花顺 | null | ✅可用 |
| 366 | 向上突破 | `stock_rank_xstp_ths` | 同花顺 | symbol | ❌不可用 |
| 367 | 向下突破 | `stock_rank_xxtp_ths` | 同花顺 | symbol | ❌不可用 |
| 368 | 量价齐升 | `stock_rank_ljqs_ths` | 同花顺 | null | ✅可用 |
| 369 | 量价齐跌 | `stock_rank_ljqd_ths` | 同花顺 | null | ❌不可用 |

### 报告披露时间  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 118 | 沪深港通持股-个股详情 | `news_report_time_baidu` | 百度股市通 | date | ✅可用 |


## 十、市场情绪、互动与 ESG

### 股票热度(雪球/东财)  (15)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 336 | 股票热度-雪球-关注排行榜 | `stock_hot_follow_xq` | 雪球 | symbol | ❌不可用 |
| 337 | 股票热度-雪球-讨论排行榜 | `stock_hot_tweet_xq` | 雪球 | symbol | ❌不可用 |
| 338 | 股票热度-雪球-交易排行榜 | `stock_hot_deal_xq` | 雪球 | symbol | ❌不可用 |
| 339 | 股票热度-东财-人气榜-A股 | `stock_hot_rank_em` | 东方财富 | null | ❌不可用 |
| 340 | 股票热度-东财-飙升榜-A股 | `stock_hot_up_em` | 东方财富 | null | ❌不可用 |
| 341 | 股票热度-东财-人气榜-港股 | `stock_hk_hot_rank_em` | 东方财富 | null | ❌不可用 |
| 342 | 历史趋势及粉丝特征-A股 | `stock_hot_rank_detail_em` | 东方财富 | symbol | ❌不可用 |
| 343 | 历史趋势及粉丝特征-港股 | `stock_hk_hot_rank_detail_em` | 东方财富 | symbol | ❌不可用 |
| 347 | 个股人气榜-实时变动-A股 | `stock_hot_rank_detail_realtime_em` | 东方财富 | symbol | ❌不可用 |
| 348 | 个股人气榜-实时变动-港股 | `stock_hk_hot_rank_detail_realtime_em` | 东方财富 | symbol | ❌不可用 |
| 349 | 热门关键词 | `stock_hot_keyword_em` | 东方财富 | symbol | ❌不可用 |
| 351 | 个股人气榜-最新排名-A股 | `stock_hot_rank_latest_em` | 东方财富 | symbol | ✅可用 |
| 352 | 个股人气榜-最新排名-港股 | `stock_hk_hot_rank_latest_em` | 东方财富 | symbol | ✅可用 |
| 353 | 热搜股票 | `stock_hot_search_baidu` | 百度股市通 | symbol, date, time | ❌不可用 |
| 354 | 相关股票 | `stock_hot_rank_relate_em` | 东方财富 | symbol | ❌不可用 |

### 涨跌投票  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 264 | 涨跌投票 | `stock_zh_vote_baidu` | 百度股市通 | symbol, indicator | ❌不可用 |

### 互动平台  (3)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 344 | 互动平台-互动易-提问 | `stock_irm_cninfo` | 巨潮资讯 | symbol | ❌不可用 |
| 345 | 互动平台-互动易-回答 | `stock_irm_ans_cninfo` | 巨潮资讯 | symbol | ❌不可用 |
| 346 | 互动平台-上证e互动 | `stock_sns_sseinfo` | 上证e互动 | symbol | ❌不可用 |

### 新闻  (2)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 116 | 沪深港通持股-个股详情 | `stock_news_em` | 东方财富 | symbol | ✅可用 |
| 117 | 沪深港通持股-个股详情 | `stock_news_main_cx` | 财新 | null | ✅可用 |

### 美港目标价  (1)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 249 | 美港目标价 | `stock_price_js` | 港股新闻 | symbol | ❌不可用 |

### ESG 评级  (5)

| 序号 | 接口名称 | 接口函数 | 数据源 | 输入参数 | 可用性 |
| ---: | --- | --- | --- | --- | :---: |
| 371 | ESG 评级数据 | `stock_esg_rate_sina` | 新浪财经 | null | ❌不可用 |
| 372 | MSCI | `stock_esg_msci_sina` | 新浪财经 | null | ❌不可用 |
| 373 | 路孚特 | `stock_esg_rft_sina` | 新浪财经 | null | ✅可用 |
| 374 | 秩鼎 | `stock_esg_zd_sina` | 新浪财经 | null | ❌不可用 |
| 375 | 华证指数 | `stock_esg_hz_sina` | 新浪财经 | null | ✅可用 |


## 使用说明

- **可用性** 列标注 ✅ 的接口可直接调用;标注 ❌ 的接口在原表中标为「不可用」,使用前需先到 AkShare 文档核对是否已修复或改名。

- **数据源** 主要集中在东方财富(207)、新浪财经(43)、同花顺(32)、巨潮资讯(23)、沪深北交易所等,跨源同主题接口可互为备份。

- 同一主题(如三大报表、龙虎榜、沪深港通持股)在多个数据源下均有覆盖,做研究时建议优先选**可用**且**字段最全**的版本,再做交叉校验。

- 本分类按投资研究工作流组织:从**市场总览**到**标的筛选**(列表/基础信息),再到**个股深研**(行情/财务/股东),接着**资金筹码**(资金流/陆股通/两融/龙虎榜/质押),然后**IPO 与资本运作**、**机构研究**、**公告事件**,最后**情绪/互动/ESG** 等衍生主题。

- 如需按数据源或可用性筛选,可打开配套文件 `docs/tutorial/akshare_api_classified.xlsx`,在工作表中按列筛选。
