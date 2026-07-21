import unittest

import pandas as pd

from analysis import (
    build_repo_level,
    build_stock_level,
    rolling_backtest,
    simulate_level_dca,
)


class AnalysisTests(unittest.TestCase):
    def test_contribution_does_not_hide_drawdown(self):
        level = pd.Series(
            [100.0, 90.0, 80.0],
            index=pd.to_datetime(["2020-01-02", "2020-01-31", "2020-02-03"]),
        )
        _, summary = simulate_level_dca(level, "2020-01", "2020-02")
        self.assertAlmostEqual(summary["asset_max_drawdown_pct"], -20.0)
        self.assertAlmostEqual(summary["strategy_max_drawdown_pct"], -20.0)
        self.assertAlmostEqual(summary["max_principal_loss_pct"], -10.0)

    def test_cash_dividend_reinvestment_offsets_ex_dividend_drop(self):
        prices = pd.DataFrame({
            "date": pd.to_datetime(["2020-01-02", "2020-01-03"]),
            "close": [100.0, 90.0],
        })
        dividends = pd.DataFrame({
            "date": pd.to_datetime(["2020-01-03"]),
            "cash_dividend_per_share": [10.0],
            "bonus_share_ratio": [0.0],
        })
        level = build_stock_level(prices, dividends, reinvest_dividends=True)
        self.assertAlmostEqual(level.iloc[-1] / level.iloc[0], 1.0)

        price_only = build_stock_level(prices, dividends, reinvest_dividends=False)
        self.assertAlmostEqual(price_only.iloc[-1] / price_only.iloc[0], 0.9)

    def test_bonus_shares_offset_price_adjustment(self):
        prices = pd.DataFrame({
            "date": pd.to_datetime(["2020-01-02", "2020-01-03"]),
            "close": [100.0, 50.0],
        })
        dividends = pd.DataFrame({
            "date": pd.to_datetime(["2020-01-03"]),
            "cash_dividend_per_share": [0.0],
            "bonus_share_ratio": [1.0],
        })
        level = build_stock_level(prices, dividends)
        self.assertAlmostEqual(level.iloc[-1] / level.iloc[0], 1.0)

    def test_repo_rate_uses_actual_calendar_days(self):
        repo = pd.DataFrame({
            "date": pd.to_datetime(["2020-01-03", "2020-01-06"]),
            "rate_pct": [365.0, 365.0],
        })
        level = build_repo_level(repo)
        self.assertAlmostEqual(level.iloc[-1] / level.iloc[0], 1.03)

    def test_rolling_window_ends_in_its_own_month(self):
        dates = pd.date_range("2020-01-02", "2021-12-31", freq="B")
        level = pd.Series(
            [100.0 if date.year == 2020 else 200.0 for date in dates],
            index=dates,
        )
        result = rolling_backtest(level, holding_years=1)
        first = result.iloc[0]
        self.assertEqual(first["end_date"], "2020-12-31")
        self.assertEqual(first["periods"], 12)


if __name__ == "__main__":
    unittest.main()
