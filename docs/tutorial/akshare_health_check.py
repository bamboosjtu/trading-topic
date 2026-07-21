"""遍历 akshare 中所有 stock_* 接口，逐个调用并记录状态，输出 Excel 清单。"""

from __future__ import annotations

import inspect
import re
import time
import traceback
from pathlib import Path
from typing import Any

import akshare as ak
import pandas as pd

OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "tutorial" / "akshare_api.xlsx"
TIMEOUT_PER_CALL = 15  # 秒
TEST_SYMBOL = "000001"       # 平安银行
TEST_SYMBOL_SH = "600036"    # 招商银行
TEST_START = "20260701"
TEST_END = "20260720"
TEST_DATE = "20260720"

# ── 按参数模式分组的调用模板 ──────────────────────────────
# 每个模式对应 (参数, extras) ，extras 里的值会覆盖默认参数


def _call_with_args(func, args_map: dict[str, Any]) -> tuple[bool, int, str]:
    """调用 func，返回 (成功, 行数, 错误信息)。"""
    try:
        sig = inspect.signature(func)
        # 只传 func 接受的参数
        valid = {k: v for k, v in args_map.items() if k in sig.parameters}
        result = func(**valid)
        if isinstance(result, pd.DataFrame):
            return True, len(result), ""
        if isinstance(result, pd.Series):
            return True, len(result), ""
        if result is None:
            return True, 0, ""
        if isinstance(result, (list, dict)):
            return True, len(result), ""
        return True, 1, ""
    except Exception:
        return False, 0, _sanitize_error(traceback.format_exc())


def _sanitize_error(text: str, limit: int = 200) -> str:
    text = text.replace("\r", " ").replace("\n", " | ")
    text = re.sub(r"(token|api[_-]?key|authorization|cookie)=([^&\s]+)", r"\1=***", text)
    return text[-limit:]


def _guess_upstream(func_name: str, doc: str) -> str:
    """根据函数名和 docstring 推测上游数据源。"""
    combined = f"{func_name} {doc}"
    sources = []
    if "em" in func_name.split("_")[-3:]:
        sources.append("东方财富")
    if any(kw in combined for kw in ["tx", "腾讯", "qq"]):
        sources.append("腾讯")
    if any(kw in combined for kw in ["sina", "新浪"]):
        sources.append("新浪")
    if any(kw in combined for kw in ["xq", "雪球"]):
        sources.append("雪球")
    if any(kw in combined for kw in ["sse", "上交所", "sh"]):
        sources.append("上交所")
    if any(kw in combined for kw in ["szse", "深交所", "sz"]):
        sources.append("深交所")
    if any(kw in combined for kw in ["bj", "bse", "北交所"]):
        sources.append("北交所")
    if any(kw in combined for kw in ["ths", "同花顺"]):
        sources.append("同花顺")
    if any(kw in combined for kw in ["iwencai", "问财"]):
        sources.append("问财")
    if any(kw in combined for kw in ["cninfo", "巨潮"]):
        sources.append("巨潮")
    if any(kw in combined for kw in ["mootdx", "tdx", "通达信"]):
        sources.append("通达信")
    return "/".join(sources) if sources else "未识别"


def _guess_category(func_name: str) -> str:
    """根据函数名推测类别。"""
    name = func_name.lower()
    if any(kw in name for kw in ["spot", "quote", "bid_ask", "intraday"]):
        return "行情"
    if any(kw in name for kw in ["hist", "daily", "weekly", "monthly", "minute", "tick", "kline"]):
        return "历史K线"
    if any(kw in name for kw in ["financial", "balance", "income", "cashflow", "profit", "indicator", "abstract", "report", "f10"]):
        return "财务"
    if any(kw in name for kw in ["dividend", "fhps", "bonus", "sharebonus"]):
        return "分红"
    if any(kw in name for kw in ["ipo", "new_", "new_a"]):
        return "新股"
    if any(kw in name for kw in ["st_", "st_em"]):
        return "风险警示"
    if any(kw in name for kw in ["board", "industry", "concept", "sector"]):
        return "板块"
    if any(kw in name for kw in ["margin", "rzrq", "margin"]):
        return "融资融券"
    if any(kw in name for kw in ["flow", "fund", "money", "capital"]):
        return "资金流"
    if any(kw in name for kw in ["hsgt", "north", "south"]):
        return "沪深港通"
    if any(kw in name for kw in ["holder", "shareholder", "top"]):
        return "股东"
    if any(kw in name for kw in ["block", "limit", "zt", "dt"]):
        return "涨跌停"
    if any(kw in name for kw in ["calendar", "gsrl", "gsdt"]):
        return "日历"
    if any(kw in name for kw in ["info", "individual", "basic", "profile"]):
        return "基础信息"
    if any(kw in name for kw in ["summary", "deal", "area"]):
        return "市场总貌"
    if any(kw in name for kw in ["valuation", "dupont", "growth", "scale", "comparison", "compare"]):
        return "同行比较"
    if any(kw in name for kw in ["news", "notice", "announce", "bulletin"]):
        return "公告新闻"
    if any(kw in name for kw in ["research", "analyst", "rating"]):
        return "研报"
    if any(kw in name for kw in ["etf", "fund", "lof"]):
        return "基金/ETF"
    if any(kw in name for kw in ["option", "opt"]):
        return "期权"
    if any(kw in name for kw in ["bond", "cb", "convertible"]):
        return "债券"
    if any(kw in name for kw in ["index", "benchmark"]):
        return "指数"
    if any(kw in name for kw in ["esg", "score"]):
        return "ESG"
    if any(kw in name for kw in ["register", "reg", "list", "name_code"]):
        return "证券列表"
    return "其他"


def discover_stock_functions():
    """找出 akshare 中所有以 stock_ 开头的可调用接口。"""
    functions = []
    for name in sorted(dir(ak)):
        if not name.startswith("stock_"):
            continue
        obj = getattr(ak, name)
        if not callable(obj):
            continue
        # 跳过明显是内部的
        if name.startswith("stock___"):
            continue
        doc = inspect.getdoc(obj) or ""
        functions.append((name, obj, doc))
    return functions


def build_call_args(func_name: str, func: Any) -> list[dict[str, Any]]:
    """为一组函数推断合适的测试参数组合。"""
    sig = inspect.signature(func)
    params = set(sig.parameters.keys())
    name = func_name

    # 需要 symbol 的函数：试两个典型标的
    need_symbol = any(p in params for p in ("symbol", "stock"))

    # 不需要参数
    if not params:
        return [{}]

    # 只接受 **kwargs 的 -> 直接空参
    only_kwargs = all(
        p.kind in (inspect.Parameter.VAR_KEYWORD, inspect.Parameter.VAR_POSITIONAL)
        for p in sig.parameters.values()
    )
    if only_kwargs:
        return [{}]

    combos: list[dict[str, Any]] = []

    # 通用参数
    common: dict[str, Any] = {}
    if "start_date" in params:
        common["start_date"] = TEST_START
    if "end_date" in params:
        common["end_date"] = TEST_END
    if "date" in params:
        common["date"] = TEST_DATE
    if "timeout" in params:
        common["timeout"] = 10
    if "adjust" in params:
        common["adjust"] = "qfq"
    if "period" in params:
        common["period"] = "daily"
    if "indicator" in params:
        common["indicator"] = "分红"

    # symbol — 按函数名称特征选择标的
    def add_symbol_combo(sym):
        c = dict(common)
        for p in ("symbol", "stock", "code"):
            if p in params:
                c[p] = sym
        combos.append(c)

    # 需要 symbol 的函数给沪深各一个测试，不需要的只试一次
    if need_symbol:
        # 分时/tick 类可能只支持当天，给当天日期
        if any(kw in name for kw in ["tick", "intraday", "minute", "bid_ask"]):
            add_symbol_combo(TEST_SYMBOL_SH)  # 只需一个代表
        else:
            add_symbol_combo(TEST_SYMBOL)
    else:
        combos.append(dict(common))

    # 部分接口接受 symbol 但不强制 — 对无参也保留空参版本
    if not combos:
        combos = [{}]

    return combos


def main():
    functions = discover_stock_functions()
    print(f"发现 {len(functions)} 个 stock_* 接口，开始逐个测试...\n")

    rows: list[dict[str, Any]] = []
    tested = 0

    for func_name, func, doc in functions:
        upstream = _guess_upstream(func_name, doc)
        category = _guess_category(func_name)
        combos = build_call_args(func_name, func)

        best_ok = False
        best_rows = 0
        best_elapsed = 0.0
        errors: list[str] = []

        for args in combos:
            started = time.perf_counter()
            ok, n_rows, err = _call_with_args(func, args)
            elapsed = time.perf_counter() - started

            if ok:
                best_ok = True
                best_rows = max(best_rows, n_rows)
                best_elapsed = elapsed
                break
            else:
                errors.append(err)
                # 如果超时，不再尝试下一组参数
                if elapsed > TIMEOUT_PER_CALL:
                    best_elapsed = elapsed
                    break
                best_elapsed += elapsed

        status = "可用" if best_ok else "失败"
        error_summary = "; ".join(errors)[:200] if errors else ""

        rows.append({
            "接口": f"`{func_name}`",
            "类别": category,
            "上游源": upstream,
            "状态": status,
            "行数": best_rows,
            "耗时": f"{best_elapsed:.1f}s",
            "错误": error_summary,
            "测试时间": time.strftime("%Y-%m-%d %H:%M:%S"),
        })

        tested += 1
        if tested % 20 == 0:
            print(f"  进度: {tested}/{len(functions)}")

    df = pd.DataFrame(rows)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(OUTPUT, index=False, engine="openpyxl")
    print(f"\n完成！已输出 {OUTPUT}")
    print(f"共 {len(df)} 个接口，可用 {len(df[df['状态']=='可用'])}，失败 {len(df[df['状态']=='失败'])}")


if __name__ == "__main__":
    main()
