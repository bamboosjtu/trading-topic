import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { strategyKeyFromResult } from "../../shared/backtestIdentity";
import {
  BACKTEST_CALIBER_VERSION,
  BACKTEST_HISTORY_LIMIT,
} from "../../shared/constants";
import type {
  AppSettings,
  BacktestResult,
  BacktestWorkspaceState,
  DividendEvent,
  LedgerEntry,
  PricePoint,
  StockInfo,
} from "../../shared/contracts";

const SCHEMA_VERSION = 2;
const DEFAULT_SETTINGS: AppSettings = {
  priceSource: "tencent",
  dividendSource: "eastmoney",
  commissionRate: 0,
  minimumCommission: 0,
  caliberVersion: BACKTEST_CALIBER_VERSION,
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
  stockUniverse?: Array<
    StockInfo & {
      source: string;
      fetchedAt: string;
    }
  >;
  backtestWorkspace?: BacktestWorkspaceState | null;
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
      CREATE TABLE IF NOT EXISTS stock_universe (
        symbol TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backtest_workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL
      );
    `);
    const backtestColumns = new Set(
      rows<{ name: string }>(
        this.database,
        "PRAGMA table_info(backtest_runs)",
      ).map((column) => column.name),
    );
    if (!backtestColumns.has("strategy_key")) {
      this.database.run("ALTER TABLE backtest_runs ADD COLUMN strategy_key TEXT");
    }
    if (!backtestColumns.has("batch_id")) {
      this.database.run("ALTER TABLE backtest_runs ADD COLUMN batch_id TEXT");
    }
    this.backfillBacktestIdentity();
    this.database.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_runs_strategy_key ON backtest_runs(strategy_key)",
    );
    this.database.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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

  private backfillBacktestIdentity(): void {
    const existing = rows<{
      id: string;
      result_json: string;
      strategy_key: string | null;
    }>(
      this.database,
      "SELECT id, result_json, strategy_key FROM backtest_runs ORDER BY created_at DESC",
    );
    const newestByStrategy = new Set<string>();
    for (const row of existing) {
      let result: BacktestResult | null = null;
      try {
        result = JSON.parse(row.result_json) as BacktestResult;
      } catch {
        // 损坏的旧记录保持可识别且不阻断数据库升级。
      }
      const strategyKey =
        row.strategy_key ??
        (result ? strategyKeyFromResult(result) : `legacy:${row.id}`);
      if (newestByStrategy.has(strategyKey)) {
        this.database.run("DELETE FROM backtest_runs WHERE id = ?", [row.id]);
        continue;
      }
      newestByStrategy.add(strategyKey);
      if (result) {
        const normalized = {
          ...result,
          requestedEndDate: result.requestedEndDate ?? result.actualEndDate,
          strategyKey,
        };
        this.database.run(
          "UPDATE backtest_runs SET strategy_key = ?, batch_id = ?, result_json = ? WHERE id = ?",
          [
            strategyKey,
            normalized.batchId ?? null,
            JSON.stringify(normalized),
            row.id,
          ],
        );
      } else {
        this.database.run(
          "UPDATE backtest_runs SET strategy_key = ? WHERE id = ?",
          [strategyKey, row.id],
        );
      }
    }
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
    const stored = result
      ? (JSON.parse(result.value_json) as AppSettings)
      : DEFAULT_SETTINGS;
    return {
      ...stored,
      // 计算口径属于版本事实，不允许旧备份把当前 R1 恢复成整数手/佣金模型。
      commissionRate: 0,
      minimumCommission: 0,
      caliberVersion: DEFAULT_SETTINGS.caliberVersion,
    };
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
        const strategyKey = result.strategyKey ?? strategyKeyFromResult(result);
        const normalized: BacktestResult = {
          ...result,
          requestedEndDate: result.requestedEndDate ?? result.actualEndDate,
          strategyKey,
        };
        this.database.run(
          `INSERT INTO backtest_runs(
             id, created_at, symbol, result_json, strategy_key, batch_id
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(strategy_key) DO UPDATE SET
             id = excluded.id,
             created_at = excluded.created_at,
             symbol = excluded.symbol,
             result_json = excluded.result_json,
             batch_id = excluded.batch_id`,
          [
            normalized.id,
            normalized.createdAt,
            normalized.symbol,
            JSON.stringify(normalized),
            strategyKey,
            normalized.batchId ?? null,
          ],
        );
      }
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  listBacktests(limit = BACKTEST_HISTORY_LIMIT): BacktestResult[] {
    const suffix = Number.isFinite(limit) ? ` LIMIT ${Math.max(1, limit)}` : "";
    return rows<{ result_json: string }>(
      this.database,
      `SELECT result_json FROM backtest_runs ORDER BY created_at DESC${suffix}`,
    ).map((row) => JSON.parse(row.result_json) as BacktestResult);
  }

  getBacktest(id: string): BacktestResult | null {
    return (
      this.listBacktests(Number.POSITIVE_INFINITY).find(
        (result) => result.id === id,
      ) ?? null
    );
  }

  listBacktestsByIds(ids: string[]): BacktestResult[] {
    const byId = new Map(
      this.listBacktests(Number.POSITIVE_INFINITY).map((result) => [
        result.id,
        result,
      ]),
    );
    return ids.flatMap((id) => {
      const result = byId.get(id);
      return result ? [result] : [];
    });
  }

  replaceStockUniverse(
    stocks: StockInfo[],
    source: string,
    fetchedAt: string,
  ): void {
    this.database.run("BEGIN");
    try {
      this.database.run("DELETE FROM stock_universe");
      for (const stock of stocks) {
        this.database.run(
          "INSERT INTO stock_universe(symbol, name, source, fetched_at) VALUES (?, ?, ?, ?)",
          [stock.symbol, stock.name, source, fetchedAt],
        );
      }
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  listStockUniverse(): Array<
    StockInfo & { source: string; fetchedAt: string }
  > {
    return rows<{
      symbol: string;
      name: string;
      source: string;
      fetched_at: string;
    }>(
      this.database,
      "SELECT symbol, name, source, fetched_at FROM stock_universe ORDER BY symbol",
    ).map((row) => ({
      symbol: row.symbol,
      name: row.name,
      source: row.source,
      fetchedAt: row.fetched_at,
    }));
  }

  getBacktestWorkspace(): BacktestWorkspaceState | null {
    const row = rows<{ state_json: string }>(
      this.database,
      "SELECT state_json FROM backtest_workspace WHERE id = 1",
    )[0];
    return row
      ? (JSON.parse(row.state_json) as BacktestWorkspaceState)
      : null;
  }

  saveBacktestWorkspace(state: BacktestWorkspaceState): void {
    this.database.run(
      `INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
      [JSON.stringify(state)],
    );
    this.persist();
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
      stockUniverse: this.listStockUniverse(),
      backtestWorkspace: this.getBacktestWorkspace(),
    };
  }

  restoreBackup(payload: unknown): void {
    if (
      !payload ||
      typeof payload !== "object" ||
      ![1, SCHEMA_VERSION].includes(
        Number((payload as Partial<BackupPayload>).schemaVersion),
      ) ||
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
      this.database.run("DELETE FROM stock_universe");
      this.database.run("DELETE FROM backtest_workspace");
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
        const strategyKey = result.strategyKey ?? strategyKeyFromResult(result);
        const normalized = {
          ...result,
          requestedEndDate: result.requestedEndDate ?? result.actualEndDate,
          strategyKey,
        };
        this.database.run(
          `INSERT INTO backtest_runs(
             id, created_at, symbol, result_json, strategy_key, batch_id
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(strategy_key) DO UPDATE SET
             id = excluded.id,
             created_at = excluded.created_at,
             symbol = excluded.symbol,
             result_json = excluded.result_json,
             batch_id = excluded.batch_id`,
          [
            normalized.id,
            normalized.createdAt,
            normalized.symbol,
            JSON.stringify(normalized),
            strategyKey,
            normalized.batchId ?? null,
          ],
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
      for (const stock of backup.stockUniverse ?? []) {
        this.database.run(
          "INSERT INTO stock_universe(symbol, name, source, fetched_at) VALUES (?, ?, ?, ?)",
          [stock.symbol, stock.name, stock.source, stock.fetchedAt],
        );
      }
      if (backup.backtestWorkspace) {
        this.database.run(
          "INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)",
          [JSON.stringify(backup.backtestWorkspace)],
        );
      }
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }
}
