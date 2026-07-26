export const BACKTEST_CALIBER_VERSION = "bank-dca-r1-node-v3";

export const BACKTEST_MAX_SYMBOLS = 10;
export const BACKTEST_RANGE_YEARS = [3, 5, 10, 15] as const;
export const BACKTEST_DETAIL_PAGE_SIZE = 20;
export const BACKTEST_COMPARISON_PAGE_SIZE = 10;
export const BACKTEST_HISTORY_LIMIT = 500;
export const STOCK_UNIVERSE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DATA_SOURCE_THROTTLE_MS = 1_200;

/** 首次启动和全市场目录暂不可用时显示的可验证默认标的。 */
export const DEFAULT_STOCKS = [
  { symbol: "601398", name: "工商银行" },
  { symbol: "601939", name: "建设银行" },
  { symbol: "601288", name: "农业银行" },
  { symbol: "601988", name: "中国银行" },
  { symbol: "600036", name: "招商银行" },
  { symbol: "601166", name: "兴业银行" },
  { symbol: "600016", name: "民生银行" },
] as const;

export const DEFAULT_BACKTEST_SYMBOLS = ["601398", "601288", "601166"] as const;

export const BACKTEST_RANGE_LABELS: Readonly<Record<number, string>> = {
  3: "三年",
  5: "五年",
  10: "十年",
  15: "十五年",
};
