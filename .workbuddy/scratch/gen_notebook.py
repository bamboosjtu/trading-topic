"""Generate labs/akshare_tutorial.ipynb with mind map + 10 category sections."""
import json

def md_cell(source):
    """Create a markdown cell."""
    if isinstance(source, str):
        source = source.split("\n")
        source = [s + "\n" for s in source[:-1]] + [source[-1]] if source else []
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": source if isinstance(source, list) else [source],
    }

def code_cell(source):
    """Create a code cell."""
    if isinstance(source, str):
        lines = source.split("\n")
        source = [s + "\n" for s in lines[:-1]] + [lines[-1]] if lines else []
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source if isinstance(source, list) else [source],
    }

cells = []

# ===== Title =====
cells.append(md_cell(
    "# AkShare 股票数据接口教程\n"
    "\n"
    "> 基于 AkShare 1.18.78，覆盖 **134 个实测可用接口**，按投资研究工作流分为 **10 大类**。\n"
    ">\n"
    "> 本教程配套文档：`docs/tutorial/akshare.md`、`docs/tutorial/akshare_api_classification.md`\n"
    "\n"
    "---"
))

# ===== Mind Map =====
cells.append(md_cell("## 思维导图"))
cells.append(code_cell(
    "# 画出 AkShare 股票接口 10 大分类思维导图\n"
    "import matplotlib.pyplot as plt\n"
    "import matplotlib.patches as mpatches\n"
    "import numpy as np\n"
    "\n"
    "plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial Unicode MS']\n"
    "plt.rcParams['axes.unicode_minus'] = False\n"
    "\n"
    "categories = [\n"
    "    ('1. 市场总览与统计', 6, '#E8F0FE'),\n"
    "    ('2. 标的列表与基础信息', 10, '#FCE8E8'),\n"
    "    ('3. 行情数据', 11, '#FEF7E0'),\n"
    "    ('4. 财务与估值', 9, '#E6F4EA'),\n"
    "    ('5. 股东与股本变动', 12, '#F3E8FD'),\n"
    "    ('6. 资金与筹码', 35, '#E0F7FA'),\n"
    "    ('7. IPO与资本运作', 26, '#FFF3E0'),\n"
    "    ('8. 机构与研究', 7, '#F1F8E9'),\n"
    "    ('9. 公告与事件异动', 12, '#FCE4EC'),\n"
    "    ('10. 市场情绪/互动/ESG', 6, '#EDE7F6'),\n"
    "]\n"
    "\n"
    "fig, ax = plt.subplots(figsize=(16, 10))\n"
    "ax.set_xlim(-1, 21)\n"
    "ax.set_ylim(-6, 6)\n"
    "ax.axis('off')\n"
    "\n"
    "# Center node\n"
    "center = (0, 0)\n"
    "circle = plt.Circle(center, 1.2, color='#305496', zorder=5)\n"
    "ax.add_patch(circle)\n"
    "ax.text(0, 0, 'AkShare\\n股票接口\\n134个可用', ha='center', va='center',\n"
    "        fontsize=11, fontweight='bold', color='white', zorder=6)\n"
    "\n"
    "# Left side: categories 1-5\n"
    "# Right side: categories 6-10\n"
    "n = len(categories)\n"
    "half = n // 2\n"
    "for i, (name, count, color) in enumerate(categories):\n"
    "    if i < half:\n"
    "        # Left side\n"
    "        angle = np.pi - (np.pi / (half + 1)) * (i + 1)\n"
    "        x = 8 * np.cos(angle)\n"
    "        y = 5.5 * np.sin(angle)\n"
    "        tx = x - 2.5\n"
    "        ha = 'right'\n"
    "    else:\n"
    "        # Right side\n"
    "        j = i - half\n"
    "        angle = (np.pi / (n - half + 1)) * (j + 1)\n"
    "        x = 8 * np.cos(angle)\n"
    "        y = 5.5 * np.sin(angle)\n"
    "        tx = x + 2.5\n"
    "        ha = 'left'\n"
    "\n"
    "    # Draw connecting line\n"
    "    ax.annotate('', xy=(x * 0.75, y * 0.75), xytext=(0, 0),\n"
    "                arrowprops=dict(arrowstyle='-', color='#999', lw=1.5))\n"
    "\n"
    "    # Draw category box\n"
    "    box = mpatches.FancyBboxPatch((x - 2.2 if x < 0 else x - 0.3, y - 0.35),\n"
    "                                   2.5, 0.7, boxstyle='round,pad=0.15',\n"
    "                                   facecolor=color, edgecolor='#666', linewidth=0.8)\n"
    "    ax.add_patch(box)\n"
    "    ax.text(x + 0.95 if x < 0 else x + 0.95, y, f'{name}\\n({count}个)',\n"
    "            ha='center', va='center', fontsize=8.5, fontweight='bold')\n"
    "\n"
    "ax.set_title('AkShare 股票数据接口分类思维导图', fontsize=16, fontweight='bold',\n"
    "             color='#305496', pad=20)\n"
    "plt.tight_layout()\n"
    "plt.savefig('akshare_mindmap.png', dpi=150, bbox_inches='tight')\n"
    "plt.show()\n"
    "print('思维导图已保存为 akshare_mindmap.png')"
))

# ===== 0. 概述 =====
cells.append(md_cell(
    "---\n"
    "## 0. 概述\n"
    "\n"
    "### 什么是 AkShare\n"
    "\n"
    "AkShare 是一个开源免费的 Python 金融数据接口库，把东方财富、新浪财经、同花顺、交易所官网等数十个数据源统一封装，安装即用，无需 Token。\n"
    "\n"
    "### 安装与验证\n"
    "\n"
    "```bash\n"
    "pip install akshare --upgrade\n"
    "```"
))
cells.append(code_cell(
    "# 禁用 tqdm 进度条，避免未安装 ipywidgets 时报错\n"
    "# 如需进度条可注释掉下一行，或安装：pip install ipywidgets\n"
    'import os\n'
    'os.environ["TQDM_DISABLE"] = "1"\n'
    "\n"
    "# 如需运行思维导图，请先安装 matplotlib：pip install matplotlib\n"
    "%matplotlib inline\n"
    "import akshare as ak\n"
    "import pandas as pd\n"
    "\n"
    "print('AkShare 版本:', ak.__version__)\n"
    "print('可用接口数量:', len(dir(ak)))"
))

cells.append(md_cell(
    "### 核心约定\n"
    "\n"
    "| 参数 | 含义 | 常见取值 |\n"
    "| --- | --- | --- |\n"
    "| `symbol` | 标的代码 | 东财 `'600000'`、新浪 `'sh600000'`、雪球 `'SH600000'` |\n"
    "| `date` | 日期 | `'20241108'`（YYYYMMDD 字符串） |\n"
    "| `period` | 周期 | `'daily'` / `'weekly'` / `'monthly'` |\n"
    "| `adjust` | 复权 | `''` 不复权、`'qfq'` 前复权、`'hfq'` 后复权 |\n"
    "\n"
    "> **命名规律**：`类别_市场_数据类型_源`，如 `stock_zh_a_hist_em` = 股票·A股·历史K线·东方财富"
))

# ===== Helper: category section =====
def add_category(num, title, desc, code, table):
    cells.append(md_cell(f"---\n## {num}. {title}\n\n{desc}"))
    cells.append(code_cell(code))
    cells.append(md_cell(f"**可用接口汇总**\n\n{table}"))

# ===== 1. 市场总览与统计 =====
add_category(1, "市场总览与统计",
    "获取市场层面的宏观数据：交易所总貌、每日成交概况、账户开户统计。适合做市场温度计和宏观择时参考。\n\n**可用接口：6 个**",
    "# 1. 上交所股票市场总貌（单次返回最近交易日）\n"
    "df = ak.stock_sse_summary()\n"
    "print('上交所总貌:', df.shape)\n"
    "df.head()",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_sse_summary` | 上海证券交易所 | null |\n"
    "| `stock_szse_summary` | 深圳证券交易所 | date |\n"
    "| `stock_szse_area_summary` | 深圳证券交易所 | date |\n"
    "| `stock_sse_deal_daily` | 上海证券交易所 | date |\n"
    "| `stock_account_statistics_em` | 东方财富 | null |\n"
    "| `stock_market_activity_legu` | 乐估乐股 | null |"
)

# ===== 2. 标的列表与基础信息 =====
add_category(2, "标的列表与基础信息",
    "获取全市场股票代码表、个股基础信息、行业分类。这是所有分析的起点——先拿到代码表，再逐个深入。\n\n**可用接口：10 个**",
    "# 1. 全 A 股代码与简称列表（最常用）\n"
    "df = ak.stock_info_a_code_name()\n"
    "print('全A股数量:', len(df))\n"
    "print(df.head())\n"
    "\n"
    "# 2. 公司概况（巨潮资讯）\n"
    "df_profile = ak.stock_profile_cninfo(symbol='600000')\n"
    "print('\\n浦发银行公司概况:')\n"
    "df_profile.head()",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_info_a_code_name` | 其他 | null |\n"
    "| `stock_info_bj_name_code` | 北京证券交易所 | null |\n"
    "| `stock_zh_ah_name` | 腾讯 | null |\n"
    "| `stock_individual_basic_info_xq` | 雪球 | symbol, token, timeout |\n"
    "| `stock_individual_basic_info_hk_xq` | 雪球 | symbol, token, timeout |\n"
    "| `stock_profile_cninfo` | 巨潮资讯 | symbol |\n"
    "| `stock_ipo_summary_cninfo` | 巨潮资讯 | symbol |\n"
    "| `stock_info_change_name` | 新浪财经 | symbol |\n"
    "| `stock_industry_change_cninfo` | 巨潮资讯 | symbol, start_date, end_date |\n"
    "| `stock_board_industry_summary_ths` | 同花顺 | null |"
)

# ===== 3. 行情数据 =====
add_category(3, "行情数据",
    "实时行情、历史 K 线、分时数据。使用频率最高的一类接口。注意不同数据源对 `symbol` 格式要求不同。\n\n**可用接口：11 个**",
    "# 1. A股历史日K线（新浪，symbol需带前缀）\n"
    "df = ak.stock_zh_a_daily(\n"
    "    symbol='sh600000',\n"
    "    start_date='20240101',\n"
    "    end_date='20241108',\n"
    "    adjust='qfq'  # 前复权\n"
    ")\n"
    "print('历史K线:', df.shape)\n"
    "print(df.tail())\n"
    "\n"
    "# 2. 港股实时行情（新浪）\n"
    "df_hk = ak.stock_hk_spot()\n"
    "print('\\n港股实时行情:', df_hk.shape)\n"
    "df_hk.head(3)",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_zh_a_daily` | 新浪财经 | symbol, start_date, end_date, adjust |\n"
    "| `stock_zh_a_hist_tx` | 腾讯 | symbol, start_date, end_date, adjust, timeout |\n"
    "| `stock_zh_a_cdr_daily` | 新浪财经 | symbol, start_date, end_date |\n"
    "| `stock_zh_a_new` | 新浪财经 | null |\n"
    "| `stock_zh_kcb_spot` | 新浪财经 | null |\n"
    "| `stock_zh_kcb_daily` | 新浪财经 | symbol, adjust |\n"
    "| `stock_zh_kcb_report_em` | 东方财富 | from_page, to_page |\n"
    "| `stock_zh_b_spot` | 新浪财经 | null |\n"
    "| `stock_individual_spot_xq` | 雪球 | symbol, token, timeout |\n"
    "| `stock_zh_ah_spot` | 腾讯 | null |\n"
    "| `stock_hk_spot` | 新浪财经 | null |"
)

# ===== 4. 财务与估值 =====
add_category(4, "财务与估值",
    "三大报表、财务指标、估值数据和商誉信息。基本面研究的核心数据来源。\n\n**可用接口：9 个**\n\n> 东财三大报表（`stock_zcfz_em` 等）不可用，改用同花顺源。",
    "# 1. 同花顺资产负债表\n"
    "df = ak.stock_financial_debt_new_ths(symbol='600000', indicator='按报告期')\n"
    "print('资产负债表:', df.shape)\n"
    "print(df.columns.tolist())\n"
    "df.head(3)\n"
    "\n"
    "# 2. 关键财务指标摘要（新浪）\n"
    "df_abs = ak.stock_financial_abstract(symbol='sh600000')\n"
    "print('\\n关键指标:', df_abs.shape)\n"
    "\n"
    "# 3. A股估值指标（百度股市通）\n"
    "df_val = ak.stock_zh_valuation_baidu(symbol='600000', indicator='总市值', period='全部')\n"
    "print('\\n估值指标:', df_val.shape)\n"
    "df_val.tail()",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_financial_debt_new_ths` | 同花顺 | symbol, indicator |\n"
    "| `stock_financial_benefit_new_ths` | 同花顺 | symbol, indicator |\n"
    "| `stock_financial_cash_new_ths` | 同花顺 | symbol, indicator |\n"
    "| `stock_financial_abstract` | 新浪财经 | symbol |\n"
    "| `stock_financial_abstract_new_ths` | 同花顺 | symbol, indicator |\n"
    "| `stock_financial_analysis_indicator` | 新浪财经 | symbol, start_year |\n"
    "| `stock_zh_valuation_baidu` | 百度股市通 | symbol, indicator, period |\n"
    "| `stock_value_em` | 东方财富 | symbol |\n"
    "| `stock_sy_profile_em` | 东方财富 | null |"
)

# ===== 5. 股东与股本变动 =====
add_category(5, "股东与股本变动",
    "十大股东、股东户数、高管持股变动、股本结构等。用于跟踪筹码集中度和内部人交易信号。\n\n**可用接口：12 个**",
    "# 1. 股东持股变动统计-十大流通股东（按日期）\n"
    "df = ak.stock_gdfx_free_holding_change_em(date='20240930')\n"
    "print('十大流通股东变动:', df.shape)\n"
    "df.head(3)\n"
    "\n"
    "# 2. 股东户数详情（按个股）\n"
    "df_gdhs = ak.stock_zh_a_gdhs_detail_em(symbol='600000')\n"
    "print('\\n股东户数:', df_gdhs.shape)\n"
    "\n"
    "# 3. 流通股东（新浪）\n"
    "df_holder = ak.stock_circulate_stock_holder(symbol='sh600000')\n"
    "print('\\n流通股东:')\n"
    "df_holder.head()",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_gdfx_free_holding_change_em` | 东方财富 | date |\n"
    "| `stock_shareholder_change_ths` | 同花顺 | symbol |\n"
    "| `stock_gdfx_free_holding_analyse_em` | 东方财富 | date |\n"
    "| `stock_gdfx_holding_analyse_em` | 东方财富 | date |\n"
    "| `stock_gdfx_free_holding_detail_em` | 东方财富 | date |\n"
    "| `stock_zh_a_gdhs_detail_em` | 东方财富 | symbol |\n"
    "| `stock_management_change_ths` | 同花顺 | symbol |\n"
    "| `stock_share_hold_change_sse` | 上海证券交易所 | symbol |\n"
    "| `stock_share_change_cninfo` | 巨潮资讯 | symbol, start_date, end_date |\n"
    "| `stock_zh_a_gbjg_em` | 东方财富 | symbol |\n"
    "| `stock_circulate_stock_holder` | 新浪财经 | symbol |\n"
    "| `stock_main_stock_holder` | 新浪财经 | stock |"
)

# ===== 6. 资金与筹码 =====
cells.append(md_cell(
    "---\n"
    "## 6. 资金与筹码\n"
    "\n"
    "接口最多的大类（**35 个可用**），涵盖资金流向、沪深港通持股、融资融券、龙虎榜、大宗交易、股权质押、主力控盘。是跟踪聪明钱和筹码分布的核心数据。"
))
cells.append(code_cell(
    "# === 沪深港通 ===\n"
    "# 1. 沪深港通持股-个股（东财）\n"
    "df = ak.stock_hsgt_individual_em(symbol='600000')\n"
    "print('沪深港通持股:', df.shape)\n"
    "df.tail()\n"
    "\n"
    "# 2. 沪深港通持股-个股详情（带日期范围）\n"
    "df_detail = ak.stock_hsgt_individual_detail_em(\n"
    "    symbol='600000', start_date='20240101', end_date='20241108'\n"
    ")\n"
    "print('\\n持股详情:', df_detail.shape)"
))
cells.append(code_cell(
    "# === 融资融券 ===\n"
    "# 3. 上交所融资融券汇总\n"
    "df_margin = ak.stock_margin_sse(start_date='20241101', end_date='20241108')\n"
    "print('融资融券汇总:', df_margin.shape)\n"
    "df_margin\n"
    "\n"
    "# 4. 两融账户信息\n"
    "df_account = ak.stock_margin_account_info()\n"
    "print('\\n两融账户:', df_account.shape)"
))
cells.append(code_cell(
    "# === 龙虎榜 ===\n"
    "# 5. 龙虎榜明细（东财）\n"
    "df_lhb = ak.stock_lhb_detail_em(start_date='20241104', end_date='20241108')\n"
    "print('龙虎榜明细:', df_lhb.shape)\n"
    "df_lhb.head()\n"
    "\n"
    "# 6. 龙虎榜机构买卖统计\n"
    "df_jg = ak.stock_lhb_jgmmtj_em(start_date='20241104', end_date='20241108')\n"
    "print('\\n机构买卖统计:', df_jg.shape)"
))
cells.append(code_cell(
    "# === 股权质押 + 主力控盘 ===\n"
    "# 7. 股权质押市场概况\n"
    "df_gpzy = ak.stock_gpzy_profile_em()\n"
    "print('股权质押概况:', df_gpzy.shape)\n"
    "\n"
    "# 8. 主力控盘-机构参与度\n"
    "df_zlkp = ak.stock_comment_detail_zlkp_jgcyd_em(symbol='600000')\n"
    "print('\\n机构参与度:', df_zlkp.shape)\n"
    "df_zlkp.tail()"
))
cells.append(md_cell(
    "**可用接口汇总**（35 个，按子类）\n"
    "\n"
    "| 子类 | 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- | --- |\n"
    "| 资金流 | `stock_fund_flow_big_deal` | 同花顺 | null |\n"
    "| 沪深港通 | `stock_hsgt_fund_flow_summary_em` | 东方财富 | null |\n"
    "| 沪深港通 | `stock_hsgt_fund_min_em` | 东方财富 | symbol |\n"
    "| 沪深港通 | `stock_hsgt_individual_em` | 东方财富 | symbol |\n"
    "| 沪深港通 | `stock_hsgt_individual_detail_em` | 东方财富 | symbol, start_date, end_date |\n"
    "| 沪深港通 | `stock_sgt_settlement_exchange_rate_sse` | 上海证券交易所 | null |\n"
    "| 沪深港通 | `stock_sgt_reference_exchange_rate_sse` | 上海证券交易所 | null |\n"
    "| 融资融券 | `stock_margin_account_info` | 东方财富 | null |\n"
    "| 融资融券 | `stock_margin_sse` | 上海证券交易所 | start_date, end_date |\n"
    "| 融资融券 | `stock_margin_detail_sse` | 上海证券交易所 | date |\n"
    "| 融资融券 | `stock_margin_szse` | 深圳证券交易所 | date |\n"
    "| 融资融券 | `stock_margin_detail_szse` | 深圳证券交易所 | date |\n"
    "| 融资融券 | `stock_margin_underlying_info_szse` | 深圳证券交易所 | date |\n"
    "| 融资融券 | `stock_margin_bse` | 北京证券交易所 | date |\n"
    "| 融资融券 | `stock_margin_detail_bse` | 北京证券交易所 | date |\n"
    "| 融资融券 | `stock_margin_underlying_info_bse` | 北京证券交易所 | date |\n"
    "| 龙虎榜 | `stock_lhb_detail_em` | 东方财富 | start_date, end_date |\n"
    "| 龙虎榜 | `stock_lhb_jgmmtj_em` | 东方财富 | start_date, end_date |\n"
    "| 龙虎榜 | `stock_lh_yyb_most` | 同花顺 | null |\n"
    "| 龙虎榜 | `stock_lh_yyb_capital` | 同花顺 | null |\n"
    "| 龙虎榜 | `stock_lh_yyb_control` | 同花顺 | null |\n"
    "| 龙虎榜 | `stock_lhb_detail_daily_sina` | 新浪财经 | date |\n"
    "| 龙虎榜 | `stock_lhb_jgzz_sina` | 新浪财经 | symbol |\n"
    "| 龙虎榜 | `stock_lhb_jgmx_sina` | 新浪财经 | null |\n"
    "| 大宗交易 | `stock_dzjy_sctj` | 东方财富 | null |\n"
    "| 大宗交易 | `stock_dzjy_mrtj` | 东方财富 | start_date, end_date |\n"
    "| 股权质押 | `stock_gpzy_profile_em` | 东方财富 | null |\n"
    "| 股权质押 | `stock_gpzy_pledge_ratio_em` | 东方财富 | date |\n"
    "| 股权质押 | `stock_gpzy_individual_pledge_ratio_detail_em` | 东方财富 | symbol |\n"
    "| 股权质押 | `stock_gpzy_industry_data_em` | 东方财富 | null |\n"
    "| 股权质押 | `stock_cg_equity_mortgage_cninfo` | 巨潮资讯 | date |\n"
    "| 主力控盘 | `stock_comment_detail_zlkp_jgcyd_em` | 东方财富 | symbol |\n"
    "| 主力控盘 | `stock_comment_detail_zhpj_lspf_em` | 东方财富 | symbol |\n"
    "| 主力控盘 | `stock_comment_detail_scrd_focus_em` | 东方财富 | symbol |\n"
    "| 主力控盘 | `stock_comment_detail_scrd_desire_em` | 东方财富 | symbol |"
))

# ===== 7. IPO与资本运作 =====
cells.append(md_cell(
    "---\n"
    "## 7. IPO 与资本运作\n"
    "\n"
    "可用率最高的大类（26/36 ≈ 72%），涵盖新股发行、IPO 审核、增发配股回购、限售解禁、分红派息、股东大会。适合做事件驱动和打新策略研究。"
))
cells.append(code_cell(
    "# === IPO 审核 ===\n"
    "# 1. 新股上会信息\n"
    "df = ak.stock_ipo_review_em()\n"
    "print('新股上会:', df.shape)\n"
    "df.head(3)\n"
    "\n"
    "# 2. IPO审核信息-全部\n"
    "df_reg = ak.stock_register_all_em()\n"
    "print('\\nIPO审核:', df_reg.shape)"
))
cells.append(code_cell(
    "# === 增发/回购 + 解禁 + 分红 ===\n"
    "# 3. 股票回购数据\n"
    "df_repurchase = ak.stock_repurchase_em()\n"
    "print('股票回购:', df_repurchase.shape)\n"
    "\n"
    "# 4. 限售股解禁详情\n"
    "df_release = ak.stock_restricted_release_detail_em(start_date='20241101', end_date='20241130')\n"
    "print('\\n限售解禁:', df_release.shape)\n"
    "\n"
    "# 5. 分红配送详情\n"
    "df_div = ak.stock_fhps_detail_em(symbol='600000')\n"
    "print('\\n分红配送:', df_div.shape)\n"
    "df_div.head()"
))
cells.append(md_cell(
    "**可用接口汇总**（26 个）\n"
    "\n"
    "| 子类 | 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- | --- |\n"
    "| 新股发行 | `stock_dxsyl_em` | 东方财富 | null |\n"
    "| 新股发行 | `stock_ipo_hk_ths` | 同花顺 | null |\n"
    "| 新股发行 | `stock_ipo_info` | 新浪财经 | stock |\n"
    "| 新股发行 | `stock_new_ipo_cninfo` | 巨潮资讯 | null |\n"
    "| IPO审核 | `stock_ipo_review_em` | 东方财富 | null |\n"
    "| IPO审核 | `stock_ipo_tutor_em` | 东方财富 | null |\n"
    "| IPO审核 | `stock_ipo_declare_em` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_all_em` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_kcb` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_cyb` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_sh` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_sz` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_bj` | 东方财富 | null |\n"
    "| IPO审核 | `stock_register_db` | 东方财富 | null |\n"
    "| 增发/回购 | `stock_add_stock` | 新浪财经 | symbol |\n"
    "| 增发/回购 | `stock_qbzf_em` | 东方财富 | null |\n"
    "| 增发/回购 | `stock_pg_em` | 东方财富 | null |\n"
    "| 增发/回购 | `stock_repurchase_em` | 东方财富 | null |\n"
    "| 限售解禁 | `stock_restricted_release_queue_sina` | 新浪财经 | symbol |\n"
    "| 限售解禁 | `stock_restricted_release_detail_em` | 东方财富 | start_date, end_date |\n"
    "| 限售解禁 | `stock_restricted_release_queue_em` | 东方财富 | symbol |\n"
    "| 分红 | `stock_fhps_detail_em` | 东方财富 | symbol |\n"
    "| 分红 | `stock_fhps_detail_ths` | 同花顺 | symbol |\n"
    "| 分红 | `stock_history_dividend` | 新浪财经 | null |\n"
    "| 分红 | `stock_dividend_cninfo` | 巨潮资讯 | symbol |\n"
    "| 股东大会 | `stock_gddh_em` | 东方财富 | null |"
))

# ===== 8. 机构与研究 =====
add_category(8, "机构与研究",
    "机构调研、机构持股、分析师排行、个股研报。用于跟踪机构观点和聪明钱动向。\n\n**可用接口：7 个**",
    "# 1. 机构调研统计（东财，按日期）\n"
    "df = ak.stock_jgdy_tj_em(date='20241108')\n"
    "print('机构调研:', df.shape)\n"
    "df.head(3)\n"
    "\n"
    "# 2. 个股研报（东财）\n"
    "df_report = ak.stock_research_report_em(symbol='600000')\n"
    "print('\\n个股研报:', df_report.shape)\n"
    "df_report.head(3)\n"
    "\n"
    "# 3. 分析师指数排行\n"
    "df_analyst = ak.stock_analyst_rank_em(year='2024')\n"
    "print('\\n分析师排行:', df_analyst.shape)",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_jgdy_tj_em` | 东方财富 | date |\n"
    "| `stock_zyjs_ths` | 同花顺 | symbol |\n"
    "| `stock_fund_stock_holder` | 新浪财经 | symbol |\n"
    "| `stock_research_report_em` | 东方财富 | symbol |\n"
    "| `stock_analyst_rank_em` | 东方财富 | year |\n"
    "| `stock_comment_em` | 东方财富 | null |\n"
    "| `stock_rank_forecast_cninfo` | 巨潮资讯 | date |"
)

# ===== 9. 公告与事件异动 =====
add_category(9, "公告与事件异动",
    "停复牌通知、异动股池、技术形态选股、重大合同、内部交易、险资举牌。适合做事件驱动和异动监控。\n\n**可用接口：12 个**",
    "# 1. 停复牌通知（东财）\n"
    "df = ak.stock_tfp_em(date='20241108')\n"
    "print('停复牌:', df.shape)\n"
    "df.head()\n"
    "\n"
    "# 2. 技术形态选股-持续放量\n"
    "df_cxfl = ak.stock_rank_cxfl_ths()\n"
    "print('\\n持续放量:', df_cxfl.shape)\n"
    "\n"
    "# 3. 险资举牌\n"
    "df_xzjp = ak.stock_rank_xzjp_ths()\n"
    "print('\\n险资举牌:', df_xzjp.shape)",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_tfp_em` | 东方财富 | date |\n"
    "| `news_trade_notify_suspend_baidu` | 百度股市通 | date |\n"
    "| `news_trade_notify_dividend_baidu` | 百度股市通 | date, cookie |\n"
    "| `stock_board_change_em` | 东方财富 | null |\n"
    "| `stock_zdhtmx_em` | 东方财富 | start_date, end_date |\n"
    "| `stock_gsrl_gsdt_em` | 东方财富 | date |\n"
    "| `stock_rank_cxfl_ths` | 同花顺 | null |\n"
    "| `stock_rank_cxsl_ths` | 同花顺 | null |\n"
    "| `stock_rank_ljqs_ths` | 同花顺 | null |\n"
    "| `stock_rank_xzjp_ths` | 同花顺 | null |\n"
    "| `stock_inner_trade_xq` | 雪球 | null |\n"
    "| `news_report_time_baidu` | 百度股市通 | date |"
)

# ===== 10. 市场情绪、互动与ESG =====
add_category(10, "市场情绪、互动与 ESG",
    "股票热度排名、新闻资讯、ESG 评级。适合做情绪因子和舆情分析。\n\n**可用接口：6 个**",
    "# 1. 个股人气榜-最新排名（东财）\n"
    "df = ak.stock_hot_rank_latest_em(symbol='600000')\n"
    "print('人气榜:', df.shape)\n"
    "df.head()\n"
    "\n"
    "# 2. 个股新闻（东财）\n"
    "df_news = ak.stock_news_em(symbol='600000')\n"
    "print('\\n个股新闻:', df_news.shape)\n"
    "df_news.head(3)\n"
    "\n"
    "# 3. ESG评级-华证指数\n"
    "df_esg = ak.stock_esg_hz_sina()\n"
    "print('\\nESG评级:', df_esg.shape)\n"
    "df_esg.head(3)",
    "| 接口 | 数据源 | 参数 |\n"
    "| --- | --- | --- |\n"
    "| `stock_hot_rank_latest_em` | 东方财富 | symbol |\n"
    "| `stock_hk_hot_rank_latest_em` | 东方财富 | symbol |\n"
    "| `stock_news_em` | 东方财富 | symbol |\n"
    "| `stock_news_main_cx` | 财新 | null |\n"
    "| `stock_esg_rft_sina` | 新浪财经 | null |\n"
    "| `stock_esg_hz_sina` | 新浪财经 | null |"
)

# ===== Summary =====
cells.append(md_cell(
    "---\n"
    "## 总结\n"
    "\n"
    "### 接口选择策略\n"
    "\n"
    "1. **优先选可用接口**：本教程列出的 134 个接口均经过实测验证\n"
    "2. **多源互备**：同一主题在多个数据源下有覆盖，源 A 不可用时切到源 B\n"
    "3. **注意 symbol 格式**：东财 `'600000'`，新浪 `'sh600000'`，雪球 `'SH600000'`\n"
    "4. **日期格式统一**：`date` / `start_date` / `end_date` 均为 `'YYYYMMDD'` 字符串\n"
    "\n"
    "### 进一步学习\n"
    "\n"
    "- 完整文档：`docs/tutorial/akshare.md`\n"
    "- 分类总览：`docs/tutorial/akshare_api_classification.md`\n"
    "- 可用接口清单：`akshare.api.xlsx`\n"
    "- AkShare 官方文档：https://akshare.akfamily.xyz"
))

# ===== Build notebook =====
notebook = {
    "cells": cells,
    "metadata": {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3"
        },
        "language_info": {
            "name": "python",
            "version": "3.13.0"
        }
    },
    "nbformat": 4,
    "nbformat_minor": 5
}

OUT_PATH = r"C:\Users\theTruth\Documents\projects\vibe-working\trading-topic\labs\akshare_tutorial.ipynb"
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(notebook, f, ensure_ascii=False, indent=1)

print(f"Notebook saved: {OUT_PATH}")
print(f"Total cells: {len(cells)}")
md_count = sum(1 for c in cells if c["cell_type"] == "markdown")
code_count = sum(1 for c in cells if c["cell_type"] == "code")
print(f"  Markdown cells: {md_count}")
print(f"  Code cells: {code_count}")
