import { daysBetween } from "./dateUtils";

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
  maxDrawdownPeakDate: string;
  maxDrawdownTroughDate: string;
  longestDrawdownMonths: number;
  longestDrawdownStart: string;
  longestDrawdownEnd: string;
  longestDrawdownRecovered: boolean;
}

export function drawdownProfile(
  points: Array<{ date: string; value: number }>,
): DrawdownProfile {
  const emptyProfile: DrawdownProfile = {
    maxDrawdown: 0,
    maxDrawdownPeakDate: "",
    maxDrawdownTroughDate: "",
    longestDrawdownMonths: 0,
    longestDrawdownStart: "",
    longestDrawdownEnd: "",
    longestDrawdownRecovered: true,
  };
  if (!points.length) {
    return emptyProfile;
  }

  let peakIndex = 0;
  let deepestPeakIndex = 0;
  let troughIndex = 0;
  let maxDrawdown = 0;

  let activeDrawdownStartIndex: number | null = null;
  let longestDrawdownStartIndex: number | null = null;
  let longestDrawdownEndIndex: number | null = null;
  let longestDrawdownDays = -1;
  let longestDrawdownRecovered = true;

  const recordDrawdownPeriod = (
    startIndex: number,
    endIndex: number,
    recovered: boolean,
  ) => {
    const duration = daysBetween(
      points[startIndex].date,
      points[endIndex].date,
    );
    if (duration > longestDrawdownDays) {
      longestDrawdownDays = duration;
      longestDrawdownStartIndex = startIndex;
      longestDrawdownEndIndex = endIndex;
      longestDrawdownRecovered = recovered;
    }
  };

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].value >= points[peakIndex].value) {
      if (activeDrawdownStartIndex !== null) {
        recordDrawdownPeriod(activeDrawdownStartIndex, index, true);
        activeDrawdownStartIndex = null;
      }
      peakIndex = index;
      continue;
    }

    if (activeDrawdownStartIndex === null) {
      activeDrawdownStartIndex = peakIndex;
    }
    const drawdown = points[index].value / points[peakIndex].value - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      deepestPeakIndex = peakIndex;
      troughIndex = index;
    }
  }

  if (activeDrawdownStartIndex !== null) {
    recordDrawdownPeriod(
      activeDrawdownStartIndex,
      points.length - 1,
      false,
    );
  }

  if (maxDrawdown === 0) {
    return emptyProfile;
  }

  const longestDrawdownStart =
    longestDrawdownStartIndex === null
      ? ""
      : points[longestDrawdownStartIndex].date;
  const longestDrawdownEnd =
    longestDrawdownEndIndex === null
      ? ""
      : points[longestDrawdownEndIndex].date;
  return {
    maxDrawdown,
    maxDrawdownPeakDate: points[deepestPeakIndex].date,
    maxDrawdownTroughDate: points[troughIndex].date,
    longestDrawdownMonths: Math.max(
      0,
      Math.round(longestDrawdownDays / 30.4375),
    ),
    longestDrawdownStart,
    longestDrawdownEnd,
    longestDrawdownRecovered,
  };
}
