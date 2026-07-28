export const A_SHARE_MARKET_TIME_ZONE = "Asia/Shanghai";

/**
 * 返回指定时刻在 A 股市场时区对应的自然日。
 *
 * `recordedAt` 使用 UTC ISO 时间戳；业务日期统一通过本函数生成。
 */
export function currentMarketDate(
  now: Date = new Date(),
  timeZone = A_SHARE_MARKET_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((item) => item.type === type)?.value;
    if (!value) throw new Error(`无法生成市场业务日期：缺少 ${type}`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}
