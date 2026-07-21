"""Lab 1 银行股定投：数据获取、质量检查与纯回测函数。

Notebook 负责组织实验、展示表格和绘图；本模块把数据访问和纯计算分开，
便于针对金融口径做确定性测试。
"""

from __future__ import annotations

import hashlib
import math
import socket
import time
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import pandas as pd
from mootdx.quotes import Quotes

from data_source_registry import call_akshare, direct_domains, sanitize_error, to_frame


TDX_SERVERS = (
    ("119.97.185.59", 7709),
    ("124.70.133.119", 7709),
    ("116.205.183.150", 7709),
    ("123.60.73.44", 7709),
)

# 2026-07-24 人工核验的沪深 A 股银行清单。它是自动筛选后的审计护栏，
# 不是绕过交易所清单的静态股票池；实际输出仍要求代码存在于当次官方清单。
MANUAL_BANK_SYMBOLS = (
    "000001", "001227", "002142", "002807", "002839", "002936", "002948",
    "002958", "002966", "600000", "600015", "600016", "600036", "600908",
    "600919", "600926", "600928", "601009", "601077", "601128", "601166",
    "601169", "601187", "601229", "601288", "601328", "601398", "601528",
    "601577", "601658", "601665", "601818", "601825", "601838", "601860",
    "601916", "601939", "601963", "601988", "601997", "601998", "603323",
)

BANK_TEXT_PATTERNS = (
    "银行", "吸收公众存款", "发放贷款", "零售金融", "公司金融",
    "存贷款", "商业银行",
)

PRICE_COLUMNS = (
    "date", "symbol", "open", "high", "low", "close", "volume", "amount",
    "adjustment", "source",
)


@dataclass
class PriceBundle:
    raw: pd.DataFrame
    qfq: pd.DataFrame
    secondary_raw: pd.DataFrame
    route: dict[str, Any]
    comparison: dict[str, Any]


@dataclass
class BacktestOutput:
    summary: dict[str, Any]
    transactions: pd.DataFrame
    account_history: pd.DataFrame
    total_return_history: pd.DataFrame


def normalize_symbol(value: Any) -> str:
    digits = "".join(character for character in str(value) if character.isdigit())
    return digits[-6:].zfill(6)


def market_prefix(symbol: str) -> str:
    symbol = normalize_symbol(symbol)
    if symbol.startswith(("6", "9")):
        return "sh"
    if symbol.startswith(("4", "8")):
        return "bj"
    return "sz"


def _normalize_exchange_frame(
    frame: pd.DataFrame,
    *,
    exchange: str,
    rename: dict[str, str],
) -> pd.DataFrame:
    result = frame.rename(columns=rename).copy()
    for column in ("symbol", "name", "list_date", "exchange_industry"):
        if column not in result:
            result[column] = pd.NA
    result["symbol"] = result["symbol"].map(normalize_symbol)
    result["name"] = result["name"].astype("string").str.strip()
    result["list_date"] = pd.to_datetime(result["list_date"], errors="coerce")
    result["exchange_industry"] = (
        result["exchange_industry"].astype("string").fillna("").str.strip()
    )
    result["exchange"] = exchange
    result["security_type"] = "A-share"
    result["list_source"] = {
        "SSE": "上海证券交易所",
        "SZSE": "深圳证券交易所",
        "BSE": "北京证券交易所",
    }[exchange]
    return result[
        [
            "symbol", "name", "list_date", "exchange_industry", "exchange",
            "security_type", "list_source",
        ]
    ]


def fetch_exchange_stock_lists() -> pd.DataFrame:
    """获取沪、深、北交易所 A 股清单并统一字段。"""

    import akshare as ak

    frames: list[pd.DataFrame] = []
    with direct_domains("sse.com.cn"):
        for selector in ("主板A股", "科创板"):
            frame = call_akshare(ak.stock_info_sh_name_code, symbol=selector)
            frames.append(
                _normalize_exchange_frame(
                    frame,
                    exchange="SSE",
                    rename={
                        "证券代码": "symbol",
                        "证券简称": "name",
                        "上市日期": "list_date",
                    },
                )
            )
    with direct_domains("szse.cn"):
        frame = call_akshare(ak.stock_info_sz_name_code, symbol="A股列表")
        frames.append(
            _normalize_exchange_frame(
                frame,
                exchange="SZSE",
                rename={
                    "A股代码": "symbol",
                    "A股简称": "name",
                    "A股上市日期": "list_date",
                    "所属行业": "exchange_industry",
                },
            )
        )
    with direct_domains("bse.cn"):
        frame = call_akshare(ak.stock_info_bj_name_code)
        frames.append(
            _normalize_exchange_frame(
                frame,
                exchange="BSE",
                rename={
                    "证券代码": "symbol",
                    "证券简称": "name",
                    "上市日期": "list_date",
                    "所属行业": "exchange_industry",
                },
            )
        )

    result = pd.concat(frames, ignore_index=True)
    result = result.drop_duplicates(["exchange", "symbol"], keep="last")
    return result.sort_values(["exchange", "symbol"]).reset_index(drop=True)


def automatic_bank_candidates(exchange_universe: pd.DataFrame) -> pd.DataFrame:
    """用名称与交易所行业做宽松初筛；最终结果仍须 F10 与人工核验。"""

    frame = exchange_universe.copy()
    name_mask = frame["name"].astype(str).str.contains(
        r"银行|农商行|张家港行", regex=True, na=False
    )
    industry_mask = frame["exchange_industry"].astype(str).str.contains(
        r"银行", regex=True, na=False
    )
    manual_mask = frame["symbol"].isin(MANUAL_BANK_SYMBOLS)
    return frame[name_mask | industry_mask | manual_mask].copy()


def tdx_client() -> Any:
    for server in TDX_SERVERS:
        try:
            with socket.create_connection(server, timeout=1.5):
                return Quotes.factory(market="std", server=server)
        except OSError:
            continue
    raise ConnectionError("本轮探测的通达信 TCP 服务器均不可达")


def flatten_f10(value: Any) -> str:
    if isinstance(value, dict):
        return "\n".join(str(item) for item in value.values() if item)
    return "" if value is None else str(value)


def classify_f10_bank(text: str) -> tuple[bool, str]:
    matched = [pattern for pattern in BANK_TEXT_PATTERNS if pattern in text]
    # 名称中出现一次“银行”并不足以证明主营；至少再命中一个银行业务词，
    # 或命中三个独立银行相关词。
    confirmed = len(matched) >= 2
    return confirmed, "|".join(matched)


def fetch_f10_classification(candidates: pd.DataFrame) -> pd.DataFrame:
    """用通达信 F10 文本验证银行主营；北交所当前记录为不支持。"""

    rows: list[dict[str, Any]] = []
    client = tdx_client()
    try:
        for row in candidates.itertuples(index=False):
            symbol = normalize_symbol(row.symbol)
            if row.exchange == "BSE":
                rows.append(
                    {
                        "symbol": symbol,
                        "f10_status": "UNSUPPORTED",
                        "f10_is_bank": False,
                        "f10_matches": "",
                        "f10_sha256": "",
                        "f10_error": "mootdx F10 当前只支持沪深市场",
                    }
                )
                continue
            try:
                raw = client.F10(symbol=symbol)
                text = flatten_f10(raw)
                confirmed, matches = classify_f10_bank(text)
                rows.append(
                    {
                        "symbol": symbol,
                        "f10_status": "AVAILABLE" if text else "EMPTY",
                        "f10_is_bank": confirmed,
                        "f10_matches": matches,
                        "f10_sha256": hashlib.sha256(
                            text.encode("utf-8", errors="ignore")
                        ).hexdigest() if text else "",
                        "f10_error": "",
                    }
                )
            except Exception as error:  # noqa: BLE001 - 第三方逐股体检
                rows.append(
                    {
                        "symbol": symbol,
                        "f10_status": "BROKEN",
                        "f10_is_bank": False,
                        "f10_matches": "",
                        "f10_sha256": "",
                        "f10_error": type(error).__name__,
                    }
                )
            time.sleep(0.05)
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()
    return pd.DataFrame(rows)


def finalize_bank_universe(
    exchange_universe: pd.DataFrame,
    f10_classification: pd.DataFrame,
    *,
    as_of_date: str,
    manual_symbols: Iterable[str] = MANUAL_BANK_SYMBOLS,
) -> pd.DataFrame:
    """应用人工核验清单并检查自动候选/F10 结果是否出现待复核变化。"""

    manual = {normalize_symbol(symbol) for symbol in manual_symbols}
    listed = exchange_universe.copy()
    listed = listed[listed["list_date"].le(pd.Timestamp(as_of_date))].copy()
    listed_symbols = set(listed["symbol"])
    missing = sorted(manual - listed_symbols)
    if missing:
        raise ValueError(f"人工核验银行代码不在交易所清单中: {missing}")

    automatic = automatic_bank_candidates(listed)
    unexpected = sorted(set(automatic["symbol"]) - manual)
    if unexpected:
        raise ValueError(f"自动筛选出现未人工核验候选: {unexpected}")

    result = listed[listed["symbol"].isin(manual)].copy()
    result = result.merge(f10_classification, on="symbol", how="left")
    result["manual_verified"] = True
    result["manual_review_as_of"] = pd.Timestamp(as_of_date)
    result["f10_review_required"] = ~result["f10_is_bank"].fillna(False)
    result["universe_method"] = (
        "交易所A股清单→名称/行业初筛→mootdx F10主营文本→人工核验"
    )
    result = result.sort_values("symbol").reset_index(drop=True)
    return result


def _normalize_history(
    value: Any,
    *,
    symbol: str,
    source: str,
    adjustment: str,
) -> pd.DataFrame:
    frame = to_frame(value).rename(
        columns={
            "日期": "date",
            "datetime": "date",
            "开盘": "open",
            "最高": "high",
            "最低": "low",
            "收盘": "close",
            "成交量": "volume",
            "成交额": "amount",
        }
    ).copy()
    required = ("date", "open", "high", "low", "close")
    missing = [column for column in required if column not in frame]
    if missing:
        raise ValueError(f"{source} 缺少行情字段: {missing}")
    for column in ("volume", "amount"):
        if column not in frame:
            frame[column] = np.nan
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    for column in ("open", "high", "low", "close", "volume", "amount"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["symbol"] = normalize_symbol(symbol)
    frame["adjustment"] = adjustment
    frame["source"] = source
    frame = frame.dropna(subset=["date"]).sort_values("date")
    frame = frame.drop_duplicates("date", keep="last").reset_index(drop=True)
    return frame[list(PRICE_COLUMNS)]


def fetch_tencent_history(
    symbol: str,
    start_date: str,
    end_date: str,
    *,
    adjustment: str,
) -> pd.DataFrame:
    import akshare as ak

    adjust = "" if adjustment == "raw" else adjustment
    with direct_domains("qq.com"):
        value = call_akshare(
            ak.stock_zh_a_hist_tx,
            symbol=f"{market_prefix(symbol)}{normalize_symbol(symbol)}",
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
            timeout=30,
        )
    return _normalize_history(
        value,
        symbol=symbol,
        source="AKShare-腾讯财经",
        adjustment=adjustment,
    )


def fetch_sina_history(
    symbol: str,
    start_date: str,
    end_date: str,
    *,
    adjustment: str,
) -> pd.DataFrame:
    import akshare as ak

    adjust = "" if adjustment == "raw" else adjustment
    with direct_domains("sina.com.cn"):
        value = call_akshare(
            ak.stock_zh_a_daily,
            symbol=f"{market_prefix(symbol)}{normalize_symbol(symbol)}",
            start_date=start_date,
            end_date=end_date,
            adjust=adjust,
        )
    return _normalize_history(
        value,
        symbol=symbol,
        source="AKShare-新浪财经",
        adjustment=adjustment,
    )


def compare_price_sources(
    primary: pd.DataFrame,
    secondary: pd.DataFrame,
    *,
    relative_tolerance: float = 0.002,
    minimum_common_dates: int = 20,
) -> dict[str, Any]:
    left = primary[["date", "close"]].rename(columns={"close": "primary_close"})
    right = secondary[["date", "close"]].rename(columns={"close": "secondary_close"})
    joined = left.merge(right, on="date", how="inner").dropna()
    if len(joined) < minimum_common_dates:
        return {
            "status": "INSUFFICIENT",
            "common_dates": len(joined),
            "max_relative_diff": np.nan,
            "mean_relative_diff": np.nan,
            "breach_count": 0,
            "threshold": relative_tolerance,
        }
    denominator = joined["secondary_close"].abs().clip(lower=1e-12)
    relative = (joined["primary_close"] - joined["secondary_close"]).abs() / denominator
    breach_count = int(relative.gt(relative_tolerance).sum())
    return {
        "status": "PASS" if breach_count == 0 else "FAIL",
        "common_dates": len(joined),
        "max_relative_diff": float(relative.max()),
        "mean_relative_diff": float(relative.mean()),
        "breach_count": breach_count,
        "threshold": relative_tolerance,
    }


def fetch_price_bundle(
    symbol: str,
    start_date: str,
    end_date: str,
    *,
    relative_tolerance: float = 0.002,
) -> PriceBundle:
    """行情路由：腾讯主源、新浪备源；东财禁用、mootdx 暂缓。"""

    route: dict[str, Any] = {
        "symbol": normalize_symbol(symbol),
        "raw_source": "",
        "qfq_source": "",
        "tencent_raw_error": "",
        "sina_raw_error": "",
        "tencent_qfq_error": "",
        "sina_qfq_error": "",
        "mootdx_bars": "DEFERRED",
        "eastmoney_stock_zh_a_hist": "DISABLED",
    }
    tencent_raw = pd.DataFrame()
    sina_raw = pd.DataFrame()
    tencent_qfq = pd.DataFrame()
    sina_qfq = pd.DataFrame()

    try:
        tencent_raw = fetch_tencent_history(
            symbol, start_date, end_date, adjustment="raw"
        )
    except Exception as error:  # noqa: BLE001 - 显式降级
        route["tencent_raw_error"] = type(error).__name__
    try:
        sina_raw = fetch_sina_history(
            symbol, start_date, end_date, adjustment="raw"
        )
    except Exception as error:  # noqa: BLE001 - 双源质量检查
        route["sina_raw_error"] = type(error).__name__

    raw = tencent_raw if not tencent_raw.empty else sina_raw
    route["raw_source"] = (
        "stock_zh_a_hist_tx" if not tencent_raw.empty
        else "stock_zh_a_daily" if not sina_raw.empty else ""
    )
    if raw.empty:
        raise RuntimeError(f"{symbol} 腾讯与新浪不复权行情均不可用: {route}")

    try:
        tencent_qfq = fetch_tencent_history(
            symbol, start_date, end_date, adjustment="qfq"
        )
    except Exception as error:  # noqa: BLE001 - 显式降级
        route["tencent_qfq_error"] = type(error).__name__
    if tencent_qfq.empty:
        try:
            sina_qfq = fetch_sina_history(
                symbol, start_date, end_date, adjustment="qfq"
            )
        except Exception as error:  # noqa: BLE001 - 显式降级
            route["sina_qfq_error"] = type(error).__name__
    qfq = tencent_qfq if not tencent_qfq.empty else sina_qfq
    route["qfq_source"] = (
        "stock_zh_a_hist_tx" if not tencent_qfq.empty
        else "stock_zh_a_daily" if not sina_qfq.empty else ""
    )
    if qfq.empty:
        raise RuntimeError(f"{symbol} 腾讯与新浪前复权行情均不可用: {route}")

    comparison = compare_price_sources(
        tencent_raw,
        sina_raw,
        relative_tolerance=relative_tolerance,
    ) if not tencent_raw.empty and not sina_raw.empty else {
        "status": "UNAVAILABLE",
        "common_dates": 0,
        "max_relative_diff": np.nan,
        "mean_relative_diff": np.nan,
        "breach_count": 0,
        "threshold": relative_tolerance,
    }
    return PriceBundle(
        raw=raw,
        qfq=qfq,
        secondary_raw=sina_raw,
        route=route,
        comparison=comparison,
    )


def validate_price_frame(
    frame: pd.DataFrame,
    *,
    maximum_calendar_gap_days: int = 20,
) -> dict[str, Any]:
    data = frame.copy()
    dates = pd.to_datetime(data["date"], errors="coerce")
    gaps = dates.sort_values().diff().dt.days.dropna()
    fatal: list[str] = []
    warnings: list[str] = []
    if dates.duplicated().any():
        fatal.append("日期重复")
    if not dates.is_monotonic_increasing:
        fatal.append("日期未按升序")
    if data["close"].isna().any():
        fatal.append("存在空收盘价")
    if (data["low"] > data["high"]).fillna(False).any():
        fatal.append("最低价高于最高价")
    if (data["volume"] < 0).fillna(False).any():
        fatal.append("成交量小于0")
    if (data[["open", "high", "low", "close"]] <= 0).any(axis=None):
        fatal.append("OHLC 存在非正数")
    maximum_gap = int(gaps.max()) if not gaps.empty else 0
    if maximum_gap > maximum_calendar_gap_days:
        warnings.append(f"最大交易日期间隔 {maximum_gap} 天，需核查停牌或数据缺失")
    return {
        "status": "PASS" if not fatal else "FAIL",
        "rows": len(data),
        "start_date": dates.min(),
        "end_date": dates.max(),
        "maximum_calendar_gap_days": maximum_gap,
        "fatal_issues": "; ".join(fatal),
        "warnings": "; ".join(warnings),
    }


def normalize_dividends(value: Any, *, symbol: str, source: str) -> pd.DataFrame:
    frame = to_frame(value).copy()
    if source == "新浪财经":
        rename = {
            "公告日期": "announcement_date",
            "除权除息日": "ex_date",
            "股权登记日": "record_date",
            "派息": "cash_per_10",
            "进度": "status",
        }
    elif source == "东方财富":
        rename = {
            "最新公告日期": "announcement_date",
            "除权除息日": "ex_date",
            "股权登记日": "record_date",
            "现金分红-现金分红比例": "cash_per_10",
            "方案进度": "status",
        }
    else:
        raise ValueError(f"未知分红源: {source}")
    frame = frame.rename(columns=rename)
    for column in (
        "announcement_date", "ex_date", "record_date", "cash_per_10", "status"
    ):
        if column not in frame:
            frame[column] = pd.NA
    for column in ("announcement_date", "ex_date", "record_date"):
        frame[column] = pd.to_datetime(frame[column], errors="coerce")
    frame["cash_per_10"] = pd.to_numeric(frame["cash_per_10"], errors="coerce")
    frame["cash_dividend_per_share"] = frame["cash_per_10"] / 10.0
    frame["status"] = frame["status"].astype("string").fillna("")
    frame = frame[frame["status"].str.contains("实施", na=False)].copy()
    frame["symbol"] = normalize_symbol(symbol)
    frame["source"] = source
    frame = frame.dropna(subset=["ex_date", "cash_dividend_per_share"])
    frame = frame[frame["cash_dividend_per_share"].ge(0)]
    return frame[
        [
            "symbol", "announcement_date", "record_date", "ex_date",
            "cash_per_10", "cash_dividend_per_share", "status", "source",
        ]
    ].sort_values("ex_date").reset_index(drop=True)


def fetch_dividends(symbol: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    """分红路由：新浪主源，失败或空时降级至东方财富。"""

    import akshare as ak

    route = {
        "symbol": normalize_symbol(symbol),
        "selected_source": "",
        "sina_error": "",
        "eastmoney_error": "",
    }
    try:
        with direct_domains("sina.com.cn"):
            raw = call_akshare(
                ak.stock_history_dividend_detail,
                symbol=normalize_symbol(symbol),
                indicator="分红",
            )
        normalized = normalize_dividends(
            raw, symbol=symbol, source="新浪财经"
        )
        if not normalized.empty:
            route["selected_source"] = "stock_history_dividend_detail"
            return normalized, route
    except Exception as error:  # noqa: BLE001 - 显式降级
        route["sina_error"] = type(error).__name__

    try:
        with direct_domains("eastmoney.com"):
            raw = call_akshare(
                ak.stock_fhps_detail_em,
                symbol=normalize_symbol(symbol),
            )
        normalized = normalize_dividends(
            raw, symbol=symbol, source="东方财富"
        )
        route["selected_source"] = "stock_fhps_detail_em"
        return normalized, route
    except Exception as error:  # noqa: BLE001 - 记录备源失败
        route["eastmoney_error"] = type(error).__name__
        raise RuntimeError(f"{symbol} 分红主备源均不可用: {route}") from error


def validate_dividends(
    dividends: pd.DataFrame,
    prices: pd.DataFrame,
) -> dict[str, Any]:
    fatal: list[str] = []
    warnings: list[str] = []
    if dividends.empty:
        return {
            "status": "WARN",
            "rows": 0,
            "fatal_issues": "",
            "warnings": "无已实施现金分红记录",
            "outside_price_range": 0,
        }
    if dividends["ex_date"].duplicated().any():
        warnings.append("同一除权除息日存在多条记录，将按日合计")
    cash = pd.to_numeric(dividends["cash_dividend_per_share"], errors="coerce")
    if cash.isna().any() or cash.lt(0).any():
        fatal.append("每股分红为空或小于0")
    if cash.gt(100).any():
        fatal.append("每股分红大于100元，疑似每10股单位未转换")
    price_start = pd.to_datetime(prices["date"]).min()
    price_end = pd.to_datetime(prices["date"]).max()
    outside = int(
        (~pd.to_datetime(dividends["ex_date"]).between(price_start, price_end)).sum()
    )
    if outside:
        warnings.append(f"{outside} 条分红在当前行情范围外，回测时忽略")
    return {
        "status": "PASS" if not fatal else "FAIL",
        "rows": len(dividends),
        "fatal_issues": "; ".join(fatal),
        "warnings": "; ".join(warnings),
        "outside_price_range": outside,
    }


def build_total_return_history(
    prices: pd.DataFrame,
    dividends: pd.DataFrame,
) -> pd.DataFrame:
    """用不复权收盘价和每股现金分红构建标的总收益净值。"""

    frame = prices[["date", "close"]].copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.dropna().drop_duplicates("date", keep="last").sort_values("date")
    events = dividends[["ex_date", "cash_dividend_per_share"]].copy()
    events["ex_date"] = pd.to_datetime(events["ex_date"])
    events = events.groupby("ex_date", as_index=False)["cash_dividend_per_share"].sum()
    frame = frame.merge(events, left_on="date", right_on="ex_date", how="left")
    frame["cash_dividend_per_share"] = frame["cash_dividend_per_share"].fillna(0.0)
    frame["daily_total_return"] = (
        (frame["close"] + frame["cash_dividend_per_share"])
        / frame["close"].shift(1)
        - 1.0
    )
    frame.loc[frame.index[0], "daily_total_return"] = 0.0
    frame["total_return_nav"] = (1.0 + frame["daily_total_return"]).cumprod()
    frame["drawdown"] = (
        frame["total_return_nav"] / frame["total_return_nav"].cummax() - 1.0
    )
    return frame[
        [
            "date", "close", "cash_dividend_per_share", "daily_total_return",
            "total_return_nav", "drawdown",
        ]
    ]


def xirr(cashflows: Iterable[float], dates: Iterable[Any]) -> float:
    values = np.asarray(list(cashflows), dtype=float)
    timestamps = [pd.Timestamp(date) for date in dates]
    if len(values) != len(timestamps) or len(values) < 2:
        return np.nan
    if np.all(values >= 0) or np.all(values <= 0):
        return np.nan
    years = np.array(
        [(date - timestamps[0]).total_seconds() / (365.25 * 86400)
         for date in timestamps],
        dtype=float,
    )

    def npv(rate: float) -> float:
        return float(np.sum(values / np.power(1.0 + rate, years)))

    lower = -0.9999
    upper = 1.0
    lower_value = npv(lower)
    upper_value = npv(upper)
    while lower_value * upper_value > 0 and upper < 1_000_000:
        upper = upper * 2.0 + 1.0
        upper_value = npv(upper)
    if lower_value * upper_value > 0:
        return np.nan
    for _ in range(250):
        midpoint = (lower + upper) / 2.0
        midpoint_value = npv(midpoint)
        if abs(midpoint_value) < 1e-8:
            return float(midpoint)
        if lower_value * midpoint_value <= 0:
            upper = midpoint
        else:
            lower = midpoint
            lower_value = midpoint_value
    return float((lower + upper) / 2.0)


def contribution_dates(
    trading_dates: Iterable[Any],
    *,
    start_date: Any,
    end_date: Any,
    buy_day: int = 1,
) -> list[pd.Timestamp]:
    dates = pd.DatetimeIndex(pd.to_datetime(list(trading_dates))).sort_values().unique()
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    dates = dates[(dates >= start) & (dates <= end)]
    if len(dates) == 0:
        return []

    selected: list[pd.Timestamp] = [pd.Timestamp(dates[0])]
    first_period = pd.Timestamp(dates[0]).to_period("M")
    last_period = pd.Timestamp(dates[-1]).to_period("M")
    for period in pd.period_range(first_period + 1, last_period, freq="M"):
        target = period.start_time + pd.Timedelta(days=buy_day - 1)
        candidates = dates[
            (dates.to_period("M") == period) & (dates >= target)
        ]
        if len(candidates):
            selected.append(pd.Timestamp(candidates[0]))
    return selected


def _shares_on_or_before(
    snapshots: dict[pd.Timestamp, int],
    date: pd.Timestamp,
) -> int:
    eligible = [key for key in snapshots if key <= date]
    return snapshots[max(eligible)] if eligible else 0


def simulate_bank_dca(
    *,
    symbol: str,
    name: str,
    prices: pd.DataFrame,
    dividends: pd.DataFrame,
    listing_date: Any,
    as_of_date: str,
    horizon_years: int,
    monthly_amount: float = 3000.0,
    buy_day: int = 1,
    lot_size: int = 100,
    dividend_reinvest: bool = True,
) -> BacktestOutput:
    symbol = normalize_symbol(symbol)
    as_of = pd.Timestamp(as_of_date)
    requested_start = as_of - pd.DateOffset(years=horizon_years)
    listing = pd.Timestamp(listing_date)

    price = prices.copy()
    price["date"] = pd.to_datetime(price["date"])
    price = price[
        price["date"].le(as_of) & price["date"].ge(min(requested_start, listing))
    ].drop_duplicates("date", keep="last").sort_values("date")
    if price.empty:
        raise ValueError(f"{symbol} 在 {horizon_years} 年窗口内无行情")

    actual_start_target = max(requested_start, listing)
    available = price[price["date"].ge(actual_start_target)]
    if available.empty:
        raise ValueError(f"{symbol} 上市后至截止日无行情")
    start = pd.Timestamp(available["date"].iloc[0])
    end = pd.Timestamp(price["date"].max())
    price = price[price["date"].between(start, end)].reset_index(drop=True)
    full_horizon = bool(
        listing <= requested_start
        and start <= requested_start + pd.Timedelta(days=15)
    )

    schedule = set(
        contribution_dates(
            price["date"],
            start_date=start,
            end_date=end,
            buy_day=buy_day,
        )
    )
    dividend_events = dividends.copy()
    if dividend_events.empty:
        dividend_events = pd.DataFrame(
            columns=["record_date", "ex_date", "cash_dividend_per_share"]
        )
    dividend_events["record_date"] = pd.to_datetime(
        dividend_events["record_date"], errors="coerce"
    )
    dividend_events["ex_date"] = pd.to_datetime(
        dividend_events["ex_date"], errors="coerce"
    )
    dividend_events = dividend_events[
        dividend_events["ex_date"].between(start, end)
    ].copy()
    grouped_dividends = {
        date: group for date, group in dividend_events.groupby("ex_date")
    }

    cash = 0.0
    shares = 0
    cumulative_contribution = 0.0
    total_dividend = 0.0
    total_purchase_cost = 0.0
    snapshots: dict[pd.Timestamp, int] = {}
    transactions: list[dict[str, Any]] = []
    account_rows: list[dict[str, Any]] = []
    external_cashflows: list[float] = []
    external_dates: list[pd.Timestamp] = []

    def execute_buy(date: pd.Timestamp, close: float, trade_type: str) -> None:
        nonlocal cash, shares, total_purchase_cost
        buy_shares = int(cash // (close * lot_size)) * lot_size
        buy_amount = buy_shares * close
        cash -= buy_amount
        shares += buy_shares
        total_purchase_cost += buy_amount
        transactions.append(
            {
                "symbol": symbol,
                "name": name,
                "horizon": f"{horizon_years}Y",
                "date": date,
                "trade_type": trade_type,
                "buy_price": close,
                "buy_shares": buy_shares,
                "buy_amount": buy_amount,
                "remaining_cash": cash,
                "cumulative_shares": shares,
                "cumulative_contribution": cumulative_contribution,
            }
        )

    for row in price.itertuples(index=False):
        date = pd.Timestamp(row.date)
        close = float(row.close)
        dividend_received_today = 0.0

        if date in grouped_dividends:
            for event in grouped_dividends[date].itertuples(index=False):
                record_date = (
                    pd.Timestamp(event.record_date)
                    if pd.notna(event.record_date)
                    else date - pd.Timedelta(days=1)
                )
                eligible_shares = _shares_on_or_before(snapshots, record_date)
                dividend_cash = (
                    eligible_shares * float(event.cash_dividend_per_share)
                )
                cash += dividend_cash
                total_dividend += dividend_cash
                dividend_received_today += dividend_cash
            if dividend_reinvest and dividend_received_today > 0:
                execute_buy(date, close, "dividend_reinvest")

        if date in schedule:
            cash += monthly_amount
            cumulative_contribution += monthly_amount
            external_cashflows.append(-monthly_amount)
            external_dates.append(date)
            execute_buy(date, close, "monthly_contribution")

        snapshots[date] = shares
        market_value = shares * close
        asset = market_value + cash
        account_profit_rate = (
            asset / cumulative_contribution - 1.0
            if cumulative_contribution > 0 else np.nan
        )
        account_rows.append(
            {
                "symbol": symbol,
                "name": name,
                "horizon": f"{horizon_years}Y",
                "date": date,
                "close": close,
                "shares": shares,
                "cash": cash,
                "market_value": market_value,
                "account_asset": asset,
                "cumulative_contribution": cumulative_contribution,
                "account_profit_rate": account_profit_rate,
                "dividend_received": dividend_received_today,
            }
        )

    account = pd.DataFrame(account_rows)
    transaction_frame = pd.DataFrame(transactions)
    ending_market_value = float(account["market_value"].iloc[-1])
    ending_asset = float(account["account_asset"].iloc[-1])
    ending_cash = float(account["cash"].iloc[-1])
    ending_shares = int(account["shares"].iloc[-1])
    external_cashflows.append(ending_asset)
    external_dates.append(end)
    annualized_return = xirr(external_cashflows, external_dates)

    total_history = build_total_return_history(price, dividend_events)
    volatility = float(
        total_history["daily_total_return"].iloc[1:].std(ddof=1) * math.sqrt(252)
    )
    average_buy_price = (
        total_purchase_cost / ending_shares if ending_shares else np.nan
    )
    current_profit_rate = (
        float(price["close"].iloc[-1]) / average_buy_price - 1.0
        if average_buy_price and not np.isnan(average_buy_price) else np.nan
    )
    total_return = (
        ending_asset / cumulative_contribution - 1.0
        if cumulative_contribution else np.nan
    )
    max_loss = float(account["account_profit_rate"].min())
    max_drawdown = float(total_history["drawdown"].min())

    summary = {
        "symbol": symbol,
        "name": name,
        "horizon": f"{horizon_years}Y",
        "requested_start_date": requested_start,
        "start_date": start,
        "end_date": end,
        "listing_date": listing,
        "full_horizon": full_horizon,
        "contribution_months": len(schedule),
        "total_contribution": cumulative_contribution,
        "ending_shares": ending_shares,
        "ending_cash": ending_cash,
        "ending_market_value": ending_market_value,
        "ending_asset": ending_asset,
        "total_dividend": total_dividend,
        "total_return": total_return if full_horizon else np.nan,
        "xirr": annualized_return if full_horizon else np.nan,
        "average_buy_price": average_buy_price if full_horizon else np.nan,
        "current_profit_rate": current_profit_rate if full_horizon else np.nan,
        "max_drawdown": max_drawdown if full_horizon else np.nan,
        "max_loss_vs_contribution": max_loss if full_horizon else np.nan,
        "volatility": volatility if full_horizon else np.nan,
        "dividend_reinvest": dividend_reinvest,
    }
    return BacktestOutput(
        summary=summary,
        transactions=transaction_frame,
        account_history=account,
        total_return_history=total_history.assign(
            symbol=symbol, name=name, horizon=f"{horizon_years}Y"
        ),
    )
