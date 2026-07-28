import BetterSqlite3 from "better-sqlite3";
import {
  BACKTEST_CALIBER_VERSION,
  RECENT_BACKTEST_EXPERIMENT_LIMIT,
} from "../../shared/constants";
import type {
  AppSettings,
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestResult,
  BacktestWorkspaceState,
  DividendEvent,
  LedgerEntry,
  MarketDataProvenance,
  PricePoint,
  StockInfo,
} from "../../shared/contracts";

const SCHEMA_VERSION = 8;
const DEFAULT_SETTINGS: AppSettings = {
  priceSource: "tencent_sina",
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
  backtestExperiments: BacktestExperiment[];
  marketPrices: Array<{
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
  }>;
  liveMarketPrices: Array<{
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
    requested_from: string;
    requested_through: string;
  }>;
  corporateActions: Array<{
    symbol: string;
    event_date: string;
    payload_json: string;
  }>;
  settings: AppSettings;
  stockUniverse: Array<
    StockInfo & {
      source: string;
      fetchedAt: string;
    }
  >;
  backtestWorkspace: BacktestWorkspaceState | null;
}

type SqlParameter = string | number | bigint | Buffer | null;

export interface MarketDataCacheEntry {
  symbol: string;
  prices: PricePoint[];
  dividends: DividendEvent[];
  provenance: MarketDataProvenance & { caliberVersion: string };
  requestedFrom?: string;
  requestedThrough?: string;
}

export interface StoredMarketPrice {
  symbol: string;
  date: string;
  close: number;
  source: "tencent" | "sina";
  primarySource: "tencent";
  fallbackUsed: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  dataCutoff: string;
  adjustment: "none" | "qfq";
  requestedFrom?: string;
  requestedThrough?: string;
}

function rows<T>(
  database: BetterSqlite3.Database,
  sql: string,
  parameters: SqlParameter[] = [],
): T[] {
  return database.prepare(sql).all(...parameters) as T[];
}

export class LocalDatabase {
  private constructor(private readonly database: BetterSqlite3.Database) {}

  static async open(filePath: string): Promise<LocalDatabase> {
    const database = new BetterSqlite3(filePath);
    database.pragma("foreign_keys = ON");
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
    const store = new LocalDatabase(database);
    store.migrate();
    return store;
  }

  close(): void {
    if (this.database.open) this.database.close();
  }

  private migrate(): void {
    const currentVersion = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    if (currentVersion < 5) {
      this.database.exec(`
        DROP TABLE IF EXISTS backtest_runs;
        DROP TABLE IF EXISTS backtest_results;
        DROP TABLE IF EXISTS backtest_experiments;
        DROP TABLE IF EXISTS backtest_workspace;
      `);
    }
    if (currentVersion < 8) {
      // R1 尚无用户数据：领域模型收敛后直接重建投资事实与行情缓存，
      // 不保留旧事实类型或旧来源字段的兼容层。
      this.database.exec(`
        DROP TABLE IF EXISTS ledger_entries;
        DROP TABLE IF EXISTS market_prices;
        DROP TABLE IF EXISTS live_market_prices;
        DROP TABLE IF EXISTS settings;
      `);
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        type TEXT NOT NULL
          CHECK (type IN ('buy', 'sell', 'dividend', 'adjustment')),
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backtest_experiments (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        request_json TEXT NOT NULL,
        data_cutoff TEXT NOT NULL,
        caliber_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status = 'completed')
      );
      CREATE TABLE IF NOT EXISTS backtest_results (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        strategy_key TEXT NOT NULL,
        result_json TEXT NOT NULL,
        FOREIGN KEY (experiment_id)
          REFERENCES backtest_experiments(id)
          ON DELETE CASCADE,
        UNIQUE (experiment_id, symbol)
      );
      CREATE TABLE IF NOT EXISTS market_prices (
        symbol TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('tencent', 'sina')),
        primary_source TEXT NOT NULL CHECK (primary_source = 'tencent'),
        fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
        fallback_reason TEXT,
        fetched_at TEXT NOT NULL,
        data_cutoff TEXT NOT NULL,
        adjustment TEXT NOT NULL CHECK (adjustment IN ('none', 'qfq')),
        PRIMARY KEY (symbol, trade_date)
      );
      CREATE TABLE IF NOT EXISTS live_market_prices (
        symbol TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close REAL NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('tencent', 'sina')),
        primary_source TEXT NOT NULL CHECK (primary_source = 'tencent'),
        fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
        fallback_reason TEXT,
        fetched_at TEXT NOT NULL,
        data_cutoff TEXT NOT NULL,
        adjustment TEXT NOT NULL CHECK (adjustment IN ('none', 'qfq')),
        requested_from TEXT NOT NULL,
        requested_through TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_backtest_experiments_created_at
        ON backtest_experiments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_backtest_results_experiment
        ON backtest_results(experiment_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy
        ON backtest_results(strategy_key);
    `);
    this.database.pragma(`user_version = ${SCHEMA_VERSION}`);
    this.database
      .prepare(
        `INSERT INTO settings(key, value_json) VALUES ('app', ?)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run(JSON.stringify(DEFAULT_SETTINGS));
  }

  log(level: "info" | "warn" | "error", message: string): void {
    const sanitized = message
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .slice(0, 2_000);
    this.database
      .prepare(
        "INSERT INTO app_logs(created_at, level, message) VALUES (?, ?, ?)",
      )
      .run(new Date().toISOString(), level, sanitized);
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
      commissionRate: 0,
      minimumCommission: 0,
      caliberVersion: DEFAULT_SETTINGS.caliberVersion,
    };
  }

  addLedger(entry: LedgerEntry): void {
    this.addLedgerEntries([entry]);
  }

  addLedgerEntries(entries: readonly LedgerEntry[]): void {
    const insert = this.database.prepare(
      "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    this.database.transaction((rowsToInsert: readonly LedgerEntry[]) => {
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

  listLedger(): LedgerEntry[] {
    return rows<{ payload_json: string }>(
      this.database,
      "SELECT payload_json FROM ledger_entries ORDER BY business_date DESC, recorded_at DESC",
    ).map((row) => JSON.parse(row.payload_json) as LedgerEntry);
  }

  private insertExperiment(experiment: BacktestExperiment): void {
    this.database
      .prepare(
        `INSERT INTO backtest_experiments(
           id, created_at, request_json, data_cutoff, caliber_version, status
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        experiment.experimentId,
        experiment.createdAt,
        JSON.stringify(experiment.request),
        experiment.dataCutoff,
        experiment.caliberVersion,
        experiment.status,
      );
    const insertResult = this.database.prepare(
      `INSERT INTO backtest_results(
         id, experiment_id, symbol, strategy_key, result_json
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const result of experiment.results) {
      if (result.experimentId !== experiment.experimentId) {
        throw new Error("回测结果与实验编号不一致");
      }
      insertResult.run(
        result.id,
        experiment.experimentId,
        result.symbol,
        result.strategyKey,
        JSON.stringify(result),
      );
    }
  }

  saveBacktestExperiment(experiment: BacktestExperiment): void {
    this.database.transaction(() => this.insertExperiment(experiment))();
  }

  saveBacktestExperimentWithMarketData(
    experiment: BacktestExperiment,
    marketData: MarketDataCacheEntry[],
  ): void {
    this.database.transaction(() => {
      for (const entry of marketData) this.insertMarketData(entry);
      this.insertExperiment(experiment);
    })();
  }

  private listExperimentResults(experimentId: string): BacktestResult[] {
    return rows<{ result_json: string }>(
      this.database,
      `SELECT result_json FROM backtest_results
       WHERE experiment_id = ?
       ORDER BY rowid`,
      [experimentId],
    ).map((row) => JSON.parse(row.result_json) as BacktestResult);
  }

  listBacktestExperiments(
    limit = RECENT_BACKTEST_EXPERIMENT_LIMIT,
  ): BacktestExperimentSummary[] {
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : Number.MAX_SAFE_INTEGER;
    return rows<{
      id: string;
      created_at: string;
      request_json: string;
      data_cutoff: string;
      caliber_version: string;
      status: "completed";
      result_count: number;
      best_xirr: number | null;
      max_drawdown: number | null;
    }>(
      this.database,
      `SELECT
         e.id,
         e.created_at,
         e.request_json,
         e.data_cutoff,
         e.caliber_version,
         e.status,
         COUNT(r.id) AS result_count,
         MAX(CAST(json_extract(r.result_json, '$.metrics.xirr') AS REAL))
           AS best_xirr,
         MIN(CAST(json_extract(r.result_json, '$.metrics.maxDrawdown') AS REAL))
           AS max_drawdown
       FROM backtest_experiments e
       LEFT JOIN backtest_results r ON r.experiment_id = e.id
       GROUP BY e.id
       ORDER BY created_at DESC
       LIMIT ?`,
      [boundedLimit],
    ).map((row) => ({
        experimentId: row.id,
        createdAt: row.created_at,
        request: JSON.parse(row.request_json) as BacktestExperiment["request"],
        dataCutoff: row.data_cutoff,
        caliberVersion: row.caliber_version,
        status: row.status,
        resultCount: row.result_count,
        bestXirr: row.best_xirr,
        maxDrawdown: row.max_drawdown ?? 0,
      }));
  }

  getBacktestExperiment(id: string): BacktestExperiment | null {
    const row = rows<{
      id: string;
      created_at: string;
      request_json: string;
      data_cutoff: string;
      caliber_version: string;
      status: "completed";
    }>(
      this.database,
      `SELECT id, created_at, request_json, data_cutoff, caliber_version, status
       FROM backtest_experiments WHERE id = ?`,
      [id],
    )[0];
    if (!row) return null;
    return {
      experimentId: row.id,
      createdAt: row.created_at,
      request: JSON.parse(row.request_json) as BacktestExperiment["request"],
      dataCutoff: row.data_cutoff,
      caliberVersion: row.caliber_version,
      status: row.status,
      results: this.listExperimentResults(row.id),
    };
  }

  deleteBacktestExperiment(id: string): void {
    const workspace = this.getBacktestWorkspace();
    this.database.transaction(() => {
      this.database
        .prepare("DELETE FROM backtest_experiments WHERE id = ?")
        .run(id);
      if (workspace?.activeExperimentId === id) {
        this.database
          .prepare(
            `INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)
             ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
          )
          .run(
            JSON.stringify({
              ...workspace,
              activeExperimentId: undefined,
              updatedAt: new Date().toISOString(),
            }),
          );
      }
    })();
  }

  getBacktest(id: string): BacktestResult | null {
    const row = rows<{ result_json: string }>(
      this.database,
      "SELECT result_json FROM backtest_results WHERE id = ?",
      [id],
    )[0];
    return row ? (JSON.parse(row.result_json) as BacktestResult) : null;
  }

  replaceStockUniverse(
    stocks: StockInfo[],
    source: string,
    fetchedAt: string,
  ): void {
    const insert = this.database.prepare(
      "INSERT INTO stock_universe(symbol, name, source, fetched_at) VALUES (?, ?, ?, ?)",
    );
    this.database.transaction(() => {
      this.database.exec("DELETE FROM stock_universe");
      for (const stock of stocks) {
        insert.run(stock.symbol, stock.name, source, fetchedAt);
      }
    })();
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
    this.database
      .prepare(
        `INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
      )
      .run(JSON.stringify(state));
  }

  private insertMarketData(entry: MarketDataCacheEntry): void {
    const insertPrice = this.database.prepare(
      `INSERT OR REPLACE INTO market_prices(
         symbol, trade_date, close, source, primary_source, fallback_used,
         fallback_reason, fetched_at, data_cutoff, adjustment
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAction = this.database.prepare(
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
        entry.provenance.dataCutoff,
        entry.provenance.adjustment,
      );
    }
    for (const event of entry.dividends) {
      insertAction.run(entry.symbol, event.date, JSON.stringify(event));
    }
  }

  saveLiveMarketPriceSnapshots(entries: MarketDataCacheEntry[]): void {
    const insertPrice = this.database.prepare(
      `INSERT OR REPLACE INTO live_market_prices(
         symbol, trade_date, close, source, primary_source, fallback_used,
         fallback_reason, fetched_at, data_cutoff, adjustment,
         requested_from, requested_through
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.database.transaction(() => {
      for (const entry of entries) {
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
            entry.provenance.dataCutoff,
            entry.provenance.adjustment,
            entry.requestedFrom ?? entry.prices[0]?.date ?? entry.provenance.dataCutoff,
            entry.requestedThrough ?? entry.provenance.dataCutoff,
          );
        }
      }
    })();
  }

  listLiveMarketPrices(symbols?: readonly string[]): StoredMarketPrice[] {
    const parameters = symbols ? [...symbols] : [];
    if (symbols && !symbols.length) return [];
    const where = symbols
      ? `WHERE symbol IN (${symbols.map(() => "?").join(", ")})`
      : "";
    return rows<{
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
      requested_from: string;
      requested_through: string;
    }>(
      this.database,
      `SELECT symbol, trade_date, close, source, primary_source, fallback_used,
              fallback_reason, fetched_at, data_cutoff, adjustment,
              requested_from, requested_through
       FROM live_market_prices
       ${where}
       ORDER BY symbol, trade_date`,
      parameters,
    ).map((row) => ({
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
      requestedFrom: row.requested_from,
      requestedThrough: row.requested_through,
    }));
  }

  listLiveMarketDates(): string[] {
    return rows<{ trade_date: string }>(
      this.database,
      "SELECT DISTINCT trade_date FROM live_market_prices ORDER BY trade_date",
    ).map((row) => row.trade_date);
  }

  listMarketPrices(symbols?: readonly string[]): StoredMarketPrice[] {
    if (symbols !== undefined) {
      if (!symbols.length) return [];
      const placeholders = symbols.map(() => "?").join(", ");
      return rows<{
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
      }>(
        this.database,
        `SELECT symbol, trade_date, close, source, primary_source, fallback_used,
                fallback_reason, fetched_at, data_cutoff, adjustment
         FROM market_prices
         WHERE symbol IN (${placeholders})
         ORDER BY symbol, trade_date`,
        [...symbols],
      ).map((row) => ({
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
      }));
    }
    return rows<{
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
    }>(
      this.database,
      `SELECT symbol, trade_date, close, source, primary_source, fallback_used,
              fallback_reason, fetched_at, data_cutoff, adjustment
       FROM market_prices
       ORDER BY symbol, trade_date`,
    ).map((row) => ({
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
    }));
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
      backtestExperiments: this.listBacktestExperiments(
        Number.POSITIVE_INFINITY,
      ).map((summary) => this.getBacktestExperiment(summary.experimentId)!),
      marketPrices: rows(
        this.database,
        `SELECT symbol, trade_date, close, source, primary_source,
                fallback_used, fallback_reason, fetched_at, data_cutoff,
                adjustment
         FROM market_prices ORDER BY symbol, trade_date`,
      ),
      liveMarketPrices: rows(
        this.database,
        `SELECT symbol, trade_date, close, source, primary_source,
                fallback_used, fallback_reason, fetched_at, data_cutoff,
                adjustment, requested_from, requested_through
         FROM live_market_prices ORDER BY symbol, trade_date`,
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
      (payload as Partial<BackupPayload>).schemaVersion !== SCHEMA_VERSION ||
      (payload as Partial<BackupPayload>).application !== "stock-income-r1" ||
      !Array.isArray((payload as Partial<BackupPayload>).ledgerEntries) ||
      !Array.isArray(
        (payload as Partial<BackupPayload>).backtestExperiments,
      ) ||
      !Array.isArray((payload as Partial<BackupPayload>).marketPrices) ||
      !Array.isArray((payload as Partial<BackupPayload>).liveMarketPrices) ||
      !Array.isArray((payload as Partial<BackupPayload>).corporateActions) ||
      !Array.isArray((payload as Partial<BackupPayload>).stockUniverse)
    ) {
      throw new Error("备份结构或 schema 版本不兼容");
    }
    const backup = payload as BackupPayload;
    const allowedEntryTypes = new Set([
      "buy",
      "sell",
      "dividend",
      "adjustment",
    ]);
    if (
      backup.ledgerEntries.some(
        (entry) => !allowedEntryTypes.has(entry.type),
      )
    ) {
      throw new Error("备份包含不属于 R1 的投资事实类型");
    }
    const invalidMarketRow = [
      ...backup.marketPrices,
      ...backup.liveMarketPrices,
    ].some(
      (row) =>
        !["tencent", "sina"].includes(row.source) ||
        row.primary_source !== "tencent" ||
        ![0, 1].includes(row.fallback_used) ||
        !["none", "qfq"].includes(row.adjustment),
    );
    if (invalidMarketRow) {
      throw new Error("备份包含非法行情来源或复权口径");
    }
    this.database.transaction(() => {
      this.database.exec(`
        DELETE FROM ledger_entries;
        DELETE FROM backtest_results;
        DELETE FROM backtest_experiments;
        DELETE FROM market_prices;
        DELETE FROM live_market_prices;
        DELETE FROM corporate_actions;
        DELETE FROM settings;
        DELETE FROM stock_universe;
        DELETE FROM backtest_workspace;
      `);
      const insertLedger = this.database.prepare(
        "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
      );
      for (const entry of backup.ledgerEntries) {
        insertLedger.run(
          entry.id,
          entry.businessDate,
          entry.recordedAt,
          entry.type,
          JSON.stringify({ ...entry, source: "restore" }),
        );
      }
      for (const experiment of backup.backtestExperiments) {
        this.insertExperiment(experiment);
      }
      const insertPrice = this.database.prepare(
        `INSERT INTO market_prices(
           symbol, trade_date, close, source, primary_source, fallback_used,
           fallback_reason, fetched_at, data_cutoff, adjustment
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of backup.marketPrices) {
        insertPrice.run(
          row.symbol,
          row.trade_date,
          row.close,
          row.source,
          row.primary_source,
          row.fallback_used,
          row.fallback_reason,
          row.fetched_at,
          row.data_cutoff,
          row.adjustment,
        );
      }
      const insertLivePrice = this.database.prepare(
        `INSERT INTO live_market_prices(
           symbol, trade_date, close, source, primary_source, fallback_used,
           fallback_reason, fetched_at, data_cutoff, adjustment,
           requested_from, requested_through
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of backup.liveMarketPrices) {
        insertLivePrice.run(
          row.symbol,
          row.trade_date,
          row.close,
          row.source,
          row.primary_source,
          row.fallback_used,
          row.fallback_reason,
          row.fetched_at,
          row.data_cutoff,
          row.adjustment,
          row.requested_from,
          row.requested_through,
        );
      }
      const insertAction = this.database.prepare(
        "INSERT INTO corporate_actions(symbol, event_date, payload_json) VALUES (?, ?, ?)",
      );
      for (const row of backup.corporateActions) {
        insertAction.run(row.symbol, row.event_date, row.payload_json);
      }
      this.database
        .prepare("INSERT INTO settings(key, value_json) VALUES ('app', ?)")
        .run(JSON.stringify(backup.settings ?? DEFAULT_SETTINGS));
      const insertStock = this.database.prepare(
        "INSERT INTO stock_universe(symbol, name, source, fetched_at) VALUES (?, ?, ?, ?)",
      );
      for (const stock of backup.stockUniverse) {
        insertStock.run(
          stock.symbol,
          stock.name,
          stock.source,
          stock.fetchedAt,
        );
      }
      if (backup.backtestWorkspace) {
        this.database
          .prepare(
            "INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)",
          )
          .run(JSON.stringify(backup.backtestWorkspace));
      }
    })();
  }
}
