import { addDays, validDate } from "./dateUtils";
import {
  A_SHARE_MARKET_TIME_ZONE,
  currentMarketDate,
} from "../../shared/marketDate";
import calendar2024 from "../data/market-calendar/2024.json";
import calendar2025 from "../data/market-calendar/2025.json";
import calendar2026 from "../data/market-calendar/2026.json";
import calendar2027 from "../data/market-calendar/2027.json";

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

interface AnnualMarketCalendar {
  year: number;
  status: "official" | "pending_official_schedule";
  source: string | null;
  closures: Array<[string, string]>;
}

/**
 * 已发布年度安排使用上交所正式公告；尚未发布的年度只保留空文件和待更新
 * 状态，不猜测工作日休市。周末由独立规则处理。
 */
const ANNUAL_MARKET_CALENDARS = [
  calendar2024,
  calendar2025,
  calendar2026,
  calendar2027,
] as AnnualMarketCalendar[];
const CONFIRMED_MARKET_CLOSURES = ANNUAL_MARKET_CALENDARS
  .filter((calendar) => calendar.status === "official")
  .flatMap((calendar) => calendar.closures);

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
