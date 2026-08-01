import BetterSqlite3 from "better-sqlite3";
import type { LedgerEntry } from "../../shared/contracts";
import { rows } from "./dbUtil";

export function addLedger(
  database: BetterSqlite3.Database,
  entry: LedgerEntry,
): void {
  addLedgerEntries(database, [entry]);
}

export function addLedgerEntries(
  database: BetterSqlite3.Database,
  entries: readonly LedgerEntry[],
): void {
  const insert = database.prepare(
    "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
  );
  database.transaction((rowsToInsert: readonly LedgerEntry[]) => {
    for (const entry of rowsToInsert) {
      insert.run(
        entry.id,
        entry.businessDate,
        entry.recordedAt,
        entry.type,
        JSON.stringify(entry),
      );
    }
  })(entries);
}

export function listLedger(database: BetterSqlite3.Database): LedgerEntry[] {
  return rows<{ payload_json: string }>(
    database,
    "SELECT payload_json FROM ledger_entries ORDER BY business_date DESC, recorded_at DESC",
  ).map((row) => JSON.parse(row.payload_json) as LedgerEntry);
}
