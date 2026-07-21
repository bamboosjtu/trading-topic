# AKShare 学习指导手册

> 适用版本：AKShare ≥ 1.18（文档站当前 1.18.75，GitHub Release 1.18.64）
> 适用对象：零基础到进阶的 Python 量化 / 财经数据分析学习者
> 核心理念：**Write less, get more** —— 用最少的代码，拿到最全的金融数据

---

## 目录

1. [认识 AKShare](#第一章-认识-akshare)
2. [安装与环境配置](#第二章-安装与环境配置)
3. [核心概念与接口命名规律](#第三章-核心概念与接口命名规律)
4. [快速入门：你的第一个程序](#第四章-快速入门你的第一个程序)
5. [各数据模块实战](#第五章-各数据模块实战)
6. [数据处理与可视化](#第六章-数据处理与可视化)
7. [综合实战案例](#第七章-综合实战案例)
8. [常见问题与避坑指南](#第八章-常见问题与避坑指南)
9. [进阶与生态](#第九章-进阶与生态)
10. [学习路线与资源](#第十章-学习路线与资源)

---

## 第一章 认识 AKShare

### 1.1 什么是 AKShare

AKShare 是一个基于 Python 的**开源、免费**金融数据接口库。它把分散在东方财富、新浪财经、腾讯财经、交易所官网、国家统计局、美联储等数十个数据源的接口统一封装起来，让你用几行代码就能拿到股票、期货、基金、债券、外汇、指数、宏观、加密货币等 30+ 金融市场的结构化数据。

它最大的特点是：**不需要注册、不需要 API Key、不收费用**（个人非商用），安装即用。

### 1.2 主要特点

| 特点 | 说明 |
|------|------|
| 免费开源 | MIT 协议，GitHub 完全公开，无隐藏收费 |
| 无需鉴权 | 不像 Tushare 需要积分/Token，装上就能调 |
| 统一返回 | 所有接口统一返回 `pandas.DataFrame`，可直接分析 |
| 数据源广 | 覆盖 A 股、港股、美股、期货、基金、债券、外汇、宏观、加密等 |
| 持续维护 | 开发团队活跃，数据源失效会及时修复 |
| 生态联动 | 可与 AKQuant、Backtrader、PyBroker 等量化框架配合 |

### 1.3 它 vs 其他库

| 对比项 | AKShare | Tushare | BaoStock |
|--------|---------|---------|----------|
| 费用 | 完全免费 | 基础免费，高阶需积分 | 免费 |
| 鉴权 | 不需要 | 需要 Token | 需要登录 |
| 覆盖 | 极广（30+ 市场） | 偏 A 股，深度好 | 仅 A 股 |
| 数据频率 | 实时/历史/财报/宏观 | 日/分钟/财务齐全 | 日/分钟/财务 |
| 适合 | 快速取数、多市场 | 严肃 A 股研究 | A 股回测 |

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

---

## 第二章 安装与环境配置

### 2.1 环境要求

- **操作系统**：Windows / macOS / Linux（64 位）
- **Python 版本**：≥ 3.9（推荐 3.9 ~ 3.12，最新版已支持 3.13/3.14）

### 2.2 安装命令

```bash
# 通用安装（已装过则升级）
pip install akshare --upgrade

# 国内用户加速（清华镜像）
pip install akshare --upgrade -i https://pypi.tuna.tsinghua.edu.cn/simple

# 阿里云镜像（含信任主机参数）
pip install akshare -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host=mirrors.aliyun.com --upgrade
```

> 建议：在**虚拟环境**里安装，避免污染全局 Python。
> ```bash
> python -m venv venv
> source venv/bin/activate        # Windows: venv\Scripts\activate
> pip install akshare --upgrade
> ```

### 2.3 验证安装

```python
import akshare as ak
print("AKShare 版本：", ak.__version__)
print("可用接口数量：", len(dir(ak)))
```

输出版本号且无报错，即安装成功。`dir(ak)` 数量通常在 500+，代表它暴露了 500 多个数据接口。

### 2.4 安装报错处理

| 报错现象 | 解决方法 |
|----------|----------|
| `Microsoft Visual C++ 14.x required` | 安装 Visual Studio 构建工具（C++ 桌面开发） |
| `Read timed out` / 下载慢 | 换国内镜像源（见 2.2） |
| 依赖冲突 | 新建干净虚拟环境重装 |
| M 系列 Mac 报错 | 文档有专门章节，注意 numpy 等二进制包用 arm64 版本 |

### 2.5 配置不受系统代理影响（强制直连、不走任何代理）

在公司内网、或本地开着全局代理工具（Clash、v2ray、SSR 等，并把代理设成了**系统代理**）时，Python 的 `requests` 库（AKShare 底层依赖它）会**自动读取** `HTTP_PROXY` / `HTTPS_PROXY` 等环境变量，把 AKShare 的请求也转发到代理上。这常导致：

- 请求变慢、超时；
- 代理节点不可达时直接报错（`ConnectionError` / `ProxyError`）；
- 抓国内数据源（东财、新浪）却绕到了海外节点，被限频或返回空。

下面几种方式可以确保 AKShare **完全不走代理、直接连接**。

#### 方法一（推荐，全局生效）：在 import 前清除代理环境变量

AKShare 在**每次发请求时**才去读代理环境变量，因此只要在调用接口前把相关变量清掉即可，最稳妥：

```python
import os

# 清除系统代理环境变量（大小写都要清，部分工具只设大写/小写其一）
_proxy_keys = (
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
    "http_proxy", "https_proxy", "all_proxy",
    "NO_PROXY", "no_proxy",
)
for k in _proxy_keys:
    os.environ.pop(k, None)

import akshare as ak   # 清除后再 import / 使用
df = ak.stock_zh_a_spot_em()
print("成功（已直连，未走代理）：", len(df), "行")
```

> 关键：**先清环境变量，再 `import akshare` 和发请求**。虽然 requests 在请求时才读代理，但养成"先清后导"的习惯最不容易出错。

#### 方法二：设置 `NO_PROXY` 绕过所有主机

如果只是想让所有请求都不走代理，可把 `NO_PROXY` 设为通配：

```python
import os
os.environ["NO_PROXY"] = "*"        # 对所有主机不走代理
os.environ["no_proxy"] = "*"

import akshare as ak
df = ak.stock_zh_a_spot_em()
```

#### 方法三：单接口传 `proxy=None`

部分 AKShare 接口暴露了 `proxy` 参数，可显式传 `None` 覆盖环境变量：

```python
import akshare as ak
df = ak.stock_zh_a_spot_em(proxy=None)   # 仅对支持该参数的接口有效
```

> 注意：并非所有接口都带 `proxy` 参数，所以它**不是通用解**；需要"稳稳的不走代理"请用方法一/二。

#### 方法四（自己写请求时）：`session.trust_env = False`

如果你在 AKShare 之外自己用 `requests` 取数，可关掉对系统环境（含代理）的信任：

```python
import requests
s = requests.Session()
s.trust_env = False   # 忽略系统/环境变量里的代理设置，强制直连
r = s.get("https://push2.eastmoney.com/...")
```

#### 验证当前是否受代理影响

```python
import os
print("当前代理环境变量：",
      {k: os.environ.get(k) for k in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY")})
# 若输出都为 None / 空，说明脚本内已无代理；若仍有值，说明清环境变量没生效或被其他地方重置
```

#### 常见坑

- 大小写都要清：有的代理工具只写 `HTTPS_PROXY`，有的只写 `https_proxy`，建议两个都处理。
- 子进程 / 多线程：若在别的进程里跑，需要在那个进程入口同样清环境变量。
- 终端已 `export` 代理：在 shell 里 `export HTTPS_PROXY=...` 后，Python 会继承；清环境变量只在当前 Python 进程内有效，重开终端仍会继承，必要时在 shell 里 `unset` 或用虚拟环境。
- 虚拟环境不隔离代理：venv / conda 不会自动隔绝系统代理，仍需上面代码处理。

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

| 片段 | 含义 | 举例 |
|------|------|------|
| 类别 | 数据大类 | `stock` / `fund` / `futures` / `macro` |
| 市场 | 交易所/地域 | `zh_a`（A股）、`hk`（港股）、`us`（美股） |
| 类型 | 数据种类 | `spot`（实时）、`hist`（历史）、`daily`（日线） |
| 源 | 数据源后缀 | `_em`（东方财富）、`_sina`（新浪）、`_tx`（腾讯）、`_xq`（雪球） |

示例拆解：`stock_zh_a_hist_em`
- `stock` 股票 · `zh_a` A股 · `hist` 历史K线 · `_em` 东方财富

### 3.3 通用参数约定

虽然每个接口不同，但高频参数高度一致：

| 参数 | 含义 | 常见取值 |
|------|------|----------|
| `symbol` | 标的代码 | `"000001"`（A股）、`"SH600000"`（雪球需带市场）、`"RB0"`（期货主力） |
| `period` | 周期 | `"daily"` / `"weekly"` / `"monthly"`；分钟线 `"1" "5" "15" "30" "60"` |
| `start_date` / `end_date` | 起止日期 | `"20240101"` 字符串格式 |
| `adjust` | 复权 | `""` 不复权、`"qfq"` 前复权、`"hfq"` 后复权 |
| `proxy` | 代理 | `"http://127.0.0.1:7890"` 解决网络受限 |

### 3.4 数据源后缀怎么选

- `_em`（东方财富）：**推荐默认**，数据全、稳定、字段干净
- `_sina`（新浪）：老牌源，部分接口已标记"建议改用 `_em`"
- `_tx`（腾讯）：备用，封 IP 概率低
- `_xq`（雪球）：需要 token 的接口偶有，注意合规

> 经验法则：**优先用 `_em` 系列**，文档标记 deprecated 的接口（如 `stock_zh_a_daily`）改用新接口（`stock_zh_a_hist`）。

---

## 第四章 快速入门：你的第一个程序

### 4.1 三行代码拿到 A 股实时全市场行情

```python
import akshare as ak

# 获取沪深京 A 股全部上市公司的实时行情
df = ak.stock_zh_a_spot_em()
print(df.head())
print("共", len(df), "只股票")
```

返回的 DataFrame 通常包含：代码、名称、最新价、涨跌幅、涨跌额、成交量、成交额、今开、昨收、最高、最低等。

### 4.2 筛选涨停股

```python
import akshare as ak
df = ak.stock_zh_a_spot_em()

# 涨跌幅 >= 9.9% 视为涨停（主板 10% 限制，创业板/科创板 20%）
limit_up = df[df["涨跌幅"] >= 9.9]
print(limit_up[["代码", "名称", "最新价", "涨跌幅"]])
```

### 4.3 保存为 CSV / Excel

```python
df = ak.stock_zh_a_spot_em()
df.to_csv("a股实时行情.csv", encoding="utf-8-sig", index=False)
df.to_excel("a股实时行情.xlsx", index=False)
```

> 注意：存中文 CSV 用 `encoding="utf-8-sig"`，否则 Excel 打开会乱码。

---

## 第五章 各数据模块实战

下面按模块给出**最常用的当前接口**。因 AKShare 频繁更名，调用前请以 `ak.<函数名>?`（IPython 中）或官方文档核对参数。

### 5.1 股票数据

#### (1) A 股实时行情（东财，全市场）

```python
import akshare as ak
df = ak.stock_zh_a_spot_em()          # 无参数，返回全市场
# 单只：ak.stock_individual_spot_xq(symbol="SH600000")
```

#### (2) A 股历史 K 线（东财，**推荐**）

```python
import akshare as ak

df = ak.stock_zh_a_hist(
    symbol="000001",        # 平安银行，纯数字代码
    period="daily",         # daily/weekly/monthly
    start_date="20240101",
    end_date="20241231",
    adjust="qfq",           # 前复权；"" 不复权；"hfq" 后复权
)
print(df.head())
```

返回字段含：日期、开盘、收盘、最高、最低、成交量、成交额、振幅、涨跌幅、涨跌额、换手率。

#### (3) 分时 / 日内数据（东财）

```python
import akshare as ak
df = ak.stock_intraday_em(symbol="000001")   # 最近交易日分时（含盘前）
```

#### (4) 个股基本信息（东财）

```python
import akshare as ak
info = ak.stock_individual_info_em(symbol="603777")
print(info)
```

#### (5) 财务报表

```python
import akshare as ak
# 东财三张表（参数含 symbol 与报告期）
df = ak.stock_financial_report_em(symbol="000001")
# 新浪/同花顺源：stock_financial_report_sina / stock_financial_report_xq
```

#### (6) 行业板块（东财）

```python
import akshare as ak
df = ak.stock_board_industry_em()            # 行业板块实时行情
# 板块成分股：ak.stock_board_industry_cons_em(symbol="半导体")
```

#### (7) 龙虎榜 / 涨停跌停统计

```python
import akshare as ak
df = ak.stock_lhb_detail_em(start_date="20240101", end_date="20240131")  # 龙虎榜明细
```

### 5.2 基金数据

```python
import akshare as ak

# 开放式基金排行（东财）
df = ak.fund_open_fund_rank_em()

# ETF 实时行情（东财）
df = ak.fund_etf_spot_em()

# ETF 历史净值/行情
df = ak.fund_etf_hist_em(
    symbol="513100",       # 纳指ETF
    period="daily",
    start_date="20240101",
    end_date="20241231",
    adjust="qfq",
)

# 基金净值（按代码）
df = ak.fund_nav_em(symbol="000001")    # 示例代码，请按实际基金代码
```

### 5.3 期货数据

```python
import akshare as ak

# 期货实时行情
df = ak.futures_zh_spot()

# 期货日线历史（新浪）
df = ak.futures_zh_daily_sina(symbol="RB0")     # RB0 = 螺纹钢主力

# 期货主力连续（新浪）
df = ak.futures_main_sina(symbol="RB0")

# 展期收益率（教程官方示例）
df = ak.get_roll_yield_bar(
    type_method="date", var="RB",
    start_day="20180618", end_day="20180718",
)
```

### 5.4 债券与可转债

```python
import akshare as ak

# 美国国债收益率曲线
df = ak.bond_zh_us_rate()

# 可转债实时行情
df = ak.bond_zh_cov()
```

### 5.5 外汇与货币

```python
import akshare as ak

# 实时外汇报价
df = ak.fx_spot_quote()

# 货币历史（如 USD/CNY）
df = ak.currency_hist(symbol="USD/CNY", start_date="20240101", end_date="20241231")
```

### 5.6 指数数据

```python
import akshare as ak

# 指数实时（东财）
df = ak.stock_zh_index_spot_em()

# 指数历史 K 线（如沪深300 000300）
df = ak.index_zh_a_hist(
    symbol="000300", period="daily",
    start_date="20240101", end_date="20241231", adjust="",
)
```

### 5.7 宏观经济数据

```python
import akshare as ak

# 中国 GDP（年度）
df = ak.macro_china_gdp_yearly()

# 中国 CPI（年度）
df = ak.macro_china_cpi_yearly()

# 美国 CPI（年度）
df = ak.macro_usa_cpi_yearly()

# 中国PMI、货币供应、社融等均有对应接口
```

### 5.8 期权数据

```python
import akshare as ak

# 上交所期权实时
df = ak.option_sse_spot_price()

# 50ETF 期权日线（新浪）
df = ak.option_daily_sina(symbol="50ETF")
```

### 5.9 加密货币

```python
import akshare as ak

# 比特币历史数据
df = ak.crypto_bitcoin_hist()

# 通用加密货币历史
df = ak.crypto_hist(symbol="BTC", start_date="20240101", end_date="20241231")
```

### 5.10 工具箱与另类数据

```python
import akshare as ak

# A 股代码-名称对照表（做映射时极有用）
df = ak.stock_info_a_code_name()

# 交易日历
df = ak.tool_trade_date_hist_sina()

# 机构调研、新闻、政策不确定性指数等另类数据也有对应接口
```

---

## 第六章 数据处理与可视化

拿到 DataFrame 后，用 pandas + matplotlib / plotly 做分析与画图。

### 6.1 基础清洗

```python
import akshare as ak
import pandas as pd

df = ak.stock_zh_a_hist(symbol="000001", period="daily",
                        start_date="20240101", end_date="20241231", adjust="qfq")

# 日期转 datetime 并设为索引
df["日期"] = pd.to_datetime(df["日期"])
df = df.set_index("日期")

# 计算 20 日均线
df["MA20"] = df["收盘"].rolling(20).mean()
print(df.tail())
```

### 6.2 用 matplotlib 画 K 线 + 均线

```python
import akshare as ak
import matplotlib.pyplot as plt

df = ak.stock_zh_a_hist(symbol="600519", period="daily",
                        start_date="20240101", end_date="20241231", adjust="qfq")
df["日期"] = df["日期"].astype(str)

plt.figure(figsize=(12, 5))
plt.plot(df["日期"], df["收盘"], label="收盘")
plt.plot(df["日期"], df["收盘"].rolling(20).mean(), label="MA20")
plt.xticks(ticks=df["日期"][::20], rotation=45)
plt.legend(); plt.title("贵州茅台 2024 收盘价"); plt.tight_layout()
plt.show()
```

### 6.3 用 mplfinance 画专业 K 线

```bash
pip install mplfinance
```

```python
import akshare as ak
import mplfinance as mpf

df = ak.stock_zh_a_hist(symbol="600519", period="daily",
                        start_date="20240101", end_date="20241231", adjust="qfq")
df["日期"] = pd.to_datetime(df["日期"]); df.set_index("日期", inplace=True)
df = df.rename(columns={"开盘":"Open","收盘":"Close","最高":"High","最低":"Low","成交量":"Volume"})

mpf.plot(df, type="candle", volume=True, mav=(20,), title="K线图")
```

### 6.4 多股对比

```python
import akshare as ak
import pandas as pd

codes = {"平安银行":"000001","贵州茅台":"600519","宁德时代":"300750"}
data = {}
for name, code in codes.items():
    d = ak.stock_zh_a_hist(code, "daily", "20240101", "20241231", "qfq")
    d["日期"] = pd.to_datetime(d["日期"]); d.set_index("日期", inplace=True)
    data[name] = d["收盘"]

close = pd.DataFrame(data).ffill()
# 归一化到 100 起点便于比较
norm = close / close.iloc[0] * 100
norm.plot(title="三只股票 2024 年走势对比（归一化）")
```

---

## 第七章 综合实战案例

### 案例一：自选股实时涨跌监控脚本

```python
import akshare as ak

watchlist = ["000001", "600519", "300750"]   # 你想监控的代码
df = ak.stock_zh_a_spot_em()

sel = df[df["代码"].isin(watchlist)][["代码", "名称", "最新价", "涨跌幅", "成交额"]]
print("==== 自选股监控 ====")
print(sel.to_string(index=False))
if (sel["涨跌幅"] >= 9.9).any():
    print("⚠️ 有股票触及涨停！")
```

### 案例二：批量下载多只股票历史数据并落盘

```python
import akshare as ak
import pandas as pd

codes = {"平安银行":"000001", "贵州茅台":"600519"}
for name, code in codes.items():
    df = ak.stock_zh_a_hist(code, "daily", "20200101", "20241231", "qfq")
    df.to_csv(f"{name}_{code}.csv", encoding="utf-8-sig", index=False)
    print(f"{name} 下载完成，{len(df)} 行")
```

### 案例三：指数估值/走势速览

```python
import akshare as ak
import matplotlib.pyplot as plt

for sym, label in [("000300","沪深300"), ("000905","中证500")]:
    df = ak.index_zh_a_hist(sym, "monthly", "20190101", "20241231", "")
    plt.plot(df["日期"], df["收盘"], label=label)
plt.legend(); plt.title("宽基指数长期走势"); plt.xticks(rotation=45); plt.show()
```

---

## 第八章 常见问题与避坑指南

### 8.1 接口改名 / `AttributeError: module 'akshare' has no attribute 'xxx'`

AKShare 因数据源失效会**重命名接口**。旧代码报错时：
1. 查官方文档「接口更名一览表 / Changelog」
2. 用新名替换（如 `stock_zh_a_daily` → `stock_zh_a_hist`）
3. 保持 AKShare 为较新版本，但**生产代码固定版本**避免踩雷

```bash
pip install akshare==1.18.64   # 锁定版本，保证可复现
```

### 8.2 网络超时 / 拿不到数据

- 设置代理：`ak.stock_zh_a_spot_em(proxy="http://127.0.0.1:7890")`
- 换数据源后缀：`_em` 不行试 `_sina` / `_tx`
- 错峰请求，避免交易时段高并发

### 8.3 被封 IP / 限频

- 不要**高频循环**调用同一接口，加 `time.sleep(1~3)`
- 实时类接口（如 `stock_zh_a_spot`）重复运行易被封，缓存结果
- 批量取数用历史接口而非实时接口

### 8.4 复权方式选错导致价格异常

- 画线/算收益用**前复权 `qfq`**
- 看真实成交金额用**不复权**
- 长期持仓成本用**后复权 `hfq`**

### 8.5 日期格式

所有日期参数都是 **`"YYYYMMDD"` 字符串**，不是 `datetime` 对象。

### 8.6 中文乱码

- 存 CSV 用 `encoding="utf-8-sig"`
- 终端/Excel 打开确保 UTF-8 编码

---

## 第九章 进阶与生态

### 9.1 把 AKShare 包成 HTTP 服务

官方支持用 FastAPI 把接口暴露成 REST API，方便多语言调用或团队共享：

```bash
pip install fastapi uvicorn
```

```python
# app.py
from fastapi import FastAPI
import akshare as ak

app = FastAPI()

@app.get("/stock/{code}")
def get_stock(code: str):
    return ak.stock_zh_a_hist(code, "daily", "20240101", "20241231", "qfq").to_dict("records")
```

```bash
uvicorn app:app --port 8000
```

官方文档「HTTP 部署」章节还提供 Docker 镜像，一键拉起。

### 9.2 结合量化回测框架

- **AKQuant**：AKShare 官方推荐的高性能回测框架（Rust 撮合内核 + Python）
- **Backtrader**：经典 Python 回测框架，AKShare 取数 → Backtrader 回测
- **PyBroker**：轻量机器学习回测

典型流程：`akshare 取数` → `pandas 清洗/算因子` → `框架回测` → `评估`。

### 9.3 Docker 部署

```bash
docker pull registry.cn-shanghai.aliyuncs.com/akshare/akshare:latest
```

适合部署到服务器做定时数据采集。

---

## 第十章 学习路线与资源

### 10.1 推荐学习路线

1. **第 1 周**：装好环境，跑通第四章快速入门，熟悉 DataFrame 操作
2. **第 2 周**：逐个模块试 5.1~5.10 的接口，建立"数据地图"直觉
3. **第 3 周**：学 pandas 清洗 + matplotlib 画图（第六章）
4. **第 4 周**：做第七章实战案例，尝试自己的小项目
5. **进阶**：接入 AKQuant/Backtrader 做策略回测

### 10.2 官方与社区资源

| 资源 | 地址 |
|------|------|
| 在线文档 | https://akshare.akfamily.xyz/ |
| GitHub 仓库 | https://github.com/akfamily/akshare |
| PyPI | https://pypi.org/project/akshare/ |
| 数据字典 | 文档站「AKShare 数据字典」各子页 |
| 接口更名表 | 文档站 Changelog 章节 |

### 10.3 学习建议

- **先会查文档**：AKShare 接口多到记不住，养成"想到数据→查文档→复制示例改参数"的习惯
- **固定版本**：项目里锁定 `akshare==x.x.x`，避免接口变更打断流程
- **尊重数据源**：控制请求频率，勿滥用；遵守各平台使用条款
- **多动手**：每个接口都自己跑一遍，改参数看返回差异，理解最深

---

> **免责声明**：AKShare 获取数据仅用于学习研究，数据版权归各原始数据源所有。实盘交易决策请自行承担风险，本教材不构成任何投资建议。
