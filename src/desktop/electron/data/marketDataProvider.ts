import type {
  AdjustedBar,
  MarketDataProvenance,
  PricePoint,
} from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import {
  fetchAdjustedBars as fetchTencentAdjustedBars,
  fetchUnadjustedPrices as fetchTencentUnadjustedPrices,
} from "./tencent";
import {
  fetchSinaAdjustedBars,
  fetchSinaUnadjustedPrices,
} from "./sina";
import { latestCompletedTradingDate } from "../domain/marketCalendar";
import { currentMarketDate, daysBetween, validDate } from "../domain/dateUtils";

export interface MarketDataProvider {
  readonly source: "tencent" | "sina";
  fetchPrices(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<PricePoint[]>;
  fetchAdjustedBars(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<AdjustedBar[]>;
}

export const tencentProvider: MarketDataProvider = {
  source: "tencent",
  async fetchPrices(symbol, startDate, endDate) {
    return (await fetchTencentUnadjustedPrices(symbol, startDate, endDate)).rows;
  },
  async fetchAdjustedBars(symbol, startDate, endDate) {
    return (await fetchTencentAdjustedBars(symbol, startDate, endDate)).rows;
  },
};

export const sinaProvider: MarketDataProvider = {
  source: "sina",
  fetchPrices: fetchSinaUnadjustedPrices,
  fetchAdjustedBars: fetchSinaAdjustedBars,
};

function assertDates(
  rows: readonly { date: string }[],
  label: string,
): void {
  let previous = "";
  for (const row of rows) {
    if (!validDate(row.date)) throw new Error(`${label}包含非法交易日期`);
    const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) {
      throw new Error(`${label}把周末标记为交易日`);
    }
    if (previous && row.date <= previous) {
      throw new Error(`${label}交易日期必须严格升序且不重复`);
    }
    if (previous && daysBetween(previous, row.date) > 120) {
      throw new Error(`${label}请求区间存在超过 120 天的异常行情缺口`);
    }
    previous = row.date;
  }
}

export function validatePricePoints(
  rows: readonly PricePoint[],
  symbol: string,
  source: string,
): void {
  if (!/^\d{6}$/.test(symbol)) throw new Error("行情证券代码不合法");
  if (!rows.length) throw new Error(`${symbol} 未取得${source}不复权日线`);
  assertDates(rows, `${source}行情`);
  if (rows.some((row) => !Number.isFinite(row.close) || row.close <= 0)) {
    throw new Error(`${source}行情包含非法收盘价`);
  }
}

export function validateAdjustedBars(
  rows: readonly AdjustedBar[],
  symbol: string,
  source: string,
): void {
  if (!/^\d{6}$/.test(symbol)) throw new Error("行情证券代码不合法");
  if (!rows.length) throw new Error(`${symbol} 未取得${source}前复权日线`);
  assertDates(rows, `${source}行情`);
  for (const row of rows) {
    const values = [row.open, row.high, row.low, row.close, row.volume];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${source}行情包含非有限数值`);
    }
    if (
      row.open <= 0 ||
      row.high <= 0 ||
      row.low <= 0 ||
      row.close <= 0 ||
      row.volume < 0 ||
      row.high < Math.max(row.open, row.close) ||
      row.low > Math.min(row.open, row.close) ||
      row.high < row.low
    ) {
      throw new Error(`${source}行情 OHLCV 关系不合法`);
    }
  }
}

function assertRequestedRange(
  rows: readonly { date: string }[],
  startDate: string,
  endDate: string,
  source: string,
): void {
  if (rows.some((row) => row.date < startDate || row.date > endDate)) {
    throw new Error(`${source}行情返回了请求区间之外的交易日`);
  }
}

export function assertCrossProviderConsistency(
  tencentRows: readonly PricePoint[],
  sinaRows: readonly PricePoint[],
  tolerance = 0.02,
): void {
  const primary = new Map(tencentRows.map((row) => [row.date, row.close]));
  let overlaps = 0;
  for (const row of sinaRows) {
    const reference = primary.get(row.date);
    if (reference === undefined) continue;
    overlaps += 1;
    if (Math.abs(row.close / reference - 1) > tolerance) {
      throw new Error("腾讯与新浪行情结果不一致，本次收益计算已停止");
    }
  }
  if (tencentRows.length && sinaRows.length && overlaps === 0) {
    throw new Error("腾讯与新浪行情没有可校验的重叠交易日，本次收益计算已停止");
  }
}

function completedRows<T extends { date: string }>(
  rows: readonly T[],
  endDate: string,
  now: Date,
): T[] {
  if (endDate < currentMarketDate(now)) return [...rows];
  const cutoff = latestCompletedTradingDate(
    now,
    rows.map((row) => row.date),
  );
  return cutoff ? rows.filter((row) => row.date <= cutoff) : [];
}

function provenance(
  source: "tencent" | "sina",
  rows: readonly { date: string }[],
  adjustment: "none" | "qfq",
  fetchedAt: string,
  fallbackReason?: string,
): MarketDataProvenance {
  return {
    source,
    primarySource: "tencent",
    fallbackUsed: source === "sina",
    ...(fallbackReason ? { fallbackReason } : {}),
    fetchedAt,
    dataCutoff: rows.at(-1)?.date ?? null,
    adjustment,
  };
}

export async function fetchWithProviderFallback<T extends { date: string }>(
  operation: "prices" | "bars",
  symbol: string,
  startDate: string,
  endDate: string,
  primary: MarketDataProvider,
  fallback: MarketDataProvider,
  now = new Date(),
): Promise<{ rows: T[]; provenance: MarketDataProvenance }> {
  let primaryCandidate: readonly PricePoint[] = [];
  let primaryFailureReason: string | null = null;
  try {
    const raw =
      operation === "prices"
        ? await primary.fetchPrices(symbol, startDate, endDate)
        : await primary.fetchAdjustedBars(symbol, startDate, endDate);
    const rows = completedRows(raw, endDate, now) as unknown as T[];
    assertRequestedRange(rows, startDate, endDate, "腾讯");
    primaryCandidate = (
      operation === "prices"
        ? rows
        : (rows as unknown as AdjustedBar[]).map(({ date, close }) => ({
            date,
            close,
          }))
    ) as readonly PricePoint[];
    if (!rows.length) {
      primaryFailureReason = "腾讯在请求区间返回合法空数据";
    } else if (operation === "prices") {
      validatePricePoints(primaryCandidate, symbol, "腾讯");
    } else {
      validateAdjustedBars(rows as unknown as AdjustedBar[], symbol, "腾讯");
    }
    if (rows.length) {
      return {
        rows,
        provenance: provenance(
          "tencent",
          rows,
          operation === "prices" ? "none" : "qfq",
          now.toISOString(),
        ),
      };
    }
  } catch (error) {
    primaryFailureReason =
      error instanceof Error ? error.message : String(error);
  }

  const reason = primaryFailureReason ?? "腾讯行情不可用";
  try {
    const raw =
      operation === "prices"
        ? await fallback.fetchPrices(symbol, startDate, endDate)
        : await fallback.fetchAdjustedBars(symbol, startDate, endDate);
    const rows = completedRows(raw, endDate, now) as unknown as T[];
    assertRequestedRange(rows, startDate, endDate, "新浪");
    if (!rows.length) {
      if (primaryCandidate.length) {
        throw new Error("新浪返回空区间，无法验证腾讯的异常候选行情");
      }
      return {
        rows,
        provenance: provenance(
          primaryFailureReason?.includes("合法空数据") ? "tencent" : "sina",
          rows,
          operation === "prices" ? "none" : "qfq",
          now.toISOString(),
          primaryFailureReason?.includes("合法空数据") ? undefined : reason,
        ),
      };
    }
    if (operation === "prices") {
      const priceRows = rows as unknown as PricePoint[];
      validatePricePoints(priceRows, symbol, "新浪");
      if (primaryCandidate.length) {
        assertCrossProviderConsistency(primaryCandidate, priceRows);
      }
    } else {
      const bars = rows as unknown as AdjustedBar[];
      validateAdjustedBars(bars, symbol, "新浪");
      if (primaryCandidate.length) {
        assertCrossProviderConsistency(
          primaryCandidate,
          bars.map(({ date, close }) => ({ date, close })),
        );
      }
    }
    return {
      rows,
      provenance: provenance(
        "sina",
        rows,
        operation === "prices" ? "none" : "qfq",
        now.toISOString(),
        reason,
      ),
    };
  } catch (fallbackError) {
    const fallbackMessage =
      fallbackError instanceof Error
        ? fallbackError.message
        : String(fallbackError);
    throw new Error(
      `腾讯行情不可用（${reason}）；新浪完整区间兜底失败（${fallbackMessage}）`,
    );
  }
}

export async function fetchMarketPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{
  rows: PricePoint[];
  provenance: MarketDataProvenance & { caliberVersion: string };
}> {
  const result = await fetchWithProviderFallback<PricePoint>(
    "prices",
    symbol,
    startDate,
    endDate,
    tencentProvider,
    sinaProvider,
  );
  return {
    rows: result.rows,
    provenance: {
      ...result.provenance,
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

export async function fetchMarketAdjustedBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{
  rows: AdjustedBar[];
  provenance: MarketDataProvenance & { caliberVersion: string };
}> {
  const result = await fetchWithProviderFallback<AdjustedBar>(
    "bars",
    symbol,
    startDate,
    endDate,
    tencentProvider,
    sinaProvider,
  );
  return {
    rows: result.rows,
    provenance: {
      ...result.provenance,
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}
