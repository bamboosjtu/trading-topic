import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type {
  AppSettings,
  BacktestResult,
  DividendEvent,
  LedgerEntry,
  PricePoint,
} from "../../shared/contracts";

const SCHEMA_VERSION = 1;
const DEFAULT_SETTINGS: AppSettings = {
  priceSource: "tencent",
  dividendSource: "eastmoney",
  commissionRate: 0.00025,
  minimumCommission: 5,
  caliberVersion: "bank-dca-r1-node-v1",
};

interface BackupPayload {
  schemaVersion: number;
  exportedAt: string;
  application: "stock-income-r1";
  ledgerEntries: LedgerEntry[];
  backtestRuns: BacktestResult[];
  marketPrices: Array<{
    symbol: string;
    trade_date: string;
    close: number;
    source: string;
    fetched_at: string;
  }>;
  corporateActions: Array<{
    symbol: string;
    event_date: string;
    payload_json: string;
  }>;
  settings: AppSettings;
}

function rows<T>(database: Database, sql: string): T[] {
  const statement = database.prepare(sql);
  const result: T[] = [];
  try {
    while (statement.step()) result.push(statement.getAsObject() as T);
  } finally {
    statement.free();
  }
  return result;
}

export class LocalDatabase {
  private constructor(
    private readonly database: Database,
    private readonly filePath: string,
  ) {}

  static async open(filePath: string, projectRoot: string): Promise<LocalDatabase> {
    const SQL: SqlJsStatic = await initSqlJs({
      locateFile: (file) => join(projectRoot, "node_modules", "sql.js", "dist", file),
    });
    const database = existsSync(filePath)
      ? new SQL.Database(readFileSync(filePath))
      : new SQL.Database();
    const store = new LocalDatabase(database, filePath);
    store.migrate();
    return store;
  }

  private migrate(): void {
    this.database.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backtest_runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        symbol TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS market_prices (
        symbol TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (symbol, trade_date)
      );
      CREATE TABLE IF NOT EXISTS corporate_actions (
        symbol TEXT NOT NULL,
        event_date TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (symbol, event_date)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
    const existing = this.database.exec(
      "SELECT value_json FROM settings WHERE key = 'app'",
    );
    if (!existing.length) {
      this.database.run(
        "INSERT INTO settings(key, value_json) VALUES ('app', ?)",
        [JSON.stringify(DEFAULT_SETTINGS)],
      );
    }
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.filePath, Buffer.from(this.database.export()));
  }

  log(level: "info" | "warn" | "error", message: string): void {
    const sanitized = message
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .slice(0, 2_000);
    this.database.run(
      "INSERT INTO app_logs(created_at, level, message) VALUES (?, ?, ?)",
      [new Date().toISOString(), level, sanitized],
    );
    this.persist();
  }

  getLogs(): string {
    return rows<{ created_at: string; level: string; message: string }>(
      this.database,
      "SELECT created_at, level, message FROM app_logs ORDER BY id",
    )
      .map((row) => `${row.created_at} [${row.level.toUpperCase()}] ${row.message}`)
      .join("\n");
  }

  getSettings(): AppSettings {
    const result = rows<{ value_json: string }>(
      this.database,
      "SELECT value_json FROM settings WHERE key = 'app'",
    )[0];
    return result ? (JSON.parse(result.value_json) as AppSettings) : DEFAULT_SETTINGS;
  }

  addLedger(entry: LedgerEntry): void {
    this.database.run(
      "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
      [
        entry.id,
        entry.businessDate,
        entry.recordedAt,
        entry.type,
        JSON.stringify(entry),
      ],
    );
    this.persist();
  }

  listLedger(): LedgerEntry[] {
    return rows<{ payload_json: string }>(
      this.database,
      "SELECT payload_json FROM ledger_entries ORDER BY business_date DESC, recorded_at DESC",
    ).map((row) => JSON.parse(row.payload_json) as LedgerEntry);
  }

  saveBacktests(results: BacktestResult[]): void {
    this.database.run("BEGIN");
    try {
      for (const result of results) {
        this.database.run(
          "INSERT INTO backtest_runs(id, created_at, symbol, result_json) VALUES (?, ?, ?, ?)",
          [result.id, result.createdAt, result.symbol, JSON.stringify(result)],
        );
      }
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  listBacktests(limit = 20): BacktestResult[] {
    const suffix = Number.isFinite(limit) ? ` LIMIT ${Math.max(1, limit)}` : "";
    return rows<{ result_json: string }>(
      this.database,
      `SELECT result_json FROM backtest_runs ORDER BY created_at DESC${suffix}`,
    ).map((row) => JSON.parse(row.result_json) as BacktestResult);
  }

  replaceMarketData(
    symbol: string,
    prices: PricePoint[],
    dividends: DividendEvent[],
    source: string,
    fetchedAt: string,
  ): void {
    this.database.run("BEGIN");
    try {
      for (const row of prices) {
        this.database.run(
          "INSERT OR REPLACE INTO market_prices(symbol, trade_date, close, source, fetched_at) VALUES (?, ?, ?, ?, ?)",
          [symbol, row.date, row.close, source, fetchedAt],
        );
      }
      for (const event of dividends) {
        this.database.run(
          "INSERT OR REPLACE INTO corporate_actions(symbol, event_date, payload_json) VALUES (?, ?, ?)",
          [symbol, event.date, JSON.stringify(event)],
        );
      }
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  latestPrices(): { prices: Record<string, number>; dataCutoff: string | null } {
    const result = rows<{ symbol: string; trade_date: string; close: number }>(
      this.database,
      `SELECT p.symbol, p.trade_date, p.close
       FROM market_prices p
       JOIN (
         SELECT symbol, MAX(trade_date) AS max_date
         FROM market_prices GROUP BY symbol
       ) latest ON latest.symbol = p.symbol AND latest.max_date = p.trade_date`,
    );
    return {
      prices: Object.fromEntries(result.map((row) => [row.symbol, row.close])),
      dataCutoff: result.length
        ? result.map((row) => row.trade_date).sort().at(-1)!
        : null,
    };
  }

  exportBackup(): BackupPayload {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      application: "stock-income-r1",
      ledgerEntries: this.listLedger(),
      backtestRuns: this.listBacktests(Number.POSITIVE_INFINITY),
      marketPrices: rows(
        this.database,
        "SELECT symbol, trade_date, close, source, fetched_at FROM market_prices ORDER BY symbol, trade_date",
      ),
      corporateActions: rows(
        this.database,
        "SELECT symbol, event_date, payload_json FROM corporate_actions ORDER BY symbol, event_date",
      ),
      settings: this.getSettings(),
    };
  }

  restoreBackup(payload: unknown): void {
    if (
      !payload ||
      typeof payload !== "object" ||
      (payload as Partial<BackupPayload>).schemaVersion !== SCHEMA_VERSION ||
      (payload as Partial<BackupPayload>).application !== "stock-income-r1" ||
      !Array.isArray((payload as Partial<BackupPayload>).ledgerEntries) ||
      !Array.isArray((payload as Partial<BackupPayload>).backtestRuns) ||
      !Array.isArray((payload as Partial<BackupPayload>).marketPrices) ||
      !Array.isArray((payload as Partial<BackupPayload>).corporateActions)
    ) {
      throw new Error("备份结构或 schema 版本不兼容");
    }
    const backup = payload as BackupPayload;
    this.database.run("BEGIN");
    try {
      this.database.run("DELETE FROM ledger_entries");
      this.database.run("DELETE FROM backtest_runs");
      this.database.run("DELETE FROM market_prices");
      this.database.run("DELETE FROM corporate_actions");
      this.database.run("DELETE FROM settings");
      for (const entry of backup.ledgerEntries) {
        this.database.run(
          "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
          [
            entry.id,
            entry.businessDate,
            entry.recordedAt,
            entry.type,
            JSON.stringify({ ...entry, source: "restore" }),
          ],
        );
      }
      for (const result of backup.backtestRuns) {
        this.database.run(
          "INSERT INTO backtest_runs(id, created_at, symbol, result_json) VALUES (?, ?, ?, ?)",
          [result.id, result.createdAt, result.symbol, JSON.stringify(result)],
        );
      }
      for (const row of backup.marketPrices) {
        this.database.run(
          "INSERT INTO market_prices(symbol, trade_date, close, source, fetched_at) VALUES (?, ?, ?, ?, ?)",
          [row.symbol, row.trade_date, row.close, row.source, row.fetched_at],
        );
      }
      for (const row of backup.corporateActions) {
        this.database.run(
          "INSERT INTO corporate_actions(symbol, event_date, payload_json) VALUES (?, ?, ?)",
          [row.symbol, row.event_date, row.payload_json],
        );
      }
      this.database.run(
        "INSERT INTO settings(key, value_json) VALUES ('app', ?)",
        [JSON.stringify(backup.settings ?? DEFAULT_SETTINGS)],
      );
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }
}
