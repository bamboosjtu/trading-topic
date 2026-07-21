"""Test availability of all parsed AkShare stock interfaces.

For each interface, call the corresponding akshare function with sensible
default parameters, capture whether it returns data, and record the result.

Results are written to a JSON file for later Excel generation.
"""
import json
import signal
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

import akshare as ak

INTERFACES_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\.workbuddy\scratch\interfaces.json"
RESULTS_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\.workbuddy\scratch\results.json"

with open(INTERFACES_PATH, "r", encoding="utf-8") as f:
    interfaces = json.load(f)

print(f"Loaded {len(interfaces)} interfaces")
print(f"akshare version: {ak.__version__}")

# ---- Test parameter strategy ----
# Recent trading dates
TEST_DATE = "20241108"        # a Friday
TEST_DATE_SINA = "2024-11-08"  # sina style
TEST_START = "20240101"
TEST_END = "20241108"

# Symbol formats by source suffix
# East money (_em): 6-digit, e.g. "600000"
# Sina (_sina / no suffix for daily): "sh600000" / "sz000001"
# Xueqiu (_xq): "SH600000"
# Tencent (_tx): "sh600000"
# 163 (_163): "600000"
SH_SYMBOL = "600000"        # 浦发银行
SZ_SYMBOL = "000001"        # 平安银行
SH_SYMBOL_SINA = "sh600000"
SZ_SYMBOL_SINA = "sz000001"
SH_SYMBOL_XQ = "SH600000"
SZ_SYMBOL_XQ = "SZ000001"


def build_params(func_name, params_raw):
    """Build a kwargs dict from the function name and its declared params."""
    params_raw = params_raw or ""
    declared = [p.strip() for p in params_raw.split(",") if p.strip() and p.strip() != "null"]
    if not declared:
        return {}

    # Decide symbol format based on function name suffix
    fn = func_name.lower()
    if fn.endswith("_xq"):
        sym = SH_SYMBOL_XQ
        sym_sz = SZ_SYMBOL_XQ
    elif fn.endswith("_sina") or fn.endswith("_daily") or "sina" in fn:
        sym = SH_SYMBOL_SINA
        sym_sz = SZ_SYMBOL_SINA
    elif fn.endswith("_tx"):
        sym = SH_SYMBOL_SINA
        sym_sz = SZ_SYMBOL_SINA
    else:
        # default east-money / generic 6-digit
        sym = SH_SYMBOL
        sym_sz = SZ_SYMBOL

    kwargs = {}
    for p in declared:
        if p == "symbol":
            kwargs["symbol"] = sym
        elif p == "symbols":
            kwargs["symbols"] = sym
        elif p == "stock":
            kwargs["stock"] = sym
        elif p == "security":
            kwargs["security"] = sym
        elif p == "start_date":
            kwargs["start_date"] = TEST_START
        elif p == "end_date":
            kwargs["end_date"] = TEST_END
        elif p == "start":
            kwargs["start"] = TEST_START
        elif p == "end":
            kwargs["end"] = TEST_END
        elif p == "begin_date":
            kwargs["begin_date"] = TEST_START
        elif p == "date":
            kwargs["date"] = TEST_DATE
        elif p == "time":
            kwargs["time"] = TEST_DATE_SINA
        elif p == "trade_date":
            kwargs["trade_date"] = TEST_DATE
        elif p == "period":
            kwargs["period"] = "daily"
        elif p == "adjust":
            kwargs["adjust"] = "qfq"
        elif p == "timeout":
            kwargs["timeout"] = 10
        elif p == "token":
            # We don't have a xueqiu token; pass empty — will likely fail
            kwargs["token"] = ""
        elif p == "cookie":
            # No cookie available; will likely fail
            kwargs["cookie"] = ""
        elif p == "start_year":
            kwargs["start_year"] = "2023"
        elif p == "end_year":
            kwargs["end_year"] = "2024"
        elif p == "year":
            kwargs["year"] = "2024"
        elif p == "month":
            kwargs["month"] = "11"
        elif p == "quarter":
            kwargs["quarter"] = "20241"
        elif p == "season":
            kwargs["season"] = "20241"
        elif p == "report_type":
            kwargs["report_type"] = "年报"
        elif p == "symbol_type":
            kwargs["symbol_type"] = "沪市A股"
        elif p == "market":
            kwargs["market"] = "沪深京A股"
        elif p == "category":
            kwargs["category"] = "全部"
        elif p == "sector":
            kwargs["sector"] = "电子"
        elif p == "sector_type":
            kwargs["sector_type"] = "行业"
        elif p == "page":
            kwargs["page"] = 1
        elif p == "page_size":
            kwargs["page_size"] = 50
        elif p == "from_page":
            kwargs["from_page"] = 1
        elif p == "to_page":
            kwargs["to_page"] = 5
        elif p == "limit":
            kwargs["limit"] = 50
        elif p == "size":
            kwargs["size"] = 50
        elif p == "offset":
            kwargs["offset"] = 0
        elif p == "fields":
            kwargs["fields"] = ""
        elif p == "start_time":
            kwargs["start_time"] = "09:00:00"
        elif p == "end_time":
            kwargs["end_time"] = "15:00:00"
        elif p == "indicator":
            kwargs["indicator"] = "总市值"
        elif p == "country":
            kwargs["country"] = "中国"
        elif p == "analyst_id":
            kwargs["analyst_id"] = "11000257107"
        elif p == "keyword":
            kwargs["keyword"] = "银行"
        elif p == "name":
            kwargs["name"] = "浦发银行"
        elif p == "flag":
            kwargs["flag"] = "买入"
        else:
            # Unknown parameter — skip, let akshare use its default
            pass
    return kwargs


class TimeoutError(Exception):
    pass


def _call_with_timeout(func, kwargs, timeout=30):
    """Run a function in a thread and enforce a timeout."""
    import threading

    result = {}
    def runner():
        try:
            result["value"] = func(**kwargs)
        except BaseException as e:
            result["error"] = e
            result["tb"] = traceback.format_exc()

    t = threading.Thread(target=runner, daemon=True)
    t.start()
    t.join(timeout=timeout)
    if t.is_alive():
        raise TimeoutError(f"timed out after {timeout}s")
    if "error" in result:
        raise result["error"]
    return result.get("value")


def test_one(iface, idx, total):
    func_name = iface["func"]
    status = "不可用"
    err_msg = ""
    try:
        func = getattr(ak, func_name)
    except AttributeError:
        err_msg = f"函数不存在: ak.{func_name}"
        return {**iface, "status": "不可用", "error": err_msg}

    kwargs = build_params(func_name, iface.get("params_raw", ""))
    try:
        result = _call_with_timeout(func, kwargs, timeout=45)
        # Check if result is meaningful
        if result is None:
            status = "不可用"
            err_msg = "返回 None"
        elif hasattr(result, "empty"):
            if result.empty:
                status = "不可用"
                err_msg = "返回空 DataFrame"
            else:
                status = "可用"
        elif isinstance(result, (list, dict, str)):
            if (isinstance(result, str) and not result.strip()) or \
               (isinstance(result, (list, dict)) and len(result) == 0):
                status = "不可用"
                err_msg = "返回空数据"
            else:
                status = "可用"
        else:
            status = "可用"
    except TimeoutError as e:
        status = "不可用"
        err_msg = f"超时: {e}"
    except Exception as e:
        status = "不可用"
        err_msg = f"{type(e).__name__}: {e}"

    # Compact progress log
    print(f"[{idx}/{total}] {func_name:45s} {status}  {err_msg[:60]}", flush=True)
    return {**iface, "status": status, "error": err_msg}


def main():
    total = len(interfaces)
    results = [None] * total

    # Use a small worker count to avoid hammering data sources and hitting rate limits
    with ThreadPoolExecutor(max_workers=6) as ex:
        future_to_idx = {
            ex.submit(test_one, iface, i + 1, total): i
            for i, iface in enumerate(interfaces)
        }
        for fut in as_completed(future_to_idx):
            i = future_to_idx[fut]
            try:
                results[i] = fut.result()
            except Exception as e:
                results[i] = {**interfaces[i], "status": "不可用", "error": f"测试异常: {e}"}

    with open(RESULTS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    ok = sum(1 for r in results if r and r["status"] == "可用")
    fail = total - ok
    print(f"\n===== DONE: {ok}/{total} 可用, {fail} 不可用 =====")


if __name__ == "__main__":
    main()
