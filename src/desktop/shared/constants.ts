export const BACKTEST_CALIBER_VERSION = "bank-dca-r1-node-v3";

export const SUPPORTED_BANKS = [
  { symbol: "601398", name: "工商银行" },
  { symbol: "601939", name: "建设银行" },
  { symbol: "601288", name: "农业银行" },
  { symbol: "601988", name: "中国银行" },
  { symbol: "600036", name: "招商银行" },
  { symbol: "601166", name: "兴业银行" },
  { symbol: "600016", name: "民生银行" },
] as const;

export const SUPPORTED_BANK_NAME_BY_SYMBOL: Readonly<Record<string, string>> =
  Object.fromEntries(SUPPORTED_BANKS.map(({ symbol, name }) => [symbol, name]));
