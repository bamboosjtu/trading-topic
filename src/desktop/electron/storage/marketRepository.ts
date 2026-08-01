import BetterSqlite3 from "better-sqlite3";
import type {
  MarketDataCacheEntry,
  StoredMarketCoverage,
  StoredMarketPrice,
} from "../../shared/contracts";
import { buildInsertSql, rows } from "./dbUtil";

/**
 * market_prices / live_market_prices 共享的列定义与行映射。
 *
 * 两张表的非 live 列完全一致（symbol..adjustment），live 表通过 coverage_id
 * 关联 live_market_coverage。集中列定义避免 INSERT 与 SELECT
 * 在多处各写一份、漂移后不易发现。
 */
export const MARKET_PRICE_COLUMNS = [
  "symbol",
  "trade_date",
  "close",
  "source",
  "primary_source",
  "fallback_used",
  "fallback_reason",
  "fetched_at",
  "data_cutoff",
  "adjustment",
] as const;
export const LIVE_MARKET_PRICE_COLUMNS = [
  ...MARKET_PRICE_COLUMNS,
  "coverage_id",
] as const;
export const LIVE_MARKET_COVERAGE_COLUMNS = [
  "coverage_id",
  "symbol",
  "requested_from",
  "requested_through",
  "source",
  "primary_source",
  "fallback_used",
  "fallback_reason",
  "fetched_at",
  "data_cutoff",
  "adjustment",
  "empty_evidence",
  "result_status",
] as const;

interface MarketPriceRow {
  symbol: string;
  trade_date: string;
  close: number;
  source: string;
  primary_source: string;
  fallback_used: number;
  fallback_reason: string | null;
  fetched_at: string;
  data_cutoff: string;
  adjustment: "none" | "qfq";
  coverage_id: number;
}

/** 将 live_market_prices SQL 行映射为 StoredMarketPrice。 */
function mapStoredMarketPrice(row: MarketPriceRow): StoredMarketPrice {
  return {
    symbol: row.symbol,
    date: row.trade_date,
    close: row.close,
    source: row.source as "tencent" | "sina",
    primarySource: row.primary_source as "tencent",
    fallbackUsed: Boolean(row.fallback_used),
    ...(row.fallback_reason
      ? { fallbackReason: row.fallback_reason }
      : {}),
    fetchedAt: row.fetched_at,
    dataCutoff: row.data_cutoff,
    adjustment: row.adjustment,
  };
}

interface MarketCoverageRow {
  coverage_id: number;
  symbol: string;
  requested_from: string;
  requested_through: string;
  source: "tencent" | "sina";
  primary_source: "tencent";
  fallback_used: number;
  fallback_reason: string | null;
  fetched_at: string;
  data_cutoff: string | null;
  adjustment: "none" | "qfq";
  empty_evidence: "exchange_calendar" | "outside_listing" | null;
  result_status: "data" | "empty";
}

/** 将 live_market_coverage SQL 行映射为 StoredMarketCoverage。 */
function mapStoredMarketCoverage(row: MarketCoverageRow): StoredMarketCoverage {
  return {
    coverageId: row.coverage_id,
    symbol: row.symbol,
    requestedFrom: row.requested_from,
    requestedThrough: row.requested_through,
    source: row.source,
    primarySource: row.primary_source,
    fallbackUsed: Boolean(row.fallback_used),
    ...(row.fallback_reason
      ? { fallbackReason: row.fallback_reason }
      : {}),
    fetchedAt: row.fetched_at,
    dataCutoff: row.data_cutoff,
    adjustment: row.adjustment,
    ...(row.empty_evidence
      ? { emptyEvidence: row.empty_evidence }
      : {}),
    resultStatus: row.result_status,
  };
}

export function insertMarketData(
  database: BetterSqlite3.Database,
  entry: MarketDataCacheEntry,
): void {
  const dataCutoff =
    entry.provenance.dataCutoff ?? entry.prices.at(-1)?.date;
  if (!dataCutoff && entry.prices.length) {
    throw new Error("行情快照包含价格但缺少实际数据截止日");
  }
  const insertPrice = database.prepare(
    buildInsertSql("market_prices", MARKET_PRICE_COLUMNS, true),
  );
  const insertAction = database.prepare(
    "INSERT OR REPLACE INTO corporate_actions(symbol, event_date, payload_json) VALUES (?, ?, ?)",
  );
  for (const row of entry.prices) {
    insertPrice.run(
      entry.symbol,
      row.date,
      row.close,
      entry.provenance.source,
      entry.provenance.primarySource ?? "tencent",
      entry.provenance.fallbackUsed ? 1 : 0,
      entry.provenance.fallbackReason ?? null,
      entry.provenance.fetchedAt,
      dataCutoff,
      entry.provenance.adjustment,
    );
  }
  for (const event of entry.dividends) {
    insertAction.run(entry.symbol, event.date, JSON.stringify(event));
  }
}

export function saveLiveMarketPriceSnapshots(
  database: BetterSqlite3.Database,
  entries: MarketDataCacheEntry[],
): void {
  const insertPrice = database.prepare(
    buildInsertSql("live_market_prices", LIVE_MARKET_PRICE_COLUMNS, true),
  );
  const insertCoverage = database.prepare(
    buildInsertSql(
      "live_market_coverage",
      LIVE_MARKET_COVERAGE_COLUMNS,
      true,
    ),
  );
  database.transaction(() => {
    for (const entry of entries) {
      const requestedFrom =
        entry.requestedFrom ?? entry.prices[0]?.date;
      const requestedThrough =
        entry.requestedThrough ??
        entry.prices.at(-1)?.date ??
        entry.provenance.dataCutoff;
      if (!requestedFrom || !requestedThrough) {
        throw new Error("行情覆盖记录缺少请求起止日期");
      }
      if (
        !entry.prices.length &&
        !entry.provenance.emptyEvidence
      ) {
        throw new Error(
          "空行情覆盖缺少独立交易日历或证券存续期证据，拒绝持久化",
        );
      }
      if (
        !entry.prices.length &&
        entry.provenance.dataCutoff !== null
      ) {
        throw new Error("空行情覆盖不能包含实际数据截止日");
      }
      const actualDataCutoff = entry.prices
        .map((row) => row.date)
        .sort()
        .at(-1) ?? null;
      if (
        entry.prices.length &&
        (entry.provenance.emptyEvidence ||
          !actualDataCutoff ||
          entry.provenance.dataCutoff !== actualDataCutoff)
      ) {
        throw new Error(
          "非空行情覆盖的实际数据截止日或空区间证据不一致",
        );
      }
      const coverageResult = insertCoverage.run(
        null,
        entry.symbol,
        requestedFrom,
        requestedThrough,
        entry.provenance.source,
        entry.provenance.primarySource ?? "tencent",
        entry.provenance.fallbackUsed ? 1 : 0,
        entry.provenance.fallbackReason ?? null,
        entry.provenance.fetchedAt,
        actualDataCutoff,
        entry.provenance.adjustment,
        entry.provenance.emptyEvidence ?? null,
        entry.prices.length ? "data" : "empty",
      );
      const coverageId = Number(coverageResult.lastInsertRowid);
      for (const row of entry.prices) {
        insertPrice.run(
          entry.symbol,
          row.date,
          row.close,
          entry.provenance.source,
          entry.provenance.primarySource ?? "tencent",
          entry.provenance.fallbackUsed ? 1 : 0,
          entry.provenance.fallbackReason ?? null,
          entry.provenance.fetchedAt,
          entry.provenance.dataCutoff ?? row.date,
          entry.provenance.adjustment,
          coverageId,
        );
      }
    }
  })();
}

export function listLiveMarketPrices(
  database: BetterSqlite3.Database,
  symbols?: readonly string[],
): StoredMarketPrice[] {
  const parameters = symbols ? [...symbols] : [];
  if (symbols && !symbols.length) return [];
  const where = symbols
    ? `WHERE symbol IN (${symbols.map(() => "?").join(", ")})`
    : "";
  return rows<MarketPriceRow>(
    database,
    `SELECT ${LIVE_MARKET_PRICE_COLUMNS.join(", ")}
     FROM live_market_prices
     ${where}
     ORDER BY symbol, trade_date`,
    parameters,
  ).map(mapStoredMarketPrice);
}

export function listLiveMarketCoverage(
  database: BetterSqlite3.Database,
  symbols?: readonly string[],
): StoredMarketCoverage[] {
  const parameters = symbols ? [...symbols] : [];
  if (symbols && !symbols.length) return [];
  const where = symbols
    ? `WHERE symbol IN (${symbols.map(() => "?").join(", ")})`
    : "";
  return rows<MarketCoverageRow>(
    database,
    `SELECT ${LIVE_MARKET_COVERAGE_COLUMNS.join(", ")}
     FROM live_market_coverage
     ${where}
     ORDER BY symbol, requested_from, requested_through`,
    parameters,
  ).map(mapStoredMarketCoverage);
}

export function listLiveMarketDates(database: BetterSqlite3.Database): string[] {
  return rows<{ trade_date: string }>(
    database,
    "SELECT DISTINCT trade_date FROM live_market_prices ORDER BY trade_date",
  ).map((row) => row.trade_date);
}
