import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
  BACKTEST_CALIBER_VERSION,
  BACKTEST_EXPERIMENT_LIMIT,
} from "../../shared/constants";
import type {
  AppSettings,
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestResult,
  BacktestWorkspaceState,
  DividendEvent,
  LedgerEntry,
  PricePoint,
  StockInfo,
} from "../../shared/contracts";

const SCHEMA_VERSION = 3;
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
  backtestExperiments: BacktestExperiment[];
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
  stockUniverse: Array<
    StockInfo & {
      source: string;
      fetchedAt: string;
    }
  >;
  backtestWorkspace: BacktestWorkspaceState | null;
}

function rows<T>(
  database: Database,
  sql: string,
  parameters: Array<string | number | null> = [],
): T[] {
  const statement = database.prepare(sql);
  const result: T[] = [];
  try {
    if (parameters.length) statement.bind(parameters);
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
    const currentVersion =
      rows<{ user_version: number }>(
        this.database,
        "PRAGMA user_version",
      )[0]?.user_version ?? 0;
    if (currentVersion < SCHEMA_VERSION) {
      // 当前产品尚无用户数据，直接移除已废弃的 batch/唯一策略模型，
      // 不保留兼容分支或双轨表。
      this.database.run(`
        DROP TABLE IF EXISTS backtest_runs;
        DROP TABLE IF EXISTS backtest_results;
        DROP TABLE IF EXISTS backtest_experiments;
        DROP TABLE IF EXISTS backtest_workspace;
      `);
    }
    this.database.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        type TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_backtest_experiments_created_at
        ON backtest_experiments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_backtest_results_experiment
        ON backtest_results(experiment_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy
        ON backtest_results(strategy_key);
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

  private insertExperiment(experiment: BacktestExperiment): void {
    this.database.run(
      `INSERT INTO backtest_experiments(
         id, created_at, request_json, data_cutoff, caliber_version, status
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        experiment.experimentId,
        experiment.createdAt,
        JSON.stringify(experiment.request),
        experiment.dataCutoff,
        experiment.caliberVersion,
        experiment.status,
      ],
    );
    for (const result of experiment.results) {
      if (result.experimentId !== experiment.experimentId) {
        throw new Error("回测结果与实验编号不一致");
      }
      this.database.run(
        `INSERT INTO backtest_results(
           id, experiment_id, symbol, strategy_key, result_json
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          result.id,
          experiment.experimentId,
          result.symbol,
          result.strategyKey,
          JSON.stringify(result),
        ],
      );
    }
  }

  saveBacktestExperiment(experiment: BacktestExperiment): void {
    this.database.run("BEGIN");
    try {
      this.insertExperiment(experiment);
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
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
    limit = BACKTEST_EXPERIMENT_LIMIT,
  ): BacktestExperimentSummary[] {
    const suffix = Number.isFinite(limit) ? ` LIMIT ${Math.max(1, limit)}` : "";
    return rows<{
      id: string;
      created_at: string;
      request_json: string;
      data_cutoff: string;
      caliber_version: string;
      status: "completed";
    }>(
      this.database,
      `SELECT id, created_at, request_json, data_cutoff, caliber_version, status
       FROM backtest_experiments
       ORDER BY created_at DESC${suffix}`,
    ).map((row) => {
      const results = this.listExperimentResults(row.id);
      const xirrs = results
        .map((result) => result.metrics.xirr)
        .filter((value): value is number => value !== null);
      return {
        experimentId: row.id,
        createdAt: row.created_at,
        request: JSON.parse(row.request_json) as BacktestExperiment["request"],
        dataCutoff: row.data_cutoff,
        caliberVersion: row.caliber_version,
        status: row.status,
        resultCount: results.length,
        bestXirr: xirrs.length ? Math.max(...xirrs) : null,
        maxDrawdown: results.length
          ? Math.min(...results.map((result) => result.metrics.maxDrawdown))
          : 0,
      };
    });
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
    this.database.run("BEGIN");
    try {
      // sql.js 的外键 pragma 可能受已有连接状态影响；显式删除子记录，
      // 让删除语义不依赖运行时是否真正启用了级联。
      this.database.run(
        "DELETE FROM backtest_results WHERE experiment_id = ?",
        [id],
      );
      this.database.run(
        "DELETE FROM backtest_experiments WHERE id = ?",
        [id],
      );
      if (workspace?.activeExperimentId === id) {
        this.database.run(
          `INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)
           ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
          [
            JSON.stringify({
              ...workspace,
              activeExperimentId: undefined,
              updatedAt: new Date().toISOString(),
            }),
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
      backtestExperiments: this.listBacktestExperiments(
        Number.POSITIVE_INFINITY,
      ).map((summary) =>
        this.getBacktestExperiment(summary.experimentId)!,
      ),
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
      (payload as Partial<BackupPayload>).schemaVersion !== SCHEMA_VERSION ||
      (payload as Partial<BackupPayload>).application !== "stock-income-r1" ||
      !Array.isArray((payload as Partial<BackupPayload>).ledgerEntries) ||
      !Array.isArray(
        (payload as Partial<BackupPayload>).backtestExperiments,
      ) ||
      !Array.isArray((payload as Partial<BackupPayload>).marketPrices) ||
      !Array.isArray((payload as Partial<BackupPayload>).corporateActions) ||
      !Array.isArray((payload as Partial<BackupPayload>).stockUniverse)
    ) {
      throw new Error("备份结构或 schema 版本不兼容");
    }
    const backup = payload as BackupPayload;
    this.database.run("BEGIN");
    try {
      this.database.run("DELETE FROM ledger_entries");
      this.database.run("DELETE FROM backtest_results");
      this.database.run("DELETE FROM backtest_experiments");
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
      for (const experiment of backup.backtestExperiments) {
        this.insertExperiment(experiment);
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
      for (const stock of backup.stockUniverse) {
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
