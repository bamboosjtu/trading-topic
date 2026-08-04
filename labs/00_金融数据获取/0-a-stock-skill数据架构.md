# a-stock-data 数据架构

## 文档定位

本文分析仓库内 `.agents/skills/a-stock-data/SKILL.md` 的十层金融数据获取策略，
并把它转换为本投资研究实验室可执行的数据源规划。

- 分析对象：`a-stock-data` v3.4.0；
- skill 声明的最近验证时间：2026-07-11；
- 本文整理时间：2026-07-24；
- 适用市场：以 A 股、沪深交易所 ETF 及 ETF 期权为主；
- 当前研究重点：行业与 ETF 的攒股收息回测。

skill 是接口知识与工程工作流，不是数据质量证明。其“已验证”“稳定”“不封 IP”等描述
只能视为历史测试记录；实际研究前仍须通过 Lab 0 Notebook 重新体检。

## 结论

`a-stock-data` 最值得吸收的不是某个接口，而是以下四项架构原则：

1. **按研究用途分层，而不是按 Python 包分目录。**
   行情、研报、信号、资金面等数据的时间语义和失败后果不同，不能共用一条无差别降级链。
2. **识别真实上游和风控面。**
   AKShare/东方财富与直连东方财富是两种实现，但仍是同一个上游风险面，不能算独立备份。
3. **稳定基础源优先，稀缺数据源按需使用。**
   行情优先通达信与腾讯；东方财富主要承担其独有的研报、资金面、龙虎榜、解禁等数据。
4. **降级必须保持业务语义。**
   只有资产、频率、复权、单位、时间点和数据含义一致，备用源才能自动接替主源。

skill 的十层覆盖面适合构建完整 A 股研究基础设施，但本项目不需要同时建设十层。
当前 Lab 0 聚焦行情、基础数据、研报、新闻与公告四个入口；Lab 1 只消费银行定投
需要的股票清单、F10、行情和分红子集。其余六层按研究问题逐步启用。

## 十层数据架构

| 层 | 解决的研究问题 | 主要数据 | skill 主源 | 独立备份或交叉验证 | 当前项目优先级 |
| --- | --- | --- | --- | --- | --- |
| 1. 行情层 | 价格、成交和估值现在是多少 | K 线、盘口、逐笔、PE/PB、市值、指数、ETF | 通达信、腾讯、百度 | 沪深交易所行情、同花顺 K 线 | **已建设** |
| 2. 研报层 | 市场和分析师如何判断行业与公司 | 个股/行业研报、PDF、评级、EPS 一致预期、语义检索 | 东方财富、同花顺、iwencai | 多源元数据互证；不存在完全等价的单一备份 | **已建设** |
| 3. 信号层 | 当下有哪些主题、资金或事件信号 | 热点归因、北向、概念、分钟资金流、龙虎榜、解禁、行业排名 | 同花顺、东方财富 | 交易所龙虎榜、HKEX 北向、部分新浪资金流 | 暂缓 |
| 4. 资金面/筹码层 | 杠杆、筹码和股东结构如何变化 | 两融、大宗交易、股东户数、分红、120 日资金流 | 东方财富 | 新浪资金流；分红应再与公告交叉验证 | **仅分红已纳入** |
| 5. 新闻层 | 市场刚发生了什么 | 个股新闻、财联社电报、7×24 快讯 | 东方财富、财联社 | 两者互备，另可用新浪/金十发现线索 | **已建设** |
| 6. 基础数据层 | 证券和公司的静态/周期属性是什么 | 财务快照、F10、公司资料、财务三表 | 通达信、东方财富、新浪 | 同花顺 F10、交易所证券名录 | **已建设** |
| 7. 公告层 | 公司法定披露了什么 | 公告检索、PDF、F10 最新提示 | 巨潮资讯、通达信 | 深交所官方；沪市可回到上交所或其他公告入口 | **已建设** |
| 8. 打板层 | 短线情绪和连板结构如何 | 涨停、炸板、跌停、昨日涨停、题材原因、炸板率 | 东方财富、同花顺 | 暂无覆盖完整且独立的备份 | 不适用于当前主线 |
| 9. ETF 期权层 | 市场如何为波动与尾部风险定价 | 合约清单、T 型报价、持仓、希腊字母、IV | 新浪 | skill 未提供独立完整备份 | 后续按需 |
| 10. 舆情互动层 | 公司如何回应投资者，市场关注什么 | 互动易、热榜、人气榜、热门概念 | 巨潮、同花顺、东方财富 | 各接口语义不同，只能互补，不能直接替换 | 后续按需 |

### 1. 行情层

skill 将行情拆成互补能力：

- 通达信 TCP：不复权 K 线、五档盘口、逐笔成交；
- 腾讯财经：实时价、PE/PB、市值、换手率、涨跌停价、指数和 ETF；
- 百度股市通：带 MA5/MA10/MA20 的 K 线。

这里的关键不是三选一，而是先定义用途。回测需要历史价格和复权口径；估值快照需要
PE/PB 与市值；盘中研究才需要盘口和逐笔。不同用途不能因为字段都含“价格”就自动替换。

对攒股收息回测，应使用：

- 不复权价格；
- 独立现金分红事件；
- 明确的交易日、手续费、税费和分红再投资规则。

若改用复权价格，必须防止再次计入现金分红。

#### 接口细节

> 以下至第 10 层的接口细节均来自 `.agents/skills/a-stock-data/SKILL.md` v3.4.0（2026-07-11 验证）。鉴权只区分公开接口与需 Key 接口；限流仅在东财系标注，mootdx/腾讯/百度为零鉴权低风险源。实际体检仍以 Lab 0 Notebook 当次结果为准。

- **`tdx_client().bars(symbol, frequency, offset)`** — 通达信 · TCP 7709 二进制 · 无鉴权
  - 关键字段：`datetime, open, close, high, low, vol, amount`
  - 备注：不复权原始价；`frequency` 取值 0/1/2/3/4/5/6/8/9/10/11（4 或 9=日线、8=1 分钟）；参数名是 `frequency` 不是 `category`，传错会被 `**kwargs` 静默吞掉退化为日线
- **`tdx_client().quotes(symbol)`** — 通达信 · TCP 7709 · 无鉴权
  - 关键字段：`price, open, high, low, last_close, bid1-5, ask1-5, vol, amount, servertime`（共 46 字段）
  - 备注：五档盘口；**不提供 PE/PB/市值/换手率/涨跌停价**
- **`tdx_client().transaction(symbol, date)`** — 通达信 · TCP 7709 · 无鉴权
  - 关键字段：`time, price, vol, num, buyorsell(0买/1卖/2中性)`
  - 备注：逐笔成交；非交易时段返回空
- **`tencent_quote(codes)`** — 腾讯财经 · HTTP `qt.gtimg.cn/q=`（GBK，`~` 分隔 88 字段） · 无鉴权（需 UA）
  - 关键字段：`name(1), price(3), last_close(4), open(5), change_pct(32), high(33), low(34), amount_wan(37), turnover_pct(38), pe_ttm(39), mcap_yi(44), float_mcap_yi(45), pb(46), limit_up(47), limit_down(48), pe_static(52)`
  - 备注：支持个股 / 指数（`sh000001` 等）/ ETF（`sh510050` 等）；**索引 43 是振幅% 不是 PB**（网上教程常错）
- **`baidu_kline_with_ma(code)`** — 百度股市通 · HTTP `finance.pae.baidu.com/selfselect/getstockquotation` · 无鉴权（需 UA + `Referer: gushitong.baidu.com`）
  - 关键字段：`time, open, close, high, low, volume, amount, ma5avgprice, ma10avgprice, ma20avgprice`
  - 备注：独有能力——返回时自带均线，无需本地计算

**主源 → 备份路径：**

- K 线全历史：mootdx → 同花顺 `d.10jqka.com.cn/v6/line/hs_{code}/01/last.js`（`01` 日 / `11` 周 / `21` 月 / `30`/`60` 分；2001 至今；JSONP 剥壳）→ 百度股市通
- 实时五档：mootdx → 沪 `yunhq.sse.com.cn:32041/v1/sh1/snap/{code}`、深 `szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code={code}`（交易所官方一手五档）
- 估值快照（PE/PB/市值）：腾讯 → 东财 push2 `api/qt/stock/get`（`f116` 总市值 / `f117` 流通市值 / `f127` 行业 / `f189` 上市日期）

mootdx（TCP）与腾讯（HTTP）属于不同协议、不同风控面，可作为行情双活；东财与 AKShare `stock_zh_a_hist` 共用东财风控面，不能算独立备份。

### 2. 研报层

研报层按检索方式分工：

- 东方财富 `reportapi`：按个股或行业获取研报元数据、评级、预测和 PDF；
- 同花顺：机构一致预期 EPS；
- iwencai：跨公司、跨行业的自然语言主题检索。

三者不是严格备份关系。东方财富适合确定标的后的完整检索，iwencai 擅长发现主题，
同花顺提供聚合预期。自动降级只能返回“研报元数据可用”，不能假装三者字段和覆盖完全一致。

研报属于观点数据。评级、目标价和盈利预测不能替代公告或财务报表中的事实。

#### 接口细节

- **`eastmoney_reports(code, max_pages)`** — 东财 reportapi · HTTP `reportapi.eastmoney.com/report/list`（`qType=0`） · 无鉴权（走 `em_get` 限流）
  - 关键字段：`title, publishDate, orgSName, infoCode, predictThisYearEps, predictNextYearEps, predictNextTwoYearEps, emRatingName, indvInduName`
  - 备注：`Referer: data.eastmoney.com/` 必填；分页 `pageNo`+`p`+`pageNum`+`pageNumber` 同时传
- **`eastmoney_industry_reports(industry_code, max_pages)`** — 东财 reportapi · 同上，`qType=1` · 无鉴权（走 `em_get` 限流）
  - 关键字段：同上 + `industryName, industryCode, attachPages, attachSize`
  - 备注：`industry_code="*"` 拉全行业后反查行业码；PDF 模板与个股研报通用
- **`download_pdf(record, target_dir)`** — 东财 PDF · HTTP `pdf.dfcfw.com/pdf/H3_{infoCode}_1.pdf` · 无鉴权（需 `Referer: data.eastmoney.com/`）
  - 关键字段：PDF 二进制
  - 备注：`len(content) >= 1024` 才落盘；文件名按 `日期_机构_标题` 安全化
- **`ths_eps_forecast(code)`** — 同花顺 · HTTP `basic.10jqka.com.cn/new/{code}/worth.html`（GBK） · 无鉴权（需 UA + `Referer: basic.10jqka.com.cn/`）
  - 关键字段：`年度, 预测机构数, 最小值, 均值, 最大值`
  - 备注：“均值”=机构一致预期 EPS；预测机构数 < 3 视为覆盖不足；无机构覆盖时返回空
- **`iwencai_search(query, channel, size)` / `iwencai_query(query, page, limit)`** — iwencai OpenAPI · HTTPS `openapi.iwencai.com/v1/comprehensive/search` 与 `/v1/query2data` · **需 `IWENCAI_API_KEY` + X-Claw-* Headers**（SkillHub 2.0 强制）
  - 关键字段：`uid, title, publish_date, extra.organization, score`
  - 备注：唯一 NL 主题搜索；`channel=report/announcement/news`；`size` 默认 10、隐藏上限 50；同 `uid` 按 `score` 去重

**主源 → 备份路径：**

- 按标的研报检索：东财 reportapi → 巨潮 webapi `p_sysapi1089?tdate=YYYY-MM-DD`（评级+目标价，需 `Accept-Enckey`=base64(AES-128-CBC(unix 秒, key=iv=`1234567887654321`))）
- 一致预期 EPS：同花顺 `worth.html` → 东财 reportapi record 的 `predictThisYearEps` 字段（fallback，仅当年）
- NL 主题发现：iwencai **无等价备份**，只能用多关键词东财/巨潮检索近似

三者并非严格备份关系：东财按标的/行业完整检索，同花顺提供聚合预期，iwencai 擅长跨标的主题发现。自动降级只能返回“研报元数据可用”，不能假装三者字段和覆盖完全一致。

### 3. 信号层

信号层把多个短周期指标组合为研究线索：

- 同花顺热点给出强势股及人工题材标签；
- 同花顺北向接口提供盘中流向，但 skill 已提示深股通序列不可靠；
- 东方财富提供概念归属、资金流、龙虎榜、解禁和行业排名；
- 交易所与 HKEX 可提供更权威、但粒度不同的备份。

这一层最容易出现相关性冒充因果关系。热点、资金流和龙虎榜只能说明市场行为，
不能直接证明公司价值变化。若未来启用，应把它定义为“候选线索层”，而不是买卖信号层。

#### 接口细节

- **`ths_hot_reason(date)`** — 同花顺 · HTTP `zx.10jqka.com.cn/event/api/getharden/date/{date}/orderby/date/orderway/desc/charset/GBK/` · 无鉴权（需 UA）
  - 关键字段：`code, name, reason(题材归因), zhangfu, huanshou, chengjiaoe, ddejingliang, close, market`
  - 备注：零鉴权 ~73ms 返回 ~125 只强势股；`reason` 是同花顺编辑部人工标签（如“算力租赁+Token工厂+AI政务”）
- **`hsgt_realtime()`** — 同花顺 · HTTP `data.hexin.cn/market/hsgtApi/method/dayChart/` · 无鉴权（需 UA + `Host: data.hexin.cn` + `Referer: https://data.hexin.cn/`）
  - 关键字段：`time, hgt_yi, sgt_yi`
  - 备注：262 个分钟点（含集合竞价 09:10–15:00）；**hgt 可用，sgt 自 2024-08 收紧盘中披露后不可靠**；自缓存到 `~/.tradingagents/cache/northbound_daily.csv`
- **`eastmoney_concept_blocks(code)`** — 东财 push2 · HTTP `push2.eastmoney.com/api/qt/slist/get`（`spt=3`） · 无鉴权（走 `em_get` 限流）
  - 关键字段：`boards[{name, code(BK), change_pct, lead_stock}], concept_tags`
  - 备注：一次请求拿全行业/概念/地域混合；V3.2.2 替换失效的百度 PAE `getrelatedblock`
- **`eastmoney_fund_flow_minute(code)`** — 东财 push2 · HTTP `push2.eastmoney.com/api/qt/stock/fflow/kline/get`（`klt=1`） · 无鉴权（走 `em_get` 限流）
  - 关键字段：`time, main_net, small_net, mid_net, large_net, super_net`
  - 备注：单位**元**；`klt=1` 分钟 / `klt=101` 日
- **`dragon_tiger_board(code, trade_date, look_back)`** — 东财 datacenter · HTTP `datacenter-web.eastmoney.com/api/data/v1/get`，`reportName=RPT_DAILYBILLBOARD_DETAILSNEW` + `RPT_BILLBOARD_DAILYDETAILSBUY`/`SELL` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`records[{date, reason, net_buy, turnover}], seats{buy,sell} TOP5, institution{buy_amt, sell_amt, net_amt}`
  - 备注：ST 5% 涨跌停易触发（连续三日偏离值累计 12%），科创板 20% 少触发
- **`lockup_expiry(code, trade_date, forward_days)`** — 东财 datacenter · 同上，`reportName=RPT_LIFT_STAGE` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`history/upcoming[{date, type(FREE_SHARES_TYPE), shares, able_shares, ratio}]`
  - 备注：V3.4 字段改列名（旧 `LIMITED_STOCK_TYPE` 已废）；`able_shares` 更贴近真实抛压；`ratio` 是小数
- **`industry_comparison(top_n)`** — 东财 push2 · HTTP `push2.eastmoney.com/api/qt/clist/get`（`m:90+t:2`） · 无鉴权（走 `em_get` 限流）
  - 关键字段：`top/bottom[{rank, name, change_pct, code, up_count, down_count, leader, leader_change}]`
  - 备注：**`fid=f3` 必填**，否则 `top`/`bottom` 切片非按涨幅排序（V3.4 修复）；~100 个东财行业
- **`daily_dragon_tiger(trade_date, min_net_buy)`** — 东财 datacenter · 同 `dragon_tiger_board`，filter 仅按 `TRADE_DATE` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`stocks[{code, name, reason, close, change_pct, net_buy_wan, buy_wan, sell_wan, turnover_pct}]`
  - 备注：全市场当日汇总；非交易日或盘后未更新时返回空

**主源 → 备份路径：**

- 龙虎榜：东财 datacenter → `dragon_tiger_backup(trade_date)`（沪 `query.sse.com.cn/infodisplay/showTradePublicFile.do` + 深 `szse.cn/api/report/ShowReport/data?CATALOGID=1842_xxpl`，含营业部席位，零鉴权一手权威）
- 个股资金流：东财 push2 → `fund_flow_backup(code, days)`（新浪 `vip.stock.finance.sina.com.cn/.../MoneyFlow.ssl_qsfx_zjlrqs`，日度四档净额）
- 北向权威：同花顺 hexin → HKEX 官方 `hkex.com.hk/chi/csm/DailyStat/data_tab_daily_{YYYYMMDD}c.js`（成交额/额度/十大活跃股）
- 概念板块归属：东财 slist → 无独立完整备份（百度 PAE 已失效）

`push2`/`push2his`/`push2ex` 系列对部分大陆住宅 IP 有连接级风控，偶发 `HTTP 000` 或返回空——非代码问题，换网络或调大 `EM_MIN_INTERVAL` 即可。

### 4. 资金面/筹码层

skill 将融资融券、大宗交易、股东户数、分红和日级资金流放在同一层，因为它们都描述
持仓结构或资金行为。但它们的时间尺度不同：

- 两融和资金流：日级；
- 大宗交易：事件级；
- 股东户数：通常为季度或不定期披露；
- 分红：董事会预案、股东大会批准、实施公告、股权登记和除权除息组成事件链。

当前项目只应优先吸收分红数据，并以实施公告为准。预案不能作为已经收到的现金流，
股东户数也只能在实际披露日之后进入回测。

#### 接口细节

- **`margin_trading(code, page_size)`** — 东财 datacenter · HTTP `datacenter-web.eastmoney.com/api/data/v1/get`，`reportName=RPTA_WEB_RZRQ_GGMX` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`date, rzye, rzmre, rzche, rqye, rqmcl, rqchl, rzrqye`
  - 备注：日级；金额单位**元**；`filter_str=(SCODE="{code}")`
- **`block_trade(code, page_size)`** — 东财 datacenter · 同上，`reportName=RPT_DATA_BLOCKTRADE` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`date, price, close, premium_pct, vol, amount, buyer, seller`
  - 备注：事件级；`premium_pct` 由 `DEAL_PRICE/CLOSE_PRICE-1` 本地计算
- **`holder_num_change(code, page_size)`** — 东财 datacenter · 同上，`reportName=RPT_HOLDERNUMLATEST` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`date, holder_num, change_num, change_ratio, avg_shares`
  - 备注：季度级或不定期披露；`change_ratio` 已是百分比数字
- **`dividend_history(code, page_size)`** — 东财 datacenter · 同上，`reportName=RPT_SHAREBONUS_DET` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`date(EX_DIVIDEND_DATE), bonus_rmb(PRETAX_BONUS_RMB 每股税前), transfer_ratio(每 10 股转增), bonus_ratio(每 10 股送股), plan(ASSIGN_PROGRESS)`
  - 备注：**每股税前派息**；`plan` 含“实施”才进入回测；本项目 Lab 1 当前以新浪 `stock_history_dividend_detail` 为主源、东财为备源
- **`stock_fund_flow_120d(code)`** — 东财 push2his · HTTP `push2his.eastmoney.com/api/qt/stock/fflow/daykline/get`（`lmt=120`） · 无鉴权（走 `em_get` 限流）
  - 关键字段：`date, main_net, small_net, mid_net, large_net, super_net`
  - 备注：单位**元**；住宅 IP 间歇 `HTTP 000` 风控，非代码问题

**主源 → 备份路径：**

- 个股日级资金流：东财 push2his → `fund_flow_backup(code, days)`（新浪 `MoneyFlow.ssl_qsfx_zjlrqs`，返回 `net_amount/turnover` 四档净额，60 日窗口）
- 分红：东财 `RPT_SHAREBONUS_DET` ↔ 新浪 `stock_history_dividend_detail`（Lab 1 当前路由：新浪主源 + 东财备源）；分红**必须再与公告层交叉验证**（实施公告为准，预案不能进入现金流）
- 融资融券/大宗交易/股东户数：东财 datacenter **无独立完整备份**，被封时只能换网络或等待 IP 解封

`margin_trading`/`block_trade`/`holder_num_change`/`dividend_history` 共用 `eastmoney_datacenter()` 统一入口，单接口故障时其他接口仍可独立调用。

### 5. 新闻层

新闻层采用“发现线索而非确认事实”的定位：

- 财联社与东方财富 7×24 快讯来自不同上游，可互为服务可用性备份；
- 东方财富个股新闻适合按证券代码聚合；
- 新浪、金十可作为额外线索源。

同一事件可能被重复转载，需以稳定链接、标题、发布时间和内容哈希去重。
凡是涉及业绩、分红、重大合同或监管事项的新闻，都应回到公告验证。

#### 接口细节

- **`eastmoney_stock_news(code, page_size)`** — 东财 search-api-web · HTTP `search-api-web.eastmoney.com/search/jsonp`（JSONP） · 无鉴权（走 `em_get` 限流，需 `Referer: so.eastmoney.com/`）
  - 关键字段：`title, content, time, source, url`
  - 备注：`result.cmsArticleWebOld` 直接是文章列表（非 `{list:[...]}` 嵌套）；住宅 IP 间歇只回 `passportWeb` 而无文章列表，属风控非代码问题
- **`cls_telegraph(page_size)`** — 财联社 · HTTP `www.cls.cn/v1/roll/get_roll_list` · 无鉴权（本地签名 `sign=md5(sha1(按 key 字典序拼接的 query 串))`，零 key）
  - 关键字段：`title, content, time(YYYY-MM-DD HH:MM:SS)`
  - 备注：V3.4 复活（旧 `nodeapi` 2026-05 下线）；`ctime` 是 Unix 秒时间戳，本地转 datetime；偏 A 股财经
- **`eastmoney_global_news(page_size)`** — 东财 np-weblist · HTTP `np-weblist.eastmoney.com/comm/web/getFastNewsList`（`biz=web_724, fastColumn=102`） · 无鉴权（走 `em_get` 限流，需 `Referer: kuaixun.eastmoney.com/`）
  - 关键字段：`title, summary, time`
  - 备注：7×24 滚动；`req_trace=uuid.uuid4()` 必填

**主源 → 备份路径：**

- 全市场快讯：财联社 ↔ 东财 7×24（两条不同源、不同风控面，互为独立备份）→ 金十 `jin10.com/flash_newest.js`（额外线索）
- 个股新闻：东财 search-api-web → 新浪 7×24 `zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&page_size=20&dire=f`（`ext.stocks` 字段带个股关联可过滤）
- 公告级事实：新闻**不能替代公告**，业绩/分红/重大合同/监管事项必须回到第 7 层公告层验证

去重须以稳定链接 + 标题 + 发布时间 + 内容哈希为联合键，仅靠标题去重会误并不同来源的相同事件报道。

### 6. 基础数据层

基础数据层混合了两类数据：

- 相对稳定的证券主数据：代码、名称、交易所、证券类型、上市日期、行业；
- 随报告期变化的公司数据：财务三表、财务快照、股本与 F10。

通达信适合快速财务快照和 F10，新浪提供结构化三表，东方财富补充个股信息。
本项目还应优先接入交易所证券名录，避免仅依赖财经网站维护证券主数据。

财务字段必须同时保留报告期、公告日、币种、单位、合并口径和来源版本。

#### 接口细节

- **`tdx_client().finance(symbol)`** — 通达信 · TCP 7709 · 无鉴权
  - 关键字段：37 字段季报快照 `liutongguben, zongguben, eps, bvps, roe, profit, income, meigujingzichan, meigugongjijin, meiguweifeipeili` 等
  - 备注：`market=0` 深 / `1` 沪；快照口径，需自行关联报告期
- **`tdx_client().F10(symbol, name)`** — 通达信 · TCP 7709 · 无鉴权
  - 关键字段：9 大类文本 `最新提示, 公司概况, 财务分析, 股东研究, 股本结构, 资本运作, 业内点评, 行业分析, 公司大事`
  - 备注：“股东研究”含历史十大股东 16000+ chars，建议只留最新一期以节省 70% token；Lab 1 用“公司概况”做银行关键词匹配
- **`eastmoney_stock_info(code)`** — 东财 push2 · HTTP `push2.eastmoney.com/api/qt/stock/get` · 无鉴权（走 `em_get` 限流）
  - 关键字段：`code(f57), name(f58), industry(f127), total_shares(f84), float_shares(f85), mcap(f116), float_mcap(f117), list_date(f189, YYYYMMDD), price(f43)`
  - 备注：`list_date` 是 `YYYYMMDD` 字符串，需标准化为 ISO 日期
- **`sina_financial_report(code, report_type, num)`** — 新浪 · HTTP `quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022` · 无鉴权（需 UA）
  - 关键字段：`{报告期, <科目>, <科目>_同比}` 按报告期倒序
  - 备注：`report_type=fzb` 资产负债表 / `lrb` 利润表 / `llb` 现金流量表；实际结构是 `result.data.report_list` 按报告期为键的 dict，每期 `data` 才是行项列表

**主源 → 备份路径：**

- 财务三表：新浪 `getFinanceReport2022` → 同花顺 F10 `basic.10jqka.com.cn/api/stock/finance/{code}_debt.json`（`_benefit` 利润表 / `_cash` 现金流量表，仅 UA，5 连发不封）→ mootdx `finance()` 快照
- 公司资料/F10：mootdx `F10()` → 同花顺 F10 → 东财个股信息
- 证券主数据（代码/名称/交易所/上市日期/行业）：东财 push2 → **交易所证券名录**（沪 `query.sse.com.cn` / 深 `szse.cn/api/disc/announcement/annList`，本项目 Lab 1 已通过 AKShare `fetch_exchange_stock_lists` 接入交易所清单为主源）

财务字段必须同时保留：报告期、公告日、币种、单位、合并口径、来源版本——只有数值没有口径的财务数据无法跨期比较，也无法跨源交叉验证。

### 7. 公告层

公告层以巨潮为主要检索入口，以交易所和公告 PDF 为最终证据。通达信 F10 的“最新提示”
只是摘要，不能替代公告原文。

公告降级需要特别谨慎：

- 深市可从巨潮降级到深交所官方；
- 沪市应优先回到上交所披露入口；
- 东方财富公告可以做检索备份，但不应提升为比交易所更权威的事实源。

研究包应保存公告 URL、发布日期、证券代码、公告类型、PDF 哈希和修订关系。

#### 接口细节

- **`cninfo_announcements(code, page_size)`** — 巨潮 · HTTPS POST `www.cninfo.com.cn/new/hisAnnouncement/query`（`application/x-www-form-urlencoded`） · 无鉴权（需 UA + `Referer: cninfo.com.cn/new/disclosure` + `Origin: cninfo.com.cn`）
  - 关键字段：`title(announcementTitle), type(announcementTypeName), date(_cninfo_ts_to_date(announcementTime)), url(annoId)`
  - 备注：`announcementTime` 是 Unix 毫秒；`orgId` 必须 `_cninfo_orgid()` 动态查 `szse_stock.json` 映射，硬编码 `gssx0{code}` 会致 601xxx 段返回 `totalAnnouncement=0`
- **`tdx_client().F10(symbol, name='最新提示')`** — 通达信 · TCP 7709 · 无鉴权
  - 关键字段：文本摘要（公告/分红/股东大会决议等）
  - 备注：仅摘要，**不能替代公告原文**；用于快速发现待检索的公告类型

**主源 → 备份路径：**

- 深市公告：巨潮 `hisAnnouncement/query` → `announcements_backup()` 深市分支（深交所官方 `szse.cn/api/disc/announcement/annList`，POST JSON body，PDF 直链 `disc.static.szse.cn/download{attachPath}`）
- 沪市公告：巨潮（统一入口仍可用）→ `announcements_backup()` 沪市分支（东财 `np-anotice-stock.eastmoney.com/api/security/ann`，PDF `pdf.dfcfw.com/pdf/H2_{art_code}_1.pdf`）→ 上交所披露入口
- 公告 PDF：巨潮/深交所/东财均提供直链；保存时计算 PDF 哈希以识别修订版本

公告降级必须按交易所分流：深市优先深交所官方，沪市优先上交所披露入口；东财公告可作检索备份，但不应提升为比交易所更权威的事实源。`tdx_client().F10('最新提示')` 只用于缩小检索范围，确认事实仍须回到公告原文 PDF。

### 8. 打板层

打板层使用东方财富四类股票池和同花顺涨停原因，计算连板梯队、炸板率、晋级率和题材情绪。
这是交易情绪数据，不是当前攒股收息研究的必要输入。

该层高度依赖东方财富 `push2ex`，且 skill 明确没有完整独立备份。如果未来启用，应默认
标记为探索性数据，不能让单一源中断影响长期价值研究主线。

#### 接口细节

- **`em_zt_pool(date)`** — 东财 push2ex · HTTP `push2ex.eastmoney.com/getTopicZTPool`（`sort=fbt:asc`） · 无鉴权（走 `em_get` 限流，需 `Referer: quote.eastmoney.com/`）
  - 关键字段：`code, name, price(÷1000), pct, amount, float_cap, turnover, limit_days(连板数), first_seal, last_seal, seal_fund(元), break_times, industry, zt_stat(N天M板)`
  - 备注：`ut=7eea3edcaed734bea9cbfc24409ed989, dpt=wz.ztzt`；`date=YYYYMMDD` 必须交易日
- **`em_zb_pool(date)`** — 东财 push2ex · `getTopicZBPool`（`sort=fbt:asc`） · 同上
  - 关键字段：`code, name, price, limit_price, pct, turnover, first_seal, break_times, amplitude, speed, industry, zt_stat`
  - 备注：炸板池（涨停后开板）
- **`em_dt_pool(date)`** — 东财 push2ex · `getTopicDTPool`（`sort=fund:asc`） · 同上
  - 关键字段：`code, name, price, pct, turnover, pe, seal_fund, last_seal, board_amount, dt_days, open_times, industry`
  - 备注：跌停池
- **`em_yzt_pool(date)`** — 东财 push2ex · `getYesterdayZTPool`（`sort=zs:desc`） · 同上
  - 关键字段：`code, name, price, pct, turnover, amplitude, speed, y_first_seal, y_limit_days, industry, zt_stat`
  - 备注：昨涨停今表现，算晋级率/赚钱效应
- **`ths_limit_up_pool(date)`** — 同花顺 · HTTP `data.10jqka.com.cn/dataapi/limit_up/limit_up_pool` · 无鉴权（需 UA）
  - 关键字段：`code, name, price, pct, reason, board_type(换手/一字/T字板), seal_rate(0-1), break_times, seal_amount(元), high_days, first_time, is_again`
  - 备注：`first_limit_up_time` 是 **Unix 秒时间戳**（非 HHMMSS）；`filter=HS,GEM2STAR` 控制板块范围
- **`limit_up_sentiment(date)`** — 本地组合 · 调用 `em_zt_pool`/`em_zb_pool`/`em_dt_pool` · —
  - 关键字段：`zt_count, zb_count, dt_count, break_rate(%), max_height(连板), ladder{板数:家数}`
  - 备注：炸板率 = `zb/(zt+zb)`；晋级率用 `em_yzt_pool` 的 `pct>=9.8` 自算

**主源 → 备份路径：**

- 涨停四池：东财 push2ex → **无独立完整备份**（skill 明确标注）
- 涨停原因题材：同花顺 `limit_up_pool` → 东财 `industry` 字段（仅行业，无题材标签）
- 打板情绪：东财四池组合 → 无备份

`price`/`limit_price` 字段已 ÷1000（原始值是 ×1000 整数）；金额单位均为**元**；非交易日 `data` 返回 null。该层在当前 Lab 0 主线不建设，仅作接口登记备查。

### 9. ETF 期权层

ETF 期权层通过新浪获取合约清单、T 型报价、持仓量、希腊字母和隐含波动率。
它适合研究市场风险定价、对冲成本和尾部风险，但不应与 ETF 现货行情混在同一标准表。

关键校验包括：

- 合约代码、到期月、认购/认沽、行权价；
- 报价时间与标的价格是否同步；
- IV 是小数还是百分数；
- 希腊字母方向和单位；
- 交易所合约清单与新浪返回是否一致。

skill 当前没有提供独立完整备份，因此不宜直接成为生产级数据入口。

#### 接口细节

- **`sina_option_codes(underlying, call)`** — 新浪 · HTTP `stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName?exchange=null&cate={50ETF/300ETF/科创50ETF/500ETF}` · 无鉴权（需 `Referer: stock.finance.sina.com.cn/`）
  - 关键字段：`{月份YYMM: [合约代码...]}`（首个月份丢弃，第一个 key 即近月）
  - 备注：`underlying`: `510050`/`510300`/`588000`/`510500`；`call=True` 认购 / `False` 认沽；合约代码再走 `_sina_opt_list(f"OP_UP_{underlying}{m}")` 取
- **`sina_option_tquote(code)`** — 新浪 · HTTP `hq.sinajs.cn/list=CON_OP_{code}`（GBK，逗号分隔，去 `var hq_str_XXX="..."` 壳） · 无鉴权（需 `Referer: stock.finance.sina.com.cn/`）
  - 关键字段：`bid_vol, bid, last, ask, ask_vol, open_interest(持仓量), pct, strike(行权价), prev_close, open, limit_up, limit_down, name, amplitude, high, low, volume, amount`
  - 备注：共 43 字段，长度 < 43 返回空
- **`sina_option_greeks(code)`** — 新浪 · HTTP `hq.sinajs.cn/list=CON_SO_{code}`（GBK） · 无鉴权（需 `Referer: stock.finance.sina.com.cn/`）
  - 关键字段：`name, volume, delta, gamma, theta, vega, iv(隐含波动率,小数), high, low, trade_code, strike, last, theory(理论价值)`
  - 备注：**`raw[1:4]` 是 3 个空串必须跳过**，否则 Delta/IV 全错位；`iv` 是小数（0.1735 = 17.35%），使用时注意单位

**主源 → 备份路径：**

- 合约清单：新浪 `StockOptionService.getStockName` → 交易所官方合约清单（上交所 `sse.com.cn`/深交所 `szse.cn` 月度合约文件，需手工校对）
- T 型报价 / Greeks / IV：新浪 `hq.sinajs.cn` → **无独立完整备份**；交易所官方仅给合约清单与开收盘，希腊字母与 IV 需本地用 BSM 模型从合约价反算

校验要点：合约代码、到期月、认购/认沽、行权价四要素主键唯一；报价时间与 ETF 现货价格同步；IV 单位（小数 vs 百分数）必须显式标注；希腊字母方向（Delta 认购为正/认沽为负）与单位；交易所合约清单与新浪返回一致。该层在当前 Lab 0 主线不建设。

### 10. 舆情互动层

互动易、热榜和人气榜回答的是三个不同问题：

- 互动易：公司如何回应投资者提问；
- 同花顺热榜：市场正在关注哪些股票和概念；
- 东方财富人气榜：站内用户关注度如何变化。

这些数据只能互补，不能互相降级。公司回复也不等同于审计后的公告事实；
热度更不等于基本面质量。

#### 接口细节

- **`cninfo_irm(code, page_size, page_num)`** — 巨潮 irm · HTTPS POST `irm.cninfo.com.cn/newircs/index/queryKeyboardInfo`（取 `secid`）+ `irm.cninfo.com.cn/newircs/company/question` · 无鉴权（需 UA）
  - 关键字段：`code, company, question, answer, answerer, ask_time`
  - 备注：第二步参数必须放 **query string**（POST 但 body 空），否则 400；`ask_time` 是 Unix 毫秒时间戳；最新提问常 `answer=None`，回复率因公司而异
- **`ths_hot_list(period)`** — 同花顺 · HTTP `dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock` · 无鉴权（需 UA）
  - 关键字段：`rank, code, name, heat(人气值), pct, rank_chg, concepts[], tag`
  - 备注：`period=hour`/`day`；`stock_type=a, list_type=normal`
- **`em_hot_rank(top)`** — 东财 emappdata · HTTPS POST `emappdata.eastmoney.com/stockrank/getAllCurrentList` · 无鉴权（需 `appId=appId01, globalId=786e4c21-70dc-435a-93bb-38`）
  - 关键字段：`rank, code(带 SZ/SH 前缀), name, price, pct, rank_chg`
  - 备注：名称/价格需另走 `push2.eastmoney.com/api/qt/ulist.np/get` 补（`SZ`→`0.`、`SH`→`1.`）；`diff` 偶尔是 dict 需 `list(values())` 归一化
- **`em_hot_concept(code)`** — 东财 emappdata · HTTPS POST `emappdata.eastmoney.com/stockrank/getHotStockRankList` · 同上
  - 关键字段：`concept, bk, hit(命中热度)`
  - 备注：`srcSecurityCode` 带前缀（`SH`/`SZ`）；按 `hit` 降序

**主源 → 备份路径：**

- 互动易问答：巨潮 `irm.cninfo.com.cn`（深沪统一入口）→ **无等价备份**（这是投资者互动问答的唯一官方源）
- 热度榜单：同花顺热榜 ↔ 东财人气榜（语义不同——同花顺偏概念热度，东财偏站内用户关注），可互补但不可直接替换
- 概念命中：东财 `getHotStockRankList` → 第 3 层 `eastmoney_concept_blocks`（板块归属，不含命中热度）

互动易公司回复不等同于审计后的公告事实；热度/人气榜更不等于基本面质量。该层在当前 Lab 0 主线不建设，仅作接口登记备查。

## 宏观、中观、微观的横向视角

十层是按用途纵向拆分，宏观/中观/微观则是每层内部的横向粒度：

| 层 | 宏观 | 中观 | 微观 |
| --- | --- | --- | --- |
| 行情 | 市场总貌、宽基指数 | 行业指数、主题/行业 ETF | 个股与单只 ETF |
| 研报 | 宏观策略、资产配置 | 行业与产业链研报 | 公司研报与盈利预测 |
| 信号 | 市场广度、北向总量 | 行业轮动、题材热度 | 个股龙虎榜、解禁、资金流 |
| 资金面 | 全市场两融等总量 | 行业资金与持仓结构 | 个股两融、大宗、股东户数、分红 |
| 新闻 | 全市场快讯、政策 | 行业事件与产业政策 | 公司新闻 |
| 基础数据 | 证券名录、交易日历 | 行业分类、ETF 资料 | 公司资料与财务报表 |
| 公告 | 监管规则、交易所通知 | 行业相关监管披露 | 公司法定公告 |
| 打板 | 涨跌停家数、炸板率 | 连板梯队、题材板块 | 单只股票封板质量 |
| ETF 期权 | 全市场波动风险偏好 | 标的/期限结构 | 单合约报价与 Greeks |
| 舆情互动 | 全市场热榜 | 概念热度 | 公司问答与个股人气 |

skill 在微观个股层覆盖最强，在宏观数据方面并不完整。利率、通胀、社融、PMI、
行业产量和政策统计等真正的宏观/中观基本面数据，仍需央行、国家统计局、行业协会及
交易所等一手来源补充，不能用新闻热度替代。

## 来源

- 仓库工作流：`.agents/skills/a-stock-data/SKILL.md`，v3.4.0；
- skill 项目主页：<https://github.com/simonlin1212/a-stock-data>；
- AKShare 股票官方文档：<https://akshare.akfamily.xyz/data/stock/stock.html>。

以上来源用于理解接口设计。任何随时间变化的接口状态、字段和覆盖范围，均应以实际
体检结果和一手官方文档为准。