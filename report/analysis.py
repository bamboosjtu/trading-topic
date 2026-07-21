"""报告的纯分析层：构建总回报序列、定投回测和滚动比较。"""

from __future__ import annotations

import numpy as np
import pandas as pd


MONTHLY_AMOUNT = 3000.0


def calc_xirr(cashflows, dates):
    """计算仅含持续投入和期末赎回场景的年化内部收益率。"""
    if len(cashflows) < 2:
        return np.nan
    dates = [pd.Timestamp(date) for date in dates]
    years = np.array(
        [(date - dates[0]).total_seconds() / (365.25 * 86400) for date in dates]
    )
    values = np.asarray(cashflows, dtype=float)
    if np.all(values >= 0) or np.all(values <= 0):
        return np.nan

    guess = 0.05
    for _ in range(200):
        npv = np.sum(values / (1.0 + guess) ** years)
        derivative = np.sum(-years * values / (1.0 + guess) ** (years + 1))
        if abs(derivative) < 1e-12:
            break
        new_guess = max(guess - npv / derivative, -0.99)
        if abs(new_guess - guess) < 1e-10:
            return float(new_guess)
        guess = new_guess
    residual = abs(np.sum(values / (1.0 + guess) ** years))
    return float(guess) if residual < 1e-6 else np.nan


def build_stock_level(prices, dividends, reinvest_dividends=True):
    """由不复权价格和公司行动构建可投资的总回报价格序列。"""
    frame = prices[["date", "close"]].copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.drop_duplicates("date", keep="last").sort_values("date")

    events = dividends[["date", "cash_dividend_per_share", "bonus_share_ratio"]].copy()
    events["date"] = pd.to_datetime(events["date"])
    events = events.groupby("date", as_index=False).sum(numeric_only=True)
    frame = frame.merge(events, on="date", how="left")
    frame[["cash_dividend_per_share", "bonus_share_ratio"]] = frame[
        ["cash_dividend_per_share", "bonus_share_ratio"]
    ].fillna(0.0)
    if not reinvest_dividends:
        frame["cash_dividend_per_share"] = 0.0
        frame["bonus_share_ratio"] = 0.0

    closes = frame["close"].to_numpy(dtype=float)
    cash = frame["cash_dividend_per_share"].to_numpy(dtype=float)
    bonus = frame["bonus_share_ratio"].to_numpy(dtype=float)
    if np.any(closes <= 0):
        raise ValueError("不复权收盘价必须全部为正数")

    levels = np.empty(len(frame), dtype=float)
    levels[0] = closes[0]
    for position in range(1, len(frame)):
        gross_return = (
            closes[position] * (1.0 + bonus[position]) + cash[position]
        ) / closes[position - 1]
        levels[position] = levels[position - 1] * gross_return

    return pd.Series(levels, index=pd.DatetimeIndex(frame["date"]), name="level")


def build_index_level(index_frame):
    frame = index_frame[["date", "close"]].copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.dropna().drop_duplicates("date", keep="last").sort_values("date")
    if (frame["close"] <= 0).any():
        raise ValueError("指数收盘值必须全部为正数")
    return pd.Series(
        frame["close"].to_numpy(dtype=float),
        index=pd.DatetimeIndex(frame["date"]),
        name="level",
    )


def build_repo_level(repo_frame):
    """将204001年化定盘利率转换为连续滚动的一天期逆回购净值。"""
    frame = repo_frame[["date", "rate_pct"]].copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.dropna().drop_duplicates("date", keep="last").sort_values("date")
    rates = frame["rate_pct"].to_numpy(dtype=float)
    dates = pd.DatetimeIndex(frame["date"])

    levels = np.ones(len(frame), dtype=float) * 100.0
    for position in range(1, len(frame)):
        calendar_days = (dates[position] - dates[position - 1]).days
        levels[position] = levels[position - 1] * (
            1.0 + rates[position - 1] / 100.0 * calendar_days / 365.0
        )
    return pd.Series(levels, index=dates, name="level")


def simulate_level_dca(
    level,
    start_ym,
    end_ym,
    *,
    valuation_end_ym=None,
    monthly_amount=MONTHLY_AMOUNT,
):
    """对任意可投资总回报净值序列执行统一的月度定投回测。"""
    start_ym = pd.Period(start_ym, "M")
    end_ym = pd.Period(end_ym, "M")
    valuation_end_ym = (
        pd.Period(valuation_end_ym, "M") if valuation_end_ym is not None else None
    )
    level = level.dropna().sort_index()
    level = level[~level.index.duplicated(keep="last")]
    periods = level.index.to_period("M")

    eligible = level[(periods >= start_ym) & (periods <= end_ym)]
    if eligible.empty:
        return None, None
    invest_dates = eligible.groupby(eligible.index.to_period("M")).head(1).index

    first_date = invest_dates[0]
    if valuation_end_ym is None:
        last_date = level.index[-1]
    else:
        valuation_dates = level.index[level.index.to_period("M") <= valuation_end_ym]
        if len(valuation_dates) == 0 or valuation_dates[-1] < first_date:
            return None, None
        last_date = valuation_dates[-1]

    daily = pd.DataFrame({"level": level.loc[first_date:last_date]})
    daily["external_flow"] = 0.0
    daily.loc[invest_dates, "external_flow"] = monthly_amount
    daily["units_bought"] = daily["external_flow"] / daily["level"]
    daily["total_units"] = daily["units_bought"].cumsum()
    daily["total_invested"] = daily["external_flow"].cumsum()
    daily["portfolio_value"] = daily["total_units"] * daily["level"]
    daily["pnl_on_principal"] = (
        daily["portfolio_value"] / daily["total_invested"] - 1.0
    )

    daily["asset_nav"] = daily["level"] / daily["level"].iloc[0]
    asset_peak = daily["asset_nav"].cummax()
    daily["asset_drawdown"] = daily["asset_nav"] / asset_peak - 1.0

    prior_value = daily["portfolio_value"].shift(1)
    daily["strategy_return"] = (
        (daily["portfolio_value"] - daily["external_flow"]) / prior_value - 1.0
    )
    daily.iloc[0, daily.columns.get_loc("strategy_return")] = 0.0
    daily["strategy_nav"] = (1.0 + daily["strategy_return"]).cumprod()
    strategy_peak = daily["strategy_nav"].cummax()
    daily["strategy_drawdown"] = daily["strategy_nav"] / strategy_peak - 1.0

    final_value = float(daily["portfolio_value"].iloc[-1])
    total_invested = float(daily["total_invested"].iloc[-1])
    cashflows = [-monthly_amount] * len(invest_dates) + [final_value]
    cashflow_dates = list(invest_dates) + [last_date]
    xirr = calc_xirr(cashflows, cashflow_dates)

    summary = {
        "periods": len(invest_dates),
        "start_date": first_date.strftime("%Y-%m-%d"),
        "end_date": last_date.strftime("%Y-%m-%d"),
        "total_invested": total_invested,
        "final_value": final_value,
        "total_return_pct": (final_value / total_invested - 1.0) * 100.0,
        "xirr_pct": xirr * 100.0 if not np.isnan(xirr) else np.nan,
        "max_principal_loss_pct": min(
            0.0, float(daily["pnl_on_principal"].min()) * 100.0
        ),
        "asset_max_drawdown_pct": float(daily["asset_drawdown"].min()) * 100.0,
        "strategy_max_drawdown_pct": float(daily["strategy_drawdown"].min()) * 100.0,
    }
    return daily.reset_index(names="date"), summary


def rolling_backtest(level, holding_years):
    """生成固定期限、各自到期月估值的全部滚动定投窗口。"""
    level = level.dropna().sort_index()
    first_month = level.index[0].to_period("M")
    last_month = level.index[-1].to_period("M")
    rows = []
    required_periods = holding_years * 12

    for start_ym in pd.period_range(first_month, last_month, freq="M"):
        end_ym = start_ym + required_periods - 1
        if end_ym > last_month:
            break
        _, summary = simulate_level_dca(
            level,
            start_ym,
            end_ym,
            valuation_end_ym=end_ym,
        )
        if summary is None or summary["periods"] != required_periods:
            continue
        rows.append({
            "start_ym": str(start_ym),
            "end_ym": str(end_ym),
            "holding_years": holding_years,
            **summary,
        })
    return pd.DataFrame(rows)
