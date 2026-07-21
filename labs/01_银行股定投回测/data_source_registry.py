"""Lab 0 数据源登记、体检、快照与降级共用工具。

本模块只提供工程机制，不包含任何投资结论。Notebook 负责定义具体接口、
参数、字段口径与数据源优先级。
"""

from __future__ import annotations

import importlib
import json
import os
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Iterable
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pandas as pd


SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")


class HealthStatus(str, Enum):
    """数据接口健康状态。"""

    AVAILABLE = "AVAILABLE"
    UNSTABLE = "UNSTABLE"
    BLOCKED = "BLOCKED"
    BROKEN = "BROKEN"
    EMPTY = "EMPTY"
    UNTESTED = "UNTESTED"


@dataclass(frozen=True)
class InterfaceSpec:
    """一个可独立测试和登记的数据接口。"""

    interface: str
    category: str
    scale: str
    wrapper: str
    upstream: str
    fetcher: Callable[[], Any]
    normalizer: Callable[[Any], pd.DataFrame] | None = None
    domains: tuple[str, ...] = ()
    requirements: tuple[str, ...] = ()
    docs_url: str = ""
    documented: str = "UNVERIFIED"
    notes: str = ""
    min_interval: float = 0.2


@dataclass
class FallbackResult:
    """按优先级降级后得到的统一结果与调用轨迹。"""

    data: pd.DataFrame
    selected_interface: str | None
    selected_upstream: str | None
    trace: pd.DataFrame
    raw: Any = None


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
_SECRET_PATTERN = re.compile(
    r"(?i)(token|api[_-]?key|authorization|cookie)=([^&\s]+)"
)
_CREDENTIAL_URL_PATTERN = re.compile(r"(https?://)([^/@\s]+)@")


def now_shanghai() -> datetime:
    return datetime.now(tz=SHANGHAI_TZ)


def make_run_id() -> str:
    return now_shanghai().strftime("%Y%m%d_%H%M%S")


def sanitize_error(error: BaseException | str, limit: int = 240) -> str:
    """压缩错误信息，并移除潜在 Token、Cookie 或代理凭据。"""

    text = str(error).replace("\r", " ").replace("\n", " ")
    text = _SECRET_PATTERN.sub(r"\1=***", text)
    text = _CREDENTIAL_URL_PATTERN.sub(r"\1***@", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def is_blocked_error(error_name: str, error_message: str) -> bool:
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
    return iterable


def call_akshare(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """调用 AKShare，并局部关闭依赖 ipywidgets 的 Notebook 进度条。"""

    module = importlib.import_module(function.__module__)
    if hasattr(module, "get_tqdm"):
        with patch.object(
            module,
            "get_tqdm",
            return_value=_iter_without_progress,
        ):
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


def _write_raw(value: Any, path_without_suffix: Path) -> Path:
    """按原始返回类型保存 CSV 或 JSON。"""

    path_without_suffix.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(value, (pd.DataFrame, pd.Series)):
        path = path_without_suffix.with_suffix(".csv")
        to_frame(value).to_csv(path, index=False, encoding="utf-8-sig")
        return path

    path = path_without_suffix.with_suffix(".json")
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2, default=str)
    return path


def _slug(text: str) -> str:
    value = re.sub(r"[^0-9A-Za-z_\-]+", "_", text).strip("_")
    return value or "interface"


def _missing_requirements(spec: InterfaceSpec) -> list[str]:
    return [name for name in spec.requirements if not os.environ.get(name)]


def _status_from_attempts(attempts: list[dict[str, Any]]) -> HealthStatus:
    if not attempts:
        return HealthStatus.UNTESTED

    outcomes = [row["outcome"] for row in attempts]
    if all(outcome == "SUCCESS" for outcome in outcomes):
        return HealthStatus.AVAILABLE
    if all(outcome == "EMPTY" for outcome in outcomes):
        return HealthStatus.EMPTY
    if any(outcome in {"SUCCESS", "EMPTY"} for outcome in outcomes):
        return HealthStatus.UNSTABLE

    if all(
        is_blocked_error(row.get("error_type", ""), row.get("error_message", ""))
        for row in attempts
    ):
        return HealthStatus.BLOCKED
    return HealthStatus.BROKEN


def probe_interfaces(
    specs: list[InterfaceSpec],
    output_root: Path,
    repeats: int = 2,
    run_id: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, Path]:
    """顺序体检接口，保存原始响应、标准数据、尝试日志和汇总登记表。"""

    if repeats < 1:
        raise ValueError("repeats 必须 >= 1")

    run_id = run_id or make_run_id()
    run_dir = Path(output_root) / run_id
    raw_dir = run_dir / "raw"
    standard_dir = run_dir / "standard"
    raw_dir.mkdir(parents=True, exist_ok=True)
    standard_dir.mkdir(parents=True, exist_ok=True)

    summary_rows: list[dict[str, Any]] = []
    attempt_rows: list[dict[str, Any]] = []
    last_call_at = 0.0

    for spec in specs:
        missing = _missing_requirements(spec)
        spec_attempts: list[dict[str, Any]] = []
        raw_paths: list[str] = []
        standard_paths: list[str] = []

        if missing:
            summary_rows.append(
                {
                    "接口": spec.interface,
                    "类别": spec.category,
                    "尺度": spec.scale,
                    "封装": spec.wrapper,
                    "上游源": spec.upstream,
                    "状态": HealthStatus.UNTESTED.value,
                    "成功/测试": f"0/{repeats}",
                    "行数": 0,
                    "平均耗时(秒)": 0.0,
                    "错误": f"缺少配置: {', '.join(missing)}",
                    "测试时间": now_shanghai().strftime("%Y-%m-%d %H:%M:%S"),
                    "官方文档": spec.documented,
                    "文档地址": spec.docs_url,
                    "原始数据": "",
                    "标准数据": "",
                    "备注": spec.notes,
                }
            )
            continue

        for attempt_number in range(1, repeats + 1):
            wait = spec.min_interval - (time.monotonic() - last_call_at)
            if wait > 0:
                time.sleep(wait)

            started_at = now_shanghai()
            started = time.perf_counter()
            outcome = "ERROR"
            row_count = 0
            error_type = ""
            error_message = ""
            raw_path = ""
            standard_path = ""

            try:
                with direct_domains(*spec.domains):
                    raw_value = spec.fetcher()
                elapsed = time.perf_counter() - started
                raw_frame = to_frame(raw_value)
                row_count = len(raw_frame)
                outcome = "EMPTY" if raw_frame.empty else "SUCCESS"

                raw_file = _write_raw(
                    raw_value,
                    raw_dir
                    / f"{_slug(spec.interface)}_attempt_{attempt_number}",
                )
                raw_path = raw_file.relative_to(run_dir).as_posix()
                raw_paths.append(raw_path)

                if outcome == "SUCCESS" and spec.normalizer is not None:
                    standard_frame = spec.normalizer(raw_value)
                    if not isinstance(standard_frame, pd.DataFrame):
                        raise TypeError("normalizer 必须返回 pandas.DataFrame")
                    standard_file = (
                        standard_dir
                        / f"{_slug(spec.interface)}_attempt_{attempt_number}.csv"
                    )
                    standard_frame.to_csv(
                        standard_file,
                        index=False,
                        encoding="utf-8-sig",
                    )
                    standard_path = standard_file.relative_to(run_dir).as_posix()
                    standard_paths.append(standard_path)
            except Exception as error:  # noqa: BLE001 - 体检必须记录第三方异常
                elapsed = time.perf_counter() - started
                outcome = "ERROR"
                error_type = type(error).__name__
                error_message = sanitize_error(error)
            finally:
                last_call_at = time.monotonic()

            row = {
                "interface": spec.interface,
                "attempt": attempt_number,
                "outcome": outcome,
                "rows": row_count,
                "elapsed_seconds": round(elapsed, 3),
                "error_type": error_type,
                "error_message": error_message,
                "tested_at": started_at.strftime("%Y-%m-%d %H:%M:%S"),
                "raw_path": raw_path,
                "standard_path": standard_path,
            }
            spec_attempts.append(row)
            attempt_rows.append(row)

        status = _status_from_attempts(spec_attempts)
        success_rows = [
            row for row in spec_attempts if row["outcome"] == "SUCCESS"
        ]
        error_names = list(
            dict.fromkeys(
                row["error_type"] for row in spec_attempts if row["error_type"]
            )
        )
        summary_rows.append(
            {
                "接口": spec.interface,
                "类别": spec.category,
                "尺度": spec.scale,
                "封装": spec.wrapper,
                "上游源": spec.upstream,
                "状态": status.value,
                "成功/测试": f"{len(success_rows)}/{repeats}",
                "行数": success_rows[-1]["rows"] if success_rows else 0,
                "平均耗时(秒)": round(
                    sum(row["elapsed_seconds"] for row in spec_attempts)
                    / len(spec_attempts),
                    3,
                ),
                "错误": ", ".join(error_names),
                "测试时间": spec_attempts[-1]["tested_at"],
                "官方文档": spec.documented,
                "文档地址": spec.docs_url,
                "原始数据": "; ".join(dict.fromkeys(raw_paths)),
                "标准数据": "; ".join(dict.fromkeys(standard_paths)),
                "备注": spec.notes,
            }
        )

    summary = pd.DataFrame(summary_rows)
    attempts = pd.DataFrame(attempt_rows)
    summary.to_csv(
        standard_dir / "interface_registry.csv",
        index=False,
        encoding="utf-8-sig",
    )
    attempts.to_csv(
        standard_dir / "attempt_log.csv",
        index=False,
        encoding="utf-8-sig",
    )

    manifest = {
        "run_id": run_id,
        "generated_at": now_shanghai().isoformat(),
        "status_definitions": {
            item.value: description
            for item, description in {
                HealthStatus.AVAILABLE: "连续测试均成功且返回非空",
                HealthStatus.UNSTABLE: "成功、空结果或失败混合出现",
                HealthStatus.BLOCKED: "当前网络或 IP 被上游拒绝/超时",
                HealthStatus.BROKEN: "字段、解析、依赖或程序异常",
                HealthStatus.EMPTY: "请求成功但连续返回空数据",
                HealthStatus.UNTESTED: "缺少凭据或本轮未执行",
            }.items()
        },
        "registry": "standard/interface_registry.csv",
        "attempt_log": "standard/attempt_log.csv",
    }
    with (run_dir / "manifest.json").open("w", encoding="utf-8") as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)

    return summary, attempts, run_dir


def fetch_first_available(
    specs: list[InterfaceSpec],
) -> FallbackResult:
    """按列表顺序尝试数据源，返回首个非空且标准化成功的结果。"""

    trace_rows: list[dict[str, Any]] = []
    last_call_at = 0.0

    for spec in specs:
        missing = _missing_requirements(spec)
        if missing:
            trace_rows.append(
                {
                    "接口": spec.interface,
                    "上游源": spec.upstream,
                    "结果": HealthStatus.UNTESTED.value,
                    "行数": 0,
                    "错误": f"缺少配置: {', '.join(missing)}",
                }
            )
            continue

        wait = spec.min_interval - (time.monotonic() - last_call_at)
        if wait > 0:
            time.sleep(wait)

        started = time.perf_counter()
        try:
            with direct_domains(*spec.domains):
                raw_value = spec.fetcher()
            raw_frame = to_frame(raw_value)
            if raw_frame.empty:
                trace_rows.append(
                    {
                        "接口": spec.interface,
                        "上游源": spec.upstream,
                        "结果": HealthStatus.EMPTY.value,
                        "行数": 0,
                        "错误": "",
                    }
                )
                continue

            standard = (
                spec.normalizer(raw_value)
                if spec.normalizer is not None
                else raw_frame
            )
            if standard.empty:
                raise ValueError("标准化后为空")
            trace_rows.append(
                {
                    "接口": spec.interface,
                    "上游源": spec.upstream,
                    "结果": HealthStatus.AVAILABLE.value,
                    "行数": len(standard),
                    "错误": "",
                }
            )
            return FallbackResult(
                data=standard,
                selected_interface=spec.interface,
                selected_upstream=spec.upstream,
                trace=pd.DataFrame(trace_rows),
                raw=raw_value,
            )
        except Exception as error:  # noqa: BLE001 - 降级必须继续尝试
            name = type(error).__name__
            message = sanitize_error(error)
            status = (
                HealthStatus.BLOCKED
                if is_blocked_error(name, message)
                else HealthStatus.BROKEN
            )
            trace_rows.append(
                {
                    "接口": spec.interface,
                    "上游源": spec.upstream,
                    "结果": status.value,
                    "行数": 0,
                    "错误": name,
                }
            )
        finally:
            _ = time.perf_counter() - started
            last_call_at = time.monotonic()

    return FallbackResult(
        data=pd.DataFrame(),
        selected_interface=None,
        selected_upstream=None,
        trace=pd.DataFrame(trace_rows),
        raw=None,
    )
