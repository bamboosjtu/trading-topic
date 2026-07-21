"""Retry failed interfaces sequentially with corrected parameters.

Many failures in the first pass were due to:
1. Rate limiting from 6 parallel workers hitting the same data source
2. Wrong symbol format (KeyError)
3. Functions returning None due to bad parameters

This script retries failures one at a time with small delays and tries
alternative symbol formats where applicable.
"""
import json
import time
import traceback

import akshare as ak

RESULTS_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\.workbuddy\scratch\results.json"
RETRY_OUT_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\.workbuddy\scratch\results_retried.json"

with open(RESULTS_PATH, "r", encoding="utf-8") as f:
    results = json.load(f)

# Symbol format alternatives to try for KeyError cases
SH_SYMBOLS = ["600000", "sh600000", "SH600000"]
SZ_SYMBOLS = ["000001", "sz000001", "SZ000001"]

TEST_DATE = "20241108"
TEST_START = "20240101"
TEST_END = "20241108"


def build_kwargs(func_name, params_raw, symbol_variant=None):
    params_raw = params_raw or ""
    declared = [p.strip() for p in params_raw.split(",") if p.strip() and p.strip() != "null"]
    if not declared:
        return {}

    fn = func_name.lower()
    if symbol_variant is None:
        if fn.endswith("_xq"):
            sym = "SH600000"
        elif fn.endswith("_sina") or fn.endswith("_daily") or "sina" in fn or fn.endswith("_tx"):
            sym = "sh600000"
        else:
            sym = "600000"
    else:
        sym = symbol_variant

    kwargs = {}
    for p in declared:
        if p in ("symbol", "stock", "security"):
            kwargs[p] = sym
        elif p == "symbols":
            kwargs[p] = sym
        elif p in ("start_date", "begin_date"):
            kwargs[p] = TEST_START
        elif p == "end_date":
            kwargs[p] = TEST_END
        elif p in ("start",):
            kwargs[p] = TEST_START
        elif p in ("end",):
            kwargs[p] = TEST_END
        elif p == "date":
            kwargs[p] = TEST_DATE
        elif p == "time":
            kwargs[p] = "2024-11-08"
        elif p == "trade_date":
            kwargs[p] = TEST_DATE
        elif p == "period":
            kwargs[p] = "daily"
        elif p == "adjust":
            kwargs[p] = "qfq"
        elif p == "timeout":
            kwargs[p] = 10
        elif p == "token":
            kwargs[p] = ""
        elif p == "cookie":
            kwargs[p] = ""
        elif p == "start_year":
            kwargs[p] = "2023"
        elif p == "end_year":
            kwargs[p] = "2024"
        elif p == "year":
            kwargs[p] = "2024"
        elif p == "month":
            kwargs[p] = "11"
        elif p == "quarter":
            kwargs[p] = "20241"
        elif p == "season":
            kwargs[p] = "20241"
        elif p == "report_type":
            kwargs[p] = "年报"
        elif p == "symbol_type":
            kwargs[p] = "沪市A股"
        elif p == "market":
            kwargs[p] = "沪深京A股"
        elif p == "category":
            kwargs[p] = "全部"
        elif p == "sector":
            kwargs[p] = "电子"
        elif p == "sector_type":
            kwargs[p] = "行业"
        elif p == "page":
            kwargs[p] = 1
        elif p == "page_size":
            kwargs[p] = 50
        elif p == "from_page":
            kwargs[p] = 1
        elif p == "to_page":
            kwargs[p] = 5
        elif p in ("limit", "size"):
            kwargs[p] = 50
        elif p == "offset":
            kwargs[p] = 0
        elif p == "fields":
            kwargs[p] = ""
        elif p == "start_time":
            kwargs[p] = "09:00:00"
        elif p == "end_time":
            kwargs[p] = "15:00:00"
        elif p == "indicator":
            kwargs[p] = "总市值"
        elif p == "country":
            kwargs[p] = "中国"
        elif p == "analyst_id":
            kwargs[p] = "11000257107"
        elif p == "keyword":
            kwargs[p] = "银行"
        elif p == "name":
            kwargs[p] = "浦发银行"
        elif p == "flag":
            kwargs[p] = "买入"
    return kwargs


def call_with_timeout(func, kwargs, timeout=45):
    import threading
    box = {}
    def runner():
        try:
            box["v"] = func(**kwargs)
        except BaseException as e:
            box["e"] = e
    t = threading.Thread(target=runner, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise TimeoutError(f"timed out after {timeout}s")
    if "e" in box:
        raise box["e"]
    return box.get("v")


def check_result(result):
    if result is None:
        return False, "返回 None"
    if hasattr(result, "empty"):
        if result.empty:
            return False, "返回空 DataFrame"
        return True, ""
    if isinstance(result, str):
        return (bool(result.strip()), "" if result.strip() else "返回空数据")
    if isinstance(result, (list, dict)):
        return (len(result) > 0, "" if len(result) > 0 else "返回空数据")
    return True, ""


failed = [r for r in results if r["status"] != "可用"]
print(f"Retrying {len(failed)} failed interfaces sequentially...")

retried = 0
recovered = 0
for i, r in enumerate(failed):
    func_name = r["func"]
    err = r.get("error", "")
    # Skip token-required and non-existent functions
    if "token" in err.lower() and "token" in (r.get("params_raw") or ""):
        continue
    if "函数不存在" in err:
        continue

    try:
        func = getattr(ak, func_name)
    except AttributeError:
        continue

    retried += 1
    # Determine which symbol variants to try
    symbol_variants = [None]
    if "KeyError" in err and "symbol" in (r.get("params_raw") or ""):
        # Try all variants
        symbol_variants = [None] + SH_SYMBOLS + SZ_SYMBOLS

    success = False
    last_err = err
    for sv in symbol_variants:
        kwargs = build_kwargs(func_name, r.get("params_raw", ""), sv)
        try:
            result = call_with_timeout(func, kwargs, timeout=45)
            ok, msg = check_result(result)
            if ok:
                r["status"] = "可用"
                r["error"] = ""
                success = True
                recovered += 1
                break
            else:
                last_err = msg
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
        if sv is not None:
            time.sleep(0.3)

    if not success:
        r["error"] = last_err

    if (i + 1) % 20 == 0:
        print(f"  retried {i+1}/{len(failed)}, recovered {recovered}", flush=True)
    time.sleep(0.5)  # small delay to avoid rate limiting

print(f"\nRetried {retried}, recovered {recovered}")

with open(RETRY_OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

ok = sum(1 for r in results if r["status"] == "可用")
print(f"Final: {ok}/{len(results)} 可用, {len(results)-ok} 不可用")
