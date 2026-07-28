import { currentMarketDate } from "../../../../shared/marketDate";

export function today(): string {
  return currentMarketDate();
}

export function dateYearsAgo(years: number): string {
  const date = new Date(`${currentMarketDate()}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export type BacktestRangePreset = 3 | 5 | 10 | 15 | "custom";
