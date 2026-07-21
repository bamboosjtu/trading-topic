from pathlib import Path

import nbformat as nbf


notebook_path = Path(__file__).with_name("lab1_akshare.ipynb")
notebook = nbf.read(notebook_path, as_version=4)


def md(source: str):
    return nbf.v4.new_markdown_cell(source.strip() + "\n")


def code(source: str):
    return nbf.v4.new_code_cell(source.strip() + "\n")


notebook.cells = [
    md(
        r"""
# 实验一（AKShare 版）：A 股多数据源实测

本 Notebook 是 **Lab 1 数据源验证**，目标不是只让单一接口跑通，而是验证：

1. 上交所官方市场总貌 `stock_sse_summary`；
2. 东方财富、腾讯、新浪接口的字段、单位与实时可用性；
3. 东方财富不可用时，日线按 **腾讯 → 新浪 → 东方财富** 显式降级；
4. AKShare 数据源请求按域名直连，其他网络请求继续使用原系统代理。

接口定义与参数以 [AKShare 官方股票数据文档](https://akshare.akfamily.xyz/data/stock/stock.html) 为准。本地安装版本会在运行时打印并检查。

| 数据类别 | AKShare 接口 | 原始数据源 | 本实验用途 |
| --- | --- | --- | --- |
| 市场总貌 | `stock_sse_summary()` | 上海证券交易所 | 最近交易日股票、主板、科创板汇总 |
| 行业板块 | `stock_board_industry_cons_em()` | 东方财富 | 银行板块成分股 |
| A 股日线 | `stock_zh_a_hist()` | 东方财富 | 多源对照、末级降级 |
| A 股日线 | `stock_zh_a_hist_tx()` | 腾讯证券 | 批量取数首选 |
| A 股日线 | `stock_zh_a_daily()` | 新浪财经 | 第二数据源；官方提示多次抓取可能封 IP |
| 分红配送 | `stock_fhps_detail_em()` | 东方财富 | 分红明细对照 |
| 分红配送 | `stock_history_dividend_detail()` | 新浪财经 | 非东财替代源 |

> `stock_sse_summary` 是交易所层面的股票市场总貌，可作为市场宏观概览；它不是 GDP、CPI 等宏观经济指标。  
> 前复权价格会随未来除权除息重新计算；本实验保存数据时记录运行日，但不把前复权快照当作永不变化的原始价格。
"""
    ),
    md(
        r"""
---
## 0. 环境与实验参数

从仓库根目录运行：

```powershell
uv sync --project labs
uv run --project labs python -m jupyter nbconvert --execute --to notebook --inplace labs/lab1_akshare.ipynb
```

Notebook 只在每次 AKShare 调用期间追加该接口的直连域名，并在成功或异常后精确恢复 `NO_PROXY/no_proxy`。不会清除 `HTTP_PROXY/HTTPS_PROXY`，也不会设置 `NO_PROXY="*"`。
"""
    ),
    code(
        r"""
import os
import time
from contextlib import contextmanager
from pathlib import Path

import akshare as ak
import pandas as pd
from IPython.display import display


OFFICIAL_STOCK_DOC = "https://akshare.akfamily.xyz/data/stock/stock.html"

# 域名来自本机 AKShare 1.18.74 的接口实现；只对当前接口的真实数据源直连。
SOURCE_DOMAINS = {
    "上交所": ("sse.com.cn",),
    "东方财富": ("eastmoney.com",),
    "腾讯": ("qq.com",),
    "新浪": ("sina.com.cn",),
}

required_apis = [
    "stock_sse_summary",
    "stock_board_industry_name_em",
    "stock_board_industry_cons_em",
    "stock_zh_a_hist",
    "stock_zh_a_hist_tx",
    "stock_zh_a_daily",
    "stock_fhps_detail_em",
    "stock_history_dividend_detail",
]
missing_apis = [name for name in required_apis if not hasattr(ak, name)]
if missing_apis:
    raise RuntimeError(
        f"当前 AKShare {ak.__version__} 缺少接口: {missing_apis}；请先核对官方文档与锁定版本"
    )

# 无论从仓库根目录还是 labs/ 启动 Jupyter，都固定写入 labs/data。
WORKING_DIR = Path.cwd().resolve()
LABS_DIR = WORKING_DIR if WORKING_DIR.name == "labs" else WORKING_DIR / "labs"
if not (LABS_DIR / "pyproject.toml").is_file():
    raise FileNotFoundError("请从仓库根目录或 labs/ 启动 Jupyter")

DATA_DIR = LABS_DIR / "data" / "lab1_akshare"
DATA_DIR.mkdir(parents=True, exist_ok=True)

TARGET_STOCKS = {
    "601398": "工商银行",
    "601939": "建设银行",
    "601288": "农业银行",
    "601988": "中国银行",
    "600036": "招商银行",
}

START_DATE = "20220101"
DATA_CUTOFF_DATE = pd.Timestamp.now(tz="Asia/Shanghai").strftime("%Y%m%d")
COMPARE_START_DATE = (
    pd.Timestamp(DATA_CUTOFF_DATE) - pd.Timedelta(days=60)
).strftime("%Y%m%d")

print(f"AKShare 版本: {ak.__version__}")
print(f"官方文档: {OFFICIAL_STOCK_DOC}")
print(f"数据截止日参数: {DATA_CUTOFF_DATE}")
print(f"数据目录: {DATA_DIR}")
print(f"目标股票: {len(TARGET_STOCKS)} 只")
"""
    ),
    md(
        r"""
---
## 1. 调用、代理隔离与字段标准化

三家行情源的官方输出字段与单位并不完全相同：

- 东方财富 `stock_zh_a_hist`：中文列名，成交量单位为 **手**；
- 腾讯 `stock_zh_a_hist_tx`：英文列名，成交量单位为 **股**；
- 新浪 `stock_zh_a_daily`：英文列名，成交量单位为 **股**。

下方统一为 `日期、开盘、收盘、最高、最低、成交量(股)、成交额(元)、数据源`。这一步是跨源比较的必要前提。
"""
    ),
    code(
        r"""
@contextmanager
def akshare_direct(*domains):
    """仅让指定数据源域名直连，并精确恢复当前 Python 进程的 NO_PROXY。"""
    no_proxy_keys = ("NO_PROXY", "no_proxy")
    original_env = {key: os.environ.get(key) for key in no_proxy_keys}

    existing_domains = []
    for value in original_env.values():
        if value:
            existing_domains.extend(
                item.strip() for item in value.split(",") if item.strip()
            )
    bypass_value = ",".join(dict.fromkeys([*existing_domains, *domains]))

    try:
        for key in no_proxy_keys:
            os.environ[key] = bypass_value
        yield
    finally:
        for key in no_proxy_keys:
            os.environ.pop(key, None)
        for key, value in original_env.items():
            if value is not None:
                os.environ[key] = value


def safe_call(
    fn,
    label,
    *args,
    direct_domains=(),
    retries=2,
    delay=2.0,
    **kwargs,
):
    """调用 AKShare；短暂失败时重试，最终失败返回 None，不中断其他数据源。"""
    last_error = None

    for attempt in range(1, retries + 1):
        try:
            with akshare_direct(*direct_domains):
                result = fn(*args, **kwargs)
            print(f"  [成功] {label}")
            return result
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                wait_seconds = delay * attempt
                print(
                    f"  [重试] {label}: {attempt}/{retries}，"
                    f"{wait_seconds:.0f} 秒后重试"
                )
                time.sleep(wait_seconds)

    print(
        f"  [失败] {label}: "
        f"{type(last_error).__name__}: {last_error}"
    )
    return None


def market_symbol(code):
    """为新浪/腾讯补市场前缀；本实验目标均为沪市，函数同时兼容常见深市代码。"""
    if code.startswith(("4", "8")):
        return f"bj{code}"
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def normalize_history(frame, source):
    """把东财、腾讯、新浪日线统一到同一字段与单位。"""
    data = frame.copy()

    if source == "东方财富":
        data = data.rename(
            columns={
                "日期": "日期",
                "开盘": "开盘",
                "收盘": "收盘",
                "最高": "最高",
                "最低": "最低",
                "成交量": "成交量(股)",
                "成交额": "成交额(元)",
            }
        )
        # 官方文档：东财成交量单位为手；A 股 1 手 = 100 股。
        data["成交量(股)"] = (
            pd.to_numeric(data["成交量(股)"], errors="coerce") * 100
        )
    else:
        data = data.rename(
            columns={
                "date": "日期",
                "open": "开盘",
                "close": "收盘",
                "high": "最高",
                "low": "最低",
                "volume": "成交量(股)",
                "amount": "成交额(元)",
            }
        )

    standard_columns = [
        "日期",
        "开盘",
        "收盘",
        "最高",
        "最低",
        "成交量(股)",
        "成交额(元)",
    ]
    missing_columns = [col for col in standard_columns if col not in data.columns]
    if missing_columns:
        raise ValueError(f"{source} 日线缺少预期字段: {missing_columns}")

    data = data[standard_columns].copy()
    data["日期"] = pd.to_datetime(data["日期"], errors="coerce")
    for column in standard_columns[1:]:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = (
        data.dropna(subset=["日期", "收盘"])
        .sort_values("日期")
        .drop_duplicates("日期", keep="last")
        .reset_index(drop=True)
    )
    data["数据源"] = source
    return data


HISTORY_SOURCE_ORDER = ("腾讯", "新浪", "东方财富")


def fetch_history(
    code,
    source,
    start_date=START_DATE,
    end_date=DATA_CUTOFF_DATE,
    adjust="qfq",
    retries=2,
):
    """按官方接口参数取一只股票日线，并返回统一字段。"""
    prefixed_symbol = market_symbol(code)

    if source == "腾讯":
        raw = safe_call(
            ak.stock_zh_a_hist_tx,
            f"腾讯 {code} 日线",
            symbol=prefixed_symbol,
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
            timeout=20,
            direct_domains=SOURCE_DOMAINS[source],
            retries=retries,
        )
    elif source == "新浪":
        raw = safe_call(
            ak.stock_zh_a_daily,
            f"新浪 {code} 日线",
            symbol=prefixed_symbol,
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
            direct_domains=SOURCE_DOMAINS[source],
            retries=retries,
        )
    elif source == "东方财富":
        raw = safe_call(
            ak.stock_zh_a_hist,
            f"东方财富 {code} 日线",
            symbol=code,
            period="daily",
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
            timeout=20,
            direct_domains=SOURCE_DOMAINS[source],
            retries=retries,
        )
    else:
        raise ValueError(f"未知行情源: {source}")

    if raw is None or raw.empty:
        return None

    try:
        return normalize_history(raw, source)
    except Exception as exc:
        print(f"  [失败] {source} {code} 字段标准化: {type(exc).__name__}: {exc}")
        return None
"""
    ),
    md(
        r"""
---
## 2. 市场宏观概览：上交所股票数据总貌

**API**：`ak.stock_sse_summary()`

官方文档说明：单次返回最近交易日的股票数据总貌，当日数据需在收盘后统计。输出包括股票、主板、科创板的流通股本、总市值、平均市盈率、上市公司数、流通市值、报告时间和总股本。

本单元保留交易所原始项目与数值，不擅自推断官方文档未标注的单位。
"""
    ),
    code(
        r"""
print("=" * 72)
print("案例 1：上海证券交易所股票数据总貌")
print("=" * 72)

sse_summary_df = safe_call(
    ak.stock_sse_summary,
    "上交所股票数据总貌",
    direct_domains=SOURCE_DOMAINS["上交所"],
    retries=2,
    delay=2,
)

if sse_summary_df is not None and not sse_summary_df.empty:
    sse_summary_df = sse_summary_df.copy()
    display(sse_summary_df)

    report_rows = sse_summary_df.loc[
        sse_summary_df["项目"].eq("报告时间")
    ]
    if not report_rows.empty:
        print(f"报告时间（股票口径）: {report_rows.iloc[0]['股票']}")

    sse_path = DATA_DIR / "上交所股票数据总貌.csv"
    sse_summary_df.to_csv(sse_path, index=False, encoding="utf-8-sig")
    print(f"已保存: {sse_path}")
else:
    print("上交所市场总貌获取失败；不影响后续腾讯、新浪、东财接口验证")
"""
    ),
    md(
        r"""
---
## 3. 东方财富行业板块接口

**API**：

- `ak.stock_board_industry_name_em()`：行业板块名称；
- `ak.stock_board_industry_cons_em(symbol="银行")`：银行板块成分股。

这是东方财富独有的板块分类示例。若远端限流或主动断开，本单元会记录失败并继续执行后续非东财接口。
"""
    ),
    code(
        r"""
print("\n" + "=" * 72)
print("案例 2：东方财富银行板块")
print("=" * 72)

industry_names_df = safe_call(
    ak.stock_board_industry_name_em,
    "东方财富行业板块名称",
    direct_domains=SOURCE_DOMAINS["东方财富"],
    retries=1,
)

if industry_names_df is not None and not industry_names_df.empty:
    display(industry_names_df.head())

bank_board_df = safe_call(
    ak.stock_board_industry_cons_em,
    "东方财富银行板块成分股",
    symbol="银行",
    direct_domains=SOURCE_DOMAINS["东方财富"],
    retries=1,
)

if bank_board_df is not None and not bank_board_df.empty:
    display(bank_board_df.head())
    bank_board_path = DATA_DIR / "银行板块清单_东方财富.csv"
    bank_board_df.to_csv(bank_board_path, index=False, encoding="utf-8-sig")
    print(f"银行板块共 {len(bank_board_df)} 只，已保存: {bank_board_path}")
else:
    print("东方财富银行板块当前不可用；后续行情将优先使用腾讯、新浪")
"""
    ),
    md(
        r"""
---
## 4. 日线多源实测：腾讯、新浪、东方财富

以招商银行 `600036` 为例，对三个官方文档接口使用相同日期范围与 `qfq` 参数。先分别保留各源标准化后的快照，再按共同交易日比较收盘价。

注意：

- 三个接口都称为前复权，但复权因子、更新时间可能存在细微差异；
- 只有共同日期上的同字段比较才有意义；
- 东方财富失败是一条实测结果，不会被静默替换成其他来源。
"""
    ),
    code(
        r"""
print("\n" + "=" * 72)
print("案例 3A：招商银行三数据源日线实测（前复权）")
print(f"范围: {COMPARE_START_DATE} 至 {DATA_CUTOFF_DATE}")
print("=" * 72)

multi_source_history = {}
history_status_rows = []

for source in HISTORY_SOURCE_ORDER:
    frame = fetch_history(
        "600036",
        source,
        start_date=COMPARE_START_DATE,
        end_date=DATA_CUTOFF_DATE,
        adjust="qfq",
        retries=1,
    )

    if frame is not None and not frame.empty:
        multi_source_history[source] = frame
        output_path = DATA_DIR / f"招商银行_600036_日线_前复权_{source}.csv"
        frame.to_csv(output_path, index=False, encoding="utf-8-sig")
        history_status_rows.append(
            {
                "数据源": source,
                "状态": "成功",
                "行数": len(frame),
                "起始交易日": frame["日期"].iloc[0].date(),
                "最新交易日": frame["日期"].iloc[-1].date(),
                "最新收盘": frame["收盘"].iloc[-1],
            }
        )
    else:
        history_status_rows.append(
            {
                "数据源": source,
                "状态": "失败",
                "行数": 0,
                "起始交易日": pd.NaT,
                "最新交易日": pd.NaT,
                "最新收盘": float("nan"),
            }
        )

history_status_df = pd.DataFrame(history_status_rows)
display(history_status_df)

if len(multi_source_history) >= 2:
    close_series = [
        frame.set_index("日期")["收盘"].rename(source)
        for source, frame in multi_source_history.items()
    ]
    close_comparison_df = pd.concat(close_series, axis=1, join="inner").dropna()
    close_comparison_df["来源间最大价差"] = (
        close_comparison_df.max(axis=1) - close_comparison_df.min(axis=1)
    )
    close_comparison_df = close_comparison_df.reset_index()

    print(f"共同交易日: {len(close_comparison_df)}")
    print(
        "共同区间最大收盘价差: "
        f"{close_comparison_df['来源间最大价差'].max():.4f} 元"
    )
    display(close_comparison_df.tail())

    comparison_path = DATA_DIR / "招商银行_三源收盘价对比.csv"
    close_comparison_df.to_csv(
        comparison_path,
        index=False,
        encoding="utf-8-sig",
    )
    print(f"已保存: {comparison_path}")
else:
    print("成功来源不足 2 个，跳过跨源收盘价比较")
"""
    ),
    md(
        r"""
### 4.1 五只银行批量取数与显式降级

每只股票依次尝试：

1. 腾讯 `stock_zh_a_hist_tx`；
2. 新浪 `stock_zh_a_daily`；
3. 东方财富 `stock_zh_a_hist`。

输出文件名和清单都记录实际来源，避免“接口自动换源但研究者不知道”的情况。
"""
    ),
    code(
        r"""
print("\n" + "=" * 72)
print("案例 3B：五只银行日线批量获取（腾讯 → 新浪 → 东方财富）")
print(f"范围: {START_DATE} 至 {DATA_CUTOFF_DATE}，前复权")
print("=" * 72)

hist_data = {}
history_source_used = {}
history_manifest_rows = []

for code, name in TARGET_STOCKS.items():
    print(f"\n{name} ({code})")
    selected_frame = None
    selected_source = None

    for source in HISTORY_SOURCE_ORDER:
        candidate = fetch_history(
            code,
            source,
            start_date=START_DATE,
            end_date=DATA_CUTOFF_DATE,
            adjust="qfq",
            retries=1,
        )
        if candidate is not None and not candidate.empty:
            selected_frame = candidate
            selected_source = source
            break

    if selected_frame is None:
        history_manifest_rows.append(
            {
                "代码": code,
                "名称": name,
                "状态": "全部来源失败",
                "实际来源": None,
                "行数": 0,
                "起始交易日": pd.NaT,
                "最新交易日": pd.NaT,
            }
        )
        continue

    hist_data[code] = selected_frame
    history_source_used[code] = selected_source
    output_path = (
        DATA_DIR / f"{name}_{code}_日线_前复权_{selected_source}.csv"
    )
    selected_frame.to_csv(output_path, index=False, encoding="utf-8-sig")
    history_manifest_rows.append(
        {
            "代码": code,
            "名称": name,
            "状态": "成功",
            "实际来源": selected_source,
            "行数": len(selected_frame),
            "起始交易日": selected_frame["日期"].iloc[0].date(),
            "最新交易日": selected_frame["日期"].iloc[-1].date(),
        }
    )
    print(
        f"  采用 {selected_source}: {len(selected_frame)} 行，"
        f"最新 {selected_frame['日期'].iloc[-1].date()}"
    )
    time.sleep(0.3)

history_manifest_df = pd.DataFrame(history_manifest_rows)
display(history_manifest_df)
history_manifest_df.to_csv(
    DATA_DIR / "银行日线_数据源清单.csv",
    index=False,
    encoding="utf-8-sig",
)
"""
    ),
    md(
        r"""
---
## 5. 分红配送多源实测：新浪与东方财富

官方文档接口：

- 新浪：`stock_history_dividend_detail(symbol, indicator="分红")`；
- 东方财富：`stock_fhps_detail_em(symbol)`。

两者字段覆盖不同，本实验只统一适合直接对照的核心字段：公告日、除权除息日、送股、转增、每 10 股派息、方案进度。东方财富的股息率字段没有在官方文档中注明单位，因此不在此处擅自换算或汇总。
"""
    ),
    code(
        r"""
def normalize_dividends(frame, source):
    """统一新浪与东财的已实施分红核心字段。"""
    data = frame.copy()

    if source == "新浪":
        data = data.rename(
            columns={
                "公告日期": "公告日期",
                "除权除息日": "除权除息日",
                "送股": "送股(每10股)",
                "转增": "转增(每10股)",
                "派息": "派息(每10股/元)",
                "进度": "方案进度",
            }
        )
    elif source == "东方财富":
        data = data.rename(
            columns={
                "最新公告日期": "公告日期",
                "除权除息日": "除权除息日",
                "送转股份-送股比例": "送股(每10股)",
                "送转股份-转股比例": "转增(每10股)",
                "现金分红-现金分红比例": "派息(每10股/元)",
                "方案进度": "方案进度",
            }
        )
    else:
        raise ValueError(f"未知分红源: {source}")

    standard_columns = [
        "公告日期",
        "除权除息日",
        "送股(每10股)",
        "转增(每10股)",
        "派息(每10股/元)",
        "方案进度",
    ]
    missing_columns = [col for col in standard_columns if col not in data.columns]
    if missing_columns:
        raise ValueError(f"{source} 分红数据缺少预期字段: {missing_columns}")

    data = data[standard_columns].copy()
    for column in ("公告日期", "除权除息日"):
        data[column] = pd.to_datetime(data[column], errors="coerce")
    for column in ("送股(每10股)", "转增(每10股)", "派息(每10股/元)"):
        data[column] = pd.to_numeric(data[column], errors="coerce")

    data = data[
        data["方案进度"].astype(str).str.contains("实施", na=False)
    ].copy()
    data = data[data["除权除息日"] >= pd.Timestamp("2022-01-01")]
    data = (
        data.sort_values("除权除息日", ascending=False)
        .drop_duplicates(
            subset=["除权除息日", "派息(每10股/元)"],
            keep="last",
        )
        .reset_index(drop=True)
    )
    data["数据源"] = source
    return data


DIVIDEND_SOURCE_ORDER = ("新浪", "东方财富")


def fetch_dividends(code, source, retries=1):
    if source == "新浪":
        raw = safe_call(
            ak.stock_history_dividend_detail,
            f"新浪 {code} 分红",
            symbol=code,
            indicator="分红",
            direct_domains=SOURCE_DOMAINS[source],
            retries=retries,
        )
    elif source == "东方财富":
        raw = safe_call(
            ak.stock_fhps_detail_em,
            f"东方财富 {code} 分红",
            symbol=code,
            direct_domains=SOURCE_DOMAINS[source],
            retries=retries,
        )
    else:
        raise ValueError(f"未知分红源: {source}")

    if raw is None or raw.empty:
        return None

    try:
        return normalize_dividends(raw, source)
    except Exception as exc:
        print(f"  [失败] {source} {code} 分红标准化: {type(exc).__name__}: {exc}")
        return None


print("\n" + "=" * 72)
print("案例 4A：招商银行新浪/东方财富分红实测")
print("=" * 72)

dividend_demo = {}
dividend_status_rows = []

for source in DIVIDEND_SOURCE_ORDER:
    frame = fetch_dividends("600036", source, retries=1)
    if frame is not None and not frame.empty:
        dividend_demo[source] = frame
        output_path = DATA_DIR / f"招商银行_600036_分红_{source}.csv"
        frame.to_csv(output_path, index=False, encoding="utf-8-sig")
        dividend_status_rows.append(
            {
                "数据源": source,
                "状态": "成功",
                "2022年以来已实施记录": len(frame),
                "最新除权除息日": frame["除权除息日"].iloc[0].date(),
            }
        )
    else:
        dividend_status_rows.append(
            {
                "数据源": source,
                "状态": "失败或无记录",
                "2022年以来已实施记录": 0,
                "最新除权除息日": pd.NaT,
            }
        )

display(pd.DataFrame(dividend_status_rows))
if dividend_demo:
    display(pd.concat(dividend_demo.values(), ignore_index=True).head(10))
"""
    ),
    md(
        r"""
### 5.1 五只银行分红显式降级

分红历史优先使用新浪；新浪不可用或返回空数据时再尝试东方财富。这里的降级只针对已经实施的核心分红记录，不代表两家接口所有扩展字段完全等价。
"""
    ),
    code(
        r"""
print("\n" + "=" * 72)
print("案例 4B：五只银行分红（新浪 → 东方财富）")
print("=" * 72)

all_dividends = {}
dividend_manifest_rows = []

for code, name in TARGET_STOCKS.items():
    print(f"\n{name} ({code})")
    selected_frame = None
    selected_source = None

    for source in DIVIDEND_SOURCE_ORDER:
        candidate = fetch_dividends(code, source, retries=1)
        if candidate is not None and not candidate.empty:
            selected_frame = candidate
            selected_source = source
            break

    if selected_frame is None:
        dividend_manifest_rows.append(
            {
                "代码": code,
                "名称": name,
                "状态": "全部来源失败或无已实施记录",
                "实际来源": None,
                "记录数": 0,
            }
        )
        continue

    all_dividends[code] = selected_frame
    output_path = DATA_DIR / f"{name}_{code}_分红_{selected_source}.csv"
    selected_frame.to_csv(output_path, index=False, encoding="utf-8-sig")
    dividend_manifest_rows.append(
        {
            "代码": code,
            "名称": name,
            "状态": "成功",
            "实际来源": selected_source,
            "记录数": len(selected_frame),
        }
    )
    print(f"  采用 {selected_source}: {len(selected_frame)} 条")
    time.sleep(0.3)

dividend_manifest_df = pd.DataFrame(dividend_manifest_rows)
display(dividend_manifest_df)
dividend_manifest_df.to_csv(
    DATA_DIR / "银行分红_数据源清单.csv",
    index=False,
    encoding="utf-8-sig",
)
"""
    ),
    md(
        r"""
---
## 6. 同一数据源的前复权与不复权对比

以招商银行为例，使用批量步骤实际选中的同一数据源比较 `qfq` 与不复权价格，避免把“数据源差异”误当成“复权差异”。

下方计算的是：

$$隐含价格比值 = \frac{不复权收盘价}{前复权收盘价}$$

它用于本实验的直观核对，不等同于各数据供应商公开的完整复权因子序列。
"""
    ),
    code(
        r"""
print("\n" + "=" * 72)
print("补充验证：招商银行同源前复权 vs 不复权")
print("=" * 72)

if "600036" in hist_data:
    selected_source = history_source_used["600036"]
    adjusted_frame = hist_data["600036"]
    raw_frame = fetch_history(
        "600036",
        selected_source,
        start_date=COMPARE_START_DATE,
        end_date=DATA_CUTOFF_DATE,
        adjust="",
        retries=1,
    )

    if raw_frame is not None and not raw_frame.empty:
        comparison = adjusted_frame[
            adjusted_frame["日期"] >= pd.Timestamp(COMPARE_START_DATE)
        ][["日期", "收盘"]].rename(columns={"收盘": "收盘(前复权)"})
        comparison = comparison.merge(
            raw_frame[["日期", "收盘"]].rename(
                columns={"收盘": "收盘(不复权)"}
            ),
            on="日期",
            how="inner",
        )
        comparison["隐含价格比值"] = (
            comparison["收盘(不复权)"] / comparison["收盘(前复权)"]
        )
        comparison["数据源"] = selected_source

        display(comparison.tail())
        comparison_path = DATA_DIR / (
            f"招商银行_复权对比_{selected_source}.csv"
        )
        comparison.to_csv(
            comparison_path,
            index=False,
            encoding="utf-8-sig",
        )
        print(f"采用数据源: {selected_source}")
        print(f"已保存: {comparison_path}")
    else:
        print(f"{selected_source} 不复权数据不可用，跳过复权对比")
else:
    print("招商银行所有日线来源均失败，跳过复权对比")
"""
    ),
    md(
        r"""
---
## 7. 输出清单与阅读结论

运行完成后重点查看：

1. `银行日线_数据源清单.csv`：每只股票实际采用的行情源；
2. `招商银行_三源收盘价对比.csv`：共同日期上的多源一致性；
3. `银行分红_数据源清单.csv`：每只股票实际采用的分红源；
4. 控制台中的失败信息：区分“接口实现正确”与“上游当前可用”。

若东方财富失败而腾讯/新浪成功，说明降级路径生效；不能据此推断东方财富接口永久失效。
"""
    ),
    code(
        r"""
print(f"\n{'=' * 72}")
print("实验一（AKShare 多数据源版）完成")
print(f"运行日 / 数据截止参数: {DATA_CUTOFF_DATE}")
print(f"数据目录: {DATA_DIR}")
print(f"{'=' * 72}")

output_files = sorted(path for path in DATA_DIR.iterdir() if path.is_file())
for path in output_files:
    size_kb = path.stat().st_size / 1024
    print(f"  {path.relative_to(LABS_DIR)}  ({size_kb:.1f} KB)")

print(f"{'=' * 72}")
"""
    ),
]

for cell in notebook.cells:
    if cell.cell_type == "code":
        cell.execution_count = None
        cell.outputs = []

nbf.write(notebook, notebook_path)
