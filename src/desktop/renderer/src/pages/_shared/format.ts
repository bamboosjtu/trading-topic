/**
 * 渲染层数值格式化与盈亏样式工具。
 *
 * backtest 与 live 页面原本各自维护一套 money/percent/pnlClass 实现，
 * 行为近似但签名与边界处理不一致（是否接受 null、是否支持 signed 前缀、
 * 盈亏 class 前缀不同）。集中到 _shared 后统一边界语义，避免同一概念
 * 在不同页面漂移出不同格式。
 */

const CNY_FORMATTER = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * 格式化为人民币字符串。
 * - null/NaN/Infinity 返回 "—"；
 * - signed=true 且为正数时加 "+" 前缀，便于盈亏场景展示。
 */
export function money(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${CNY_FORMATTER.format(value)}`;
}

/**
 * 格式化为百分比字符串。
 * - null/NaN/Infinity 返回 "—"；
 * - signed=true 且为正数时加 "+" 前缀。
 */
export function percent(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

/** 通用数值格式化，null/NaN/Infinity 返回 "—"。 */
export function numberValue(
  value: number | null,
  digits = 2,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 根据盈亏值返回 CSS 类名。
 *
 * 不同区域使用不同 class 前缀以保留各自配色：
 * - `finance-` 用于 live 页面（finance-profit/loss/flat）；
 * - `stock-` 用于 backtest 页面（stock-profit/loss/flat）。
 *
 * 统一逻辑：null 或 0 → flat，正数 → profit，负数 → loss。
 */
export function pnlClass(
  value: number | null,
  prefix: "finance" | "stock" = "finance",
): string {
  if (value === null || value === 0) return `${prefix}-flat`;
  return value > 0 ? `${prefix}-profit` : `${prefix}-loss`;
}

const BEIJING_DATETIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function beijingPart(date: Date, type: Intl.DateTimeFormatPartTypes): string {
  const value = BEIJING_DATETIME.formatToParts(date).find(
    (item) => item.type === type,
  )?.value;
  if (!value) throw new Error(`无法格式化北京时间：缺少 ${type}`);
  return value;
}

/**
 * 将 UTC ISO 时间戳格式化为北京时间（Asia/Shanghai）的 `YYYY-MM-DD HH:mm:ss`。
 *
 * 存储层统一保存 UTC（`toISOString()`）保证无歧义；展示层统一经本函数换算为
 * 北京时间，避免应用运行在不同系统时区时时间显示漂移。
 */
export function beijingTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${beijingPart(date, "year")}-${beijingPart(date, "month")}-${beijingPart(
    date,
    "day",
  )} ${beijingPart(date, "hour")}:${beijingPart(date, "minute")}:${beijingPart(
    date,
    "second",
  )}`;
}

/** 北京时间（Asia/Shanghai）的日期部分 `YYYY-MM-DD`。 */
export function beijingDate(value: string): string {
  return beijingTimestamp(value).slice(0, 10);
}
