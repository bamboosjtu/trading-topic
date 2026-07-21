"""重新梳理：7大类 + 数据源交叉统计 sheet，重写 Excel 和 Notebook。"""

from __future__ import annotations

import importlib
import inspect
import json
import os
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
EXCEL_OUT = ROOT / "docs" / "tutorial" / "akshare_api.xlsx"
OUT_DIR = ROOT / "docs" / "tutorial"
AKSHARE_DIR = ROOT / "labs" / ".venv" / "Lib" / "site-packages" / "akshare"
STOCK_MODULES = ["stock", "stock_feature", "stock_fundamental"]

# ── 7 大分类及其描述 ──────────────────────────────────────
CATEGORIES = {
    "宏观总貌与股票列表": "市场总貌（成交统计/市盈率/巴菲特指标）+ 交易所股票清单（沪深京注册制/名称变更/退市列表）",
    "行情报价": "实时行情 + 历史日线/分钟/分笔 + 日内分时 + B股/CDR + 板块行情 + 指数行情",
    "基本面": "财务报表（资产负债表/利润表/现金流量表）+ 财务指标 + 盈利预测 + 分红 + 公司档案 + IPO + 行业分类 + 同行比较 + ESG + 估值",
    "股东与持股": "十大股东/流通股东 + 股东户数 + 高管持股 + 股权质押 + 解禁 + 回购 + 内部交易 + 管理层变动",
    "资金面": "融资融券 + 沪深港通 + 个股/板块/市场资金流 + 大宗交易 + 大单追踪 + 龙虎榜",
    "研报": "券商研报 + 盈利预测 + 分析师评级 + 机构调研 + 财报微博情绪",
    "新闻与公告": "公司公告（巨潮/东财）+ 财经新闻 + 互动易问答 + 问询函 + 法律诉讼 + 担保 + 业绩预告",
}

# ── 分类规则：按函数名 + 源文件匹配 ──────────────────────
def classify(func_name: str, source_file: str) -> str:
    n = func_name.lower()
    f = source_file.lower()

    # 新闻与公告
    if any(kw in n for kw in ["news_", "notice", "irm_", "disclosure",
                                "lawsuit", "guarantee", "allotment",
                                "cg_equity", "cg_guarantee", "cg_lawsuit",
                                "gsrl", "hold_control", "hold_num",
                                "share_change", "share_changes"]):
        return "新闻与公告"
    if any(kw in f for kw in ["news", "lawsuit", "guarantee", "allotment",
                                "gsrl", "hold_control", "hold_num",
                                "share_change", "irm", "disclosure"]):
        return "新闻与公告"

    # 研报
    if any(kw in n for kw in ["research_report", "analyst", "rank_forecast",
                                "js_weibo_report", "jgdy", "institute_hold"]):
        return "研报"
    if any(kw in f for kw in ["rank_forecast", "weibo_nlp", "jgdy"]):
        return "研报"

    # 资金面
    if any(kw in n for kw in ["margin", "hsgt", "fund_flow", "fund_stock",
                                "lh_yyb_capital", "lhb", "lh_yyb",
                                "dzjy", "individual_fund", "main_fund",
                                "market_fund", "sector_fund", "concept_fund",
                                "stock_hot_up", "stock_hot_keyword"]):
        return "资金面"
    if any(kw in f for kw in ["margin", "hsgt", "fund_em", "fund_hold",
                                "lhb", "dzjy", "stock_hot"]):
        return "资金面"

    # 股东与持股
    if any(kw in n for kw in ["holder", "shareholder", "gdhs", "gdfx",
                                "circulate_stock", "main_stock",
                                "hold_management", "gpzy_pledge",
                                "restricted_release", "repurchase",
                                "inner_trade", "management_change",
                                "share_hold_change"]):
        return "股东与持股"
    if any(kw in f for kw in ["share_hold", "hold_control_em",
                                "hold_management", "repurchase",
                                "xq", "pledge"]):
        return "股东与持股"

    # 基本面
    if any(kw in n for kw in ["financial_", "profit_forecast", "fhps",
                                "dividend", "ipo_", "new_ipo",
                                "zt_pool_sub_new", "individual_info",
                                "individual_basic", "info_global",
                                "profile", "gpzy_profile", "sy_profile",
                                "info_cjzc", "industry_", "comparison",
                                "esg", "value_em", "pg_em", "ebs_lg",
                                "a_all_pb", "a_ttm_lyr", "buffett",
                                "a_congestion", "dxsyl", "tfp",
                                "hk_indicator", "hk_profit_forecast",
                                "hk_dividend", "hk_growth", "hk_scale",
                                "hk_valuation", "zh_growth", "zh_scale",
                                "zh_valuation", "zh_dupont",
                                "sector_detail", "stock_pg",
                                "gpzy_industry_data"]):
        return "基本面"
    if any(kw in f for kw in ["financial", "fhps", "dividend", "ipo",
                                "new_cninfo", "profile", "industry",
                                "comparison", "esg", "value",
                                "stock_info", "stock_hk_comparison",
                                "stock_hk_famous", "stock_hk_fhpx"]):
        return "基本面"

    # 行情报价
    if any(kw in n for kw in ["spot", "bid_ask", "intraday",
                                "_daily", "_hist", "_minute", "_tick",
                                "board_concept", "board_industry",
                                "board_change", "hist_pre_min",
                                "stock_add", "zh_ah_spot", "zh_ah_name",
                                "zh_b_spot", "zh_b_daily", "zh_b_minute",
                                "zh_kcb", "zh_a_cdr", "hk_index_spot",
                                "zh_index_spot", "zh_index_daily",
                                "zh_index_hist", "zh_index_value",
                                "hk_spot", "hk_daily", "hk_famous",
                                "us_spot", "us_daily", "us_famous",
                                "us_pink", "stock_price_js",
                                "stock_sector_spot", "stock_staq_net"]):
        return "行情报价"
    if any(kw in f for kw in ["stock_zh_a_sina", "stock_zh_a_tx",
                                "stock_zh_a_tick", "stock_zh_b_sina",
                                "stock_zh_kcb", "stock_zh_comparison",
                                "stock_zh_ah", "stock_zh_a_special",
                                "stock_intraday", "stock_board",
                                "stock_ask_bid", "stock_hk_sina",
                                "stock_us_sina", "stock_us_pink",
                                "stock_us_famous", "stock_us_js",
                                "stock_hk_famous", "stock_summary"]):
        return "行情报价"

    # 宏观总貌与股票列表
    if any(kw in n for kw in ["_summary", "_deal_daily",
                                "register_", "_name_code",
                                "change_name", "a_code_name",
                                "stock_info_sh", "stock_info_sz",
                                "stock_info_bj", "account_statistics",
                                "stock_info_a", "sgt_", "market_activity",
                                "zh_a_new", "zh_a_new_em", "zh_a_st",
                                "zh_a_stop", "stock_hk_hot_rank",
                                "stock_hot_rank", "stock_hot_search"]):
        return "宏观总貌与股票列表"
    if any(kw in f for kw in ["stock_summary", "stock_info",
                                "stock_hot_rank", "stock_hot_search"]):
        return "宏观总貌与股票列表"

    # 剩余 —— 根据源文件二次判断
    if any(kw in f for kw in ["comment", "weibo", "inner_trade", "xq"]):
        return "研报"  # 社交媒体/舆情归入研报
    if "stock_rank" in f or "hot_rank" in f:
        return "宏观总貌与股票列表"
    if any(kw in f for kw in ["stock_hold", "stock_share", "pledge",
                                "restricted", "repurchase"]):
        return "股东与持股"
    if any(kw in f for kw in ["stock_fund", "stock_hsgt", "margin",
                                "lhb", "dzjy"]):
        return "资金面"

    return "宏观总貌与股票列表"


def discover_stock_module_functions() -> tuple[set[str], dict[str, str]]:
    funcs: set[str] = set()
    source_map: dict[str, str] = {}
    for mod_name in STOCK_MODULES:
        mod_dir = AKSHARE_DIR / mod_name
        if not mod_dir.is_dir():
            continue
        for fname in sorted(os.listdir(mod_dir)):
            if not fname.endswith(".py") or fname.startswith("_"):
                continue
            full_mod = f"akshare.{mod_name}.{fname[:-3]}"
            try:
                mod = importlib.import_module(full_mod)
                for name in dir(mod):
                    if name.startswith("stock_") and callable(getattr(mod, name, None)):
                        funcs.add(name)
                        source_map[name] = f"{mod_name}/{fname}"
            except Exception:
                pass
    return funcs, source_map


def main():
    stock_funcs, source_map = discover_stock_module_functions()
    print(f"三个 stock 模块中的 stock_* 函数: {len(stock_funcs)}")

    # 读已有 Excel
    df = pd.read_excel(ROOT / "docs" / "tutorial" / "akshare_api.xlsx")
    df["api_name"] = df["接口"].str.strip("`")
    before = len(df)
    df = df[df["api_name"].isin(stock_funcs)].copy()
    print(f"筛选后: {len(df)} (排除 {before - len(df)})")

    # 重新分类
    df["类别"] = df["api_name"].apply(lambda n: classify(n, source_map.get(n, "")))
    df["api_name_stripped"] = df["api_name"]

    # ── Sheet 1: API 清单 ──
    cat_order = list(CATEGORIES.keys())
    df["_order"] = df["类别"].map({c: i for i, c in enumerate(cat_order)})
    df = df.sort_values(["_order", "api_name_stripped"]).drop(columns=["_order", "api_name"]).reset_index(drop=True)

    # ── Sheet 2: 数据源交叉统计 ──
    cross_rows = []
    for cat in cat_order:
        cat_df = df[df["类别"] == cat]
        for upstream in sorted(cat_df["上游源"].unique()):
            src_df = cat_df[cat_df["上游源"] == upstream]
            total = len(src_df)
            avail = len(src_df[src_df["状态"] == "可用"])
            cross_rows.append({
                "类别": cat,
                "数据源": upstream,
                "总数": total,
                "可用": avail,
                "失败": total - avail,
                "可用率": f"{avail/total*100:.0f}%" if total else "0%",
            })
    cross_df = pd.DataFrame(cross_rows)

    # 写入 Excel（两个 sheet）
    with pd.ExcelWriter(EXCEL_OUT, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="API清单", index=False)
        cross_df.to_excel(writer, sheet_name="数据源统计", index=False)

    # 统计打印
    print("\n按类别统计:")
    for cat in cat_order:
        g = df[df["类别"] == cat]
        avail = len(g[g["状态"] == "可用"])
        print(f"  {cat}: {len(g)} 个接口, {avail} 可用")

    # 生成 Notebook
    generate_notebooks(df, cat_order)
    print(f"\n✓ Excel: {EXCEL_OUT}")
    print(f"✓ Notebooks ({len(cat_order)} 个): {OUT_DIR}")


def generate_notebooks(df: pd.DataFrame, cat_order: list[str]):
    for old in OUT_DIR.glob("akshare_stock_*.ipynb"):
        old.unlink()

    import akshare as ak_mod

    for cat in cat_order:
        group = df[df["类别"] == cat]
        apis = []
        for _, row in group.iterrows():
            apis.append({
                "api": row["接口"].strip("`"),
                "upstream": row["上游源"],
                "rows": int(row["行数"]),
                "status": row["状态"],
                "error": row.get("错误", ""),
            })
        apis.sort(key=lambda x: x["api"])
        write_notebook(cat, apis, ak_mod)
        print(f"  Notebook: {cat} ({len(apis)} APIs)")


def write_notebook(cat: str, apis: list[dict], ak_mod):
    desc = CATEGORIES.get(cat, "")
    cells: list[dict] = []

    # Title
    cells.append({
        "cell_type": "markdown", "metadata": {},
        "source": [
            f"# AKShare 股票数据 —— {cat}\n\n",
            f"{desc}\n\n",
            f"> 仅包含 `akshare.stock` / `stock_feature` / `stock_fundamental` 三个模块的 A 股接口\n",
            f"> 对应文档：[AKShare 股票数据](https://akshare.akfamily.xyz/data/stock/stock.html)\n",
            f"> 生成时间：{pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}\n",
        ],
    })

    # 统计概览
    avail_count = sum(1 for a in apis if a["status"] == "可用")
    cells.append({
        "cell_type": "markdown", "metadata": {},
        "source": [
            f"**共 {len(apis)} 个接口，{avail_count} 个可用**\n\n",
            "---\n",
        ],
    })

    # Import
    cells.append({"cell_type": "markdown", "metadata": {}, "source": ["## 环境准备\n"]})
    cells.append({
        "cell_type": "code", "metadata": {}, "source": [
            "import akshare as ak\nimport pandas as pd\n\n",
            "pd.set_option('display.max_columns', 30)\n",
            "pd.set_option('display.width', 300)\n",
            "pd.set_option('display.max_rows', 30)\n",
            "print(f'AKShare 版本: {ak.__version__}')",
        ],
        "outputs": [], "execution_count": None,
    })

    # Per-API
    DEFAULTS = {
        "symbol": "000001", "stock": "000001", "code": "000001",
        "start_date": "20260101", "end_date": "20260720",
        "date": "20260720", "adjust": "qfq", "period": "daily",
        "indicator": "分红", "market": "沪深A股", "concept": "人工智能",
    }

    for i, a in enumerate(apis):
        api = a["api"]
        status_tag = "✓ 可用" if a["status"] == "可用" else "✗ 失败"
        cells.append({
            "cell_type": "markdown", "metadata": {},
            "source": [
                f"---\n## {i+1}. `{api}`\n\n",
                f"**状态**: {status_tag} | **上游源**: {a['upstream']} | **体检行数**: {a['rows']}\n\n",
                f"_调用示例_：\n",
            ],
        })

        func = getattr(ak_mod, api, None)
        if func is None:
            code_lines = [f"# 接口未找到\n", f"# df = ak.{api}()\n"]
        else:
            sig = inspect.signature(func)
            args: dict[str, str] = {}
            for pname, param in sig.parameters.items():
                if param.default is not inspect.Parameter.empty:
                    continue
                if param.kind in (inspect.Parameter.VAR_KEYWORD, inspect.Parameter.VAR_POSITIONAL):
                    continue
                if pname in DEFAULTS:
                    args[pname] = repr(DEFAULTS[pname])
                elif pname == "timeout":
                    args[pname] = "15"
                elif "date" in pname:
                    args[pname] = repr(DEFAULTS["date"])
                elif "symbol" in pname or "stock" in pname or "code" in pname:
                    args[pname] = repr(DEFAULTS["symbol"])
            arg_str = ", ".join(f"{k}={v}" for k, v in args.items())
            code_lines = [f"# {api}\n", "try:\n"]
            if arg_str:
                code_lines.append(f"    df = ak.{api}({arg_str})\n")
            else:
                code_lines.append(f"    df = ak.{api}()\n")
            code_lines.append('    print(f"行数: {len(df)},  列: {list(df.columns)[:15]}")\n')
            code_lines.append("    display(df.head(10))\n")
            code_lines.append("except Exception as e:\n")
            code_lines.append('    print(f"调用失败: {type(e).__name__}: {e}")\n')

        cells.append({
            "cell_type": "code", "metadata": {},
            "source": code_lines, "outputs": [], "execution_count": None,
        })

    cells.append({
        "cell_type": "markdown", "metadata": {},
        "source": [
            "---\n## 总结\n\n",
            f"本 notebook 覆盖 **{cat}** 下 {len(apis)} 个 AKShare 股票数据接口。\n\n",
            "下一步：[AKShare 完整文档](https://akshare.akfamily.xyz/data/stock/stock.html)\n",
        ],
    })

    nb = {
        "nbformat": 4, "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.12.0"},
        },
        "cells": cells,
    }
    fname = f"akshare_stock_{cat}.ipynb"
    OUT_DIR.joinpath(fname).write_text(
        json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
