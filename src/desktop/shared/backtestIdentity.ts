import { BACKTEST_CALIBER_VERSION } from "./constants";
import type { BacktestRequest } from "./contracts";

interface StrategyIdentity {
  caliberVersion: string;
  symbol: string;
  range: string;
  monthlyAmount: number;
  buyDay: number;
  dividendTiming: "ex_date" | "payment_date";
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildBacktestStrategyKey(
  request: BacktestRequest,
  symbol: string,
): string {
  const identity: StrategyIdentity = {
    caliberVersion: request.caliberVersion ?? BACKTEST_CALIBER_VERSION,
    symbol,
    range: request.rangeYears
      ? `${request.rangeYears}y`
      : `${request.startDate}:${request.endDate}`,
    monthlyAmount: normalizeMoney(request.monthlyAmount),
    buyDay: request.buyDay,
    dividendTiming: request.dividendTiming ?? "ex_date",
  };
  return JSON.stringify(identity);
}
