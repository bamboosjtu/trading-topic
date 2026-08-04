# Tushare 学习指导教材

> 适用版本：Tushare ≥ 1.4.x（PyPI 当前 1.4.29，2026-03 发布，BSD 协议）
> 适用对象：零基础到进阶的 Python 量化 / 财经数据分析学习者
> 核心理念：**注册免费 + Token 鉴权 + 积分分级**，用一份 Token 稳定获取高质量 A 股等金融数据

---

## 目录

1. [认识 Tushare](#第一章-认识-tushare)
2. [安装与环境配置](#第二章-安装与环境配置)
3. [核心概念](#第三章-核心概念)
4. [快速入门：你的第一个程序](#第四章-快速入门你的第一个程序)
5. [各数据模块实战](#第五章-各数据模块实战)
6. [数据处理与可视化](#第六章-数据处理与可视化)
7. [综合实战案例](#第七章-综合实战案例)
8. [常见问题与避坑指南](#第八章-常见问题与避坑指南)
9. [进阶与生态](#第九章-进阶与生态)
10. [学习路线与资源](#第十章-学习路线与资源)

---

## 第一章 认识 Tushare

### 1.1 什么是 Tushare

Tushare 是国内**最主流、免费**的财经数据接口库之一，由 waditu（吉姆·刘）维护，覆盖 A 股、指数、基金、期货、期权、债券、外汇、数字货币等行情与基本面数据。它最大的优势是**数据稳定、规范、字段干净**，非常适合做严肃的量化研究和因子回测。

### 1.2 两个"Tushare"：旧版 vs Tushare Pro（必读）

同一个 `tushare` 包里其实藏着**两套 API**，初学者最容易混淆：

| 维度 | 旧版 Tushare（免费无 Token） | Tushare Pro（Token 鉴权） |
|------|------------------------------|---------------------------|
| 入口 | `ts.get_hist_data(...)` 等模块函数 | `pro.daily(...)` 等 `pro` 对象方法 |
| 鉴权 | 不需要 Token | 需要 `ts.set_token(...)` |
| 数据 | 历史日/周/月线、实时行情 | 全品类、更规范、带 `ts_code` |
| 权限 | 无限制但接口老旧 | 按**积分**分级开放 |
| 推荐度 | 仅作补充 | **主力，强烈推荐** |

> 结论：本教材以 **Tushare Pro** 为主线。旧版接口（如 `get_hist_data`）虽然免 Token，但数据字段、稳定性都不如 Pro，仅实时行情等少数场景仍可用。

### 1.3 主要特点

- **免费注册**，基础数据（日线、股票列表、交易日历）120 积分即可用
- **数据规范**：统一 `ts_code`（如 `000001.SZ`）、统一日期格式、统一返回 `DataFrame`
- **稳定可靠**：官方维护，不像爬网页那样容易被封
- **权限分级**：积分越高，可解锁的接口越多（资金流、财务、深度数据等）
- **多形态**：提供 Python SDK 与 HTTP RESTful 两种调用方式

### 1.4 积分与权限体系（Tushare 的核心差异点）

Tushare Pro 用**积分（points）**控制接口权限，这是它和 AKShare 最大的不同：

- 注册并完成实名后默认约 **120 积分**（基础档）
- 不同接口有不同积分门槛，常见档位（以官网实时为准）：
  - **120 积分**：个股日线 `daily`、股票列表 `stock_basic`、交易日历 `trade_cal`
  - **500 积分**：更多基础与行情类接口
  - **1000 积分**：资金流向 `moneyflow`、解禁减持等
  - **2000 积分**：完整财务指标 `fina_indicator`、每日市值估值等
- 提升积分的途径：每日签到、在社区分享原创研究笔记、参与官方任务等

> ⚠️ 积分门槛会随官网调整，**以 Tushare 个人中心「积分」页与接口文档标注的积分要求为准**。调用返回"权限不足/积分不够"时，先去查该接口需要的积分。

### 1.5 Tushare vs AKShare（怎么选）

| 对比项 | Tushare | AKShare |
|--------|---------|---------|
| 费用 | 免费，但接口按积分分级 | 完全免费、无门槛 |
| 鉴权 | 需要 Token | 不需要 |
| 数据质量 | 规范、稳定、字段统一 | 广但来源杂、偶有字段差异 |
| 覆盖 | A 股为主，深度好 | 30+ 市场，面广 |
| 限频 | 约 500 次/分钟（Pro） | 受源站限频 |
| 适合 | 严肃 A 股研究、回测 | 快速取数、多市场探索 |

> 建议组合使用：**AKShare 免费广撒网 + Tushare Pro 做核心 A 股深度研究**。

---

## 第二章 安装与环境配置

### 2.1 环境要求

- **Python**：3.6 ~ 3.10（1.4.x 官方支持到 3.10；更高版本通常也能装，但建议 3.9/3.10）
- **依赖**：pandas、requests 等随包安装

### 2.2 安装命令

```bash
# 通用安装 / 升级
pip install tushare --upgrade

# 国内用户加速（清华镜像）
pip install tushare --upgrade -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> 建议在**虚拟环境**中安装：
> ```bash
> python -m venv venv
> source venv/bin/activate      # Windows: venv\Scripts\activate
> pip install tushare --upgrade
> ```

### 2.3 注册并获取 Token

1. 打开 https://tushare.pro ，用手机号注册并登录
2. 进入 **个人中心 → 接口 TOKEN**（或"用户主页"复制 API Token）
3. 复制这串专属长字符串 —— **切勿泄露、勿硬编码到公开仓库**

### 2.4 初始化与验证

```python
import tushare as ts

ts.set_token("你的Token")      # 设置一次即可，会写入 ~/.tushare_token
pro = ts.pro_api()             # 拿到 pro 接口对象

# 验证：拉一条日线
df = pro.daily(ts_code="000001.SZ", start_date="20260101", end_date="20260110")
print(df.head())
```

`ts.set_token(...)` 会把 Token 持久化到用户目录的 `.tushare_token` 文件，之后**同一环境无需重复设置**。但在共享/生产代码中仍建议显式设置或用环境变量管理。

### 2.5 配置不受系统代理影响（强制直连、不走任何代理）

和 AKShare 一样，Tushare 底层用 `requests`，会**自动读取**系统代理环境变量。若本地开着 Clash/v2ray 等全局代理，请求可能变慢或失败。强制直连的方法：

```python
import os

# 清除代理环境变量（大小写都清）
for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
          "http_proxy", "https_proxy", "all_proxy",
          "NO_PROXY", "no_proxy"):
    os.environ.pop(k, None)

import tushare as ts
ts.set_token("你的Token")
pro = ts.pro_api()
df = pro.daily(ts_code="000001.SZ", start_date="20260101", end_date="20260110")
```

其他等价方式：设 `os.environ["NO_PROXY"] = "*"`；或用 `requests.Session()` 设 `trust_env=False` 自行封装请求。验证：`print({k: os.environ.get(k) for k in ("HTTP_PROXY","HTTPS_PROXY")})` 应为 None。

### 2.6 安装 / 调用报错速查

| 现象 | 原因与解决 |
|------|------------|
| `ModuleNotFoundError: tushare` | 没装或装错环境，确认在正确 venv 中 `pip install tushare` |
| `token 无效 / 未注册` | Token 复制带空格、未完成实名认证；重新复制 |
| `抱歉，您没有访问该接口的权限` | 积分不够，去官网提升积分或换低门槛接口 |
| `每分钟最多访问该接口 500 次` | 触发限频，加 `time.sleep`、批量拆分 |
| `网络超时` | 清代理（见 2.5）或换网络 |

---

## 第三章 核心概念

### 3.1 一切皆 DataFrame

Pro 的每个接口都返回 `pandas.DataFrame`，可直接筛选、统计、存盘。

### 3.2 `ts_code`：带交易所后缀的代码（关键！）

Tushare Pro **必须用 `ts_code`**（不是纯数字），格式为 `代码.交易所`：

| 市场 | 后缀 | 示例 |
|------|------|------|
| 深圳 | `.SZ` | `000001.SZ`、`300750.SZ` |
| 上海 | `.SH` | `600519.SH`、`601318.SH` |
| 北交所 | `.BJ` | `830799.BJ` |
| 指数 | `.SH`/`.SZ` | `000001.SH`（上证综指）、`399001.SZ`（深证成指） |

> 忘了后缀？用 `pro.stock_basic()` 查全市场代码表，或用 `pro.index_basic()` 查指数代码。

### 3.3 `pro` 对象与参数风格

- `pro = ts.pro_api()` 是统一入口
- 大多接口用**命名参数**传 `ts_code` / `trade_date` / `start_date` / `end_date` / `fields`
- `start_date`、`end_date`、`trade_date` 均为 `"YYYYMMDD"` 字符串
- `fields` 可指定返回列，减少流量、提升速度

### 3.4 复权数据要用 `pro_bar`

`pro.daily` 默认返回**不复权**收盘价。做价格走势/收益要复权，用模块级函数 `pro_bar`（注意它是模块函数，必须传 `api=pro`）：

```python
import tushare as ts
pro = ts.pro_api()
df = ts.pro_bar(ts_code="600519.SH", start_date="20240101",
                end_date="20241231", adj="qfq", api=pro)
```

`adj`：`None` 不复权、`"qfq"` 前复权、`"hfq"` 后复权。

### 3.5 积分 / 权限报错是常态

调用前先确认该接口所需积分（官网文档标注）。拿不到数据先排查：Token → 积分 → 限频 → 网络。

---

## 第四章 快速入门：你的第一个程序

### 4.1 拿到一只股票的历史日线

```python
import tushare as ts

ts.set_token("你的Token")
pro = ts.pro_api()

# 平安银行 2026 年初的日线
df = pro.daily(ts_code="000001.SZ", start_date="20260101", end_date="20260131")
print(df.head())
print("共", len(df), "行")
```

返回字段：trade_date、open、high、low、close、pre_close、change、pct_chg、vol、amount。

### 4.2 按交易日拉全市场快照

```python
# 某一天所有股票的日线（不传 ts_code，只传 trade_date）
df = pro.daily(trade_date="20260610")
print("当日有行情的股票数：", len(df))
```

### 4.3 保存为文件

```python
df.to_csv("daily_000001.csv", encoding="utf-8-sig", index=False)
df.to_excel("daily_000001.xlsx", index=False)
```

---

## 第五章 各数据模块实战

下面给出最常用的 Pro 接口（积分门槛以官网实时为准）。

### 5.1 股票基础信息

```python
import tushare as ts
pro = ts.pro_api()

# 全部正常上市的 A 股列表
df = pro.stock_basic(exchange="", list_status="L",
                     fields="ts_code,symbol,name,area,industry,list_date")
print("股票总数：", len(df))
print(df.head())
```

`list_status`：`L` 上市、`D` 退市、`P` 暂停。

### 5.2 日线行情（不复权）

```python
df = pro.daily(ts_code="600519.SH", start_date="20240101", end_date="20241231")
```

### 5.3 复权 K 线（前/后复权）

```python
df = ts.pro_bar(ts_code="600519.SH", start_date="20240101",
                end_date="20241231", adj="qfq", api=pro)
```

### 5.4 实时行情

```python
import tushare as ts

# 旧版实时接口（免 Token，适合轻量用）
ts.set_token("你的Token")   # 新版实时也需要 pro，但 get_realtime_quotes 仍走老通道
print(ts.get_realtime_quotes(["600519.SH", "000001.SZ"]))

# 新版爬虫版实时盘口
df = ts.realtime_quote(ts_code="600519.SH,000001.SZ")
```

> 实时类接口波动较大，请以官网文档当前写法为准；注意实时数据也有调用频率限制。

### 5.5 交易日历

```python
df = pro.trade_cal(exchange="", start_date="20260101",
                   end_date="20261231", is_open="1")
print(df.head())   # 仅列出交易日
```

### 5.6 财务数据（需更高积分）

```python
# 财务指标（利润、偿债、成长等，需 2000 积分左右）
df = pro.fina_indicator(ts_code="600519.SH")
print(df[["ann_date", "end_date", "roe", "eps", "debt_to_assets"]].head())

# 资产负债表 / 利润表 / 现金流量表
df_bs = pro.balancesheet(ts_code="600519.SH", period="20241231")
df_pl = pro.income(ts_code="600519.SH", period="20241231")
```

### 5.7 资金流向（需 1000 积分左右）

```python
df = pro.moneyflow(ts_code="600519.SH", start_date="20260101", end_date="20260131")
print(df[["trade_date", "buy_sm_vol", "sell_sm_vol", "net_mf_vol"]].head())
```

### 5.8 指数 / 基金 / 期货

```python
# 指数日线（上证综指）
df = pro.index_daily(ts_code="000001.SH", start_date="20240101", end_date="20241231")

# 指数基本信息
df = pro.index_basic(market="SSE")

# 基金日线
df = pro.fund_daily(ts_code="510300.SH", start_date="20240101", end_date="20241231")

# 期货日线
df = pro.fut_daily(ts_code="RB.SHF", start_date="20240101", end_date="20241231")
```

### 5.9 复权因子（进阶）

```python
df = pro.adj_factor(ts_code="600519.SH", start_date="20240101", end_date="20241231")
# 用复权因子可自行计算前/后复权价：adj_close = close * factor / base_factor
```

---

## 第六章 数据处理与可视化

（与 AKShare 完全一致的 pandas 玩法，这里给出 Tushare 专属示例）

### 6.1 排序与清洗

```python
import tushare as ts
import pandas as pd

pro = ts.pro_api()
df = pro.daily(ts_code="600519.SH", start_date="20240101", end_date="20241231")

# Tushare 默认按交易日期降序，分析前一般按时间升序
df = df.sort_values("trade_date").reset_index(drop=True)
df["trade_date"] = pd.to_datetime(df["trade_date"])
df["ma20"] = df["close"].rolling(20).mean()
print(df.tail())
```

### 6.2 画图（matplotlib）

```python
import matplotlib.pyplot as plt

plt.figure(figsize=(12, 5))
plt.plot(df["trade_date"], df["close"], label="收盘")
plt.plot(df["trade_date"], df["ma20"], label="MA20")
plt.legend(); plt.title("贵州茅台 2024 收盘价"); plt.tight_layout(); plt.show()
```

### 6.3 多股归一化对比

```python
import tushare as ts
import pandas as pd

pro = ts.pro_api()
codes = {"平安银行":"000001.SZ", "贵州茅台":"600519.SH", "宁德时代":"300750.SZ"}
close = {}
for name, code in codes.items():
    d = pro.daily(ts_code=code, start_date="20240101", end_date="20241231")
    d = d.sort_values("trade_date")
    close[name] = d.set_index("trade_date")["close"]
close = pd.DataFrame(close).ffill()

norm = close / close.iloc[0] * 100
norm.plot(title="三只股票 2024 年走势对比（归一化）")
```

---

## 第七章 综合实战案例

### 案例一：拉全市场列表并批量下载日线（注意积分与限频）

```python
import tushare as ts
import pandas as pd
import time

ts.set_token("你的Token")
pro = ts.pro_api()

stocks = pro.stock_basic(exchange="", list_status="L", fields="ts_code")["ts_code"].tolist()
print("待下载：", len(stocks), "只")

for code in stocks[:10]:   # 演示只取前 10 只，批量请控制频率
    df = pro.daily(ts_code=code, start_date="20240101", end_date="20241231")
    df.to_csv(f"data/{code}.csv", encoding="utf-8-sig", index=False)
    time.sleep(0.3)        # 降低频率，避免触发限频
print("完成")
```

> 批量全市场会消耗大量积分/频次，建议：**先落盘缓存、按需增量更新、错峰调用**。

### 案例二：筛选某日涨幅靠前的股票

```python
import tushare as ts
pro = ts.pro_api()

df = pro.daily(trade_date="20260610")
top = df.sort_values("pct_chg", ascending=False).head(20)
print(top[["ts_code", "close", "pct_chg", "vol"]])
```

### 案例三：计算个股年化收益与波动率

```python
import tushare as ts
import numpy as np

pro = ts.pro_api()
df = pro.daily(ts_code="600519.SH", start_date="20230101", end_date="20231231")
df = df.sort_values("trade_date")
ret = df["close"].pct_change().dropna()

ann_return = ret.mean() * 252
ann_vol = ret.std() * np.sqrt(252)
print(f"年化收益：{ann_return:.2%}，年化波动：{ann_vol:.2%}")
```

---

## 第八章 常见问题与避坑指南

### 8.1 Token 无效 / 未注册
- 复制 Token 时**前后无空格**、无换行
- 完成**实名认证**（部分接口强制要求）
- 确认 `set_token` 用的是 Pro 的 Token，不是别的 key

### 8.2 权限不足 / 积分不够
- 查官网该接口的积分要求，去「个人中心」提升积分
- 先用低门槛接口练手（daily / stock_basic / trade_cal）
- 切勿尝试绕过权限，违规会被封号

### 8.3 触发限频（约 500 次/分钟）
- 加 `time.sleep(0.2~1)`、批量拆分、错峰
- 数据落盘缓存，避免重复拉取
- 用 `fields` 只取需要的列，减少传输

### 8.4 数据为空 / 返回 0 行
- 日期格式必须是 `"YYYYMMDD"`
- 非交易日（周末/节假日）`daily(trade_date=...)` 会为空 → 用 `trade_cal` 先确认交易日
- `ts_code` 后缀写错（如漏 `.SZ`）

### 8.5 复权方式混淆
- 画长期走势/算收益用前复权 `adj="qfq"`（`pro_bar`）
- `pro.daily` 默认不复权，直接比价会失真

### 8.6 中文乱码
- 存 CSV 用 `encoding="utf-8-sig"`

### 8.7 网络 / 代理
- 见 2.5：本地有全局代理时清环境变量强制直连

---

## 第九章 进阶与生态

### 9.1 HTTP RESTful 调用

Tushare 也提供 HTTP 接口，适合非 Python 环境或做服务化：

```python
import requests

url = "https://api.tushare.pro"
data = {
    "api_name": "daily",
    "token": "你的Token",
    "params": {"ts_code": "000001.SZ", "start_date": "20260101", "end_date": "20260131"},
    "fields": "",
}
r = requests.post(url, json=data)
print(r.json()["data"]["items"])
```

### 9.2 数据落盘与增量更新（工程化建议）

- 首次全量下载到本地（CSV/数据库），之后只拉"最后 N 天"增量
- 用 `trade_cal` 生成本地交易日表，避免重复请求
- 数据库可选 MySQL / MongoDB / HDF5（官方推荐）

### 9.3 与回测框架结合

典型流程：`tushare 取数` → `pandas 清洗/算因子` → `AKQuant / Backtrader / PyBroker 回测` → `评估`。Tushare 的规范数据特别适合做因子研究。

### 9.4 提升积分的正道

每日签到、在 Tushare 社区分享**原创**研究笔记、参与官方任务，按规则申请积分奖励。

---

## 第十章 学习路线与资源

### 10.1 推荐学习路线

1. **第 1 周**：注册拿 Token，跑通第四章，熟悉 `ts_code` 与 `pro` 对象
2. **第 2 周**：逐个试 5.1~5.9 接口，弄清积分门槛；建立本地代码表缓存
3. **第 3 周**：pandas 清洗 + 画图（第六章）
4. **第 4 周**：做第七章案例，尝试自己的小项目
5. **进阶**：数据工程化落盘 + 接入回测框架

### 10.2 官方与社区资源

| 资源 | 地址 |
|------|------|
| 官网 / 社区 | https://tushare.pro |
| 接口文档 | https://tushare.pro/document/2（含各接口积分要求） |
| PyPI | https://pypi.org/project/tushare/ |
| 个人中心（Token / 积分） | 登录后右上角头像 → 个人中心 |

### 10.3 学习建议

- **先查积分**：动手前确认接口所需积分，避免白调
- **先缓存后分析**：数据落盘，减少重复请求与限频风险
- **规范第一**：坚持用 `ts_code`、统一日期格式、明确复权方式
- **尊重规则**：积分体系是社区可持续的基础，勿违规绕过

---

> **免责声明**：Tushare 数据仅用于学习研究，数据版权与接口权限归 Tushare 社区所有。实盘交易决策风险自负，本教材不构成任何投资建议。
