/**
 * backtest 页面格式化入口：统一从 _shared/format 复用，
 * 保留本模块作为 backtest 域的稳定导入路径，避免各组件直接依赖 _shared。
 */
export {
  money,
  percent,
  pnlClass,
  beijingTimestamp,
} from "../_shared/format";

/**
 * 将年份列表格式化为连续区间字符串。
 *
 * 连续年份合并为 `start—end`，多段区间以「、」分隔；
 * 单年保持原样。空数组返回空串。
 *
 * 用于展示「未覆盖正式交易日历年份」等需要合并连续年份的场景。
 */
export function formatYearRanges(years: readonly number[]): string {
  if (!years.length) return "";
  const sorted = [...years].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}—${end}`);
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}—${end}`);
  return ranges.join("、");
}
