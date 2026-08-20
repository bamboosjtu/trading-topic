"""Lab 01 数据源体检：以工商银行 601398 为样本，控制台输出测试结果。

本脚本对 Lab 01 依赖的 8 个核心 AKShare/mootdx 接口执行连续体检：
- 交易所清单（上交所、深交所、北交所）
- 通达信 F10 主营业务文本
- 腾讯/新浪不复权日线
- 新浪/东方财富已实施分红

每个接口测试 2 次，记录状态、行数、耗时、错误。状态只代表本次运行环境，
不是长期服务承诺。

通用工具（direct_domains / call_akshare / to_frame / market_prefix 等）在本文件
内实现，不依赖外部模块。

运行方式：
    python akshare_check.py
"""

from __future__ import annotations

import importlib
import os
import re
import socket
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Iterable
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pandas as pd


# ---------------------------------------------------------------------------
# 通用工具：域名直连、AKShare 调用、错误脱敏、DataFrame 转换
# ---------------------------------------------------------------------------

_BLOCKED_ERROR_NAMES = {
    "ConnectionError",
    "ConnectTimeout",
    "ProxyError",
    "ReadTimeout",
    "RemoteDisconnected",
    "Timeout",
}
_BLOCKED_MESSAGE_PATTERNS = (
    "403",
    "429",
    "connection aborted",
    "connection refused",
    "connection reset",
    "max retries exceeded",
    "remote end closed",
    "timed out",
    "too many requests",
)
_SECRET_PATTERN = re.compile(r"(?i)(token|api[_-]?key|authorization|cookie)=([^&\s]+)")
_CREDENTIAL_URL_PATTERN = re.compile(r"(https?://)([^/@\s]+)@")


def sanitize_error(error: BaseException | str, limit: int = 240) -> str:
    """压缩错误信息，并移除潜在 Token、Cookie 或代理凭据。"""
    text = str(error).replace("\r", " ").replace("\n", " ")
    text = _SECRET_PATTERN.sub(r"\1=***", text)
    text = _CREDENTIAL_URL_PATTERN.sub(r"\1***@", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def is_blocked_error(error_name: str, error_message: str) -> bool:
    """判断错误是否为网络阻塞类（连接超时/拒绝/429 等）。"""
    if error_name in _BLOCKED_ERROR_NAMES:
        return True
    lowered = error_message.lower()
    return any(pattern in lowered for pattern in _BLOCKED_MESSAGE_PATTERNS)


@contextmanager
def direct_domains(*domains: str):
    """仅让指定域名在当前调用期间直连，并精确恢复 NO_PROXY。

    不删除 HTTP_PROXY/HTTPS_PROXY，也不设置通配符，因此无关域名继续遵循
    用户原有代理设置；该环境修改仅存在于当前 Python 进程。
    """
    no_proxy_keys = ("NO_PROXY", "no_proxy")
    original = {key: os.environ.get(key) for key in no_proxy_keys}
    entries: list[str] = []
    for value in original.values():
        if value:
            entries.extend(item.strip() for item in value.split(",") if item.strip())
    entries.extend(domain.strip() for domain in domains if domain.strip())
    bypass = ",".join(dict.fromkeys(entries))
    try:
        for key in no_proxy_keys:
            os.environ[key] = bypass
        yield
    finally:
        for key in no_proxy_keys:
            os.environ.pop(key, None)
        for key, value in original.items():
            if value is not None:
                os.environ[key] = value


def _iter_without_progress(iterable: Iterable[Any], *args: Any, **kwargs: Any):
    """替代 tqdm 的空迭代器，用于关闭 AKShare 的 ipywidgets 进度条。"""
    return iterable


def call_akshare(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """调用 AKShare，并局部关闭依赖 ipywidgets 的 Notebook 进度条。"""
    module = importlib.import_module(function.__module__)
    if hasattr(module, "get_tqdm"):
        with patch.object(module, "get_tqdm", return_value=_iter_without_progress):
            return function(*args, **kwargs)
    return function(*args, **kwargs)


def to_frame(value: Any) -> pd.DataFrame:
    """将常见接口返回值转换为可计数的 DataFrame，不改变原始对象。"""
    if isinstance(value, pd.DataFrame):
        return value.copy()
    if isinstance(value, pd.Series):
        return value.to_frame().T
    if value is None:
        return pd.DataFrame()
    if isinstance(value, list):
        return pd.DataFrame(value)
    if isinstance(value, tuple):
        return pd.DataFrame(list(value))
    if isinstance(value, dict):
        try:
            return pd.DataFrame(value)
        except (ValueError, TypeError):
            return pd.DataFrame([value])
    return pd.DataFrame({"value": [value]})


def market_prefix(symbol: str) -> str:
    """返回证券代码对应的交易所前缀（sh/sz/bj）。"""
    digits = "".join(c for c in str(symbol) if c.isdigit())
    s = digits[-6:].zfill(6)
    if s.startswith(("6", "9")):
        return "sh"
    if s.startswith(("4", "8")):
        return "bj"
    return "sz"

SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
TEST_SYMBOL = "601398"  # 工商银行
AS_OF_DATE = "20260724"
START_DATE = "20260101"


class HealthStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    UNSTABLE = "UNSTABLE"
    BLOCKED = "BLOCKED"
    BROKEN = "BROKEN"
    EMPTY = "EMPTY"
    UNTESTED = "UNTESTED"


STATUS_DESCRIPTION = {
    HealthStatus.AVAILABLE: "连续测试均成功且返回非空",
    HealthStatus.UNSTABLE: "成功、空结果或失败混合出现",
    HealthStatus.BLOCKED: "当前网络或 IP 被上游拒绝/超时",
    HealthStatus.BROKEN: "字段、解析、依赖或程序异常",
    HealthStatus.EMPTY: "请求成功但连续返回空数据",
    HealthStatus.UNTESTED: "缺少凭据或本轮未执行",
}


def now_shanghai() -> datetime:
    return datetime.now(tz=SHANGHAI_TZ)


@dataclass
class InterfaceSpec:
    interface: str
    category: str
    upstream: str
    fetcher: Callable[[], Any]
    domains: tuple[str, ...] = ()
    notes: str = ""
    min_interval: float = 0.2


@dataclass
class AttemptResult:
    attempt: int
    outcome: str
    rows: int
    elapsed_seconds: float
    error_type: str
    error_message: str
    tested_at: str


@dataclass
class InterfaceReport:
    spec: InterfaceSpec
    attempts: list[AttemptResult] = field(default_factory=list)

    @property
    def status(self) -> HealthStatus:
        if not self.attempts:
            return HealthStatus.UNTESTED
        outcomes = [a.outcome for a in self.attempts]
        if all(o == "SUCCESS" for o in outcomes):
            return HealthStatus.AVAILABLE
        if all(o == "EMPTY" for o in outcomes):
            return HealthStatus.EMPTY
        if any(o in {"SUCCESS", "EMPTY"} for o in outcomes):
            return HealthStatus.UNSTABLE
        if all(
            is_blocked_error(a.error_type, a.error_message) for a in self.attempts
        ):
            return HealthStatus.BLOCKED
        return HealthStatus.BROKEN

    @property
    def success_count(self) -> int:
        return sum(1 for a in self.attempts if a.outcome == "SUCCESS")

    @property
    def last_success_rows(self) -> int:
        for a in reversed(self.attempts):
            if a.outcome == "SUCCESS":
                return a.rows
        return 0

    @property
    def avg_elapsed(self) -> float:
        if not self.attempts:
            return 0.0
        return round(sum(a.elapsed_seconds for a in self.attempts) / len(self.attempts), 3)

    @property
    def error_types(self) -> str:
        names = list(dict.fromkeys(a.error_type for a in self.attempts if a.error_type))
        return ", ".join(names)


def build_specs() -> list[InterfaceSpec]:
    """构建 8 个核心接口的体检清单，以工商银行 601398 为样本。"""
    import akshare as ak

    def fetch_sina_history(symbol: str, start: str, end: str, adjustment: str):
        adjust = "" if adjustment == "raw" else adjustment
        with direct_domains("sina.com.cn"):
            return call_akshare(
                ak.stock_zh_a_daily,
                symbol=f"{market_prefix(symbol)}{symbol}",
                start_date=start,
                end_date=end,
                adjust=adjust,
            )

    def fetch_tencent_history(symbol: str, start: str, end: str, adjustment: str):
        adjust = "" if adjustment == "raw" else adjustment
        with direct_domains("qq.com"):
            return call_akshare(
                ak.stock_zh_a_hist_tx,
                symbol=f"{market_prefix(symbol)}{symbol}",
                start_date=start,
                end_date=end,
                adjust=adjust,
                timeout=30,
            )

    def fetch_tdx_f10():
        from mootdx.quotes import Quotes

        servers = (
            ("119.97.185.59", 7709),
            ("124.70.133.119", 7709),
            ("116.205.183.150", 7709),
            ("123.60.73.44", 7709),
        )
        client = None
        for server in servers:
            try:
                with socket.create_connection(server, timeout=1.5):
                    client = Quotes.factory(market="std", server=server)
                    break
            except OSError:
                continue
        if client is None:
            raise ConnectionError("本轮探测的通达信 TCP 服务器均不可达")
        try:
            raw = client.F10(symbol=TEST_SYMBOL)
            if isinstance(raw, dict):
                return {"symbol": TEST_SYMBOL, "text": "\n".join(str(v) for v in raw.values() if v)}
            return {"symbol": TEST_SYMBOL, "text": "" if raw is None else str(raw)}
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()

    return [
        InterfaceSpec(
            interface="stock_info_sh_name_code",
            category="基础数据",
            upstream="上海证券交易所",
            fetcher=lambda: call_akshare(ak.stock_info_sh_name_code, symbol="主板A股"),
            domains=("sse.com.cn",),
            notes="银行股票池：上交所清单",
        ),
        InterfaceSpec(
            interface="stock_info_sz_name_code",
            category="基础数据",
            upstream="深圳证券交易所",
            fetcher=lambda: call_akshare(ak.stock_info_sz_name_code, symbol="A股列表"),
            domains=("szse.cn",),
            notes="银行股票池：深交所清单",
        ),
        InterfaceSpec(
            interface="stock_info_bj_name_code",
            category="基础数据",
            upstream="北京证券交易所",
            fetcher=lambda: call_akshare(ak.stock_info_bj_name_code),
            domains=("bse.cn",),
            notes="银行股票池：北交所清单",
        ),
        InterfaceSpec(
            interface="mootdx.F10",
            category="基础数据",
            upstream="通达信 TCP",
            fetcher=fetch_tdx_f10,
            notes="主营业务文本验证",
            min_interval=0.5,
        ),
        InterfaceSpec(
            interface="stock_zh_a_hist_tx",
            category="行情",
            upstream="腾讯财经",
            fetcher=lambda: fetch_tencent_history(
                TEST_SYMBOL, START_DATE, AS_OF_DATE, "raw"
            ),
            domains=("qq.com",),
            notes="工商银行不复权主源",
            min_interval=1.2,
        ),
        InterfaceSpec(
            interface="stock_zh_a_daily",
            category="行情",
            upstream="新浪财经",
            fetcher=lambda: fetch_sina_history(
                TEST_SYMBOL, START_DATE, AS_OF_DATE, "raw"
            ),
            domains=("sina.com.cn",),
            notes="工商银行行情备源/校验源",
            min_interval=1.2,
        ),
        InterfaceSpec(
            interface="stock_history_dividend_detail",
            category="基础数据",
            upstream="新浪财经",
            fetcher=lambda: call_akshare(
                ak.stock_history_dividend_detail,
                symbol=TEST_SYMBOL,
                indicator="分红",
            ),
            domains=("sina.com.cn",),
            notes="工商银行现金分红主源",
            min_interval=0.5,
        ),
        InterfaceSpec(
            interface="stock_fhps_detail_em",
            category="基础数据",
            upstream="东方财富",
            fetcher=lambda: call_akshare(ak.stock_fhps_detail_em, symbol=TEST_SYMBOL),
            domains=("eastmoney.com",),
            notes="工商银行现金分红备源",
            min_interval=1.2,
        ),
    ]


def run_probe(specs: list[InterfaceSpec], repeats: int = 2) -> list[InterfaceReport]:
    reports: list[InterfaceReport] = []
    last_call_at = 0.0

    for spec in specs:
        report = InterfaceReport(spec=spec)
        for attempt_num in range(1, repeats + 1):
            wait = spec.min_interval - (time.monotonic() - last_call_at)
            if wait > 0:
                time.sleep(wait)

            started_at = now_shanghai()
            started = time.perf_counter()
            outcome = "ERROR"
            row_count = 0
            error_type = ""
            error_message = ""

            try:
                with direct_domains(*spec.domains):
                    raw_value = spec.fetcher()
                elapsed = time.perf_counter() - started
                frame = to_frame(raw_value)
                row_count = len(frame)
                outcome = "EMPTY" if frame.empty else "SUCCESS"
            except Exception as error:  # noqa: BLE001 - 体检必须记录第三方异常
                elapsed = time.perf_counter() - started
                outcome = "ERROR"
                error_type = type(error).__name__
                error_message = sanitize_error(error)
            finally:
                last_call_at = time.monotonic()

            report.attempts.append(
                AttemptResult(
                    attempt=attempt_num,
                    outcome=outcome,
                    rows=row_count,
                    elapsed_seconds=round(elapsed, 3),
                    error_type=error_type,
                    error_message=error_message,
                    tested_at=started_at.strftime("%Y-%m-%d %H:%M:%S"),
                )
            )
        reports.append(report)
    return reports


def print_report(reports: list[InterfaceReport]) -> None:
    """控制台输出测试结果表格。"""
    print()
    print("=" * 110)
    print(f"Lab 01 数据源体检  样本: 工商银行 {TEST_SYMBOL}  截止日: {AS_OF_DATE}  运行时间: {now_shanghai().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 110)
    header = f"{'接口':<35} {'类别':<10} {'上游源':<18} {'状态':<12} {'成功/测试':<10} {'行数':<8} {'平均耗时(秒)':<14} {'错误':<20}"
    print(header)
    print("-" * 110)
    for r in reports:
        print(
            f"{r.spec.interface:<35} "
            f"{r.spec.category:<10} "
            f"{r.spec.upstream:<18} "
            f"{r.status.value:<12} "
            f"{r.success_count}/{len(r.attempts):<8} "
            f"{r.last_success_rows:<8} "
            f"{r.avg_elapsed:<14} "
            f"{r.error_types:<20}"
        )
    print("-" * 110)
    print()
    print("状态定义：")
    for status, desc in STATUS_DESCRIPTION.items():
        print(f"  {status.value:<12} {desc}")
    print()
    print("备注：")
    for r in reports:
        if r.spec.notes:
            print(f"  {r.spec.interface}: {r.spec.notes}")
    print()
    print("状态只代表本次运行环境，不是长期服务承诺。AKShare 是封装层，真实风险面按上游分别登记。")


def main() -> int:
    print(f"AKShare 体检开始，样本标的: 工商银行 {TEST_SYMBOL}")
    specs = build_specs()
    reports = run_probe(specs, repeats=2)
    print_report(reports)

    # 退出码：任一接口不可用返回非零
    failed = [r for r in reports if r.status in {HealthStatus.BROKEN, HealthStatus.BLOCKED}]
    if failed:
        print(f"\n警告：{len(failed)} 个接口当前不可用：{', '.join(r.spec.interface for r in failed)}")
        return 1
    print("\n所有接口当前可用。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
