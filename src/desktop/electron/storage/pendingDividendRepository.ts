import BetterSqlite3 from "better-sqlite3";
import type {
  LedgerEntry,
  PendingDividend,
  PendingDividendStatus,
  SecurityType,
} from "../../shared/contracts";
import { rows } from "./dbUtil";

/**
 * pending_dividends 列定义。
 *
 * 集中列定义避免 INSERT 与 SELECT 在多处各写一份、漂移后不易发现。
 */
export const PENDING_DIVIDEND_COLUMNS = [
  "id",
  "symbol",
  "instrument_name",
  "security_type",
  "ex_date",
  "record_date",
  "payment_date",
  "per_share",
  "holding_quantity",
  "expected_amount",
  "status",
  "discovered_at",
  "confirmed_amount",
  "linked_entry_id",
  "source",
  "note",
] as const;

interface PendingDividendRow {
  id: string;
  symbol: string;
  instrument_name: string;
  security_type: "stock" | "etf";
  ex_date: string;
  record_date: string;
  payment_date: string | null;
  per_share: number;
  holding_quantity: number;
  expected_amount: number;
  status: "pending" | "confirmed" | "ignored";
  discovered_at: string;
  confirmed_amount: number | null;
  linked_entry_id: string | null;
  source: "corporate_action";
  note: string | null;
}

/** 将 pending_dividends SQL 行映射为 PendingDividend。 */
function mapPendingDividend(row: PendingDividendRow): PendingDividend {
  const result: PendingDividend = {
    id: row.id,
    symbol: row.symbol,
    instrumentName: row.instrument_name,
    securityType: row.security_type as SecurityType,
    exDate: row.ex_date,
    recordDate: row.record_date,
    paymentDate: row.payment_date,
    perShare: row.per_share,
    holdingQuantity: row.holding_quantity,
    expectedAmount: row.expected_amount,
    status: row.status as PendingDividendStatus,
    discoveredAt: row.discovered_at,
    source: row.source,
  };
  if (row.confirmed_amount !== null) {
    result.confirmedAmount = row.confirmed_amount;
  }
  if (row.linked_entry_id !== null) {
    result.linkedEntryId = row.linked_entry_id;
  }
  if (row.note !== null) {
    result.note = row.note;
  }
  return result;
}

/**
 * 写入待确认分红候选项。
 *
 * 使用 INSERT OR IGNORE 以遵守 (symbol, record_date) UNIQUE 约束：
 * 重复发现同一分红事件时保留首次记录，避免覆盖用户已确认或已忽略的状态。
 */
export function insertPendingDividend(
  database: BetterSqlite3.Database,
  candidate: PendingDividend,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO pending_dividends(
         id, symbol, instrument_name, security_type, ex_date, record_date,
         payment_date, per_share, holding_quantity, expected_amount, status,
         discovered_at, confirmed_amount, linked_entry_id, source, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.id,
      candidate.symbol,
      candidate.instrumentName,
      candidate.securityType,
      candidate.exDate,
      candidate.recordDate,
      candidate.paymentDate,
      candidate.perShare,
      candidate.holdingQuantity,
      candidate.expectedAmount,
      candidate.status,
      candidate.discoveredAt,
      candidate.confirmedAmount ?? null,
      candidate.linkedEntryId ?? null,
      candidate.source,
      candidate.note ?? null,
    );
}

export function listPendingDividends(
  database: BetterSqlite3.Database,
): PendingDividend[] {
  return rows<PendingDividendRow>(
    database,
    `SELECT ${PENDING_DIVIDEND_COLUMNS.join(", ")}
     FROM pending_dividends
     ORDER BY record_date DESC, discovered_at DESC, id`,
  ).map(mapPendingDividend);
}

export function listPendingDividendsByStatus(
  database: BetterSqlite3.Database,
  status: PendingDividendStatus,
): PendingDividend[] {
  return rows<PendingDividendRow>(
    database,
    `SELECT ${PENDING_DIVIDEND_COLUMNS.join(", ")}
     FROM pending_dividends
     WHERE status = ?
     ORDER BY record_date DESC, discovered_at DESC, id`,
    [status],
  ).map(mapPendingDividend);
}

export function getPendingDividend(
  database: BetterSqlite3.Database,
  id: string,
): PendingDividend | null {
  const row = rows<PendingDividendRow>(
    database,
    `SELECT ${PENDING_DIVIDEND_COLUMNS.join(", ")}
     FROM pending_dividends
     WHERE id = ?`,
    [id],
  )[0];
  return row ? mapPendingDividend(row) : null;
}

export function findPendingDividend(
  database: BetterSqlite3.Database,
  symbol: string,
  recordDate: string,
): PendingDividend | null {
  const row = rows<PendingDividendRow>(
    database,
    `SELECT ${PENDING_DIVIDEND_COLUMNS.join(", ")}
     FROM pending_dividends
     WHERE symbol = ? AND record_date = ?`,
    [symbol, recordDate],
  )[0];
  return row ? mapPendingDividend(row) : null;
}

export function updatePendingDividendStatus(
  database: BetterSqlite3.Database,
  id: string,
  status: PendingDividendStatus,
  confirmedAmount?: number,
  linkedEntryId?: string,
): void {
  database
    .prepare(
      `UPDATE pending_dividends
         SET status = ?, confirmed_amount = ?, linked_entry_id = ?
       WHERE id = ?`,
    )
    .run(status, confirmedAmount ?? null, linkedEntryId ?? null, id);
}

/**
 * P1：原子地确认待确认分红。
 *
 * 把"插入 dividend 流水 + 更新 pending_dividends 状态"
 * 放进同一个 SQLite 事务。任一步失败时整体回滚，避免出现
 * "正式分红流水已生成但候选仍 pending，用户再次确认后重复记账"的不一致。
 *
 * @param dividendEntry 已通过 preview 校验、且填好 id/recordedAt 的正式分红流水
 * @param actualAmount  用户确认的实际到账金额
 */
export function confirmPendingDividendAtomically(
  database: BetterSqlite3.Database,
  params: {
    pendingId: string;
    dividendEntry: LedgerEntry;
    actualAmount: number;
  },
): void {
  const insertLedger = database.prepare(
    "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
  );
  const updatePending = database.prepare(
    `UPDATE pending_dividends
       SET status = 'confirmed',
           confirmed_amount = ?,
           linked_entry_id = ?
     WHERE id = ? AND status = 'pending'`,
  );
  database.transaction(() => {
    insertLedger.run(
      params.dividendEntry.id,
      params.dividendEntry.businessDate,
      params.dividendEntry.recordedAt,
      params.dividendEntry.type,
      JSON.stringify(params.dividendEntry),
    );
    const result = updatePending.run(
      params.actualAmount,
      params.dividendEntry.id,
      params.pendingId,
    );
    if (result.changes === 0) {
      // 候选已被其他人确认/忽略或不存在；抛错让事务回滚，避免悬挂流水。
      throw new Error(
        `待确认分红 ${params.pendingId} 不存在或状态已变更，确认已回滚`,
      );
    }
  })();
}

/** 备份恢复时清空表。 */
export function deleteAllPendingDividends(
  database: BetterSqlite3.Database,
): void {
  database.prepare("DELETE FROM pending_dividends").run();
}

/** 备份恢复时批量写入。 */
export function insertPendingDividends(
  database: BetterSqlite3.Database,
  candidates: readonly PendingDividend[],
): void {
  if (!candidates.length) return;
  const insert = database.prepare(
    `INSERT INTO pending_dividends(
         id, symbol, instrument_name, security_type, ex_date, record_date,
         payment_date, per_share, holding_quantity, expected_amount, status,
         discovered_at, confirmed_amount, linked_entry_id, source, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  database.transaction(() => {
    for (const candidate of candidates) {
      insert.run(
        candidate.id,
        candidate.symbol,
        candidate.instrumentName,
        candidate.securityType,
        candidate.exDate,
        candidate.recordDate,
        candidate.paymentDate,
        candidate.perShare,
        candidate.holdingQuantity,
        candidate.expectedAmount,
        candidate.status,
        candidate.discoveredAt,
        candidate.confirmedAmount ?? null,
        candidate.linkedEntryId ?? null,
        candidate.source,
        candidate.note ?? null,
      );
    }
  })();
}
