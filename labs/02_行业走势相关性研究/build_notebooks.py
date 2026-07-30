from __future__ import annotations

import sys
from pathlib import Path
from textwrap import dedent

import nbformat as nbf


LAB_DIR = Path(__file__).resolve().parent


def md(text: str):
    return nbf.v4.new_markdown_cell(dedent(text).strip() + "\n")


def code(text: str):
    return nbf.v4.new_code_cell(dedent(text).strip() + "\n")


def write_notebook(name: str, cells: list) -> None:
    notebook = nbf.v4.new_notebook(
        cells=cells,
        metadata={
            "kernelspec": {
                "display_name": "Python 3 (ipykernel)",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3.12"},
        },
    )
    nbf.write(notebook, LAB_DIR / name)


classification_cells = [
    md(
        """
        # Lab 02-1：股票与 ETF 标的行业分类

        **实验目标**：形成可复查的 A 股行业分类与 ETF 行业初筛流程，为后续行业市值排名和
        走势相关性研究提供输入。

        数据截止日为 **2026-07-29（最后完整交易日）**。本 Notebook 不使用 2026-07-30
        盘中价格作为市值排名依据。
        """
    ),
    md(
        """
        ## 口径与数据路由

        | 对象 | 主分类依据 | 行情/市值 | 校验与边界 |
        | --- | --- | --- | --- |
        | A 股 | 申万一级行业指数当前成分 | 腾讯财经实时行情 | 总市值按昨收回推至截止日；深交所官方行业仅作跨分类体系对照 |
        | ETF | 东财 ETF 清单与基金类型 | 东财/同花顺 ETF 清单互查 | 名称关键词只是初筛；权威结论仍需基金合同、招募说明书或跟踪指数说明 |

        申万一级行业是一套互斥的投资研究分类；交易所行业是监管口径，两者粒度不同，
        不应要求名称逐字一致。ETF 是基金产品，不天然等于上市公司的“所属行业”：
        宽基、策略、债券、商品、跨境 ETF 应标为非行业 ETF。
        """
    ),
    code(
        """
        import json
        import math
        import time
        import urllib.request
        from pathlib import Path

        import akshare as ak
        import numpy as np
        import pandas as pd
        from IPython.display import display

        pd.set_option("display.max_columns", 50)
        pd.set_option("display.width", 160)

        WORKING_DIR = Path.cwd().resolve()
        LAB_DIR = next(
            (
                p
                for p in [WORKING_DIR, *WORKING_DIR.parents]
                if p.name == "02_行业走势相关性研究"
            ),
            None,
        )
        if LAB_DIR is None:
            candidate = WORKING_DIR / "labs" / "02_行业走势相关性研究"
            if candidate.is_dir():
                LAB_DIR = candidate
        if LAB_DIR is None:
            raise FileNotFoundError("请从仓库根目录或 labs/02_行业走势相关性研究 运行")

        DATA_DIR = LAB_DIR / "data"
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        SNAPSHOT_DATE = pd.Timestamp("2026-07-29")
        RUN_DATE = pd.Timestamp.now(tz="Asia/Shanghai")
        print("AKShare:", ak.__version__)
        print("运行时间:", RUN_DATE)
        print("市值快照截止日:", SNAPSHOT_DATE.date())
        """
    ),
    code(
        """
        def normalize_code(value) -> str:
            text = str(value).strip()
            if text.endswith(".0"):
                text = text[:-2]
            return text.zfill(6)


        def tencent_quote(codes: list[str], batch_size: int = 80) -> pd.DataFrame:
            \"\"\"批量获取腾讯行情；串行小批次，返回当前价、昨收与总市值。\"\"\"
            rows = []
            for start in range(0, len(codes), batch_size):
                batch = codes[start : start + batch_size]
                prefixed = [
                    ("sh" if c.startswith(("6", "9")) else "bj" if c.startswith("8") else "sz") + c
                    for c in batch
                ]
                url = "https://qt.gtimg.cn/q=" + ",".join(prefixed)
                last_error = None
                for attempt in range(3):
                    try:
                        request = urllib.request.Request(
                            url, headers={"User-Agent": "Mozilla/5.0"}
                        )
                        with urllib.request.urlopen(request, timeout=20) as response:
                            payload = response.read().decode("gbk", errors="replace")
                        break
                    except Exception as exc:
                        last_error = exc
                        time.sleep(1.0 * (attempt + 1))
                else:
                    raise RuntimeError(f"腾讯行情批次获取失败: {last_error}")

                for line in payload.strip().split(";"):
                    if "=" not in line or '"' not in line:
                        continue
                    key = line.split("=", 1)[0].split("_")[-1]
                    values = line.split('"')[1].split("~")
                    if len(values) < 46:
                        continue
                    def number(index: int) -> float:
                        try:
                            return float(values[index]) if values[index] else np.nan
                        except (ValueError, IndexError):
                            return np.nan
                    rows.append(
                        {
                            "symbol": key[2:],
                            "quote_name": values[1],
                            "price": number(3),
                            "last_close": number(4),
                            "mcap_current_yi": number(44),
                            "float_mcap_current_yi": number(45),
                        }
                    )
                time.sleep(0.05)
            frame = pd.DataFrame(rows).drop_duplicates("symbol", keep="last")
            return frame


        def safe_to_parquet(frame: pd.DataFrame, path: Path) -> None:
            frame.to_parquet(path, index=False)
            assert path.is_file()
        """
    ),
    md(
        """
        ## 1. A 股：申万一级行业成分

        先获取 31 个申万一级行业，再逐行业获取当前成分。申万成分与腾讯行情分别来自不同
        数据提供方；行业归属与市值因此不是同一接口内的自我验证。
        """
    ),
    code(
        """
        sw_realtime = ak.index_realtime_sw(symbol="一级行业").copy()
        sw_industries = (
            sw_realtime[["指数代码", "指数名称"]]
            .rename(columns={"指数代码": "industry_code", "指数名称": "industry_name"})
            .drop_duplicates("industry_code")
            .sort_values("industry_code")
            .reset_index(drop=True)
        )

        component_frames = []
        component_errors = []
        for row in sw_industries.itertuples(index=False):
            try:
                part = ak.index_component_sw(symbol=row.industry_code).copy()
                part = part.rename(
                    columns={
                        "证券代码": "symbol",
                        "证券名称": "name",
                        "最新权重": "latest_weight_pct",
                        "计入日期": "included_date",
                    }
                )
                part["symbol"] = part["symbol"].map(normalize_code)
                part["industry_code"] = row.industry_code
                part["industry_name"] = row.industry_name
                component_frames.append(
                    part[
                        [
                            "symbol",
                            "name",
                            "industry_code",
                            "industry_name",
                            "latest_weight_pct",
                            "included_date",
                        ]
                    ]
                )
            except Exception as exc:
                component_errors.append(
                    {"industry_code": row.industry_code, "error": repr(exc)}
                )
            time.sleep(0.10)

        if component_errors:
            display(pd.DataFrame(component_errors))
            raise RuntimeError("申万行业成分存在获取失败，停止生成不完整分类")

        stock_classification = pd.concat(component_frames, ignore_index=True)
        stock_classification["classification_system"] = "申万一级行业"
        stock_classification["classification_source"] = "申万指数（AKShare index_component_sw）"
        stock_classification["snapshot_date"] = SNAPSHOT_DATE

        duplicate_assignments = (
            stock_classification.groupby("symbol")["industry_code"].nunique().gt(1)
        )
        duplicate_symbols = duplicate_assignments[duplicate_assignments].index.tolist()
        print("申万一级行业数:", len(sw_industries))
        print("行业成分记录数:", len(stock_classification))
        print("唯一股票数:", stock_classification["symbol"].nunique())
        print("跨一级行业重复股票数:", len(duplicate_symbols))
        display(sw_industries)
        """
    ),
    code(
        """
        # 腾讯实时总市值按 昨收/现价 回推至 2026-07-29 收盘。
        unique_symbols = sorted(stock_classification["symbol"].unique())
        quotes = tencent_quote(unique_symbols)
        quotes["mcap_asof_yi"] = np.where(
            quotes["price"].gt(0) & quotes["last_close"].gt(0),
            quotes["mcap_current_yi"] * quotes["last_close"] / quotes["price"],
            quotes["mcap_current_yi"],
        )
        quotes["mcap_method"] = "腾讯当前总市值×昨收/现价"
        quotes["snapshot_date"] = SNAPSHOT_DATE

        stock_classification = stock_classification.merge(
            quotes[
                [
                    "symbol",
                    "quote_name",
                    "price",
                    "last_close",
                    "mcap_current_yi",
                    "mcap_asof_yi",
                    "mcap_method",
                ]
            ],
            on="symbol",
            how="left",
            validate="many_to_one",
        )
        stock_classification["quote_available"] = (
            stock_classification["mcap_asof_yi"].notna()
            & stock_classification["mcap_asof_yi"].gt(0)
        )
        stock_classification["name_match"] = (
            stock_classification["name"].str.replace(" ", "", regex=False)
            == stock_classification["quote_name"].fillna("").str.replace(" ", "", regex=False)
        )

        industry_market_cap = (
            stock_classification.groupby(
                ["industry_code", "industry_name"], as_index=False
            )
            .agg(
                constituent_count=("symbol", "nunique"),
                quote_count=("quote_available", "sum"),
                total_mcap_yi=("mcap_asof_yi", "sum"),
            )
        )
        industry_market_cap["quote_coverage"] = (
            industry_market_cap["quote_count"]
            / industry_market_cap["constituent_count"]
        )
        industry_market_cap = industry_market_cap.sort_values(
            "total_mcap_yi", ascending=False
        ).reset_index(drop=True)
        industry_market_cap["rank"] = np.arange(1, len(industry_market_cap) + 1)
        industry_market_cap["snapshot_date"] = SNAPSHOT_DATE

        quality_summary = pd.DataFrame(
            [
                ("申万一级行业数", len(sw_industries)),
                ("成分记录数", len(stock_classification)),
                ("唯一股票数", stock_classification["symbol"].nunique()),
                ("跨一级行业重复股票数", len(duplicate_symbols)),
                ("腾讯市值覆盖率", stock_classification["quote_available"].mean()),
                ("腾讯名称一致率（有报价）", stock_classification.loc[
                    stock_classification["quote_available"], "name_match"
                ].mean()),
            ],
            columns=["quality_metric", "value"],
        )

        safe_to_parquet(stock_classification, DATA_DIR / "stock_industry_classification.parquet")
        safe_to_parquet(quotes, DATA_DIR / "tencent_quote_snapshot.parquet")
        industry_market_cap.to_csv(
            DATA_DIR / "industry_market_cap.csv", index=False, encoding="utf-8-sig"
        )
        quality_summary.to_csv(
            DATA_DIR / "classification_quality.csv", index=False, encoding="utf-8-sig"
        )
        display(quality_summary)
        display(industry_market_cap.head(10))
        """
    ),
    md(
        """
        ## 2. 交易所行业口径对照

        深交所公开 A 股列表带有证监会大类行业字段。它与申万一级行业的研究口径不同，
        此处只检查代码连接是否合理并展示映射关系，不用它覆盖申万分类。
        """
    ),
    code(
        """
        try:
            szse = ak.stock_info_sz_name_code(symbol="A股列表").copy()
            szse_crosscheck = szse.rename(
                columns={
                    "A股代码": "symbol",
                    "A股简称": "exchange_name",
                    "所属行业": "exchange_industry",
                }
            )[["symbol", "exchange_name", "exchange_industry"]]
            szse_crosscheck["symbol"] = szse_crosscheck["symbol"].map(normalize_code)
            szse_crosscheck = szse_crosscheck.merge(
                stock_classification[
                    ["symbol", "industry_code", "industry_name"]
                ].drop_duplicates("symbol"),
                on="symbol",
                how="left",
                validate="one_to_one",
            )
            szse_crosscheck["sw_available"] = szse_crosscheck["industry_code"].notna()
            szse_crosscheck.to_csv(
                DATA_DIR / "exchange_industry_crosscheck.csv",
                index=False,
                encoding="utf-8-sig",
            )
            print("深交所 A 股代码数:", len(szse_crosscheck))
            print("可连接到申万一级行业比例:", f"{szse_crosscheck['sw_available'].mean():.2%}")
            display(
                pd.crosstab(
                    szse_crosscheck["exchange_industry"],
                    szse_crosscheck["industry_name"],
                ).head(10)
            )
        except Exception as exc:
            szse_crosscheck = pd.DataFrame()
            print("深交所行业对照获取失败，不影响申万主分类:", repr(exc))
        """
    ),
    md(
        """
        ## 3. ETF：双清单与名称初筛

        ETF 主表来自东财，独立清单来自同花顺。行业初筛按基金简称关键词映射到申万一级行业；
        结果明确保留 `classification_confidence` 和 `needs_prospectus_review`。这一步适合构造
        待核验候选池，不适合直接作为投资研究的最终行业事实。
        """
    ),
    code(
        """
        try:
            etf_em_raw = ak.fund_etf_spot_em().copy()
            etf_em = etf_em_raw.rename(
                columns={
                    "代码": "symbol",
                    "名称": "name_em",
                    "总市值": "market_cap_yuan",
                    "数据日期": "data_date",
                }
            )[["symbol", "name_em", "market_cap_yuan", "data_date"]]
            etf_em["symbol"] = etf_em["symbol"].map(normalize_code)
            time.sleep(1.5)
        except Exception as exc:
            etf_em = pd.DataFrame(
                columns=["symbol", "name_em", "market_cap_yuan", "data_date"]
            )
            print("东财 ETF 清单获取失败，降级为同花顺:", repr(exc))

        etf_ths_raw = ak.fund_etf_spot_ths().copy()
        etf_ths = etf_ths_raw.rename(
            columns={
                "基金代码": "symbol",
                "基金名称": "name_ths",
                "基金类型": "fund_type_ths",
                "查询日期": "query_date_ths",
            }
        )[["symbol", "name_ths", "fund_type_ths", "query_date_ths"]]
        etf_ths["symbol"] = etf_ths["symbol"].map(normalize_code)

        if etf_em.empty:
            etf_universe = etf_ths.copy()
            etf_universe["name_em"] = pd.NA
            etf_universe["market_cap_yuan"] = np.nan
            etf_universe["data_date"] = pd.NaT
        else:
            etf_universe = etf_em.merge(
                etf_ths, on="symbol", how="outer", validate="one_to_one"
            )

        etf_universe["name"] = etf_universe["name_em"].fillna(
            etf_universe["name_ths"]
        )
        etf_universe["source_count"] = (
            etf_universe["name_em"].notna().astype(int)
            + etf_universe["name_ths"].notna().astype(int)
        )
        etf_universe["name_match"] = (
            etf_universe["name_em"].fillna("").str.replace(" ", "", regex=False)
            == etf_universe["name_ths"].fillna("").str.replace(" ", "", regex=False)
        )

        INDUSTRY_KEYWORDS = [
            ("银行", ["银行"]),
            ("非银金融", ["证券", "券商", "保险", "非银金融"]),
            ("电子", ["半导体", "芯片", "电子", "消费电子"]),
            ("计算机", ["计算机", "软件", "云计算", "信创", "人工智能", "AI"]),
            ("通信", ["通信", "5G"]),
            ("食品饮料", ["食品饮料", "白酒", "酒ETF", "食品"]),
            ("医药生物", ["医药", "医疗", "生物", "创新药", "中药"]),
            ("电力设备", ["电力设备", "光伏", "电池", "新能源车"]),
            ("汽车", ["汽车", "智能车"]),
            ("房地产", ["房地产", "地产"]),
            ("煤炭", ["煤炭"]),
            ("钢铁", ["钢铁"]),
            ("有色金属", ["有色", "稀土", "黄金", "金属"]),
            ("国防军工", ["军工", "国防", "航天", "航空"]),
            ("传媒", ["传媒", "游戏", "动漫"]),
            ("美容护理", ["美容", "美妆"]),
            ("社会服务", ["旅游", "酒店", "教育", "社会服务"]),
            ("家用电器", ["家电"]),
            ("农林牧渔", ["农业", "养殖", "畜牧", "农林牧渔"]),
            ("建筑材料", ["建筑材料", "建材"]),
            ("建筑装饰", ["建筑装饰", "基建"]),
            ("交通运输", ["交通运输", "物流", "机场", "航运"]),
            ("机械设备", ["机械", "机器人", "机床"]),
            ("石油石化", ["石油石化", "油气"]),
            ("基础化工", ["基础化工", "化工"]),
            ("纺织服饰", ["纺织", "服装"]),
            ("商贸零售", ["商贸零售", "零售"]),
            ("环保", ["环保"]),
            ("公用事业", ["公用事业", "电力ETF", "绿电"]),
            ("轻工制造", ["轻工", "家居"]),
            ("综合", ["综合行业"]),
        ]
        NON_INDUSTRY_KEYWORDS = [
            "沪深300", "中证500", "上证50", "创业板", "科创", "红利",
            "债", "货币", "黄金ETF", "商品", "纳指", "标普", "恒生", "港股",
            "日经", "德国", "法国", "沙特", "东南亚", "REIT",
        ]

        def classify_etf_name(name: str) -> tuple[str, str, bool]:
            text = str(name)
            for industry, keywords in INDUSTRY_KEYWORDS:
                if any(keyword in text for keyword in keywords):
                    return industry, "名称关键词初筛", True
            if any(keyword in text for keyword in NON_INDUSTRY_KEYWORDS):
                return "非行业ETF", "名称规则", False
            return "待核验", "无可靠结构化跟踪指数", True

        classified = etf_universe["name"].map(classify_etf_name)
        etf_universe[["industry_initial", "classification_method", "needs_prospectus_review"]] = (
            pd.DataFrame(classified.tolist(), index=etf_universe.index)
        )
        etf_universe["classification_confidence"] = np.where(
            etf_universe["industry_initial"].eq("非行业ETF"),
            "中",
            np.where(etf_universe["industry_initial"].eq("待核验"), "低", "低"),
        )
        etf_universe["snapshot_date"] = SNAPSHOT_DATE
        etf_universe = etf_universe.sort_values(
            ["industry_initial", "market_cap_yuan"], ascending=[True, False]
        )
        safe_to_parquet(etf_universe, DATA_DIR / "etf_industry_classification.parquet")

        etf_summary = (
            etf_universe.groupby("industry_initial", dropna=False)
            .agg(
                etf_count=("symbol", "nunique"),
                dual_source_count=("source_count", lambda x: int((x == 2).sum())),
                market_cap_yi=("market_cap_yuan", lambda x: x.sum(min_count=1) / 1e8),
            )
            .sort_values("etf_count", ascending=False)
        )
        print("ETF 唯一代码数:", etf_universe["symbol"].nunique())
        print("双清单同时覆盖比例:", f"{etf_universe['source_count'].eq(2).mean():.2%}")
        print("需基金文件进一步核验比例:", f"{etf_universe['needs_prospectus_review'].mean():.2%}")
        display(etf_summary.head(15))

        sample_codes = ["510300", "510500", "512800", "512480", "512170"]
        display(
            etf_universe.loc[
                etf_universe["symbol"].isin(sample_codes),
                [
                    "symbol",
                    "name",
                    "fund_type_ths",
                    "industry_initial",
                    "classification_method",
                    "classification_confidence",
                    "needs_prospectus_review",
                    "source_count",
                ],
            ].sort_values("symbol")
        )
        """
    ),
    code(
        """
        manifest = {
            "schema_version": "1.0",
            "run_time": RUN_DATE.isoformat(),
            "snapshot_date": SNAPSHOT_DATE.date().isoformat(),
            "stock_classification": {
                "system": "申万一级行业",
                "source": "申万指数 via AKShare",
                "industry_count": int(len(sw_industries)),
                "record_count": int(len(stock_classification)),
                "unique_stock_count": int(stock_classification["symbol"].nunique()),
                "duplicate_assignment_count": int(len(duplicate_symbols)),
                "quote_coverage": float(stock_classification["quote_available"].mean()),
            },
            "market_cap": {
                "source": "腾讯财经",
                "method": "当前总市值×昨收/现价，回推至最后完整交易日",
                "unit": "亿元人民币",
            },
            "etf_classification": {
                "sources": ["东方财富", "同花顺"],
                "method": "名称关键词初筛；最终需基金合同/招募说明书/跟踪指数说明",
                "unique_etf_count": int(etf_universe["symbol"].nunique()),
                "dual_source_ratio": float(etf_universe["source_count"].eq(2).mean()),
            },
        }
        (DATA_DIR / "classification_manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        assert len(sw_industries) == 31
        assert not stock_classification.duplicated(
            ["symbol", "industry_code"]
        ).any()
        assert stock_classification["quote_available"].mean() >= 0.95
        assert industry_market_cap["total_mcap_yi"].gt(0).all()
        assert etf_universe["symbol"].is_unique
        print("分类数据质量门禁通过")
        print(f"数据目录: {DATA_DIR.relative_to(LAB_DIR.parents[1])}")
        """
    ),
    md(
        """
        ## 本 Notebook 的结论边界

        1. A 股行业分类可稳定地按“申万一级行业成分”构造，并用独立腾讯行情补足市值。
        2. 交易所行业与申万行业是两套分类体系；对照的目的在于发现错码/漏码，不是强制同名。
        3. ETF 的基金类型与行业暴露不是同一个字段。名称规则只能初筛，正式研究必须核验跟踪指数
           及基金法律文件；宽基、策略、债券、商品、跨境 ETF 不应硬塞进 A 股行业。
        4. 市值排名是 2026-07-29 的静态快照，用它回看历史会产生选择时点偏差；相关性结果应
           解读为“当前大行业的历史联动”，而非当时可实时构建的无偏策略。
        """
    ),
]


correlation_cells = [
    md(
        """
        # Lab 02-2：A 股市值前十行业与大盘走势相关性

        **问题**：以 2026-07-29 收盘总市值选出的申万一级行业前十，与沪深300、中证500
        在 2021-01-01 至 2026-07-29 的走势有多强的联动？

        主指标是**日对数收益率的 Pearson 相关系数**；同时报告 Spearman 相关、市场 beta
        和 60 日滚动相关区间。价格水平相关只作伪相关风险说明，不作为结论。
        """
    ),
    md(
        """
        ## 研究设计

        - 行业样本：上一 Notebook 生成的申万一级行业成分与腾讯总市值快照；
        - 行业走势：申万一级行业指数日收盘；
        - 大盘：沪深300（000300）与中证500（000905），腾讯指数日线；
        - 对齐：每个行业和基准按共同交易日内连接；
        - 复权：研究对象均为指数点位，不混用个股不复权/复权价格；
        - 性质：描述性相关，不代表因果、预测能力或可交易收益。
        """
    ),
    code(
        """
        import json
        import math
        import time
        from pathlib import Path
        from statistics import NormalDist

        import akshare as ak
        import matplotlib.pyplot as plt
        import numpy as np
        import pandas as pd
        from IPython.display import display

        plt.rcParams["font.sans-serif"] = [
            "Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"
        ]
        plt.rcParams["axes.unicode_minus"] = False
        pd.set_option("display.max_columns", 50)
        pd.set_option("display.width", 180)

        WORKING_DIR = Path.cwd().resolve()
        LAB_DIR = next(
            (
                p
                for p in [WORKING_DIR, *WORKING_DIR.parents]
                if p.name == "02_行业走势相关性研究"
            ),
            None,
        )
        if LAB_DIR is None:
            candidate = WORKING_DIR / "labs" / "02_行业走势相关性研究"
            if candidate.is_dir():
                LAB_DIR = candidate
        if LAB_DIR is None:
            raise FileNotFoundError("请从仓库根目录或 labs/02_行业走势相关性研究 运行")

        DATA_DIR = LAB_DIR / "data"
        CHART_DIR = DATA_DIR / "charts"
        CHART_DIR.mkdir(parents=True, exist_ok=True)

        START_DATE = pd.Timestamp("2021-01-01")
        END_DATE = pd.Timestamp("2026-07-29")
        ROLLING_WINDOW = 60
        """
    ),
    code(
        """
        classification_path = DATA_DIR / "stock_industry_classification.parquet"
        if not classification_path.is_file():
            raise FileNotFoundError(
                "缺少分类快照。请先执行 1-标的行业分类.ipynb。"
            )

        stock_classification = pd.read_parquet(classification_path)
        required_columns = {
            "symbol", "industry_code", "industry_name", "mcap_asof_yi",
            "quote_available", "snapshot_date",
        }
        missing = required_columns - set(stock_classification.columns)
        if missing:
            raise ValueError(f"分类快照缺少字段: {sorted(missing)}")

        market_cap = (
            stock_classification.loc[stock_classification["quote_available"]]
            .groupby(["industry_code", "industry_name"], as_index=False)
            .agg(
                constituent_count=("symbol", "nunique"),
                total_mcap_yi=("mcap_asof_yi", "sum"),
            )
            .sort_values("total_mcap_yi", ascending=False)
            .reset_index(drop=True)
        )
        market_cap["market_cap_rank"] = np.arange(1, len(market_cap) + 1)
        market_cap["market_cap_share"] = (
            market_cap["total_mcap_yi"] / market_cap["total_mcap_yi"].sum()
        )
        top10 = market_cap.head(10).copy()
        top10.to_csv(
            DATA_DIR / "top10_industries.csv", index=False, encoding="utf-8-sig"
        )

        print("市值快照日期:", pd.to_datetime(
            stock_classification["snapshot_date"]
        ).max().date())
        print("前十行业占 31 个行业总市值:", f"{top10['market_cap_share'].sum():.2%}")
        display(
            top10.assign(
                total_mcap_trillion=lambda x: x["total_mcap_yi"] / 10_000,
                market_cap_share=lambda x: x["market_cap_share"].map(
                    lambda v: f"{v:.2%}"
                ),
            )[
                [
                    "market_cap_rank", "industry_code", "industry_name",
                    "constituent_count", "total_mcap_trillion", "market_cap_share",
                ]
            ]
        )
        """
    ),
    code(
        """
        def normalize_sw_history(frame: pd.DataFrame, code: str, name: str) -> pd.DataFrame:
            result = frame.rename(
                columns={"日期": "date", "收盘": "close"}
            )[["date", "close"]].copy()
            result["date"] = pd.to_datetime(result["date"])
            result["close"] = pd.to_numeric(result["close"], errors="coerce")
            result["series_code"] = code
            result["series_name"] = name
            result["series_type"] = "industry"
            return result


        def normalize_tencent_index(
            frame: pd.DataFrame, code: str, name: str
        ) -> pd.DataFrame:
            result = frame[["date", "close"]].copy()
            result["date"] = pd.to_datetime(result["date"])
            result["close"] = pd.to_numeric(result["close"], errors="coerce")
            result["series_code"] = code
            result["series_name"] = name
            result["series_type"] = "benchmark"
            return result


        histories = []
        history_errors = []
        for row in top10.itertuples(index=False):
            try:
                raw = ak.index_hist_sw(symbol=row.industry_code, period="day")
                histories.append(
                    normalize_sw_history(raw, row.industry_code, row.industry_name)
                )
            except Exception as exc:
                history_errors.append(
                    {"series": row.industry_name, "error": repr(exc)}
                )
            time.sleep(0.10)

        benchmark_specs = [
            ("sh000300", "沪深300"),
            ("sh000905", "中证500"),
        ]
        for code_value, name_value in benchmark_specs:
            try:
                raw = ak.stock_zh_index_daily_tx(symbol=code_value)
                histories.append(
                    normalize_tencent_index(raw, code_value[2:], name_value)
                )
            except Exception as exc:
                history_errors.append({"series": name_value, "error": repr(exc)})

        if history_errors:
            display(pd.DataFrame(history_errors))
            raise RuntimeError("历史行情存在获取失败，停止相关性计算")

        history = pd.concat(histories, ignore_index=True)
        history = history.loc[
            history["date"].between(START_DATE, END_DATE)
        ].copy()
        history = history.dropna(subset=["date", "close"])
        history = history.loc[history["close"].gt(0)]
        history = history.sort_values(["series_name", "date"])

        history_quality = (
            history.groupby(["series_name", "series_type"], as_index=False)
            .agg(
                start_date=("date", "min"),
                end_date=("date", "max"),
                row_count=("date", "size"),
                duplicate_dates=("date", lambda x: int(x.duplicated().sum())),
                missing_close=("close", lambda x: int(x.isna().sum())),
                max_calendar_gap_days=(
                    "date", lambda x: int(x.sort_values().diff().dt.days.max())
                ),
            )
        )
        history.to_parquet(DATA_DIR / "industry_benchmark_history.parquet", index=False)
        history_quality.to_csv(
            DATA_DIR / "history_quality.csv", index=False, encoding="utf-8-sig"
        )
        display(history_quality)

        assert history_quality["duplicate_dates"].eq(0).all()
        assert history_quality["missing_close"].eq(0).all()
        assert history_quality["end_date"].eq(END_DATE).all()
        assert history_quality["row_count"].min() >= 1_000
        """
    ),
    code(
        """
        close_wide = history.pivot(
            index="date", columns="series_name", values="close"
        ).sort_index()
        log_returns = np.log(close_wide).diff()

        benchmark_names = ["沪深300", "中证500"]
        industry_names = top10["industry_name"].tolist()

        def fisher_ci(r: float, n: int, alpha: float = 0.05) -> tuple[float, float]:
            if n <= 3 or not np.isfinite(r) or abs(r) >= 1:
                return (np.nan, np.nan)
            z = np.arctanh(r)
            se = 1 / math.sqrt(n - 3)
            critical = NormalDist().inv_cdf(1 - alpha / 2)
            return (
                float(np.tanh(z - critical * se)),
                float(np.tanh(z + critical * se)),
            )

        metric_rows = []
        rolling_series = {}
        for industry in industry_names:
            for benchmark in benchmark_names:
                pair = log_returns[[industry, benchmark]].dropna()
                pearson = pair[industry].corr(pair[benchmark], method="pearson")
                # Spearman 等价于两列秩的 Pearson 相关；避免为此引入 SciPy。
                spearman = pair[industry].rank(method="average").corr(
                    pair[benchmark].rank(method="average"), method="pearson"
                )
                benchmark_variance = pair[benchmark].var(ddof=1)
                beta = (
                    pair[industry].cov(pair[benchmark]) / benchmark_variance
                    if benchmark_variance > 0
                    else np.nan
                )
                rolling = pair[industry].rolling(ROLLING_WINDOW).corr(
                    pair[benchmark]
                ).dropna()
                rolling_series[(industry, benchmark)] = rolling
                ci_low, ci_high = fisher_ci(pearson, len(pair))
                metric_rows.append(
                    {
                        "industry_name": industry,
                        "benchmark": benchmark,
                        "observations": len(pair),
                        "start_date": pair.index.min(),
                        "end_date": pair.index.max(),
                        "pearson_corr": pearson,
                        "pearson_ci95_low": ci_low,
                        "pearson_ci95_high": ci_high,
                        "spearman_corr": spearman,
                        "beta": beta,
                        "rolling60_median": rolling.median(),
                        "rolling60_min": rolling.min(),
                        "rolling60_max": rolling.max(),
                        "rolling60_latest": rolling.iloc[-1],
                    }
                )

        metrics = pd.DataFrame(metric_rows)
        metrics = metrics.merge(
            top10[
                [
                    "industry_name", "industry_code", "market_cap_rank",
                    "total_mcap_yi", "market_cap_share",
                ]
            ],
            on="industry_name",
            how="left",
            validate="many_to_one",
        )
        metrics = metrics.sort_values(["benchmark", "pearson_corr"], ascending=[True, False])
        metrics.to_csv(
            DATA_DIR / "correlation_metrics.csv", index=False, encoding="utf-8-sig"
        )

        corr_matrix = metrics.pivot(
            index="industry_name", columns="benchmark", values="pearson_corr"
        ).reindex(industry_names)
        spearman_matrix = metrics.pivot(
            index="industry_name", columns="benchmark", values="spearman_corr"
        ).reindex(industry_names)
        beta_matrix = metrics.pivot(
            index="industry_name", columns="benchmark", values="beta"
        ).reindex(industry_names)

        print("Pearson 日收益率相关：")
        display(corr_matrix.style.format("{:.3f}").background_gradient(cmap="YlOrRd", vmin=0, vmax=1))
        print("Spearman 日收益率相关：")
        display(spearman_matrix.style.format("{:.3f}").background_gradient(cmap="YlGnBu", vmin=0, vmax=1))
        print("市场 beta：")
        display(beta_matrix.style.format("{:.3f}").background_gradient(cmap="coolwarm", vmin=0.5, vmax=1.5))
        """
    ),
    md(
        """
        ## 图表

        热力图比较两个基准；归一化点位图只展示“共同起点后的相对路径”，不能替代收益率相关。
        60 日滚动相关展示相关性并非常数。
        """
    ),
    code(
        """
        fig, ax = plt.subplots(figsize=(8, 6))
        image = ax.imshow(corr_matrix.values, cmap="YlOrRd", vmin=0, vmax=1, aspect="auto")
        ax.set_xticks(range(len(corr_matrix.columns)), corr_matrix.columns)
        ax.set_yticks(range(len(corr_matrix.index)), corr_matrix.index)
        for i in range(corr_matrix.shape[0]):
            for j in range(corr_matrix.shape[1]):
                ax.text(j, i, f"{corr_matrix.iloc[i, j]:.2f}", ha="center", va="center")
        ax.set_title("市值前十申万行业与大盘的日收益率相关")
        fig.colorbar(image, ax=ax, label="Pearson 相关系数")
        fig.tight_layout()
        fig.savefig(CHART_DIR / "correlation_heatmap.png", dpi=160, bbox_inches="tight")
        plt.show()

        common_close = close_wide[industry_names + benchmark_names].dropna()
        normalized = common_close / common_close.iloc[0] * 100
        fig, ax = plt.subplots(figsize=(12, 7))
        for industry in industry_names:
            ax.plot(normalized.index, normalized[industry], lw=1.0, alpha=0.70, label=industry)
        for benchmark in benchmark_names:
            ax.plot(
                normalized.index,
                normalized[benchmark],
                lw=2.7,
                linestyle="--",
                label=benchmark,
            )
        ax.axhline(100, color="gray", lw=0.8)
        ax.set_title("行业与大盘归一化指数路径（共同起点=100）")
        ax.set_ylabel("归一化点位")
        ax.legend(ncol=3, fontsize=9)
        ax.grid(alpha=0.2)
        fig.tight_layout()
        fig.savefig(CHART_DIR / "normalized_trends.png", dpi=160, bbox_inches="tight")
        plt.show()

        fig, axes = plt.subplots(2, 1, figsize=(12, 10), sharex=True)
        for ax, benchmark in zip(axes, benchmark_names):
            for industry in industry_names:
                rolling = rolling_series[(industry, benchmark)]
                ax.plot(rolling.index, rolling.values, lw=0.9, alpha=0.75, label=industry)
            ax.axhline(0, color="black", lw=0.7)
            ax.set_ylim(-0.4, 1.0)
            ax.set_title(f"60 日滚动相关：行业 vs {benchmark}")
            ax.set_ylabel("相关系数")
            ax.grid(alpha=0.2)
        axes[-1].legend(ncol=5, fontsize=8)
        fig.tight_layout()
        fig.savefig(CHART_DIR / "rolling_60d_correlations.png", dpi=160, bbox_inches="tight")
        plt.show()
        """
    ),
    code(
        """
        # 稳健性：相关排名、Pearson/Spearman差异、滚动波动范围。
        robustness = metrics.copy()
        robustness["pearson_spearman_gap"] = (
            robustness["pearson_corr"] - robustness["spearman_corr"]
        ).abs()
        robustness["rolling60_range"] = (
            robustness["rolling60_max"] - robustness["rolling60_min"]
        )
        robustness["corr_rank_within_benchmark"] = robustness.groupby(
            "benchmark"
        )["pearson_corr"].rank(ascending=False, method="min")
        display(
            robustness[
                [
                    "benchmark", "corr_rank_within_benchmark", "industry_name",
                    "pearson_corr", "pearson_ci95_low", "pearson_ci95_high",
                    "spearman_corr", "beta", "rolling60_median",
                    "rolling60_min", "rolling60_max", "rolling60_latest",
                    "pearson_spearman_gap",
                ]
            ].sort_values(["benchmark", "corr_rank_within_benchmark"])
            .style.format({
                "pearson_corr": "{:.3f}",
                "pearson_ci95_low": "{:.3f}",
                "pearson_ci95_high": "{:.3f}",
                "spearman_corr": "{:.3f}",
                "beta": "{:.3f}",
                "rolling60_median": "{:.3f}",
                "rolling60_min": "{:.3f}",
                "rolling60_max": "{:.3f}",
                "rolling60_latest": "{:.3f}",
                "pearson_spearman_gap": "{:.3f}",
            })
        )
        """
    ),
    code(
        """
        conclusions = {}
        for benchmark in benchmark_names:
            subset = metrics.loc[metrics["benchmark"].eq(benchmark)].sort_values(
                "pearson_corr", ascending=False
            )
            conclusions[benchmark] = {
                "highest": subset.iloc[0]["industry_name"],
                "highest_corr": float(subset.iloc[0]["pearson_corr"]),
                "lowest": subset.iloc[-1]["industry_name"],
                "lowest_corr": float(subset.iloc[-1]["pearson_corr"]),
                "median_corr": float(subset["pearson_corr"].median()),
                "latest_rolling_median": float(subset["rolling60_latest"].median()),
            }
            print(
                f"{benchmark}: 最高 {subset.iloc[0]['industry_name']} "
                f"({subset.iloc[0]['pearson_corr']:.3f})；"
                f"最低 {subset.iloc[-1]['industry_name']} "
                f"({subset.iloc[-1]['pearson_corr']:.3f})；"
                f"前十行业中位数 {subset['pearson_corr'].median():.3f}。"
            )

        result_manifest = {
            "schema_version": "1.0",
            "analysis_window": {
                "start": START_DATE.date().isoformat(),
                "end": END_DATE.date().isoformat(),
            },
            "selection": "2026-07-29 申万一级行业成分，按腾讯昨收回推总市值取前十",
            "primary_metric": "日对数收益率 Pearson 相关",
            "rolling_window": ROLLING_WINDOW,
            "top10_industries": top10[
                ["market_cap_rank", "industry_code", "industry_name", "total_mcap_yi"]
            ].to_dict("records"),
            "summary": conclusions,
            "limitations": [
                "当前市值选样回看历史，存在选择时点与幸存者偏差",
                "行业指数历史受指数编制与成分调整影响",
                "相关不等于因果或预测能力",
                "Fisher区间按独立同分布近似，未完全处理收益率时序依赖",
            ],
        }
        (DATA_DIR / "correlation_manifest.json").write_text(
            json.dumps(result_manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        assert len(top10) == 10
        assert len(metrics) == 20
        assert metrics["observations"].min() >= 1_000
        assert metrics["pearson_corr"].between(-1, 1).all()
        assert metrics["spearman_corr"].between(-1, 1).all()
        print("相关性计算与质量门禁通过")
        """
    ),
    md(
        """
        ## 解释限制

        - 本结果回答“当前大市值行业过去与宽基同步程度如何”，不回答“未来哪个行业会上涨”。
        - 以 2026-07-29 的行业市值排序回看 2021 年以来历史，存在选择时点偏差；若用于策略，
          必须改为每期使用当时可得的成分和市值。
        - 行业指数与沪深300/中证500存在成分重叠，高相关有一部分是机械性的共同持股。
        - 60 日滚动相关的宽区间说明相关结构会随市场阶段变化；单一全样本系数不能当常数。
        - Fisher 95% 区间用于描述抽样不确定性，但日收益率并非严格独立同分布，区间应谨慎解读。

        本实验不构成投资建议。
        """
    ),
]


target = sys.argv[1] if len(sys.argv) > 1 else "all"
if target in {"all", "classification"}:
    write_notebook("1-标的行业分类.ipynb", classification_cells)
if target in {"all", "correlation"}:
    write_notebook("2-前十行业与大盘相关性.ipynb", correlation_cells)
if target not in {"all", "classification", "correlation"}:
    raise SystemExit("target must be: all, classification, or correlation")
print(f"notebooks written: {target}")
