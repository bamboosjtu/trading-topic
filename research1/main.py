"""
Research 1: AI 板块走势可视化
读取 research1/data/*.csv，生成综合走势图
"""
import os
import glob
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
from downloader import AI_STOCKS

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_DIR = os.path.dirname(__file__)
CODE_TO_NAME = {code: name for code, name in AI_STOCKS}

plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei"]
plt.rcParams["axes.unicode_minus"] = False


def load_data(csv_path):
    code = os.path.splitext(os.path.basename(csv_path))[0]
    name = CODE_TO_NAME.get(code, code)
    df = pd.read_csv(csv_path, encoding="utf-8-sig")

    date_col = next((c for c in df.columns if c in ("date", "日期")), df.columns[0])
    close_col = next((c for c in df.columns if c == "close" or "收盘" in c), df.columns[2])

    df[date_col] = pd.to_datetime(df[date_col])
    df = df.set_index(date_col).sort_index()
    return code, name, df[close_col]


def main():
    csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    if not csv_files:
        print("data 目录下无 CSV 文件，请先运行 downloader.py")
        return

    print(f"加载 {len(csv_files)} 只股票数据...")
    records = []
    for fp in csv_files:
        code, name, close_series = load_data(fp)
        records.append((code, name, close_series))

    if not records:
        print("无有效数据")
        return

    # ---- 图1: 全部股票归一化走势 ----
    fig1, ax1 = plt.subplots(figsize=(14, 7))
    for code, name, close in records:
        normed = close / close.iloc[0] * 100
        ax1.plot(normed.index, normed, label=name, linewidth=0.8, alpha=0.8)

    ax1.axhline(y=100, color="gray", linestyle="--", alpha=0.4)
    ax1.set_title(f"AI 板块走势归一化对比 ({len(records)} 只, 起始=100)", fontsize=15)
    ax1.set_ylabel("归一化价格")
    ax1.legend(loc="upper left", fontsize=7, ncol=3)
    ax1.grid(True, alpha=0.3)
    ax1.yaxis.set_major_formatter(FuncFormatter(lambda y, _: f"{y:.0f}"))
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, "research1_normalized.png"), dpi=150)
    plt.close()
    print("→ research1_normalized.png")

    # ---- 图2: 等权组合 vs 个股 ----
    all_closes = pd.DataFrame({name: s for _, name, s in records})
    ew_portfolio = all_closes.mean(axis=1).dropna()
    ew_norm = ew_portfolio / ew_portfolio.iloc[0] * 100

    fig2, ax2 = plt.subplots(figsize=(14, 7))
    for _, name, close in records:
        normed = close / close.iloc[0] * 100
        ax2.plot(normed.index, normed, color="gray", linewidth=0.3, alpha=0.4)
    ax2.plot(ew_norm.index, ew_norm, color="#E53935", linewidth=2.5, label="等权组合")
    ax2.axhline(y=100, color="gray", linestyle="--", alpha=0.4)
    ax2.set_title("AI 板块等权组合走势 (灰线为个股)", fontsize=15)
    ax2.set_ylabel("归一化价格 (起始=100)")
    ax2.legend(fontsize=11)
    ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, "research1_portfolio.png"), dpi=150)
    plt.close()
    print("→ research1_portfolio.png")

    # ---- 图3: 收益率排名柱状图 ----
    returns = {}
    for code, name, close in records:
        ret = (close.iloc[-1] / close.iloc[0] - 1) * 100
        returns[name] = ret
    sorted_ret = sorted(returns.items(), key=lambda x: x[1])

    fig3, ax3 = plt.subplots(figsize=(12, 6))
    names_sorted = [r[0] for r in sorted_ret]
    vals_sorted = [r[1] for r in sorted_ret]
    colors = ["#E53935" if v >= 0 else "#43A047" for v in vals_sorted]
    ax3.barh(names_sorted, vals_sorted, color=colors, alpha=0.8)
    ax3.axvline(x=0, color="black", linewidth=0.8)
    ax3.set_title("AI 板块个股收益率排名 (2024-01 至今)", fontsize=15)
    ax3.set_xlabel("收益率 (%)")
    for i, (name, v) in enumerate(zip(names_sorted, vals_sorted)):
        ax3.text(v + (1 if v >= 0 else -4), i, f"{v:+.1f}%",
                 va="center", fontsize=7)
    ax3.grid(True, alpha=0.3, axis="x")
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, "research1_returns.png"), dpi=150)
    plt.close()
    print("→ research1_returns.png")

    # ---- 控制台摘要 ----
    print(f"\n===== 板块摘要 =====")
    print(f"股票数: {len(records)}")
    top3 = sorted(returns.items(), key=lambda x: x[1], reverse=True)[:3]
    bot3 = sorted_ret[:3]
    print(f"涨幅 TOP3:  {', '.join(f'{n} {v:+.1f}%' for n, v in top3)}")
    print(f"跌幅 TOP3:  {', '.join(f'{n} {v:+.1f}%' for n, v in bot3)}")
    print(f"等权组合收益率: {((ew_portfolio.iloc[-1] / ew_portfolio.iloc[0]) - 1) * 100:+.1f}%")


if __name__ == "__main__":
    main()
