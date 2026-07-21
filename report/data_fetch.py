"""下载报告所需的原始行情、分红、指数和逆回购数据。

该文件只负责数据获取与快照落盘，不包含回测和图表逻辑。
"""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO
from pathlib import Path

import pandas as pd
import requests


DATA_START = "20060101"
REPO_START = "20160101"
DATA_END = "20260720"
DATA_DIR = Path(__file__).resolve().parent / "data"

STOCKS = {
    "601398": "工商银行",
    "601939": "建设银行",
    "601288": "农业银行",
    "601988": "中国银行",
    "600036": "招商银行",
    "601166": "兴业银行",
    "600016": "民生银行",
}

CSI_INDICES = {
    "H00300": "沪深300全收益",
    "H00905": "中证500全收益",
    "000300": "沪深300价格",
    "000905": "中证500价格",
}

SOURCES = {
    "stock_prices": "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get",
    "dividends": "https://vip.stock.finance.sina.com.cn/corp/go.php/vISSUE_ShareBonus/",
    "csi_indices": "https://www.csindex.com.cn/csindex-home/perf/index-perf",
    "repo_204001": "https://query.sse.com.cn/commonQuery.do",
}


def request_with_retry(method, url, *, retries=3, **kwargs):
    last_error = None
    for attempt in range(retries):
        try:
            response = requests.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(1.0 + attempt)
    raise RuntimeError(f"请求失败: {url}: {last_error}")


def fetch_stock_prices(code: str) -> pd.DataFrame:
    """从腾讯证券接口分两年窗口获取不复权日线。"""
    prefix = "sh" if code.startswith(("6", "9")) else "sz"
    symbol = f"{prefix}{code}"
    rows = []

    for year in range(int(DATA_START[:4]), int(DATA_END[:4]) + 1, 2):
        params = {
            "_var": f"kline_day{year}",
            "param": f"{symbol},day,{year}-01-01,{year + 1}-12-31,640,",
            "r": "0.8205512681390605",
        }
        response = request_with_retry(
            "GET", SOURCES["stock_prices"], params=params, timeout=20
        )
        text = response.text
        payload = json.loads(text[text.find("={") + 1 :])
        rows.extend(payload["data"][symbol].get("day") or [])

    frame = pd.DataFrame(rows).iloc[:, :6]
    frame.columns = ["date", "open", "close", "high", "low", "amount"]
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    for column in ["open", "close", "high", "low", "amount"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["date", "close"])
    frame = frame.drop_duplicates(subset="date", keep="last").sort_values("date")
    frame = frame[
        frame["date"].between(pd.Timestamp(DATA_START), pd.Timestamp(DATA_END))
    ]
    frame.insert(1, "code", code)
    frame.insert(2, "name", STOCKS[code])
    return frame.reset_index(drop=True)


def fetch_dividends(code: str) -> pd.DataFrame:
    """获取新浪财经已实施分红方案并换算成每股口径。"""
    url = (
        "https://vip.stock.finance.sina.com.cn/corp/go.php/"
        f"vISSUE_ShareBonus/stockid/{code}.phtml"
    )
    response = request_with_retry("GET", url, timeout=20)
    tables = pd.read_html(StringIO(response.text))
    source = next(
        table for table in tables
        if any("派息" in str(column) for column in table.columns)
    )
    source.columns = [
        column[-1] if isinstance(column, tuple) else column
        for column in source.columns
    ]

    def find_column(text):
        return next(column for column in source.columns if text in str(column))

    frame = pd.DataFrame({
        "date": pd.to_datetime(source[find_column("除权除息日")], errors="coerce"),
        "cash_dividend_per_share": pd.to_numeric(
            source[find_column("派息")], errors="coerce"
        ).fillna(0.0) / 10.0,
        "bonus_share_ratio": (
            pd.to_numeric(source[find_column("送股")], errors="coerce").fillna(0.0)
            + pd.to_numeric(source[find_column("转增")], errors="coerce").fillna(0.0)
        ) / 10.0,
        "status": source[find_column("进度")].astype(str),
    })
    frame = frame[
        frame["date"].notna()
        & frame["status"].str.contains("实施", na=False)
        & (frame["date"] <= pd.Timestamp(DATA_END))
    ].drop(columns="status")
    frame = frame.groupby("date", as_index=False).agg(
        cash_dividend_per_share=("cash_dividend_per_share", "sum"),
        bonus_share_ratio=("bonus_share_ratio", "sum"),
    ).sort_values("date")
    frame.insert(1, "code", code)
    frame.insert(2, "name", STOCKS[code])
    return frame.reset_index(drop=True)


def fetch_csi_index(code: str) -> pd.DataFrame:
    """从中证指数官网获取价格指数或全收益指数日收盘值。"""
    params = {
        "indexCode": code,
        "startDate": DATA_START,
        "endDate": DATA_END,
    }
    response = request_with_retry(
        "GET", SOURCES["csi_indices"], params=params, timeout=30
    )
    rows = response.json().get("data") or []
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise RuntimeError(f"中证指数 {code} 没有返回数据")
    frame = frame.rename(columns={"tradeDate": "date", "close": "close"})
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame = frame[["date", "close"]].dropna()
    frame = frame.drop_duplicates(subset="date", keep="last").sort_values("date")

    # 中证接口会在非交易的查询起始日注入一行“下一交易日收盘值”。固定
    # 起点 2006-01-01 为周日，因此明确移除该合成行。
    frame = frame[frame["date"] != pd.Timestamp(DATA_START)]
    frame.insert(1, "code", code)
    frame.insert(2, "name", CSI_INDICES[code])
    return frame.reset_index(drop=True)


def _fetch_repo_window(query_date: pd.Timestamp) -> list[dict]:
    params = {
        "isPagination": "false",
        "sqlId": "COMMON_BOND_HGDPSYLQX_L",
        "TRADEDATE": query_date.strftime("%Y-%m-%d"),
    }
    headers = {"Referer": "https://bond.sse.com.cn/"}
    response = request_with_retry(
        "GET", SOURCES["repo_204001"], params=params, headers=headers, timeout=20
    )
    return response.json().get("result") or []


def fetch_repo_204001() -> pd.DataFrame:
    """按周查询上交所 204001 一天期回购定盘利率并去重。"""
    start = pd.Timestamp(REPO_START)
    end = pd.Timestamp(DATA_END)
    query_dates = list(pd.date_range(start + pd.Timedelta(days=7), end, freq="7D"))
    if not query_dates or query_dates[-1] != end:
        query_dates.append(end)

    rows = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(_fetch_repo_window, date): date for date in query_dates}
        for completed, future in enumerate(as_completed(futures), start=1):
            rows.extend(future.result())
            if completed % 100 == 0:
                print(f"  国债逆回购进度: {completed}/{len(futures)}")

    frame = pd.DataFrame(rows)
    if frame.empty:
        raise RuntimeError("上交所 204001 定盘利率没有返回数据")
    frame = frame.rename(columns={
        "TRADE_DATE": "date",
        "RATE_1DAY": "rate_pct",
        "AVG_RATE_1DAY": "avg_5d_pct",
    })
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["rate_pct"] = pd.to_numeric(frame["rate_pct"], errors="coerce")
    frame["avg_5d_pct"] = pd.to_numeric(frame["avg_5d_pct"], errors="coerce")
    frame = frame[["date", "rate_pct", "avg_5d_pct"]].dropna(subset=["date", "rate_pct"])
    frame = frame.drop_duplicates(subset="date", keep="last").sort_values("date")
    frame = frame[frame["date"].between(start, end)]
    frame.insert(1, "code", "204001")
    frame.insert(2, "name", "国债逆回购GC001代理")
    return frame.reset_index(drop=True)


def write_snapshot():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    stock_frames = []
    dividend_frames = []
    for code, name in STOCKS.items():
        print(f"获取 {name}({code})...")
        stock_frames.append(fetch_stock_prices(code))
        dividend_frames.append(fetch_dividends(code))

    print("获取中证指数基准...")
    index_frames = [fetch_csi_index(code) for code in CSI_INDICES]
    print("获取国债逆回购 204001 定盘利率...")
    repo_frame = fetch_repo_204001()

    stocks = pd.concat(stock_frames, ignore_index=True)
    dividends = pd.concat(dividend_frames, ignore_index=True)
    indices = pd.concat(index_frames, ignore_index=True)

    stocks.to_csv(DATA_DIR / "stock_prices.csv", index=False, encoding="utf-8-sig")
    dividends.to_csv(DATA_DIR / "dividends.csv", index=False, encoding="utf-8-sig")
    indices.to_csv(DATA_DIR / "csi_indices.csv", index=False, encoding="utf-8-sig")
    repo_frame.to_csv(DATA_DIR / "repo_204001.csv", index=False, encoding="utf-8-sig")

    manifest = {
        "data_start": DATA_START,
        "repo_start_query": REPO_START,
        "repo_start_actual": repo_frame["date"].min().strftime("%Y%m%d"),
        "data_end": DATA_END,
        "stocks": STOCKS,
        "indices": CSI_INDICES,
        "sources": SOURCES,
        "row_counts": {
            "stock_prices": len(stocks),
            "dividends": len(dividends),
            "csi_indices": len(indices),
            "repo_204001": len(repo_frame),
        },
        "notes": [
            "股票价格为不复权日线；分红按税前每股口径单独保存。",
            "H00300/H00905 为中证官方全收益指数，已包含样本现金分红。",
            "204001 为上交所一天期回购定盘利率代理，不是个体实际成交价。",
        ],
    }
    (DATA_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"数据快照已写入 {DATA_DIR}")


if __name__ == "__main__":
    write_snapshot()
