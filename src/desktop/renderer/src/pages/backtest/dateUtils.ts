export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export type BacktestRangePreset = 3 | 5 | 10 | 15 | "custom";
