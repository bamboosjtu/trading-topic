"""AkShare 股票接口健康检测脚本

从官方文档 https://akshare.akfamily.xyz/data/stock/stock.html 解析接口清单，
逐个调用检测可用性，输出 xlsx 结果，
同步更新 akshare_stock_api.xlsx 和 akshare_api.md。

运行方式:
    uv run --project labs python labs/00_金融数据获取/akshare_health_check.py
"""

from __future__ import annotations

import inspect
import re
import time
import traceback
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import akshare as ak
import pandas as pd
import requests
from bs4 import BeautifulSoup

# ── 配置 ──────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
DOC_URL = "https://akshare.akfamily.xyz/data/stock/stock.html"
STOCK_API_XLSX = SCRIPT_DIR / "akshare_stock_api.xlsx"
HEALTH_CHECK_XLSX = SCRIPT_DIR / "akshare_health_check_result.xlsx"
AKSHARE_API_MD = SCRIPT_DIR / "akshare_api.md"

TIMEOUT_PER_CALL = 15  # 单个接口调用超时(秒)
TEST_SYMBOL = "000001"       # 平安银行
TEST_SYMBOL_SH = "600036"    # 招商银行
TEST_START = "20260701"
TEST_END = "20260720"
TEST_DATE = "20260720"

# 官方标题对少数接口过于笼统时，按返回数据覆盖展示名称，避免把市场范围写错。
DISPLAY_NAME_OVERRIDES = {
    "stock_hk_spot": "港股实时行情数据-新浪",
    "stock_zh_a_hist_tx": "A股历史行情数据-腾讯",
    "stock_zh_a_new": "次新股实时行情数据-新浪",
    "stock_zh_ah_spot": "A+H股实时行情数据-腾讯",
    "stock_zh_b_spot": "B股实时行情数据-新浪",
    "stock_zh_kcb_spot": "科创板实时行情数据-新浪",
}

# ── 面向投资研究的 7 领域分类 ─────────────────────────
CATEGORIES = [
    "universe：证券主数据与股票池",
    "market：行情与估值快照",
    "fundamentals：公司与财务基本面",
    "corporate_actions：公司行为与股本事件",
    "sector：行业、概念与市场结构",
    "flows_events：资金、交易行为与市场事件",
    "research_disclosure：研报、公告与资讯",
]

CAT_NUMBER = {
    category: number
    for category, number in zip(CATEGORIES, "一二三四五六七", strict=True)
}

# “可用”是面向当前研究的状态，不等同于“函数能被调用”。
# 不同数据类型的更新节奏不同，因此使用保守的、按子类区分的日期窗口。
QUALITY_USABLE = "可用"
QUALITY_EXPIRED = "过期"
QUALITY_UNAVAILABLE = "不可用"

FRESHNESS_WINDOWS_DAYS = {
    "intraday": 45,
    "snapshot": 90,
    "quotes": 90,
    "daily": 365,
    "history": 730,
    "valuation": 730,
    "industry_metrics": 730,
    "financial_statements": 900,
    "financial_indicators": 900,
    "forecasts": 900,
    "shareholders": 900,
    "fund_flow": 365,
    "margin": 365,
    "northbound": 365,
    "block_trade": 365,
    "limit_up": 365,
    "sentiment": 365,
    "unusual_trade": 365,
    "investor_relations": 730,
    "announcements": 730,
    "analyst_forecasts": 900,
    "news": 180,
    "research_reports": 730,
    "capital_change": 730,
    "unlock": 730,
    "rights_issue": 730,
    "repurchase": 730,
    "pledge": 730,
    "dividend": 730,
    "issuance": 365,
}

DATE_COLUMN_TOKENS = (
    "date", "日期", "时间", "交易日", "报告期", "公告日", "发布日", "更新时间",
    "更新日期", "统计日", "截止日", "披露日", "申报日", "实施日", "解禁日",
    "除权日", "股权登记日", "回购日", "分红日", "上榜日",
)
STATIC_DATE_COLUMNS = {"上市日期", "成立日期", "注册日期"}


def _return_columns(result: Any) -> list[str]:
    """提取返回值的字段名，避免把整份大表写入检测结果。"""
    if isinstance(result, pd.DataFrame):
        return [str(column) for column in result.columns]
    if isinstance(result, pd.Series):
        if result.name is not None:
            return [str(result.name)]
        return [str(index) for index in result.index[:50]]
    if isinstance(result, dict):
        return [str(key) for key in result.keys()]
    if isinstance(result, (list, tuple)) and result and isinstance(result[0], dict):
        return [str(key) for key in result[0].keys()]
    return []


def _classify_return_semantics(result: Any) -> str | None:
    """按实际返回字段补充语义分类，优先于官方标题和函数名。"""
    columns = {column.lower() for column in _return_columns(result)}
    if not columns:
        return None

    def contains_any(*tokens: str) -> bool:
        return any(token.lower() in column for column in columns for token in tokens)

    # 上交所/深交所市场总貌：项目 × 股票/主板/科创板，而非单只股票行情。
    if "项目" in columns and columns.intersection({"股票", "主板", "科创板", "总市值", "流通市值"}):
        return CATEGORIES[1]

    # 板块自身的行情/资金字段归 sector；先于通用“净流入”规则判断。
    if columns.intersection({"板块", "行业", "概念"}) and columns.intersection(
        {"涨跌幅", "总成交额", "净流入", "上涨家数", "下跌家数"}
    ):
        return CATEGORIES[4]

    if contains_any("除权除息", "股权登记", "分红", "送股", "转增", "派息", "解禁数量", "回购价格"):
        return CATEGORIES[3]

    if contains_any("公告标题", "新闻标题", "研报标题", "资讯标题", "标题"):
        return CATEGORIES[6]

    if contains_any("报告期", "营业收入", "净利润", "资产总计", "负债合计", "每股收益"):
        return CATEGORIES[2]

    return None


def classify_interface(func_name: str, description: str = "", sample: Any = None) -> str:
    """按 ``1-akshare股票数据源.md`` 推断接口所属的 7 个稳定领域。

    规则按数据语义而不是上游网站组织。优先级从边界最明确的领域到
    最通用的行情领域；同一上游的接口因此可能分属不同领域。
    """
    name = func_name.lower()
    name_category = classify_interface(func_name, description) if sample is not None else None
    # 返回值语义只在它与稳定的函数名分类一致，或函数名落入通用行情兜底时参与决策。
    # 这样不会把 IPO/重大合同/行业比较等明确领域，因返回字段里出现“报告/营业收入”而误改。
    semantic_category = _classify_return_semantics(sample) if sample is not None else None
    if semantic_category is not None and (
        semantic_category == name_category or name_category == CATEGORIES[1]
    ):
        return semantic_category

    desc = description or ""

    # 虽以 news_ 命名，但返回的是除权除息/分红事件，按公司行为归档。
    if name == "news_trade_notify_dividend_baidu":
        return CATEGORIES[3]

    # 官方文档中少量股票接口以 news_ 开头；仍按“资讯/事件通知”语义归档。
    if name.startswith("news_"):
        return CATEGORIES[6]

    # 行业质押统计研究的是行业结构，不是单家公司行为。
    if name == "stock_gpzy_industry_data_em":
        return CATEGORIES[4]

    # 1. universe：证券主数据、上市状态、分类归属和股票池成分
    if any(kw in name for kw in [
        "info_a_code", "info_bj_name", "info_sh_name", "info_sz_name",
        "info_change_name", "info_sz_change", "info_sz_delist", "info_sh_delist",
        "staq_net_stop", "zh_a_st_em", "zh_a_stop_em", "zh_ah_name",
        "board_concept_cons", "board_industry_cons", "concept_cons_futu",
        "ggt_components", "industry_category", "industry_change",
        "security_profile", "basic_info", "sector_detail",
    ]):
        return CATEGORIES[0]

    # 4. corporate_actions：公司发起或直接改变持有人权益/股本的事件
    if any(kw in name for kw in [
        "dividend", "fhps", "fhpx", "history_dividend",
        "repurchase", "restricted_release",
        "allotment", "add_stock", "qbzf", "pg_em",
        "ipo_", "register_", "new_ipo", "new_gh", "xgsglb", "xgsr", "dxsyl",
        "gpzy_", "equity_mortgage",
        "share_change", "share_hold_change", "shareholder_change",
        "management_change", "ggcg", "hold_change", "hold_control",
        "hold_management", "gbjg", "gddh_em",
    ]):
        return CATEGORIES[3]

    # 7. research_disclosure：公告、研报、资讯、互动和外部评价
    if any(kw in name for kw in [
        "research_report", "analyst", "institute_recommend", "rank_forecast",
        "jgdy_", "notice_report", "individual_notice",
        "news_", "info_cjzc", "info_global",
        "report_disclosure", "disclosure_report", "disclosure_relation",
        "irm_", "sns_sseinfo", "esg_",
        "cg_guarantee", "cg_lawsuit", "zdhtmx", "gsrl_gsdt",
        "zh_kcb_report", "price_js",
    ]):
        return CATEGORIES[6]
    if name == "stock_comment_em":
        return CATEGORIES[6]

    # 5. sector：行业/概念本身的分类、行情、估值、资金和中观指标
    if any(kw in name for kw in [
        "board_concept_name", "board_concept_info", "board_concept_spot",
        "board_concept_hist", "board_concept_index",
        "board_industry_name", "board_industry_summary", "board_industry_spot",
        "board_industry_hist", "board_industry_index",
        "industry_clf", "industry_pe_ratio", "szse_sector_summary",
        "sector_spot", "sector_fund_flow", "concept_fund_flow",
        "fund_flow_concept", "fund_flow_industry", "hsgt_board_rank",
        "gpzy_industry_data", "sy_hy", "dupont_comparison",
        "growth_comparison", "scale_comparison", "valuation_comparison",
    ]):
        return CATEGORIES[4]

    # 6. flows_events：资金、交易行为、异动、涨跌停与情绪
    if any(kw in name for kw in [
        "fund_flow", "dzjy_", "lhb_", "lh_",
        "cyq_em", "margin_", "hsgt_", "sgt_",
        "hot_follow", "hot_tweet", "hot_deal", "hot_rank", "hot_up",
        "hot_keyword", "hot_search", "hk_hot_rank",
        "comment_detail", "changes_em", "zt_pool", "tfp_em",
        "board_change", "inner_trade", "rank_xzjp", "zh_vote_baidu",
        "rank_cxg", "rank_cxd", "rank_lxsz", "rank_lxxd",
        "rank_xstp", "rank_xxtp", "rank_ljqd", "rank_ljqs",
        "rank_cxfl", "rank_cxsl",
        "account_statistics", "market_activity", "a_congestion", "a_high_low",
    ]):
        return CATEGORIES[5]

    # 3. fundamentals：公司资料、三表、指标、业务、股东与聚合预测
    if any(kw in name for kw in [
        "company_profile", "profile_cninfo", "individual_info_em",
        "financial", "balance_sheet", "profit_sheet", "cash_flow",
        "zcfz", "lrb", "xjll", "yjbb", "yjkb", "yjyg", "yysj",
        "sy_em", "sy_profile", "sy_yq", "sy_jz", "qsjy", "zygc",
        "zyjs_ths",
        "gdfx", "gdhs", "circulate_stock", "main_stock_holder",
        "hold_num", "yzxdr", "institute_hold", "fund_stock_holder",
        "report_fund_hold", "profit_forecast",
    ]):
        return CATEGORIES[2]

    # 2. market：价格、行情、市场概况与估值快照
    if any(kw in name for kw in [
        "spot", "hist", "daily", "minute", "tick", "intraday", "bid_ask",
        "sse_deal", "sse_summary", "szse_area", "szse_summary",
        "a_all_pb", "a_below_net_asset", "a_gxl", "a_ttm",
        "hk_gxl", "buffett_index", "ebs_lg", "market_pe", "market_pb",
        "index_pe", "index_pb", "value_em", "valuation_baidu",
        "indicator_eniu", "zh_ab_comparison",
    ]):
        return CATEGORIES[1]

    # Fallback: 描述关键词
    if any(kw in desc for kw in ["公告", "新闻", "研报", "机构调研", "投资者互动"]):
        return CATEGORIES[6]
    if any(kw in desc for kw in ["股东", "财务", "报表", "业绩"]):
        return CATEGORIES[2]
    if any(kw in desc for kw in ["板块", "行业"]):
        return CATEGORIES[4]
    if any(kw in desc for kw in ["龙虎榜", "资金流", "融资融券", "涨停", "异动"]):
        return CATEGORIES[5]
    return CATEGORIES[1]


def classify_subcategory(func_name: str, category: str | None = None) -> str:
    """返回 7 领域下的稳定子类，便于表格筛选和教程导航。"""
    name = func_name.lower()
    category = category or classify_interface(func_name)

    if category == CATEGORIES[0]:
        if any(kw in name for kw in ["_cons", "components", "sector_detail"]):
            return "constituents"
        if any(kw in name for kw in ["delist", "stop", "_st_em", "change_name", "sz_change"]):
            return "listing_status"
        if "industry_" in name:
            return "classification"
        return "security_master"

    if category == CATEGORIES[1]:
        if any(kw in name for kw in [
            "valuation", "value_em", "_pb", "_pe", "gxl", "ebs_lg",
            "buffett_index", "below_net_asset", "indicator_eniu", "zh_ab_comparison",
        ]):
            return "valuation"
        if any(kw in name for kw in ["minute", "intraday", "tick"]):
            return "intraday"
        if any(kw in name for kw in ["daily", "hist"]):
            return "daily"
        return "snapshot"

    if category == CATEGORIES[2]:
        if any(kw in name for kw in [
            "balance_sheet", "profit_sheet", "cash_flow", "financial_report",
            "financial_benefit", "financial_cash", "financial_debt", "zcfz", "lrb", "xjll",
        ]):
            return "financial_statements"
        if any(kw in name for kw in ["profit_forecast", "yjyg"]):
            return "forecasts"
        if any(kw in name for kw in [
            "holder", "gdfx", "gdhs", "hold_num", "yzxdr", "institute_hold", "report_fund_hold",
        ]):
            return "shareholders"
        if any(kw in name for kw in ["zygc", "zyjs_ths"]):
            return "business_segments"
        if any(kw in name for kw in [
            "abstract", "indicator", "yjbb", "yjkb", "yysj", "sy_", "qsjy",
        ]):
            return "financial_indicators"
        return "company_profile"

    if category == CATEGORIES[3]:
        if any(kw in name for kw in ["dividend", "fhps", "fhpx"]):
            return "dividend"
        if "repurchase" in name:
            return "repurchase"
        if "restricted_release" in name:
            return "unlock"
        if any(kw in name for kw in ["gpzy", "equity_mortgage"]):
            return "pledge"
        if any(kw in name for kw in ["allotment", "pg_em"]):
            return "rights_issue"
        if any(kw in name for kw in [
            "ipo_", "register_", "new_ipo", "new_gh", "xgsglb", "xgsr", "dxsyl",
            "add_stock", "qbzf",
        ]):
            return "issuance"
        return "capital_change"

    if category == CATEGORIES[4]:
        if "fund_flow" in name or "hsgt_board_rank" in name:
            return "fund_flow"
        if "hist" in name:
            return "history"
        if any(kw in name for kw in ["pe_ratio", "comparison"]):
            return "valuation"
        if any(kw in name for kw in ["_name", "_info", "industry_clf"]):
            return "classification"
        if any(kw in name for kw in ["spot", "index", "summary"]):
            return "quotes"
        return "industry_metrics"

    if category == CATEGORIES[5]:
        if "margin" in name:
            return "margin"
        if any(kw in name for kw in ["hsgt", "sgt_"]):
            return "northbound"
        if "dzjy" in name:
            return "block_trade"
        if "zt_pool" in name or "market_activity" in name:
            return "limit_up"
        if any(kw in name for kw in [
            "hot_", "comment_detail", "congestion", "high_low", "account_statistics",
            "zh_vote", "rank_cx", "rank_lx", "rank_xs", "rank_xx", "rank_lj",
        ]):
            return "sentiment"
        if any(kw in name for kw in ["lhb", "lh_", "changes", "board_change", "inner_trade", "tfp", "rank_xzjp"]):
            return "unusual_trade"
        return "fund_flow"

    if any(kw in name for kw in ["irm_", "sns_sseinfo"]):
        return "investor_relations"
    if any(kw in name for kw in [
        "notice", "notify", "disclosure", "zdhtmx", "gsrl_gsdt",
        "cg_guarantee", "cg_lawsuit",
    ]):
        return "announcements"
    if "rank_forecast" in name:
        return "analyst_forecasts"
    if any(kw in name for kw in ["notice", "notify", "disclosure", "zh_kcb_report"]):
        return "announcements"
    if any(kw in name for kw in ["news_", "info_cjzc", "info_global"]):
        return "news"
    return "research_reports"


@dataclass
class InterfaceInfo:
    """从文档解析的接口信息 + 检测结果。"""
    # 文档解析字段
    category: str = ""        # 文档标题层级 (h2 > h3)
    subcategory: str = ""     # 文档标题层级 (h4 > h5)
    name: str = ""            # 接口函数名
    target_url: str = ""      # 目标地址
    description: str = ""     # 描述
    input_params: str = ""    # 输入参数(逗号分隔)
    # 检测结果字段
    available: bool = False
    quality_status: str = QUALITY_UNAVAILABLE
    error: str = ""
    rows: int = 0
    elapsed: float = 0.0
    check_time: str = ""
    latest_date: str = ""
    sample_columns: str = ""
    quality_note: str = ""
    # 推断字段
    upstream: str = ""        # 数据源
    semantic_category: str = ""  # 根据实际返回字段校正后的领域


# ── 文档解析 ──────────────────────────────────────────

def fetch_documentation(url: str = DOC_URL) -> str:
    """获取官方文档 HTML。"""
    print(f"正在获取文档: {url}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    print(f"文档大小: {len(resp.text)} 字符")
    return resp.text


def _clean_heading(text: str) -> str:
    """清理标题文本中的锚点字符 (\uf0c1 等)。"""
    return text.replace("\uf0c1", "").strip()


def parse_documentation(html: str) -> list[InterfaceInfo]:
    """解析文档 HTML，提取所有接口信息。

    文档结构:
      <h2>A股</h2>            → 市场
      <h3>股票市场总貌</h3>    → 大类
      <h4>上海证券交易所</h4>   → 子类
      <h5>证券类别统计</h5>    → 细类
      <p>接口: stock_xxx</p>
      <p>目标地址: http://...</p>
      <p>描述: ...</p>
      <p>输入参数</p>
      <table>名称/类型/描述</table>
    """
    soup = BeautifulSoup(html, "html.parser")

    interfaces: list[InterfaceInfo] = []
    headings: list[tuple[int, str]] = []  # [(level, text)]
    current: InterfaceInfo | None = None
    expect_params_table = False

    # 获取所有相关元素(过滤掉 table 内的嵌套元素)
    elements = [
        e for e in soup.find_all(
            ["h1", "h2", "h3", "h4", "h5", "h6", "p", "table"], recursive=True
        )
        if not e.find_parent("table")
    ]

    for elem in elements:
        tag = elem.name
        text = elem.get_text(strip=True)

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            heading = _clean_heading(text)
            if not heading:
                continue
            # 维护标题栈: 移除同级或更深层级的标题
            headings = [h for h in headings if h[0] < level]
            headings.append((level, heading))
            if heading == "输入参数":
                expect_params_table = True
            continue

        if tag == "p":
            # 检测接口名
            m = re.match(r"接口[:：]\s*(\S+)", text)
            if m:
                if current:
                    interfaces.append(current)
                current = InterfaceInfo(name=m.group(1))
                # 从标题层级构建类别
                h2_texts = [h[1] for h in headings if h[0] == 2]
                h3_texts = [h[1] for h in headings if h[0] == 3]
                h4_texts = [h[1] for h in headings if h[0] == 4]
                h5_texts = [h[1] for h in headings if h[0] == 5]
                current.category = (
                    " > ".join(h2_texts + h3_texts)
                    if (h2_texts or h3_texts)
                    else "未分类"
                )
                current.subcategory = (
                    " > ".join(h4_texts + h5_texts)
                    if (h4_texts or h5_texts)
                    else ""
                )
                continue

            if current is None:
                continue

            # 目标地址
            m = re.match(r"目标地址[:：]\s*(\S+)", text)
            if m:
                current.target_url = m.group(1)
                continue

            # 描述
            m = re.match(r"描述[:：]\s*(.+)", text)
            if m:
                current.description = m.group(1).strip()
                continue

            # 输入参数标记
            if text == "输入参数":
                expect_params_table = True
                continue

        if tag == "table" and expect_params_table and current is not None:
            # 解析参数表: 第一列为参数名
            params: list[str] = []
            rows = elem.find_all("tr")
            for row in rows[1:]:  # 跳过表头
                cells = row.find_all(["td", "th"])
                if cells:
                    param_name = cells[0].get_text(strip=True)
                    if param_name and param_name != "-":
                        params.append(param_name)
            current.input_params = ", ".join(params) if params else "null"
            expect_params_table = False

    if current:
        interfaces.append(current)

    # `stock_hk_spot` 只返回港股行情，官方标题“实时行情数据-新浪”
    # 范围过宽；统一修正文档和 xlsx 的展示名称。
    for iface in interfaces:
        if iface.name in DISPLAY_NAME_OVERRIDES:
            iface.description = DISPLAY_NAME_OVERRIDES[iface.name]

    # 推断数据源
    for iface in interfaces:
        iface.upstream = _guess_upstream(iface.name, iface.description)

    return interfaces


# ── 接口检测 ──────────────────────────────────────────

def _sanitize_error(text: str, limit: int = 200) -> str:
    """清理错误信息，去除敏感信息和换行。"""
    text = text.replace("\r", " ").replace("\n", " | ")
    text = re.sub(r"(token|api[_-]?key|authorization|cookie)=([^&\s]+)", r"\1=***", text)
    # 报告会提交到仓库，不能把本机用户目录和虚拟环境路径写入学习文档。
    text = re.sub(r"[A-Za-z]:[\\/][^\s|\"']+", "<local-path>", text)
    text = re.sub(r"(?i)(?:[A-Za-z]:)?[\\/:]*Users[\\/][^\s|\"']+", "<local-path>", text)
    text = re.sub(r"(?i)Documents[\\/][^\s|\"']+", "<local-path>", text)
    text = re.sub(r"(?<![A-Za-z])/(?:Users|home)/[^\s|\"']+", "<local-path>", text)
    return text[-limit:]


def _guess_upstream(func_name: str, doc: str) -> str:
    """根据函数名和描述推测上游数据源。"""
    combined = f"{func_name} {doc}"
    sources: list[str] = []
    if "em" in func_name.split("_")[-3:]:
        sources.append("东方财富")
    if any(kw in combined for kw in ["tx", "腾讯", "qq"]):
        sources.append("腾讯")
    if any(kw in combined for kw in ["sina", "新浪"]):
        sources.append("新浪")
    if any(kw in combined for kw in ["xq", "雪球"]):
        sources.append("雪球")
    if any(kw in combined for kw in ["sse", "上交所", "sse"]):
        sources.append("上交所")
    if any(kw in combined for kw in ["szse", "深交所"]):
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
    if any(kw in combined for kw in ["baidu", "百度"]):
        sources.append("百度")
    if any(kw in combined for kw in ["lg", "legu", "乐估"]):
        sources.append("乐估乐股")
    if any(kw in combined for kw in ["futu", "富途"]):
        sources.append("富途")
    if any(kw in combined for kw in ["cx", "财新"]):
        sources.append("财新")
    if any(kw in combined for kw in ["eniu", "亿牛"]):
        sources.append("亿牛")
    if any(kw in combined for kw in ["et", "经济通"]):
        sources.append("经济通")
    return "/".join(sources) if sources else "未识别"


def _call_with_args(func, args_map: dict[str, Any]) -> tuple[bool, int, str, Any]:
    """调用 func，返回 (成功, 行数, 错误信息, 返回值)。"""
    try:
        sig = inspect.signature(func)
        valid = {k: v for k, v in args_map.items() if k in sig.parameters}
        result = func(**valid)
        if isinstance(result, pd.DataFrame):
            return True, len(result), "", result
        if isinstance(result, pd.Series):
            return True, len(result), "", result
        if result is None:
            return True, 0, "", result
        if isinstance(result, (list, dict)):
            return True, len(result), "", result
        return True, 1, "", result
    except Exception:
        return False, 0, _sanitize_error(traceback.format_exc()), None


def _parse_date_value(value: Any) -> date | None:
    """只解析明确的日期值，避免把财务数值误当成时间戳。"""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (datetime, date, pd.Timestamp)):
        return value.date() if isinstance(value, (datetime, pd.Timestamp)) else value

    text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none", "null", "-"}:
        return None
    match = re.search(r"(?<!\d)(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?", text)
    if match:
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None
    digits = re.sub(r"\D", "", text)
    if len(digits) == 8 and digits.startswith("20"):
        try:
            return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
        except ValueError:
            return None
    return None


def _date_columns(result: Any) -> list[str]:
    columns = [
        column for column in _return_columns(result)
        if any(token in column.lower() for token in DATE_COLUMN_TOKENS)
        and column not in STATIC_DATE_COLUMNS
    ]
    # 财务摘要常把报告期放在列名中（如 20260331），不是单独的日期字段。
    columns.extend(
        column for column in _return_columns(result)
        if column not in columns and _parse_date_value(column) is not None
    )
    return columns


def _latest_return_date(result: Any) -> tuple[date | None, list[str]]:
    """从返回值中找出最晚的时序日期及对应字段。"""
    columns = _date_columns(result)
    values: list[Any] = []
    label_dates = [
        parsed for column in columns
        if _parse_date_value(column) is not None
        and not any(token in column.lower() for token in DATE_COLUMN_TOKENS)
        if (parsed := _parse_date_value(column)) is not None
    ]
    value_columns = [column for column in columns if column not in {
        str(parsed.strftime("%Y%m%d")) for parsed in label_dates
    }]
    if isinstance(result, pd.DataFrame):
        for column in value_columns:
            values.extend(result[column].dropna().tolist())
        # stock_sse_summary 等交易所总貌接口是“指标在行、市场在列”，
        # 报告时间落在“项目”这一列的某一行，不能只看列名。
        if len(result.columns) >= 2:
            first_column = result.columns[0]
            for _, row in result.iterrows():
                label = str(row[first_column])
                if any(token in label for token in ("报告时间", "统计日期", "更新时间", "交易日期")):
                    columns.append(label)
                    values.extend(row.iloc[1:].tolist())
    elif isinstance(result, pd.Series):
        if result.name is not None and str(result.name) in columns:
            values.extend(result.dropna().tolist())
    elif isinstance(result, dict):
        values.extend(result.get(column) for column in columns if column in result)
    elif isinstance(result, (list, tuple)):
        for item in result:
            if isinstance(item, dict):
                values.extend(item.get(column) for column in columns if column in item)

    parsed_values = [parsed for value in values if (parsed := _parse_date_value(value)) is not None]
    parsed = label_dates + parsed_values
    return (max(parsed) if parsed else None), columns


def _freshness_window(iface: InterfaceInfo) -> int | None:
    # 一次性事件/累计历史统计本来就可能只有很早的日期，不能因事件发生日早而误报“过期”。
    if iface.name in {"stock_ipo_summary_cninfo", "stock_history_dividend", "stock_history_dividend_detail"}:
        return None
    category = iface.semantic_category or classify_interface(iface.name, iface.description)
    subcategory = classify_subcategory(iface.name, category)
    return FRESHNESS_WINDOWS_DAYS.get(subcategory)


def _assess_return_value(iface: InterfaceInfo, result: Any) -> None:
    """结合返回值字段和最近数据日期判定研究可用性。"""
    if not iface.available:
        iface.quality_status = QUALITY_UNAVAILABLE
        iface.quality_note = iface.error or "接口调用失败"
        return

    columns = _return_columns(result)
    iface.sample_columns = ", ".join(columns[:20])
    latest_date, date_columns = _latest_return_date(result)
    if latest_date is not None:
        iface.latest_date = latest_date.isoformat()

    if iface.rows == 0:
        iface.quality_status = QUALITY_USABLE
        iface.quality_note = "接口可调用；本次测试参数返回 0 行，未据此判定过期"
        return

    if latest_date is None:
        iface.quality_status = QUALITY_USABLE
        iface.quality_note = "接口可调用；返回值未识别到时序日期字段，仅做可调用性判断"
        return

    observed = _parse_date_value(iface.check_time) or datetime.now().date()
    age_days = (observed - latest_date).days
    window_days = _freshness_window(iface)
    if window_days is not None and age_days > window_days:
        iface.quality_status = QUALITY_EXPIRED
        iface.quality_note = (
            f"最近数据 {latest_date.isoformat()}，距检测日 {age_days} 天；"
            f"超过 {window_days} 天更新窗口（字段: {', '.join(date_columns[:3])}）"
        )
    else:
        window_text = f"，窗口 {window_days} 天" if window_days is not None else ""
        iface.quality_status = QUALITY_USABLE
        iface.quality_note = (
            f"最近数据 {latest_date.isoformat()}，距检测日 {max(age_days, 0)} 天"
            f"{window_text}（字段: {', '.join(date_columns[:3])}）"
        )


def build_call_args(func_name: str, func: Any) -> list[dict[str, Any]]:
    """为函数推断合适的测试参数组合。"""
    sig = inspect.signature(func)
    params = set(sig.parameters.keys())
    defaults = {
        parameter.name: parameter.default
        for parameter in sig.parameters.values()
        if parameter.default is not inspect.Parameter.empty
    }

    if not params:
        return [{}]

    only_kwargs = all(
        p.kind in (inspect.Parameter.VAR_KEYWORD, inspect.Parameter.VAR_POSITIONAL)
        for p in sig.parameters.values()
    )
    if only_kwargs:
        return [{}]

    combos: list[dict[str, Any]] = []
    common: dict[str, Any] = {}

    # 日期参数
    if "start_date" in params:
        common["start_date"] = TEST_START
    if "end_date" in params:
        common["end_date"] = TEST_END
    if "date" in params:
        common["date"] = TEST_DATE
    if "begin_date" in params:
        common["begin_date"] = TEST_START
    if "start_year" in params:
        common["start_year"] = "2024"
    if "end_year" in params:
        common["end_year"] = "2025"
    if "start_time" in params:
        common["start_time"] = TEST_START + "093000"
    if "end_time" in params:
        common["end_time"] = TEST_END + "150000"
    if "year" in params:
        common["year"] = "2024"
    if "quarter" in params:
        common["quarter"] = "20241"

    # 通用参数
    if "timeout" in params:
        common["timeout"] = 10
    if "adjust" in params:
        common["adjust"] = "qfq"
    if "period" in params:
        common["period"] = "daily"
    if "indicator" in params:
        default_indicator = defaults.get("indicator")
        common["indicator"] = (
            default_indicator
            if isinstance(default_indicator, str) and default_indicator.strip()
            else "分红"
        )

    # 分页参数
    if "from_page" in params:
        common["from_page"] = 1
    if "to_page" in params:
        common["to_page"] = 1

    # 市场参数
    if "market" in params:
        default_market = defaults.get("market")
        common["market"] = (
            default_market
            if isinstance(default_market, str) and default_market.strip()
            else "沪"
        )

    # symbol 参数
    need_symbol = any(p in params for p in ("symbol", "stock", "code", "security"))

    def add_symbol_combo(sym: str):
        c = dict(common)
        for p in ("symbol", "stock", "code", "security"):
            if p in params:
                default_value = defaults.get(p)
                c[p] = (
                    default_value
                    if isinstance(default_value, str) and default_value.strip()
                    else sym
                )
        combos.append(c)

    if need_symbol:
        if any(kw in func_name for kw in ["tick", "intraday", "minute", "bid_ask"]):
            add_symbol_combo(TEST_SYMBOL_SH)
        else:
            add_symbol_combo(TEST_SYMBOL)
    else:
        combos.append(dict(common))

    if not combos:
        combos = [{}]

    return combos


def test_interface(iface: InterfaceInfo) -> None:
    """测试单个接口，更新 iface 的检测结果字段。"""
    iface.check_time = time.strftime("%Y-%m-%d %H:%M:%S")

    # 检查接口是否存在于 akshare
    func = getattr(ak, iface.name, None)
    if func is None or not callable(func):
        iface.available = False
        iface.quality_status = QUALITY_UNAVAILABLE
        iface.error = f"接口 {iface.name} 在 akshare 中不存在"
        iface.quality_note = iface.error
        return

    combos = build_call_args(iface.name, func)

    best_ok = False
    best_rows = 0
    best_elapsed = 0.0
    best_result: Any = None
    errors: list[str] = []

    for args in combos:
        started = time.perf_counter()
        ok, n_rows, err, result = _call_with_args(func, args)
        elapsed = time.perf_counter() - started

        if ok:
            best_ok = True
            best_rows = max(best_rows, n_rows)
            best_elapsed = elapsed
            best_result = result
            break
        else:
            errors.append(err)
            if elapsed > TIMEOUT_PER_CALL:
                best_elapsed = elapsed
                break
            best_elapsed += elapsed

    iface.available = best_ok
    iface.rows = best_rows
    iface.elapsed = best_elapsed
    iface.error = "; ".join(errors)[:200] if errors else ""
    if best_ok:
        iface.semantic_category = classify_interface(iface.name, iface.description, best_result)
    _assess_return_value(iface, best_result)


def run_health_checks(interfaces: list[InterfaceInfo]) -> list[InterfaceInfo]:
    """对所有接口执行健康检测。"""
    total = len(interfaces)
    print(f"\n开始检测 {total} 个接口...\n")

    for i, iface in enumerate(interfaces, 1):
        test_interface(iface)
        status = iface.quality_status or (QUALITY_USABLE if iface.available else QUALITY_UNAVAILABLE)
        print(f"  [{i}/{total}] {status:4s} {iface.name} ({iface.elapsed:.1f}s)")
        if i % 20 == 0:
            usable_count = sum(1 for x in interfaces[:i] if x.quality_status == QUALITY_USABLE)
            expired_count = sum(1 for x in interfaces[:i] if x.quality_status == QUALITY_EXPIRED)
            print(f"  --- 进度: {i}/{total}, 当前可用 {usable_count}, 过期 {expired_count} ---")

    usable = sum(1 for x in interfaces if x.quality_status == QUALITY_USABLE)
    expired = sum(1 for x in interfaces if x.quality_status == QUALITY_EXPIRED)
    unavailable = total - usable - expired
    callable_count = sum(1 for x in interfaces if x.available)
    print(
        f"\n检测完成: 共 {total} 个接口, 可调用 {callable_count}, "
        f"当前可用 {usable}, 过期 {expired}, 不可用 {unavailable}"
    )
    return interfaces


# ── 输出健康检测报告 ──────────────────────────────────

def write_health_check_xlsx(
    interfaces: list[InterfaceInfo], path: Path = HEALTH_CHECK_XLSX
) -> None:
    """输出健康检测结果到 xlsx。

    输出列同时保留“接口可调用”和“研究可用性”，避免把旧数据误标为可用。
    """
    rows = []
    for iface in interfaces:
        category = iface.semantic_category or classify_interface(iface.name, iface.description)
        rows.append({
            "领域": category,
            "子类": classify_subcategory(iface.name, category),
            "接口名称": iface.name,
            "接口路径": iface.target_url,
            "检测时间": iface.check_time,
            "接口可调用": "是" if iface.available else "否",
            "可用性状态": iface.quality_status,
            "最近数据日期": iface.latest_date,
            "返回值字段": iface.sample_columns,
            "判定依据": iface.quality_note,
            "错误信息": iface.error,
            "返回行数": iface.rows,
            "耗时": f"{iface.elapsed:.1f}s",
        })

    df = pd.DataFrame(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(path, index=False, engine="openpyxl")
    print(f"\n健康检测报告已输出: {path}")


# ── 同步 akshare_stock_api.xlsx ──────────────────────

def sync_stock_api_xlsx(
    interfaces: list[InterfaceInfo], path: Path = STOCK_API_XLSX
) -> None:
    """同步更新 akshare_stock_api.xlsx。

    - 使用 classify_interface / classify_subcategory 统一分类到 7 个领域
    - 更新已有接口的可用性状态（可用 / 过期 / 不可用）
    - 补充文档中有但 xlsx 中缺失的接口
    - 删除文档中已不存在的接口
    - 按类别排序
    """
    # 读取现有 xlsx
    if path.exists():
        existing_df = pd.read_excel(path, engine="openpyxl")
        print(f"读取现有 xlsx: {len(existing_df)} 行")
    else:
        existing_df = pd.DataFrame(
            columns=["序号", "领域", "子类", "接口名称", "数据源", "接口", "目标地址", "输入参数", "可用性"]
        )
        print("现有 xlsx 不存在, 创建新文件")

    # 构建检测结果映射
    check_map = {iface.name: iface for iface in interfaces}

    # 构建现有数据映射
    existing_map: dict[str, dict] = {}
    for _, row in existing_df.iterrows():
        func_name = str(row.get("接口", "")).strip()
        if func_name:
            existing_map[func_name] = row.to_dict()

    # 合并: 保留现有数据 + 更新可用性 + 添加新接口
    result_rows: list[dict] = []
    seen: set[str] = set()

    # 1. 遍历现有数据, 更新可用性和分类
    for _, row in existing_df.iterrows():
        func_name = str(row.get("接口", "")).strip()
        if not func_name:
            continue

        if func_name in check_map:
            # 接口在文档中存在, 更新可用性和分类
            iface = check_map[func_name]
            new_row = row.to_dict()
            new_row["接口可调用"] = "是" if iface.available else "否"
            new_row["可用性"] = iface.quality_status
            new_row["最近数据日期"] = iface.latest_date
            new_row["判定依据"] = iface.quality_note
            # 使用返回值语义（若本轮调用有返回值）统一更新领域和子类
            category = iface.semantic_category or classify_interface(
                func_name, iface.description or str(row.get("接口名称", ""))
            )
            new_row.pop("类别", None)
            new_row["领域"] = category
            new_row["子类"] = classify_subcategory(func_name, category)
            # 更新目标地址和输入参数(文档中的信息更准确)
            if iface.description:
                new_row["接口名称"] = iface.description
            if iface.upstream:
                new_row["数据源"] = iface.upstream
            if iface.target_url:
                new_row["目标地址"] = iface.target_url
            if iface.input_params:
                new_row["输入参数"] = iface.input_params
            result_rows.append(new_row)
            seen.add(func_name)
        else:
            # 接口在文档中不存在, 跳过(即删除)
            print(f"  删除(文档中不存在): {func_name}")

    # 2. 添加文档中有但 xlsx 中没有的接口
    added_count = 0
    for iface in interfaces:
        if iface.name not in seen:
            result_rows.append({
                "序号": 0,
                "领域": iface.semantic_category or classify_interface(iface.name, iface.description),
                "子类": classify_subcategory(
                    iface.name, iface.semantic_category or classify_interface(iface.name, iface.description)
                ),
                "接口名称": iface.description or iface.name,
                "数据源": iface.upstream,
                "接口": iface.name,
                "目标地址": iface.target_url,
                "输入参数": iface.input_params,
                "接口可调用": "是" if iface.available else "否",
                "可用性": iface.quality_status,
                "最近数据日期": iface.latest_date,
                "判定依据": iface.quality_note,
            })
            added_count += 1
            print(f"  新增: {iface.name}")

    # 按类别排序 (按 CATEGORIES 顺序)
    cat_order = {cat: i for i, cat in enumerate(CATEGORIES)}
    result_rows.sort(
        key=lambda x: (
            cat_order.get(x.get("领域", ""), 99),
            str(x.get("子类", "")),
            str(x.get("接口", "")),
        )
    )

    # 重新编号
    for i, row in enumerate(result_rows, 1):
        row["序号"] = i

    # 写回 xlsx
    output_columns = [
        "序号", "领域", "子类", "接口名称", "数据源",
        "接口", "目标地址", "输入参数", "接口可调用", "可用性",
        "最近数据日期", "判定依据",
    ]
    result_df = pd.DataFrame(result_rows).reindex(columns=output_columns)
    result_df.to_excel(path, index=False, engine="openpyxl")

    usable = len(result_df[result_df["可用性"] == QUALITY_USABLE])
    expired = len(result_df[result_df["可用性"] == QUALITY_EXPIRED])
    unavailable = len(result_df[result_df["可用性"] == QUALITY_UNAVAILABLE])
    callable_count = len(result_df[result_df["接口可调用"] == "是"])
    print(f"\n同步完成: {path}")
    print(
        f"  共 {len(result_df)} 个接口, 可调用 {callable_count}, "
        f"当前可用 {usable}, 过期 {expired}, 不可用 {unavailable}"
    )
    print(f"  新增 {added_count} 个, 删除 {len(existing_map) - len(seen)} 个")


# ── 更新 akshare_api.md ──────────────────────────────

def update_akshare_api_md(
    interfaces: list[InterfaceInfo], path: Path = AKSHARE_API_MD
) -> None:
    """根据检测结果重新生成 akshare_api.md。

    - 使用 classify_interface / classify_subcategory 统一分类到 7 个领域
    - 按类别分章节，每类一张表格
    - Markdown 只展示当前可用接口，表格固定保留六列：序号、子类、接口名称、接口函数、数据源、输入参数
    - 统计摘要与 xlsx 保持一致
    """
    # 按类别分组
    by_cat: dict[str, list[InterfaceInfo]] = {cat: [] for cat in CATEGORIES}
    for iface in interfaces:
        cat = iface.semantic_category or classify_interface(iface.name, iface.description)
        by_cat[cat].append(iface)

    total = len(interfaces)
    callable_count = sum(1 for x in interfaces if x.available)
    usable = sum(1 for x in interfaces if x.quality_status == QUALITY_USABLE)
    expired = sum(1 for x in interfaces if x.quality_status == QUALITY_EXPIRED)
    unavailable = sum(1 for x in interfaces if x.quality_status == QUALITY_UNAVAILABLE)

    lines: list[str] = []
    lines.append("# AkShare 股票接口可用性")
    lines.append("")
    lines.append(
        f"> 接口总数:**{total}** 个  |  接口可调用:**{callable_count}** 个  "
        f"|  当前可用:**{usable}** 个  |  过期:**{expired}** 个  "
        f"|  不可用:**{unavailable}** 个"
    )
    lines.append(">")
    lines.append(
        "> 本文档由 `akshare_health_check.py` 自动生成；“接口可调用”只表示函数未抛错，"
        "“当前可用”还要求返回值未超过按子类设定的更新窗口；分类优先参考返回字段语义，"
        "再按 `1-akshare股票数据源.md` 的 7 个投资研究领域组织；下列表格仅列当前可用接口。"
    )
    lines.append(
        "> 例如 `stock_sse_summary` 返回 `项目/股票/主板/科创板/报告时间`，表示交易所市场总体情况，"
        "因此归入 `market`，不是单只股票行情。"
    )
    lines.append(">")
    lines.append("> 数据源: https://akshare.akfamily.xyz/data/stock/stock.html")
    lines.append("")
    lines.append("---")
    lines.append("")

    for cat in CATEGORIES:
        items = by_cat.get(cat, [])
        if not items:
            continue
        # 只把当前仍在更新窗口内的接口放入学习文档；可调用但过期、调用失败的接口
        # 继续保留在 xlsx 健康检测结果中，避免把“能调用”误当作“可用”。
        items = [iface for iface in items if iface.quality_status == QUALITY_USABLE]
        if not items:
            continue
        # 先按子类、再按接口名排序
        items.sort(key=lambda x: (classify_subcategory(x.name, cat), x.name))
        num = CAT_NUMBER[cat]
        lines.append(f"## {num}、{cat}")
        lines.append("")
        lines.append("| 序号 | 子类 | 接口名称 | 接口函数 | 数据源 | 输入参数 |")
        lines.append("| ---: | --- | --- | --- | --- | --- |")
        for i, iface in enumerate(items, 1):
            display_name = (iface.description or iface.name).replace("|", "/")
            subcategory = classify_subcategory(iface.name, cat)
            lines.append(
                f"| {i} | `{subcategory}` | {display_name} | `{iface.name}` | {iface.upstream} "
                f"| {iface.input_params} |"
            )
        lines.append("")

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    print(f"\nmd 重新生成完成: {path}")
    print(
        f"  共 {total} 个接口, 可调用 {callable_count}, 当前可用 {usable}, "
        f"过期 {expired}, 不可用 {unavailable}"
    )


# ── 主流程 ────────────────────────────────────────────

def main():
    """主流程: 获取文档 → 解析 → 检测 → 输出 → 同步。"""
    print("=" * 60)
    print("AkShare 股票接口健康检测")
    print("=" * 60)

    # 1. 获取文档
    html = fetch_documentation()

    # 2. 解析文档
    interfaces = parse_documentation(html)
    print(f"\n解析到 {len(interfaces)} 个接口")

    if not interfaces:
        print("未解析到任何接口, 请检查文档 URL 或 HTML 结构")
        return

    # 打印前 5 个接口作为预览
    print("\n前 5 个接口预览:")
    for iface in interfaces[:5]:
        cat = classify_interface(iface.name, iface.description)
        print(f"  {iface.name} | {cat} | {iface.target_url[:50]}")

    # 3. 执行健康检测
    run_health_checks(interfaces)

    # 4. 输出健康检测报告
    write_health_check_xlsx(interfaces)

    # 5. 同步 akshare_stock_api.xlsx
    print("\n" + "-" * 40)
    print("同步 akshare_stock_api.xlsx")
    print("-" * 40)
    sync_stock_api_xlsx(interfaces)

    # 6. 更新 akshare_api.md
    print("\n" + "-" * 40)
    print("更新 akshare_api.md")
    print("-" * 40)
    update_akshare_api_md(interfaces)

    print("\n" + "=" * 60)
    print("全部完成!")
    print("=" * 60)


if __name__ == "__main__":
    main()
