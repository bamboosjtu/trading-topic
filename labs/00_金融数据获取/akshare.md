# AKShare 学习指导手册

> 适用版本：AKShare ≥ 1.18（文档站当前 1.18.75，GitHub Release 1.18.64）
> 适用对象：零基础到进阶的 Python 量化 / 财经数据分析学习者
> 核心理念：**Write less, get more** —— 用最少的代码，拿到最全的金融数据

---

## 目录

1. [认识 AKShare](#第一章-认识-akshare)
2. [安装与环境配置](#第二章-安装与环境配置)
3. [核心概念与接口命名规律](#第三章-核心概念与接口命名规律)
4. [快速入门：股票数据接口分类实战](#第四章快速入门股票数据接口分类实战)

---

## 第一章 认识 AKShare

### 1.1 什么是 AKShare

AKShare 是一个基于 Python 的**开源、免费**金融数据接口库。它把分散在东方财富、新浪财经、腾讯财经、交易所官网、国家统计局、美联储等数十个数据源的接口统一封装起来，让你用几行代码就能拿到股票、期货、基金、债券、外汇、指数、宏观、加密货币等 30+ 金融市场的结构化数据。

它最大的特点是：**不需要注册、不需要 API Key、不收费用**（个人非商用），安装即用。

### 1.2 主要特点

| 特点     | 说明                                                        |
| -------- | ----------------------------------------------------------- |
| 免费开源 | MIT 协议，GitHub 完全公开，无隐藏收费                       |
| 无需鉴权 | 不像 Tushare 需要积分/Token，装上就能调                     |
| 统一返回 | 所有接口统一返回 `pandas.DataFrame`，可直接分析             |
| 数据源广 | 覆盖 A 股、港股、美股、期货、基金、债券、外汇、宏观、加密等 |
| 持续维护 | 开发团队活跃，数据源失效会及时修复                          |
| 生态联动 | 可与 AKQuant、Backtrader、PyBroker 等量化框架配合           |

### 1.3 与其他库对比

| 对比项   | AKShare             | Tushare              | BaoStock     |
| -------- | ------------------- | -------------------- | ------------ |
| 费用     | 完全免费            | 基础免费，高阶需积分 | 免费         |
| 鉴权     | 不需要              | 需要 Token           | 需要登录     |
| 覆盖     | 极广（30+ 市场）    | 偏 A 股，深度好      | 仅 A 股      |
| 数据频率 | 实时/历史/财报/宏观 | 日/分钟/财务齐全     | 日/分钟/财务 |
| 适合     | 快速取数、多市场    | 严肃 A 股研究        | A 股回测     |

> 建议：入门和快速取数首选 AKShare；做严肃 A 股因子研究可叠加 Tushare。

### 1.4 AKShare 的"数据地图"

AKShare 的接口按市场模块组织，常见前缀如下（完整清单见官方文档「数据字典」）：

- `stock_`：股票（A 股、港股、美股）
- `futures_`：期货
- `fund_`：基金（公募、ETF、私募）
- `bond_`：债券、可转债
- `option_`：期权
- `fx_` / `currency_`：外汇、货币
- `index_` / `stock_zh_index_`：指数
- `macro_`：宏观经济（中国、美国等）
- `dc_` / `crypto_`：加密货币
- `tool_`：工具箱（如股票代码表、交易日历）

### 1.5 AKShare 的数据源

AKShare 本身不生产数据，它是对市面上数十个免费数据接口的统一封装。了解数据源有助于你判断数据可靠性、选择合适的接口，以及在某个源失效时快速切换备选。


AKShare 股票模块共有 **17 个数据源**，按重要程度分为四个层级：

**一级 — 主力源（覆盖面最广）**

| 数据源       | 标识/后缀 | 核心覆盖                                                     | 推荐场景                         |
| ------------ | --------- | ------------------------------------------------------------ | -------------------------------- |
| **东方财富** | `_em`     | 沪深京行情、历史K线(日/周/月/分钟)、资金流向、龙虎榜、大宗交易、沪深港通、财务报表、板块/概念行情、全球快讯 | **首选默认源**，数据全、字段干净 |
| **新浪财经** | `_sina`   | A/B股实时行情与历史K线、次新股、港美股行情、日内大单分时、财务报表 | 实时行情、港美股                 |
| **同花顺**   | `_ths`    | 概念/行业板块指数、财务报表、盈利预测、新股申购与中签、分红、资金流向 | 板块分类、新股数据               |
| **腾讯财经** | `_tx`     | A股历史日频K线、分笔Tick数据、A+H实时行情                    | 备选源，封IP概率低               |
| **雪球**     | `_xq`     | 个股详细信息、实时行情、股票热度                             | 个股深度信息                     |

**二级 — 官方/机构源（权威公告与监管数据）**

| 数据源             | 标识/后缀 | 核心覆盖                                                     |
| ------------------ | --------- | ------------------------------------------------------------ |
| **巨潮资讯**       | `_cninfo` | 预约披露日、信息披露公告与调研、行业分类及归属变动、股本变动、配股方案、公司概况 |
| **上海证券交易所** | `_sse`    | 股票市场总貌、每日成交概况、融资融券                         |
| **深圳证券交易所** | `_szse`   | 证券类别统计、地区/行业成交统计、融资融券                    |
| **北京证券交易所** | —         | 实时行情（经东财接口）、资产负债表、融资融券                 |

**三级 — 财经媒体/特色源（资讯与备选）**

| 数据源       | 标识/后缀 | 核心覆盖                     |
| ------------ | --------- | ---------------------------- |
| **财联社**   | `_ccls`   | 电报资讯                     |
| **富途牛牛** | `_futu`   | 美股概念板块成分股、资讯快讯 |
| **网易财经** | `_163`    | A股历史分笔Tick（备选源）    |
| **经济通**   | `_et`     | 港股盈利预测                 |

**四级 — ESG/评级源（交叉验证）**

| 数据源                 | 核心覆盖 |
| ---------------------- | -------- |
| **MSCI**               | ESG 评级 |
| **路孚特** (Refinitiv) | ESG 评级 |
| **秩鼎**               | ESG 评级 |
| **华证指数**           | ESG 评级 |

---

## 第二章 安装与环境配置

### 2.1 安装命令

```bash
# 通用安装（已装过则升级）
pip install akshare --upgrade

# 国内用户加速（清华镜像）
pip install akshare --upgrade -i https://pypi.tuna.tsinghua.edu.cn/simple

# 阿里云镜像（含信任主机参数）
pip install akshare -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host=mirrors.aliyun.com --upgrade
```

> 建议：在**虚拟环境**里安装，避免污染全局 Python。
>
> ```bash
> python -m venv venv
> source venv/bin/activate        # Windows: venv\Scripts\activate
> pip install akshare --upgrade
> ```

### 2.2 验证安装

```python
import akshare as ak
print("AKShare 版本：", ak.__version__)
print("可用接口数量：", len(dir(ak)))
```

输出版本号且无报错，即安装成功。`dir(ak)` 数量通常在 500+，代表它暴露了 500 多个数据接口。

---

## 第三章 核心概念与接口命名规律

掌握 AKShare 的命名规律，比死记函数名重要得多——因为接口会随着数据源变动而**更名**。

### 3.1 一切皆 DataFrame

每个接口都返回一个 `pandas.DataFrame`。拿到后你就能用 pandas 做任何事：筛选、统计、画图、存 CSV。

```python
import akshare as ak
df = ak.stock_zh_a_spot_em()   # 返回一个 DataFrame
print(df.shape)                # 行数、列数
print(df.columns.tolist())     # 所有字段名
```

### 3.2 命名三段式

大多数接口遵循：**`类别_市场_数据类型_源`**

| 片段 | 含义        | 举例                                                             |
| ---- | ----------- | ---------------------------------------------------------------- |
| 类别 | 数据大类    | `stock` / `fund` / `futures` / `macro`                           |
| 市场 | 交易所/地域 | `zh_a`（A股）、`hk`（港股）、`us`（美股）                        |
| 类型 | 数据种类    | `spot`（实时）、`hist`（历史）、`daily`（日线）                  |
| 源   | 数据源后缀  | `_em`（东方财富）、`_sina`（新浪）、`_tx`（腾讯）、`_xq`（雪球） |

示例拆解：`stock_zh_a_hist_em`

- `stock` 股票 · `zh_a` A股 · `hist` 历史K线 · `_em` 东方财富

### 3.3 通用参数约定

虽然每个接口不同，但高频参数高度一致：

| 参数                      | 含义     | 常见取值                                                              |
| ------------------------- | -------- | --------------------------------------------------------------------- |
| `symbol`                  | 标的代码 | `"000001"`（A股）、`"SH600000"`（雪球需带市场）、`"RB0"`（期货主力）  |
| `period`                  | 周期     | `"daily"` / `"weekly"` / `"monthly"`；分钟线 `"1" "5" "15" "30" "60"` |
| `start_date` / `end_date` | 起止日期 | `"20240101"` 字符串格式                                               |
| `adjust`                  | 复权     | `""` 不复权、`"qfq"` 前复权、`"hfq"` 后复权                           |
| `proxy`                   | 代理     | `"http://127.0.0.1:7890"` 解决网络受限                                |

### 3.4 数据源后缀怎么选

- `_em`（东方财富）：**推荐默认**，数据全、稳定、字段干净
- `_sina`（新浪）：老牌源，部分接口已标记"建议改用 `_em`"
- `_tx`（腾讯）：备用，封 IP 概率低
- `_xq`（雪球）：需要 token 的接口偶有，注意合规

> 经验法则：**优先用 `_em` 系列**，文档标记 deprecated 的接口（如 `stock_zh_a_daily`）改用新接口（`stock_zh_a_hist`）。

---

## 第四章 快速入门：股票数据接口分类实战

> 本章基于 `akshare.api.xlsx` 中 **134 个经实测可用**的接口（akshare 1.18.78），按投资研究工作流将股票接口分为 **10 大类**。每类给出核心接口的调用示例，附可用接口汇总表。
>
> 完整分类依据见 `docs/tutorial/akshare_api_classification.md`。

### 4.0 分类总览

| 序号 | 大类 | 可用接口数 | 核心用途 |
| ---: | --- | ---: | --- |
| 1 | 市场总览与统计 | 6 | 市场总貌、每日成交概况、账户统计 |
| 2 | 标的列表与基础信息 | 10 | 股票代码表、个股基础信息、行业分类 |
| 3 | 行情数据 | 11 | 实时行情、历史K线、分时数据 |
| 4 | 财务与估值 | 9 | 三大报表、财务指标、估值、商誉 |
| 5 | 股东与股本变动 | 12 | 十大股东、高管持股、股本结构 |
| 6 | 资金与筹码 | 35 | 资金流、沪深港通、两融、龙虎榜、质押 |
| 7 | IPO 与资本运作 | 26 | 新股发行、审核、增发回购、解禁、分红 |
| 8 | 机构与研究 | 7 | 机构调研、持股、研报、分析师 |
| 9 | 公告与事件异动 | 12 | 停复牌、异动股池、技术形态选股 |
| 10 | 市场情绪、互动与 ESG | 6 | 股票热度、新闻、ESG 评级 |

---

### 4.1 市场总览与统计

获取市场层面的宏观数据：交易所总貌、每日成交概况、账户开户统计等。适合做市场温度计和宏观择时参考。

```python
import akshare as ak

# 1. 上交所股票市场总貌（单次返回最近交易日）
df = ak.stock_sse_summary()
print(df)

# 2. 深交所证券类别统计（需指定日期）
df = ak.stock_szse_summary(date="20241108")

# 3. 上交所每日成交概况
df = ak.stock_sse_deal_daily(date="20241108")

# 4. A 股开户数月度统计（东财）
df = ak.stock_account_statistics_em()
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_sse_summary` | 上海证券交易所 | null | 股票市场总貌 |
| `stock_szse_summary` | 深圳证券交易所 | date | 证券类别统计 |
| `stock_szse_area_summary` | 深圳证券交易所 | date | 地区交易排序 |
| `stock_sse_deal_daily` | 上海证券交易所 | date | 每日成交概况 |
| `stock_account_statistics_em` | 东方财富 | null | 股票账户统计月度 |
| `stock_market_activity_legu` | 乐估乐股 | null | 跌停股池 |

---

### 4.2 标的列表与基础信息

获取全市场股票代码表、个股基础信息（公司概况、上市信息）、行业分类等。这是所有后续分析的起点——先拿到代码表，再逐个深入。

```python
import akshare as ak

# 1. 全 A 股代码与简称列表（最常用，无参数）
df = ak.stock_info_a_code_name()
print(df.head())  # columns: code, name

# 2. 北交所股票列表
df = ak.stock_info_bj_name_code()

# 3. 公司概况（巨潮资讯，需股票代码）
df = ak.stock_profile_cninfo(symbol="600000")

# 4. 同花顺行业一览表
df = ak.stock_board_industry_summary_ths()

# 5. A+H 股字典
df = ak.stock_zh_ah_name()
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_info_a_code_name` | 其他 | null | 全 A 股代码与简称 |
| `stock_info_bj_name_code` | 北京证券交易所 | null | 北交所股票列表 |
| `stock_zh_ah_name` | 腾讯 | null | A+H 股字典 |
| `stock_individual_basic_info_xq` | 雪球 | symbol, token, timeout | 个股基础信息 |
| `stock_individual_basic_info_hk_xq` | 雪球 | symbol, token, timeout | 港股个股基础信息 |
| `stock_profile_cninfo` | 巨潮资讯 | symbol | 公司概况 |
| `stock_ipo_summary_cninfo` | 巨潮资讯 | symbol | 上市相关信息 |
| `stock_info_change_name` | 新浪财经 | symbol | 股票更名记录 |
| `stock_industry_change_cninfo` | 巨潮资讯 | symbol, start_date, end_date | 行业归属变动 |
| `stock_board_industry_summary_ths` | 同花顺 | null | 同花顺行业一览表 |

> **提示**：雪球接口（`_xq` 后缀）需要 token，可通过浏览器抓包获取，非商用场景合规使用。

---

### 4.3 行情数据

实时行情、历史 K 线、分时数据、分笔数据。这是使用频率最高的一类接口。注意不同数据源对 `symbol` 格式的要求不同：东财用 `"600000"`，新浪用 `"sh600000"`，雪球用 `"SH600000"`。

```python
import akshare as ak

# 1. A 股历史日K线（新浪，symbol 需带前缀）
df = ak.stock_zh_a_daily(symbol="sh600000", start_date="20240101", end_date="20241108", adjust="qfq")
print(df.tail())  # columns: date, open, high, low, close, volume

# 2. A 股历史日K线（腾讯，备选源）
df = ak.stock_zh_a_hist_tx(symbol="sh600000", start_date="20240101", end_date="20241108", adjust="qfq")

# 3. 科创板实时行情（新浪）
df = ak.stock_zh_kcb_spot()

# 4. 港股实时行情（新浪）
df = ak.stock_hk_spot()

# 5. 个股实时行情（雪球，需 token）
df = ak.stock_individual_spot_xq(symbol="SH600000", token="你的token")
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_zh_a_daily` | 新浪财经 | symbol, start_date, end_date, adjust | A 股历史日K |
| `stock_zh_a_hist_tx` | 腾讯 | symbol, start_date, end_date, adjust, timeout | A 股历史日K（备选） |
| `stock_zh_a_cdr_daily` | 新浪财经 | symbol, start_date, end_date | CDR 历史行情 |
| `stock_zh_a_new` | 新浪财经 | null | 次新股列表 |
| `stock_zh_kcb_spot` | 新浪财经 | null | 科创板实时行情 |
| `stock_zh_kcb_daily` | 新浪财经 | symbol, adjust | 科创板历史日K |
| `stock_zh_kcb_report_em` | 东方财富 | from_page, to_page | 科创板公告 |
| `stock_zh_b_spot` | 新浪财经 | null | B 股实时行情 |
| `stock_individual_spot_xq` | 雪球 | symbol, token, timeout | 个股实时行情 |
| `stock_zh_ah_spot` | 腾讯 | null | A+H 股实时行情 |
| `stock_hk_spot` | 新浪财经 | null | 港股实时行情 |

> **避坑**：东财实时行情接口（`stock_zh_a_spot_em` 等）在本次测试中不可用，建议改用新浪源（`stock_zh_a_spot`）或雪球源。

---

### 4.4 财务与估值

上市公司三大报表（资产负债表、利润表、现金流量表）、财务指标、估值数据和商誉信息。做基本面研究的核心数据来源。

```python
import akshare as ak

# 1. 同花顺资产负债表（需指定 indicator）
df = ak.stock_financial_debt_new_ths(symbol="600000", indicator="按报告期")

# 2. 同花顺利润表
df = ak.stock_financial_benefit_new_ths(symbol="600000", indicator="按报告期")

# 3. 同花顺现金流量表
df = ak.stock_financial_cash_new_ths(symbol="600000", indicator="按报告期")

# 4. 关键财务指标摘要（新浪）
df = ak.stock_financial_abstract(symbol="sh600000")

# 5. A 股估值指标（百度股市通）
df = ak.stock_zh_valuation_baidu(symbol="600000", indicator="总市值", period="全部")

# 6. 个股估值（东财）
df = ak.stock_value_em(symbol="600000")

# 7. A 股商誉市场概况
df = ak.stock_sy_profile_em()
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_financial_debt_new_ths` | 同花顺 | symbol, indicator | 资产负债表 |
| `stock_financial_benefit_new_ths` | 同花顺 | symbol, indicator | 利润表 |
| `stock_financial_cash_new_ths` | 同花顺 | symbol, indicator | 现金流量表 |
| `stock_financial_abstract` | 新浪财经 | symbol | 关键指标摘要 |
| `stock_financial_abstract_new_ths` | 同花顺 | symbol, indicator | 关键指标（同花顺版） |
| `stock_financial_analysis_indicator` | 新浪财经 | symbol, start_year | 财务指标 |
| `stock_zh_valuation_baidu` | 百度股市通 | symbol, indicator, period | A 股估值指标 |
| `stock_value_em` | 东方财富 | symbol | 个股估值 |
| `stock_sy_profile_em` | 东方财富 | null | A 股商誉市场概况 |

> **提示**：东财三大报表接口（`stock_zcfz_em` 等）在本次测试中不可用，建议改用同花顺源（`stock_financial_*_new_ths`），字段同样完整。`indicator` 参数常用值：`"按报告期"` / `"按年度"` / `"按单季度"`。

---

### 4.5 股东与股本变动

十大股东、股东户数、高管持股变动、股本结构等。用于跟踪筹码集中度和内部人交易信号。

```python
import akshare as ak

# 1. 股东持股变动统计-十大流通股东（东财，按日期）
df = ak.stock_gdfx_free_holding_change_em(date="20240930")

# 2. 股东持股分析-十大流通股东
df = ak.stock_gdfx_free_holding_analyse_em(date="20240930")

# 3. 股东持股明细-十大流通股东
df = ak.stock_gdfx_free_holding_detail_em(date="20240930")

# 4. 股东户数详情（东财，按个股）
df = ak.stock_zh_a_gdhs_detail_em(symbol="600000")

# 5. 高管持股变动统计（同花顺）
df = ak.stock_management_change_ths(symbol="600000")

# 6. 股本结构（东财）
df = ak.stock_zh_a_gbjg_em(symbol="600000")

# 7. 流通股东（新浪）
df = ak.stock_circulate_stock_holder(symbol="sh600000")

# 8. 公司股本变动（巨潮资讯）
df = ak.stock_share_change_cninfo(symbol="600000", start_date="20230101", end_date="20241108")
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_gdfx_free_holding_change_em` | 东方财富 | date | 股东持股变动统计-十大流通股东 |
| `stock_shareholder_change_ths` | 同花顺 | symbol | 股东持股变动统计 |
| `stock_gdfx_free_holding_analyse_em` | 东方财富 | date | 股东持股分析-十大流通股东 |
| `stock_gdfx_holding_analyse_em` | 东方财富 | date | 股东持股分析-十大股东 |
| `stock_gdfx_free_holding_detail_em` | 东方财富 | date | 股东持股明细-十大流通股东 |
| `stock_zh_a_gdhs_detail_em` | 东方财富 | symbol | 股东户数详情 |
| `stock_management_change_ths` | 同花顺 | symbol | 高管持股变动统计 |
| `stock_share_hold_change_sse` | 上海证券交易所 | symbol | 董监高持股变动-上证 |
| `stock_share_change_cninfo` | 巨潮资讯 | symbol, start_date, end_date | 公司股本变动 |
| `stock_zh_a_gbjg_em` | 东方财富 | symbol | 股本结构 |
| `stock_circulate_stock_holder` | 新浪财经 | symbol | 流通股东 |
| `stock_main_stock_holder` | 新浪财经 | stock | 主要股东 |

---

### 4.6 资金与筹码

这是接口最多的大类（35 个可用），涵盖资金流向、沪深港通持股、融资融券、龙虎榜、大宗交易、股权质押、主力控盘等。是跟踪聪明钱和筹码分布的核心数据。

```python
import akshare as ak

# === 资金流 ===
# 1. 同花顺大单追踪（实时）
df = ak.stock_fund_flow_big_deal()

# === 沪深港通 ===
# 2. 沪深港通市场热度（东财）
df = ak.stock_hsgt_fund_flow_summary_em()

# 3. 沪深港通持股-个股（东财）
df = ak.stock_hsgt_individual_em(symbol="600000")

# 4. 沪深港通持股-个股详情（带日期范围）
df = ak.stock_hsgt_individual_detail_em(symbol="600000", start_date="20240101", end_date="20241108")

# === 融资融券 ===
# 5. 两融账户信息
df = ak.stock_margin_account_info()

# 6. 上交所融资融券汇总
df = ak.stock_margin_sse(start_date="20240101", end_date="20241108")

# 7. 深交所融资融券明细
df = ak.stock_margin_detail_szse(date="20241108")

# === 龙虎榜 ===
# 8. 龙虎榜明细（东财，按日期范围）
df = ak.stock_lhb_detail_em(start_date="20241104", end_date="20241108")

# 9. 龙虎榜机构买卖统计
df = ak.stock_lhb_jgmmtj_em(start_date="20241104", end_date="20241108")

# 10. 龙虎榜每日详情（新浪）
df = ak.stock_lhb_detail_daily_sina(date="20241108")

# === 大宗交易 ===
# 11. 大宗交易市场统计
df = ak.stock_dzjy_sctj()

# 12. 大宗交易每日统计
df = ak.stock_dzjy_mrtj(start_date="20241101", end_date="20241108")

# === 股权质押 ===
# 13. 股权质押市场概况
df = ak.stock_gpzy_profile_em()

# 14. 上市公司质押比例（按日期）
df = ak.stock_gpzy_pledge_ratio_em(date="20241108")

# 15. 个股重要股东股权质押明细
df = ak.stock_gpzy_individual_pledge_ratio_detail_em(symbol="600000")

# === 主力控盘 ===
# 16. 主力控盘-机构参与度
df = ak.stock_comment_detail_zlkp_jgcyd_em(symbol="600000")

# 17. 综合评价-历史评分
df = ak.stock_comment_detail_zhpj_lspf_em(symbol="600000")
```

**可用接口汇总**（按子类）：

| 子类 | 接口 | 数据源 | 输入参数 |
| --- | --- | --- | --- |
| 资金流 | `stock_fund_flow_big_deal` | 同花顺 | null |
| 沪深港通 | `stock_hsgt_fund_flow_summary_em` | 东方财富 | null |
| 沪深港通 | `stock_hsgt_fund_min_em` | 东方财富 | symbol |
| 沪深港通 | `stock_hsgt_individual_em` | 东方财富 | symbol |
| 沪深港通 | `stock_hsgt_individual_detail_em` | 东方财富 | symbol, start_date, end_date |
| 沪深港通 | `stock_sgt_settlement_exchange_rate_sse` | 上海证券交易所 | null |
| 沪深港通 | `stock_sgt_reference_exchange_rate_sse` | 上海证券交易所 | null |
| 融资融券 | `stock_margin_account_info` | 东方财富 | null |
| 融资融券 | `stock_margin_sse` | 上海证券交易所 | start_date, end_date |
| 融资融券 | `stock_margin_detail_sse` | 上海证券交易所 | date |
| 融资融券 | `stock_margin_szse` | 深圳证券交易所 | date |
| 融资融券 | `stock_margin_detail_szse` | 深圳证券交易所 | date |
| 融资融券 | `stock_margin_underlying_info_szse` | 深圳证券交易所 | date |
| 融资融券 | `stock_margin_bse` | 北京证券交易所 | date |
| 融资融券 | `stock_margin_detail_bse` | 北京证券交易所 | date |
| 融资融券 | `stock_margin_underlying_info_bse` | 北京证券交易所 | date |
| 龙虎榜 | `stock_lhb_detail_em` | 东方财富 | start_date, end_date |
| 龙虎榜 | `stock_lhb_jgmmtj_em` | 东方财富 | start_date, end_date |
| 龙虎榜 | `stock_lh_yyb_most` | 同花顺 | null |
| 龙虎榜 | `stock_lh_yyb_capital` | 同花顺 | null |
| 龙虎榜 | `stock_lh_yyb_control` | 同花顺 | null |
| 龙虎榜 | `stock_lhb_detail_daily_sina` | 新浪财经 | date |
| 龙虎榜 | `stock_lhb_jgzz_sina` | 新浪财经 | symbol |
| 龙虎榜 | `stock_lhb_jgmx_sina` | 新浪财经 | null |
| 大宗交易 | `stock_dzjy_sctj` | 东方财富 | null |
| 大宗交易 | `stock_dzjy_mrtj` | 东方财富 | start_date, end_date |
| 股权质押 | `stock_gpzy_profile_em` | 东方财富 | null |
| 股权质押 | `stock_gpzy_pledge_ratio_em` | 东方财富 | date |
| 股权质押 | `stock_gpzy_individual_pledge_ratio_detail_em` | 东方财富 | symbol |
| 股权质押 | `stock_gpzy_industry_data_em` | 东方财富 | null |
| 股权质押 | `stock_cg_equity_mortgage_cninfo` | 巨潮资讯 | date |
| 主力控盘 | `stock_comment_detail_zlkp_jgcyd_em` | 东方财富 | symbol |
| 主力控盘 | `stock_comment_detail_zhpj_lspf_em` | 东方财富 | symbol |
| 主力控盘 | `stock_comment_detail_scrd_focus_em` | 东方财富 | symbol |
| 主力控盘 | `stock_comment_detail_scrd_desire_em` | 东方财富 | symbol |

---

### 4.7 IPO 与资本运作

新股发行、IPO 审核、增发配股回购、限售解禁、分红派息、股东大会等。这是可用率最高的大类（26/36 ≈ 72%），适合做事件驱动和打新策略研究。

```python
import akshare as ak

# === 新股发行 ===
# 1. 打新收益率
df = ak.stock_dxsyl_em()

# 2. 新股发行信息（新浪）
df = ak.stock_ipo_info(stock="600000")

# === IPO 审核 ===
# 3. 新股上会信息
df = ak.stock_ipo_review_em()

# 4. IPO 审核信息-全部
df = ak.stock_register_all_em()

# 5. IPO 审核信息-科创板
df = ak.stock_register_kcb()

# === 增发/配股/回购 ===
# 6. 增发
df = ak.stock_qbzf_em()

# 7. 配股
df = ak.stock_pg_em()

# 8. 股票回购数据
df = ak.stock_repurchase_em()

# === 限售解禁 ===
# 9. 限售股解禁详情
df = ak.stock_restricted_release_detail_em(start_date="20241101", end_date="20241130")

# 10. 个股解禁批次（东财）
df = ak.stock_restricted_release_queue_em(symbol="600000")

# === 分红 ===
# 11. 分红配送详情（东财）
df = ak.stock_fhps_detail_em(symbol="600000")

# 12. 历史分红（巨潮资讯）
df = ak.stock_dividend_cninfo(symbol="600000")

# 13. 股东大会
df = ak.stock_gddh_em()
```

**可用接口汇总**（按子类）：

| 子类 | 接口 | 数据源 | 输入参数 |
| --- | --- | --- | --- |
| 新股发行 | `stock_dxsyl_em` | 东方财富 | null |
| 新股发行 | `stock_ipo_hk_ths` | 同花顺 | null |
| 新股发行 | `stock_ipo_info` | 新浪财经 | stock |
| 新股发行 | `stock_new_ipo_cninfo` | 巨潮资讯 | null |
| IPO 审核 | `stock_ipo_review_em` | 东方财富 | null |
| IPO 审核 | `stock_ipo_tutor_em` | 东方财富 | null |
| IPO 审核 | `stock_ipo_declare_em` | 东方财富 | null |
| IPO 审核 | `stock_register_all_em` | 东方财富 | null |
| IPO 审核 | `stock_register_kcb` | 东方财富 | null |
| IPO 审核 | `stock_register_cyb` | 东方财富 | null |
| IPO 审核 | `stock_register_sh` | 东方财富 | null |
| IPO 审核 | `stock_register_sz` | 东方财富 | null |
| IPO 审核 | `stock_register_bj` | 东方财富 | null |
| IPO 审核 | `stock_register_db` | 东方财富 | null |
| 增发/回购 | `stock_add_stock` | 新浪财经 | symbol |
| 增发/回购 | `stock_qbzf_em` | 东方财富 | null |
| 增发/回购 | `stock_pg_em` | 东方财富 | null |
| 增发/回购 | `stock_repurchase_em` | 东方财富 | null |
| 限售解禁 | `stock_restricted_release_queue_sina` | 新浪财经 | symbol |
| 限售解禁 | `stock_restricted_release_detail_em` | 东方财富 | start_date, end_date |
| 限售解禁 | `stock_restricted_release_queue_em` | 东方财富 | symbol |
| 分红 | `stock_fhps_detail_em` | 东方财富 | symbol |
| 分红 | `stock_fhps_detail_ths` | 同花顺 | symbol |
| 分红 | `stock_history_dividend` | 新浪财经 | null |
| 分红 | `stock_dividend_cninfo` | 巨潮资讯 | symbol |
| 股东大会 | `stock_gddh_em` | 东方财富 | null |

---

### 4.8 机构与研究

机构调研、机构持股、分析师排行、个股研报、盈利预测等。用于跟踪机构观点和聪明钱动向。

```python
import akshare as ak

# 1. 机构调研统计（东财，按日期）
df = ak.stock_jgdy_tj_em(date="20241108")

# 2. 机构调研详细（同花顺）
df = ak.stock_zyjs_ths(symbol="600000")

# 3. 基金持股（新浪）
df = ak.stock_fund_stock_holder(symbol="sh600000")

# 4. 个股研报（东财）
df = ak.stock_research_report_em(symbol="600000")

# 5. 分析师指数排行（东财，按年份）
df = ak.stock_analyst_rank_em(year="2024")

# 6. 机构推荐-投资评级（巨潮资讯）
df = ak.stock_rank_forecast_cninfo(date="20241108")

# 7. 个股综合评价（东财）
df = ak.stock_comment_em()
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_jgdy_tj_em` | 东方财富 | date | 机构调研统计 |
| `stock_zyjs_ths` | 同花顺 | symbol | 机构调研详细 |
| `stock_fund_stock_holder` | 新浪财经 | symbol | 基金持股 |
| `stock_research_report_em` | 东方财富 | symbol | 个股研报 |
| `stock_analyst_rank_em` | 东方财富 | year | 分析师指数排行 |
| `stock_comment_em` | 东方财富 | null | 个股综合评价 |
| `stock_rank_forecast_cninfo` | 巨潮资讯 | date | 投资评级 |

---

### 4.9 公告与事件异动

停复牌通知、异动股池（涨停/跌停/炸板）、技术形态选股、重大合同、内部交易、险资举牌等。适合做事件驱动和异动监控。

```python
import akshare as ak

# 1. 停复牌通知（东财，按日期）
df = ak.stock_tfp_em(date="20241108")

# 2. 停复牌通知（百度股市通）
df = ak.news_trade_notify_suspend_baidu(date="20241108")

# 3. 分红除权通知（百度股市通）
df = ak.news_trade_notify_dividend_baidu(date="20241108", cookie="你的cookie")

# 4. 板块/成份变动
df = ak.stock_board_change_em()

# 5. 重大合同
df = ak.stock_zdhtmx_em(start_date="20241101", end_date="20241108")

# 6. 公司动态日历
df = ak.stock_gsrl_gsdt_em(date="20241108")

# 7. 技术形态选股-持续放量
df = ak.stock_rank_cxfl_ths()

# 8. 技术形态选股-量价齐升
df = ak.stock_rank_ljqs_ths()

# 9. 险资举牌
df = ak.stock_rank_xzjp_ths()

# 10. 内部交易（雪球）
df = ak.stock_inner_trade_xq()

# 11. 报告披露时间（百度股市通）
df = ak.news_report_time_baidu(date="20241108")
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_tfp_em` | 东方财富 | date | 停复牌通知 |
| `news_trade_notify_suspend_baidu` | 百度股市通 | date | 停复牌通知 |
| `news_trade_notify_dividend_baidu` | 百度股市通 | date, cookie | 分红除权通知 |
| `stock_board_change_em` | 东方财富 | null | 板块/成份变动 |
| `stock_zdhtmx_em` | 东方财富 | start_date, end_date | 重大合同 |
| `stock_gsrl_gsdt_em` | 东方财富 | date | 公司动态 |
| `stock_rank_cxfl_ths` | 同花顺 | null | 持续放量选股 |
| `stock_rank_cxsl_ths` | 同花顺 | null | 持续缩量选股 |
| `stock_rank_ljqs_ths` | 同花顺 | null | 量价齐升选股 |
| `stock_rank_xzjp_ths` | 同花顺 | null | 险资举牌 |
| `stock_inner_trade_xq` | 雪球 | null | 内部交易 |
| `news_report_time_baidu` | 百度股市通 | date | 报告披露时间 |

---

### 4.10 市场情绪、互动与 ESG

股票热度排名、新闻资讯、ESG 评级等衍生主题。适合做情绪因子和舆情分析。

```python
import akshare as ak

# 1. 个股人气榜-最新排名-A股（东财）
df = ak.stock_hot_rank_latest_em(symbol="600000")

# 2. 个股人气榜-最新排名-港股
df = ak.stock_hk_hot_rank_latest_em(symbol="00700")

# 3. 个股新闻（东财）
df = ak.stock_news_em(symbol="600000")

# 4. 财新主站新闻
df = ak.stock_news_main_cx()

# 5. ESG 评级-路孚特（新浪）
df = ak.stock_esg_rft_sina()

# 6. ESG 评级-华证指数（新浪）
df = ak.stock_esg_hz_sina()
```

**可用接口汇总**：

| 接口 | 数据源 | 输入参数 | 说明 |
| --- | --- | --- | --- |
| `stock_hot_rank_latest_em` | 东方财富 | symbol | 个股人气榜-A股 |
| `stock_hk_hot_rank_latest_em` | 东方财富 | symbol | 个股人气榜-港股 |
| `stock_news_em` | 东方财富 | symbol | 个股新闻 |
| `stock_news_main_cx` | 财新 | null | 财新主站新闻 |
| `stock_esg_rft_sina` | 新浪财经 | null | ESG 评级-路孚特 |
| `stock_esg_hz_sina` | 新浪财经 | null | ESG 评级-华证指数 |

---

### 4.11 小结：接口选择策略

1. **优先选可用接口**：本章列出的 134 个接口均经过实测验证，可直接调用。
2. **多源互备**：同一主题在多个数据源下有覆盖（如同花顺三大报表可替代东财报表），源 A 不可用时切到源 B。
3. **注意 symbol 格式**：东财 `"600000"`，新浪 `"sh600000"`，雪球 `"SH600000"`，切勿混用。
4. **日期格式统一**：`date` / `start_date` / `end_date` 均为 `"YYYYMMDD"` 字符串。
5. **完整清单**：所有 375 个接口（含不可用）的分类明细见 `docs/tutorial/akshare_api_classification.md`，可用接口清单见 `akshare.api.xlsx`。

---

## 附录：构建工具脚本

`docs/tutorial/` 下的 `akshare_api.xlsx` 与配套 Notebook 并非手工维护，而是由本目录下两个脚本生成。两者构成一条"体检 → 重新分类并生成 Notebook"的构建链路。

### A.1 `akshare_health_check.py` — 接口可用性体检

- **作用**：遍历 akshare 中所有 `stock_*` 接口，逐个调用并记录状态（可用/失败、返回行数、上游数据源、错误摘要），输出到 `docs/tutorial/akshare_api.xlsx`。
- **输入**：无（内部默认使用 `TEST_SYMBOL="000001"`、`TEST_SYMBOL_SH="600036"`、`TEST_START="20260701"`、`TEST_END="20260720"`）。
- **输出**：`docs/tutorial/akshare_api.xlsx`（单 sheet，字段：接口、类别、上游源、状态、行数、耗时、错误、测试时间）。
- **何时运行**：akshare 版本升级后、或需要重新校验接口可用性时。运行耗时较长（每个接口最多等待 15 秒）。

```powershell
uv run --project labs python docs/tutorial/akshare_health_check.py
```

### A.2 `filter_stock_apis.py` — 按七大类重写 Excel 与 Notebook

- **作用**：读取 `akshare_health_check.py` 生成的 xlsx，按"宏观总貌与股票列表 / 行情报价 / 基本面 / 股东与持股 / 资金面 / 研报 / 新闻与公告"七大类重新分类，重写 xlsx（新增"数据源统计" sheet），并按类别生成 `akshare_stock_<类别>.ipynb` Notebook。
- **输入**：`docs/tutorial/akshare_api.xlsx`（由 `akshare_health_check.py` 生成）。
- **输出**：
  - `docs/tutorial/akshare_api.xlsx`（覆盖原文件，含 `API清单` + `数据源统计` 两个 sheet）
  - `docs/tutorial/akshare_stock_<类别>.ipynb`（每个类别一个 Notebook，仅含可用接口）
- **何时运行**：完成一次体检后、或需要重新生成分类 Notebook 时。

```powershell
uv run --project labs python docs/tutorial/filter_stock_apis.py
```

### A.3 已废弃脚本

- `build_akshare_notebooks.py`：早期的 Notebook 生成脚本，功能已合并入 `filter_stock_apis.py` 的 `generate_notebooks()` 函数，已删除。

### A.4 典型工作流

```text
akshare_health_check.py     →  docs/tutorial/akshare_api.xlsx（单 sheet 体检结果）
        ↓
filter_stock_apis.py        →  docs/tutorial/akshare_api.xlsx（双 sheet：API清单 + 数据源统计）
                               + docs/tutorial/akshare_stock_<类别>.ipynb（每类一个 Notebook）
```

> **注意**：两个脚本均依赖 `labs/pyproject.toml` 管理的 akshare 与 pandas，必须通过 `uv run --project labs` 启动。
>
> **已知缺陷**：`filter_stock_apis.py` 中 `AKSHARE_DIR` 仍硬编码为 `labs/.venv/Lib/site-packages/akshare`，违反 `AGENTS.md` "不依赖本地虚拟环境"约束。重新启用前应改为通过 `import akshare; Path(akshare.__file__).resolve().parent` 定位模块源文件。
