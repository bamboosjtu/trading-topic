/**
 * 领域层共享的日期工具。
 *
 * 所有函数都按 UTC 解释 `YYYY-MM-DD` 字符串，避免本地时区影响。
 * 输入只接受严格 ISO 日期；调用方需要先用 {@link validDate} 校验。
 */

/** 判断字符串是否为合法的 `YYYY-MM-DD` 日期。 */
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
  );
}

/** 在 `YYYY-MM-DD` 上加减天数，返回同格式字符串。 */
export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 计算两个 `YYYY-MM-DD` 日期之间的天数差（`b - a`）。
 *
 * 由于输入只到日精度，结果恒为整数；保留浮点返回值是为了让 XIRR 等需要
 * 小数天数的场景可以直接复用同一实现。
 */
export function daysBetween(a: string, b: string): number {
  return (
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) /
    86_400_000
  );
}
