import { addDays, validDate } from "./dateUtils";
import {
  A_SHARE_MARKET_TIME_ZONE,
  currentMarketDate,
} from "../../shared/marketDate";

function marketClock(
  now: Date,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: A_SHARE_MARKET_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour"), minute: value("minute") };
}

/**
 * 使用已知交易日历确定最近已完成交易日。
 *
 * 收盘后保留十分钟数据落盘缓冲，15:10 前不把当日视为正式收盘。
 */
export function latestCompletedTradingDate(
  now: Date,
  marketCalendar: readonly string[],
): string | null {
  const today = currentMarketDate(now);
  const { hour, minute } = marketClock(now);
  const afterClose = hour > 15 || (hour === 15 && minute >= 10);
  const upperBound = afterClose ? today : addDays(today, -1);
  return (
    [...new Set(marketCalendar)]
      .filter(validDate)
      .filter((date) => date <= upperBound)
      .sort()
      .at(-1) ?? null
  );
}

export function latestTradingDateInMonth(
  month: string,
  marketCalendar: readonly string[],
): string | null {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("月份必须使用 YYYY-MM 格式");
  }
  return (
    [...new Set(marketCalendar)]
      .filter(validDate)
      .filter((date) => date.startsWith(month))
      .sort()
      .at(-1) ?? null
  );
}

/**
 * 首次联网且本地还没有交易日历时的保守请求上界。
 * 该函数只决定请求范围；最终数据截止日仍由返回的正式日线决定。
 */
export function latestWeekdayCandidate(now: Date = new Date()): string {
  const today = currentMarketDate(now);
  const { hour, minute } = marketClock(now);
  let candidate =
    hour > 15 || (hour === 15 && minute >= 10)
      ? today
      : addDays(today, -1);
  while ([0, 6].includes(new Date(`${candidate}T00:00:00Z`).getUTCDay())) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}
