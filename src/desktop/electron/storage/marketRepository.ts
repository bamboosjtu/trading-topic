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
  "issues_json",
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
  result_status: "data" | "empty" | "partial";
  issues_json: string | null;
}

/** 将 live_market_coverage SQL 行映射为 StoredMarketCoverage。 */
function mapStoredMarketCoverage(row: MarketCoverageRow): StoredMarketCoverage {
  let issues: StoredMarketCoverage["issues"] | undefined;
  if (row.issues_json) {
    try {
      const parsed = JSON.parse(row.issues_json) as unknown;
      if (Array.isArray(parsed)) {
        issues = parsed as StoredMarketCoverage["issues"];
      }
    } catch {
      // 损坏的 issues_json 不影响基本读模型，忽略并降级为无问题详情。
    }
  }
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
    ...((issues && issues.length) ? { issues } : {}),
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
  // P2-2：写入前检测新价格行是否与已有价格行冲突（同 symbol + trade_date）。
  // live_market_prices 主键为 (symbol, trade_date)，INSERT OR REPLACE 会将
  // 已有价格行的 coverage_id 切换到新覆盖，导致旧覆盖失去价格行、备份校验失败。
  // - 旧 partial 覆盖未确认完整，允许删除后替换。
  // - 旧 data/empty 覆盖已确认，禁止价格行冲突。
  const deleteCoverage = database.prepare(
    "DELETE FROM live_market_coverage WHERE coverage_id = ?",
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
      // P1-3：resultStatus 优先取 entry 显式标记；未标记时按是否有价格推导。
      // partial 仅在非空（有价格）时有效；空覆盖不允许 partial。
      const resultStatus: "data" | "empty" | "partial" =
        entry.resultStatus === "partial" && entry.prices.length
          ? "partial"
          : entry.prices.length
            ? "data"
            : "empty";
      // P2-2：检测新价格行是否与已有价格行冲突（同 symbol + trade_date）。
      if (entry.prices.length) {
        const dates = entry.prices.map((row) => row.date);
        const placeholders = dates.map(() => "?").join(", ");
        const existing = database
          .prepare(
            `SELECT p.trade_date, p.coverage_id, c.result_status
             FROM live_market_prices p
             JOIN live_market_coverage c ON p.coverage_id = c.coverage_id
             WHERE p.symbol = ? AND p.trade_date IN (${placeholders})`,
          )
          .all(entry.symbol, ...dates) as Array<{
            trade_date: string;
            coverage_id: number;
            result_status: "data" | "empty" | "partial";
          }>;
        const partialsToDelete = new Set<number>();
        const conflicts: string[] = [];
        for (const row of existing) {
          if (row.result_status === "partial") {
            // P1-3：旧 partial 覆盖未确认完整，允许被新覆盖替换。
            partialsToDelete.add(row.coverage_id);
          } else {
            conflicts.push(`${row.trade_date}（覆盖 ${row.coverage_id}）`);
          }
        }
        if (conflicts.length) {
          throw new Error(
            `行情价格行冲突：${entry.symbol} 日期 ${conflicts.join("、")} ` +
              `已属于已确认覆盖；禁止写入以避免价格行归属漂移`,
          );
        }
        for (const id of partialsToDelete) {
          deleteCoverage.run(id);
        }
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
        resultStatus,
        // P2-1：partial 覆盖持久化 error 级别问题列表，用于审计和 confirmedCoverageThrough。
        resultStatus === "partial" && entry.issues?.length
          ? JSON.stringify(entry.issues)
          : null,
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
