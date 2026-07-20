"""
实验一：A股银行股数据获取与分析
依赖：pip install akshare pandas matplotlib mootdx

数据源策略：
  - 银行股清单 + 行情 + 财务：mootdx（通达信 UDP 协议，稳定不封IP）
  - 历史K线：mootdx bars() → akshare 腾讯源（兜底）

功能：
  1. 获取 A 股银行板块全部成分股清单（含代码、名称、PE、PB、ROE、总市值等）
  2. 获取前十大银行股自 2020 年以来的历史日线行情 → data/<名称>_<代码>.csv
  3. 可视化：前十大银行股归一化走势对比
"""
import os
import time
import akshare as ak
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from mootdx.quotes import Quotes

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False

# ── 路径 ─────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJ_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJ_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# ── 通达信客户端 ─────────────────────────────────────────────
tdx = Quotes.factory(market="std")


# ============================================================
# 工具函数
# ============================================================
def safe_call(fn, label, *args, retries=3, delay=2.0, **kwargs):
    """带重试的安全调用，指数退避"""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            result = fn(*args, **kwargs)
            tag = f"  [√] {label}"
            if attempt > 1:
                tag += f" (第{attempt}次)"
            print(tag)
            return result
        except Exception as e:
            last_err = e
            if attempt < retries:
                wait = delay * attempt
                print(f"  [?] {label} 重试 {attempt}/{retries}，{wait:.0f}s... ({type(e).__name__})")
                time.sleep(wait)
    print(f"  [!] {label} 失败: {type(last_err).__name__}: {last_err}")
    return None


# ============================================================
# 任务 1：获取 A 股银行股清单（含 PE、PB、ROE、总市值等）
# ============================================================
print("=" * 65)
print("  任务 1：A 股银行板块成分股清单")
print("=" * 65)

# ── 1a. 通过通达信获取全部股票，按名称过滤银行股 ────────────
print("\n  → 获取全A股列表，过滤银行股...")
all_stocks = tdx.stocks()
mask = all_stocks["name"].str.contains("银行", na=False)
# 排除指数、港股等（仅保留6位数字代码，且不以 8/9 开头）
mask &= all_stocks["code"].astype(str).str.match(r"^[0-3,6]\d{5}$")
bank_codes = all_stocks[mask][["code", "name"]].copy()
bank_codes["code"] = bank_codes["code"].astype(str).str.zfill(6)
bank_codes = bank_codes.drop_duplicates(subset=["code"]).reset_index(drop=True)
print(f"  [√] 获取到 {len(bank_codes)} 只银行股")

# ── 1b. 批量获取实时行情（价格） ────────────────────────────
print("\n  → 获取实时行情...")
codes_list = bank_codes["code"].tolist()
quotes = tdx.quotes(symbol=codes_list)
print(f"  [√] 获取到 {len(quotes)} 条行情")

# 合并价格
bank_list = bank_codes.merge(
    quotes[["code", "price", "last_close", "open", "high", "low", "vol", "amount"]],
    on="code", how="left"
)

# ── 1c. 逐个获取财务数据，计算 PE/PB/ROE ────────────────────
print(f"\n  → 获取财务数据并计算 PE/PB/ROE（共 {len(bank_list)} 只）...")
fin_data = []
for i, (_, row) in enumerate(bank_list.iterrows()):
    code = row["code"]
    name = row["name"]
    print(f"    [{i+1:2d}/{len(bank_list)}] {name}({code}) ...", end=" ")

    fin = safe_call(tdx.finance, "", symbol=code, retries=2, delay=1)
    if fin is not None and len(fin) > 0:
        f = fin.iloc[0]
        bps   = float(f.get("meigujingzichan", np.nan))      # 每股净资产
        net_p = float(f.get("jinglirun", np.nan))             # 净利润
        equity = float(f.get("jingzichan", np.nan))           # 净资产
        shares = float(f.get("zongguben", np.nan))            # 总股本
        industry = f.get("industry", "")

        price = row["price"]
        if pd.notna(price) and price > 0:
            mkt_cap = price * shares if pd.notna(shares) else np.nan
            pb  = price / bps if pd.notna(bps) and bps > 0 else np.nan
            pe  = mkt_cap / net_p if pd.notna(net_p) and net_p > 0 else np.nan
            roe = (net_p / equity * 100) if pd.notna(equity) and equity > 0 else np.nan
        else:
            mkt_cap = pb = pe = roe = np.nan

        fin_data.append({
            "code": code,
            "总股本": shares,
            "每股净资产": bps,
            "净利润": net_p,
            "净资产": equity,
            "总市值": mkt_cap,
            "市盈率(PE)": round(pe, 2) if pd.notna(pe) else np.nan,
            "市净率(PB)": round(pb, 2) if pd.notna(pb) else np.nan,
            "ROE(%)": round(roe, 2) if pd.notna(roe) else np.nan,
        })
        print(f"PE={pe:.1f} PB={pb:.2f} ROE={roe:.1f}%")
    else:
        fin_data.append({"code": code})
        print("跳过")
    time.sleep(0.3)

df_fin = pd.DataFrame(fin_data)
bank_list = bank_list.merge(df_fin, on="code", how="left")

# 按总市值排序
bank_list = bank_list.sort_values("总市值", ascending=False, na_position="last").reset_index(drop=True)
bank_list.insert(0, "序号", range(1, len(bank_list) + 1))

# 显示
print(f"\n  【银行板块共 {len(bank_list)} 只，按总市值排序】")
print("  " + "-" * 100)
cols_show = ["序号", "code", "name", "price", "市盈率(PE)", "市净率(PB)", "ROE(%)", "总市值"]
print(bank_list[cols_show].to_string(index=False,
    float_format=lambda x: f"{x:.2f}" if pd.notna(x) else "N/A",
    formatters={"code": lambda x: str(x).zfill(6),
                "总市值": lambda x: f"{x:.0f}" if pd.notna(x) else "N/A"}))

# 保存清单
list_path = os.path.join(DATA_DIR, "银行股清单.csv")
bank_list.to_csv(list_path, index=False, encoding="utf-8-sig")
print(f"\n  → 清单已保存: data/银行股清单.csv")


# ============================================================
# 任务 2：前十大银行股自 2020 年以来的历史行情
# ============================================================
print("\n" + "=" * 65)
print("  任务 2：前十大银行股历史日线 (2020-01-01 → 最新)")
print("=" * 65)

top10 = bank_list.head(10)
hist_data = {}  # code → {name, df, date_col, close_col}

for _, row in top10.iterrows():
    code = str(row["code"]).zfill(6)
    name = str(row["name"])
    seq = row["序号"]
    print(f"\n  [{seq:2d}] {name}({code}) ", end="")

    # ── 主源：通达信 bars() ────────────────────────────────
    # mootdx 单次最多 800 根 bar，需要分批拉取
    frames = []
    for batch_start in [0, 800]:
        time.sleep(0.3)
        bars = safe_call(
            tdx.bars, f"{name} 第{batch_start//800+1}批",
            symbol=code, frequency=9, start=batch_start, offset=800,
            retries=1, delay=1,
        )
        if bars is not None and len(bars) > 0:
            frames.append(bars)
        else:
            break

    # ── 兜底：akshare 腾讯源 ───────────────────────────────
    if not frames:
        prefix = "sh" if code.startswith(("6", "9")) else "sz"
        tx_symbol = f"{prefix}{code}"
        df_hist = safe_call(
            ak.stock_zh_a_hist_tx, f"{name} 腾讯源",
            symbol=tx_symbol,
            start_date="20200101", end_date="20260720",
            adjust="qfq",
            retries=2, delay=2,
        )
        if df_hist is None or df_hist.empty:
            print("  → 跳过（无数据）")
            continue
        # 统一列名
        df_hist = df_hist.rename(columns={
            "date": "日期", "open": "开盘", "close": "收盘",
            "high": "最高", "low": "最低", "amount": "成交额",
        })
        df_hist["日期"] = pd.to_datetime(df_hist["日期"])
    else:
        # 合并两批数据
        df_hist = pd.concat(frames, axis=0)
        df_hist = df_hist[~df_hist.index.duplicated(keep="first")]
        df_hist = df_hist.sort_index()

        # 过滤 2020-01-01 之后
        df_hist = df_hist[df_hist.index >= "2020-01-01"]

        # 统一列名
        df_hist = df_hist.rename(columns={
            "open": "开盘", "close": "收盘", "high": "最高",
            "low": "最低", "vol": "成交量", "amount": "成交额",
        })
        df_hist["日期"] = df_hist.index

    df_hist = df_hist.sort_values("日期").reset_index(drop=True)

    csv_path = os.path.join(DATA_DIR, f"{name}_{code}.csv")
    df_hist.to_csv(csv_path, index=False, encoding="utf-8-sig")
    print(f"→ {len(df_hist)} 行  {name}_{code}.csv")

    hist_data[code] = {
        "name": name, "df": df_hist,
        "date_col": "日期", "close_col": "收盘",
    }


# ============================================================
# 可视化
# ============================================================
print("\n" + "=" * 65)
print("  可视化：前十大银行股归一化走势对比 (2020 年起)")
print("=" * 65)

if len(hist_data) >= 2:
    fig, axes = plt.subplots(2, 1, figsize=(16, 10))
    colors = plt.cm.tab10(range(len(hist_data)))

    # ── 图1：归一化走势 (2020-01-01 基准 = 100) ─────────────
    ax1 = axes[0]
    for idx, (code, info) in enumerate(hist_data.items()):
        df = info["df"]
        close_vals = df[info["close_col"]].values
        norm = close_vals / close_vals[0] * 100
        ax1.plot(df[info["date_col"]], norm, color=colors[idx],
                 linewidth=1.2, label=f"{info['name']}({code})", alpha=0.85)

    ax1.axhline(y=100, color="gray", linestyle="--", linewidth=0.6, alpha=0.5)
    ax1.set_title("前十大银行股归一化走势 (2020-01-01 基准 = 100)", fontsize=14, fontweight="bold")
    ax1.set_ylabel("归一化价格 (基准=100)")
    ax1.legend(loc="upper left", fontsize=7, ncol=2, framealpha=0.7)
    ax1.grid(True, alpha=0.3)
    ax1.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f"))

    # ── 图2：累计涨跌幅柱状图 ───────────────────────────────
    ax2 = axes[1]
    names_list, returns_list, bar_colors = [], [], []
    for code, info in hist_data.items():
        close_vals = info["df"][info["close_col"]].values
        ret = (close_vals[-1] / close_vals[0] - 1) * 100
        names_list.append(f"{info['name']}\n{code}")
        returns_list.append(ret)
        bar_colors.append("#d32f2f" if ret >= 0 else "#4caf50")

    bars = ax2.bar(names_list, returns_list, color=bar_colors, alpha=0.85, edgecolor="white")
    ax2.set_title("自 2020 年以来累计涨跌幅 (%)", fontsize=14, fontweight="bold")
    ax2.set_ylabel("涨跌幅 (%)")
    ax2.axhline(y=0, color="black", linewidth=0.6)
    ax2.grid(True, alpha=0.3, axis="y")

    for bar, ret in zip(bars, returns_list):
        y_pos = bar.get_height() + (1 if ret >= 0 else -1.5)
        va = "bottom" if ret >= 0 else "top"
        ax2.text(bar.get_x() + bar.get_width() / 2, y_pos,
                 f"{ret:+.1f}%", ha="center", va=va, fontsize=7, fontweight="bold")

    plt.tight_layout()
    chart_path = os.path.join(PROJ_ROOT, "lab1_bank_top10_chart.png")
    plt.savefig(chart_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"\n  → 图表已保存: lab1_bank_top10_chart.png")
else:
    print("  历史数据不足 (少于2只)，跳过绘图。")


# ── 收尾 ─────────────────────────────────────────────────────
print(f"\n{'=' * 65}")
print(f"  实验一完成！")
print(f"  - 银行股清单: data/银行股清单.csv ({len(bank_list)} 只)")
print(f"  - 历史行情文件 ({len(hist_data)} 只):")
for code, info in hist_data.items():
    print(f"    data/{info['name']}_{code}.csv")
print(f"{'=' * 65}")
