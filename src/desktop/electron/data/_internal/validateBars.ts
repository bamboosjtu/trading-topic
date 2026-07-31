/**
 * OHLCV 日线数值校验的共享规则。
 *
 * tencent.ts 与 sina.ts 原本各自维护 OHLCV 关系校验：tencent 在解析腾讯
 * 响应时严格抛错，sina 在解码 KLC 时仅检查 `Number.isFinite` 而未校验
 * high/low 与 open/close 的大小关系。集中到此处后两源采用同一口径，
 * 避免数据源切换时静默放过异常 K 线。
 *
 * AGENTS.md 规定三域间（labs/research/src）的相似适配器是有意重复，
 * 但同一域内（src/desktop）的 tencent 与 sina 之间的重复应收敛于此。
 */

export interface OhlcvValues {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 校验单根 OHLCV 日线的数值合理性。
 *
 * 规则：
 * - open、close、high、low、volume 均为有限数值；
 * - open > 0、close > 0、low > 0（high > 0 由 `high >= max(open, close)` 隐含）；
 * - high >= max(open, close)；
 * - low <= min(open, close)（同时隐含 high >= low）；
 * - volume >= 0。
 *
 * 不抛异常，调用方自行决定是抛出（如 tencent 的严格模式）还是过滤（如 sina 的宽松模式）。
 */
export function isValidOhlcv(values: OhlcvValues): boolean {
  const { open, close, high, low, volume } = values;
  if (![open, close, high, low, volume].every(Number.isFinite)) return false;
  if (open <= 0 || close <= 0 || low <= 0) return false;
  if (high < Math.max(open, close)) return false;
  if (low > Math.min(open, close)) return false;
  if (volume < 0) return false;
  return true;
}
