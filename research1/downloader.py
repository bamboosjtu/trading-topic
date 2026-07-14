"""
A股 AI 板块股票历史行情下载器
数据源: 腾讯 (akshare stock_zh_a_hist_tx)，东财被封时自动降级
"""
import os
import time
import akshare as ak
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
START_DATE = "20240101"
END_DATE = "20250714"
ADJUST = "qfq"  # 前复权

AI_STOCKS = [
    ("000977", "浪潮信息"),
    ("002230", "科大讯飞"),
    ("002236", "大华股份"),
    ("002373", "千方科技"),
    ("002405", "四维图新"),
    ("002415", "海康威视"),
    ("002920", "德赛西威"),
    ("300033", "同花顺"),
    ("300229", "拓尔思"),
    ("300253", "卫宁健康"),
    ("300418", "昆仑万维"),
    ("300474", "景嘉微"),
    ("300496", "中科创达"),
    ("300624", "万兴科技"),
    ("300750", "宁德时代"),
    ("300760", "迈瑞医疗"),
    ("600536", "中国软件"),
    ("600570", "恒生电子"),
    ("601138", "工业富联"),
    ("601360", "三六零"),
    ("603019", "中科曙光"),
    ("603486", "科沃斯"),
    ("688008", "澜起科技"),
    ("688041", "海光信息"),
    ("688088", "虹软科技"),
    ("688169", "石头科技"),
    ("688207", "格灵深瞳"),
    ("688256", "寒武纪"),
    ("688327", "云从科技"),
    ("688343", "云天励飞"),
]

os.makedirs(DATA_DIR, exist_ok=True)


def stock_code_to_tx(code):
    """akshare stock_zh_a_hist_tx 需要 sz/sh 前缀"""
    if code.startswith(("0", "3")):
        return f"sz{code}"
    elif code.startswith("6"):
        return f"sh{code}"
    return code


def download_one(code, name):
    csv_path = os.path.join(DATA_DIR, f"{code}.csv")

    if os.path.exists(csv_path):
        print(f"  [{code} {name}] 已存在，跳过")
        return True

    tx_symbol = stock_code_to_tx(code)
    try:
        df = ak.stock_zh_a_hist_tx(
            symbol=tx_symbol,
            start_date=START_DATE,
            end_date=END_DATE,
            adjust=ADJUST,
        )
    except Exception as e:
        print(f"  [{code} {name}] 腾讯源失败: {e}，尝试东财源...")
        try:
            df = ak.stock_zh_a_hist(
                symbol=code, period="daily",
                start_date=START_DATE, end_date=END_DATE, adjust=ADJUST,
            )
        except Exception as e2:
            print(f"  [{code} {name}] 东财源也失败: {e2}")
            return False

    if df is None or df.empty:
        print(f"  [{code} {name}] 返回数据为空")
        return False

    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    print(f"  [{code} {name}] 下载成功 → {len(df)} 条")
    return True


def main():
    print(f"AI 板块共 {len(AI_STOCKS)} 只股票")
    print(f"数据范围: {START_DATE} ~ {END_DATE}, 复权: {ADJUST}")
    print(f"保存目录: {DATA_DIR}\n")

    success, fail = 0, 0
    for code, name in AI_STOCKS:
        ok = download_one(code, name)
        if ok:
            success += 1
        else:
            fail += 1
        time.sleep(0.5)

    print(f"\n完成: 成功 {success}, 失败 {fail} / {len(AI_STOCKS)}")


if __name__ == "__main__":
    main()
