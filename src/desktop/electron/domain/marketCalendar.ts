import { addDays, validDate } from "./dateUtils";
import {
  A_SHARE_MARKET_TIME_ZONE,
  currentMarketDate,
} from "../../shared/marketDate";

export interface TradingCalendarCoverage {
  startDate: string;
  endDate: string;
}

export interface TradeDateContext {
  knownTradingDates: readonly string[];
  /**
   * 仅用于兼容现有调用方的缓存覆盖描述。证券自身没有行情不等于市场休市，
   * 因此 `tradeDateStatus` 不会用它判定 closed。
   */
  coveredRanges?: readonly TradingCalendarCoverage[];
}

/**
 * 上交所《关于上海证券交易所2026年部分节假日休市安排的通知》
 * （上证公告〔2025〕45号）确认的全市场休市区间。
 *
 * 年度安排发布前不猜测未来工作日是否休市；未知日期返回 unknown，让真实
 * 成交事实可以在提示后继续录入。
 */
const CONFIRMED_MARKET_CLOSURES = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
] as const;

function isWeekend(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function isConfirmedMarketClosureDate(date: string): boolean {
  if (!validDate(date)) return false;
  return (
    isWeekend(date) ||
    CONFIRMED_MARKET_CLOSURES.some(
      ([start, end]) => start <= date && date <= end,
    )
  );
}

export function isConfirmedMarketClosureRange(
  startDate: string,
  endDate: string,
): boolean {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    return false;
  }
  for (
    let date = startDate;
    date <= endDate;
    date = addDays(date, 1)
  ) {
    if (!isConfirmedMarketClosureDate(date)) return false;
  }
  return true;
}

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
  while (isConfirmedMarketClosureDate(candidate)) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

export function tradeDateStatus(
  date: string,
  context?: TradeDateContext,
): "trading" | "closed" | "unknown" {
  if (!validDate(date)) return "closed";
  if (isConfirmedMarketClosureDate(date)) return "closed";
  if (!context) return "unknown";
  if (context.knownTradingDates.includes(date)) return "trading";
  return "unknown";
}
