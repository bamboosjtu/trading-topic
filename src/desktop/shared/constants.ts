export const BACKTEST_CALIBER_VERSION = "bank-dca-r1-node-v3";

export const BACKTEST_MAX_SYMBOLS = 10;
export const BACKTEST_RANGE_YEARS = [3, 5, 10, 15] as const;
export const BACKTEST_DETAIL_PAGE_SIZE = 20;
export const BACKTEST_EXPERIMENT_LIMIT = 500;
export const STOCK_UNIVERSE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
/** 低于该数量的目录视为不完整，不能冒充全 A 股快照。 */
export const STOCK_UNIVERSE_MIN_SIZE = 1_000;
export const DATA_SOURCE_THROTTLE_MS = 1_200;

export const DEFAULT_BACKTEST_SYMBOLS = ["601398", "601288", "601166"] as const;

export const BACKTEST_RANGE_LABELS: Readonly<Record<number, string>> = {
  3: "三年",
  5: "五年",
  10: "十年",
  15: "十五年",
};
