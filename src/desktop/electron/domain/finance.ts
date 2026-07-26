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

export interface DrawdownProfile {
  maxDrawdown: number;
  maxDrawdownStart: string;
  maxDrawdownEnd: string;
  maxDrawdownMonths: number;
}

export function drawdownProfile(
  points: Array<{ date: string; value: number }>,
): DrawdownProfile {
  if (!points.length) {
    return {
      maxDrawdown: 0,
      maxDrawdownStart: "",
      maxDrawdownEnd: "",
      maxDrawdownMonths: 0,
    };
  }
  let peakIndex = 0;
  let deepestPeakIndex = 0;
  let troughIndex = 0;
  let maxDrawdown = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].value >= points[peakIndex].value) {
      peakIndex = index;
      continue;
    }
    const drawdown = points[index].value / points[peakIndex].value - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      deepestPeakIndex = peakIndex;
      troughIndex = index;
    }
  }
  if (maxDrawdown === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownStart: "",
      maxDrawdownEnd: "",
      maxDrawdownMonths: 0,
    };
  }
  let recoveryIndex = points.length - 1;
  const peakValue = points[deepestPeakIndex].value;
  for (let index = troughIndex + 1; index < points.length; index += 1) {
    if (points[index].value >= peakValue) {
      recoveryIndex = index;
      break;
    }
  }
  const maxDrawdownStart = points[deepestPeakIndex].date;
  const maxDrawdownEnd = points[recoveryIndex].date;
  return {
    maxDrawdown,
    maxDrawdownStart,
    maxDrawdownEnd,
    maxDrawdownMonths: Math.max(
      0,
      Math.round(daysBetween(maxDrawdownStart, maxDrawdownEnd) / 30.4375),
    ),
  };
}
