import BetterSqlite3 from "better-sqlite3";
import type { SecurityTradingInterruption } from "../../shared/contracts";
import { rows } from "./dbUtil";

/**
 * security_trading_interruptions 列定义。
 *
 * 与 live_market_coverage / pending_dividends 一样，集中列定义以避免
 * INSERT 与 SELECT 在多处各写一份、漂移后不易发现。
 */
export const TRADING_INTERRUPTION_COLUMNS = [
  "symbol",
  "start_date",
  "end_date",
  "reason",
  "source",
  "source_id",
  "fetched_at",
] as const;

interface TradingInterruptionRow {
  symbol: string;
  start_date: string;
  end_date: string;
  reason: "suspension" | "delisted" | "not_yet_listed";
  source: string;
  source_id: string | null;
  fetched_at: string;
}

function mapInterruption(
  row: TradingInterruptionRow,
): SecurityTradingInterruption {
  const result: SecurityTradingInterruption = {
    symbol: row.symbol,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
  if (row.source_id !== null) {
    result.sourceId = row.source_id;
  }
  return result;
}

/**
 * 列出全部证券级停复牌证据。
 *
 * 默认按 symbol 升序、start_date 升序排列，便于调用方在日志/审计中稳定展示。
 */
export function listTradingInterruptions(
  database: BetterSqlite3.Database,
): SecurityTradingInterruption[] {
  return rows<TradingInterruptionRow>(
    database,
    `SELECT ${TRADING_INTERRUPTION_COLUMNS.join(", ")}
     FROM security_trading_interruptions
     ORDER BY symbol ASC, start_date ASC, end_date ASC`,
  ).map(mapInterruption);
}

/** 列出指定 symbol 的全部停复牌证据。 */
export function listTradingInterruptionsBySymbol(
  database: BetterSqlite3.Database,
  symbol: string,
): SecurityTradingInterruption[] {
  return rows<TradingInterruptionRow>(
    database,
    `SELECT ${TRADING_INTERRUPTION_COLUMNS.join(", ")}
     FROM security_trading_interruptions
     WHERE symbol = ?
     ORDER BY start_date ASC, end_date ASC`,
    [symbol],
  ).map(mapInterruption);
}

/**
 * 列出与 [startDate, endDate] 区间有交集的停复牌证据。
 *
 * 用于行情完整性检查时按请求区间裁剪证据集合，避免把无关历史停牌
 * 也展开成日期集合。
 */
export function listTradingInterruptionsInRange(
  database: BetterSqlite3.Database,
  symbol: string,
  startDate: string,
  endDate: string,
): SecurityTradingInterruption[] {
  return rows<TradingInterruptionRow>(
    database,
    `SELECT ${TRADING_INTERRUPTION_COLUMNS.join(", ")}
     FROM security_trading_interruptions
     WHERE symbol = ?
       AND start_date <= ?
       AND end_date >= ?
     ORDER BY start_date ASC, end_date ASC`,
    [symbol, endDate, startDate],
  ).map(mapInterruption);
}

/**
 * 写入停复牌证据。
 *
 * 使用 INSERT OR IGNORE：同一 (symbol, start_date, end_date, reason) 重复
 * 写入时保留首次记录，避免覆盖已有来源元数据。
 */
export function insertTradingInterruption(
  database: BetterSqlite3.Database,
  interruption: SecurityTradingInterruption,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO security_trading_interruptions(
         symbol, start_date, end_date, reason, source, source_id, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      interruption.symbol,
      interruption.startDate,
      interruption.endDate,
      interruption.reason,
      interruption.source,
      interruption.sourceId ?? null,
      interruption.fetchedAt,
    );
}

/** 批量写入停复牌证据（如外部公告解析后一次性入库）。 */
export function insertTradingInterruptions(
  database: BetterSqlite3.Database,
  interruptions: readonly SecurityTradingInterruption[],
): void {
  if (!interruptions.length) return;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO security_trading_interruptions(
         symbol, start_date, end_date, reason, source, source_id, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  database.transaction(() => {
    for (const item of interruptions) {
      insert.run(
        item.symbol,
        item.startDate,
        item.endDate,
        item.reason,
        item.source,
        item.sourceId ?? null,
        item.fetchedAt,
      );
    }
  })();
}

/** 备份恢复时清空表。 */
export function deleteAllTradingInterruptions(
  database: BetterSqlite3.Database,
): void {
  database.prepare("DELETE FROM security_trading_interruptions").run();
}

/**
 * 按主键删除单条停复牌证据。
 *
 * 用于纠正错误录入。已确认的回测结果 provenance 中保留的快照不受影响，
 * 因为它们是历史证据的不可变副本。
 */
export function deleteTradingInterruption(
  database: BetterSqlite3.Database,
  params: {
    symbol: string;
    startDate: string;
    endDate: string;
    reason: SecurityTradingInterruption["reason"];
  },
): void {
  database
    .prepare(
      `DELETE FROM security_trading_interruptions
        WHERE symbol = ? AND start_date = ? AND end_date = ? AND reason = ?`,
    )
    .run(params.symbol, params.startDate, params.endDate, params.reason);
}

/**
 * 删除指定 symbol 和 source 的全部停复牌证据。
 *
 * 用于自动获取流程刷新前清除旧的同源数据，避免因 endDate 变化
 * 产生过时记录。手工录入的异源证据不受影响。
 */
export function deleteTradingInterruptionsBySymbolAndSource(
  database: BetterSqlite3.Database,
  symbol: string,
  source: string,
): void {
  database
    .prepare(
      `DELETE FROM security_trading_interruptions
        WHERE symbol = ? AND source = ?`,
    )
    .run(symbol, source);
}

/**
 * 原子替换指定 symbol + source 的全部停复牌证据。
 *
 * P1-2：自动获取流程必须使用本函数，而不是先 delete 再 insert 的两步操作。
 * 旧实现"先删除再写入"会在解析失败、网络抖动等情况下删除已有证据却不写入
 * 新数据，让一个原本可运行的历史回测在刷新后突然失败。
 *
 * 本函数把 delete + insert 包在同一事务里：
 * - 任一步失败时整体回滚，已有证据保留；
 * - 调用方应先完成 fetch + parse + 结构校验，确认拿到的是有效新证据
 *   后再调用本函数。
 *
 * 注意：rows 为空数组时仍会执行 delete + 0 行 insert，等价于"清空该源
 * 证据"。调用方在 rows 为空时应根据业务语义决定是否调用本函数——
 * 自动获取流程中，rows 为空通常意味着"该证券确实没有停牌记录"，
 * 此时清空旧同源证据是合法的；但若 rows 为空来自解析失败，
 * 调用方应已抛错，不会进入本函数。
 */
export function replaceTradingInterruptionsBySourceAtomically(
  database: BetterSqlite3.Database,
  symbol: string,
  source: string,
  rows: readonly SecurityTradingInterruption[],
): void {
  const deleteStmt = database.prepare(
    `DELETE FROM security_trading_interruptions
      WHERE symbol = ? AND source = ?`,
  );
  const insertStmt = database.prepare(
    `INSERT OR IGNORE INTO security_trading_interruptions(
         symbol, start_date, end_date, reason, source, source_id, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  database.transaction(() => {
    deleteStmt.run(symbol, source);
    for (const item of rows) {
      insertStmt.run(
        item.symbol,
        item.startDate,
        item.endDate,
        item.reason,
        item.source,
        item.sourceId ?? null,
        item.fetchedAt,
      );
    }
  })();
}
