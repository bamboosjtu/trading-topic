export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysBetween(a: string, b: string): number {
  return (
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) /
    86_400_000
  );
}

export function xirr(
  cashflows: Array<{ date: string; amount: number }>,
): number | null {
  if (
    cashflows.length < 2 ||
    !cashflows.some((item) => item.amount < 0) ||
    !cashflows.some((item) => item.amount > 0)
  ) {
    return null;
  }

  const start = cashflows[0].date;
  const valueAt = (rate: number): number =>
    cashflows.reduce(
      (sum, item) =>
        sum +
        item.amount /
          (1 + rate) ** (daysBetween(start, item.date) / 365.25),
      0,
    );

  let low = -0.9999;
  let high = 1;
  let lowValue = valueAt(low);
  let highValue = valueAt(high);
  for (let i = 0; i < 24 && lowValue * highValue > 0; i += 1) {
    high *= 2;
    highValue = valueAt(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;
  if (lowValue * highValue > 0) return null;

  for (let i = 0; i < 120; i += 1) {
    const middle = (low + high) / 2;
    const middleValue = valueAt(middle);
    if (Math.abs(middleValue) < 1e-7) return middle;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
}

export function maximumDrawdown(values: number[]): number {
  let peak = 0;
  let maximum = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maximum = Math.min(maximum, value / peak - 1);
  }
  return maximum;
}
