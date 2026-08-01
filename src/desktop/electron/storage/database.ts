import BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
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
  BackupPayload,
  DirectoryProvenance,
  LedgerEntry,
  MarketDataCacheEntry,
  StoredMarketCoverage,
  StoredMarketPrice,
  StoredStockInfo,
  StockInfo,
  ValidatedBackupPayload,
} from "../../shared/contracts";

const SCHEMA_VERSION = 2;
const SCHEMA_FINGERPRINT =
  "stock-income-r1-schema-2-2026-07-30-valuation-boundary-v3";
const DEFAULT_SETTINGS: AppSettings = {
  priceSource: "tencent_sina",
  dividendSource: "eastmoney",
  commissionRate: 0,
  minimumCommission: 0,
  caliberVersion: BACKTEST_CALIBER_VERSION,
};

type SqlParameter = string | number | bigint | Buffer | null;

function rows<T>(
  database: BetterSqlite3.Database,
  sql: string,
  parameters: SqlParameter[] = [],
): T[] {
  return database.prepare(sql).all(...parameters) as T[];
}

/**
 * market_prices / live_market_prices 共享的列定义与行映射。
 *
 * 两张表的非 live 列完全一致（symbol..adjustment），live 表额外包含
 * requested_from / requested_through。集中列定义避免 INSERT 与 SELECT
 * 在多处各写一份、漂移后不易发现。
 */
const MARKET_PRICE_COLUMNS = [
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
const LIVE_MARKET_PRICE_COLUMNS = [
  ...MARKET_PRICE_COLUMNS,
  "requested_from",
  "requested_through",
] as const;
const LIVE_MARKET_COVERAGE_COLUMNS = [
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

/** 生成 `INSERT [OR REPLACE] INTO table(cols) VALUES (?, ...)` 语句。 */
function buildInsertSql(
  table: string,
  columns: readonly string[],
  orReplace = false,
): string {
  const conflict = orReplace ? "OR REPLACE " : "";
  return `INSERT ${conflict}INTO ${table}(${columns.join(", ")}) VALUES (${columns
    .map(() => "?")
    .join(", ")})`;
}

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
  requested_from?: string;
  requested_through?: string;
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
    ...(row.requested_from
      ? { requestedFrom: row.requested_from }
      : {}),
    ...(row.requested_through
      ? { requestedThrough: row.requested_through }
      : {}),
  };
}

interface MarketCoverageRow {
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

function schemaShapeFingerprint(database: BetterSqlite3.Database): string {
  const schema = rows<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }>(
    database,
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  ).map((item) => ({
    ...item,
    // 空白归一化：将连续空白折叠为单空格并去除首尾空白。
    // 注意：此归一化不处理括号/逗号周边的空格（如 `foo (x)` 与 `foo(x)`），
    // 因此对 DDL 排版仍有较弱敏感。MVP 阶段 DDL 由本仓库唯一写入，
    // SQLite 存储的 sql 文本在创建与重开时一致，指纹匹配可保证；
    // 若未来需要跨工具/跨版本导出兼容，可在此扩展更激进的归一化，
    // 但需同步 bump SCHEMA_FINGERPRINT 以失效旧库。
    sql: item.sql?.replace(/\s+/g, " ").trim() ?? null,
  }));
  return createHash("sha256")
    .update(JSON.stringify(schema), "utf8")
    .digest("hex");
}

export class LocalDatabase {
  private constructor(private readonly database: BetterSqlite3.Database) {}

  static async open(filePath: string): Promise<LocalDatabase> {
    const database = new BetterSqlite3(filePath);
    database.pragma("foreign_keys = ON");
    const store = new LocalDatabase(database);
    try {
      store.initializeSchema();
      // 只有当前 Schema 验证通过后才切换持久化模式，避免打开不兼容
      // 数据库时先写文件头或创建 WAL 辅助文件。
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    if (this.database.open) this.database.close();
  }

  getSchemaVersion(): number {
    return SCHEMA_VERSION;
  }

  /**
   * 返回当前 Schema 的固定指纹，供调用方在 `validateBackup` 时传入。
   *
   * 暴露此方法是为了让 `restoreBackup` 不再反向依赖 `domain/backupValidation`：
   * 调用方（main 进程）负责先 `validateBackup(payload, version, fingerprint)`，
   * 再用已校验的 `BackupPayload` 调用 `restoreBackup`。
   */
  getSchemaFingerprint(): string {
    return SCHEMA_FINGERPRINT;
  }

  private initializeSchema(): void {
    this.database.transaction(() => {
      const currentVersion = this.database.pragma("user_version", {
        simple: true,
      }) as number;
      if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
        throw new Error(
          `数据库版本不兼容：仅支持 Schema ${SCHEMA_VERSION}，当前为 Schema ${currentVersion}`,
        );
      }
      const existingTables = rows<{ name: string }>(
        this.database,
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'`,
      ).map((row) => row.name);
      if (currentVersion === SCHEMA_VERSION) {
        const requiredTables = [
          "ledger_entries",
          "backtest_experiments",
          "backtest_results",
          "market_prices",
          "live_market_prices",
          "live_market_coverage",
          "corporate_actions",
          "settings",
          "app_logs",
          "stock_universe",
          "backtest_workspace",
          "schema_metadata",
        ];
        const missingTables = requiredTables.filter(
          (table) => !existingTables.includes(table),
        );
        if (missingTables.length) {
          throw new Error(
            `Schema ${SCHEMA_VERSION} 数据库结构不完整：缺少 ${missingTables.join("、")}`,
          );
        }
        const metadata = this.database
          .prepare(
            "SELECT fingerprint, shape_fingerprint FROM schema_metadata WHERE id = 1",
          )
          .get() as
          | { fingerprint: string; shape_fingerprint: string }
          | undefined;
        if (
          metadata?.fingerprint !== SCHEMA_FINGERPRINT ||
          metadata.shape_fingerprint !==
            schemaShapeFingerprint(this.database)
        ) {
          throw new Error(
            `Schema ${SCHEMA_VERSION} 指纹不匹配；MVP 不兼容旧数据库`,
          );
        }
        return;
      }
      if (existingTables.length) {
        throw new Error(
          "检测到未标记版本的既有数据库；MVP 不执行迁移，请使用新的本地数据库",
        );
      }
      this.database.exec(`
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        type TEXT NOT NULL
          CHECK (type IN ('buy', 'sell', 'dividend', 'adjustment')),
        payload_json TEXT NOT NULL
      );
      CREATE TABLE backtest_experiments (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        request_json TEXT NOT NULL,
        data_cutoff TEXT NOT NULL,
        caliber_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status = 'completed')
      );
      CREATE TABLE backtest_results (
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
      CREATE TABLE market_prices (
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
      CREATE TABLE live_market_prices (
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
      CREATE TABLE live_market_coverage (
        symbol TEXT NOT NULL,
        requested_from TEXT NOT NULL,
        requested_through TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('tencent', 'sina')),
        primary_source TEXT NOT NULL CHECK (primary_source = 'tencent'),
        fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
        fallback_reason TEXT,
        fetched_at TEXT NOT NULL,
        data_cutoff TEXT,
        adjustment TEXT NOT NULL CHECK (adjustment IN ('none', 'qfq')),
        empty_evidence TEXT
          CHECK (empty_evidence IS NULL OR empty_evidence IN ('exchange_calendar', 'outside_listing')),
        result_status TEXT NOT NULL CHECK (result_status IN ('data', 'empty')),
        PRIMARY KEY (symbol, requested_from, requested_through, adjustment)
      );
      CREATE TABLE corporate_actions (
        symbol TEXT NOT NULL,
        event_date TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (symbol, event_date)
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
      CREATE TABLE app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE TABLE stock_universe (
        symbol TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        security_type TEXT NOT NULL
          CHECK (security_type IN ('stock', 'etf')),
        source TEXT NOT NULL,
        primary_source TEXT NOT NULL,
        fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
        fallback_reason TEXT,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE backtest_workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL
      );
      CREATE TABLE schema_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fingerprint TEXT NOT NULL,
        shape_fingerprint TEXT NOT NULL
      );
      CREATE INDEX idx_backtest_experiments_created_at
        ON backtest_experiments(created_at DESC);
      CREATE INDEX idx_backtest_results_experiment
        ON backtest_results(experiment_id);
      CREATE INDEX idx_backtest_results_strategy
        ON backtest_results(strategy_key);
    `);
      this.database
        .prepare(
          `INSERT INTO schema_metadata(
             id, fingerprint, shape_fingerprint
           ) VALUES (1, ?, ?)`,
        )
        .run(
          SCHEMA_FINGERPRINT,
          schemaShapeFingerprint(this.database),
        );
      this.database.pragma(`user_version = ${SCHEMA_VERSION}`);
      this.database
        .prepare(
          "INSERT INTO settings(key, value_json) VALUES ('app', ?)",
        )
        .run(JSON.stringify(DEFAULT_SETTINGS));
    })();
  }

  log(level: "info" | "warn" | "error", message: string): void {
    // 脱敏规则覆盖常见密钥/凭证形式，避免 token、API key、密码、
    // Authorization 头等敏感信息进入持久化日志。规则按"前缀+值"匹配，
    // 命中后整体替换为 [REDACTED]。
    const sanitized = message
      .replace(/Bearer\s+[A-Za-z0-9._~+-]+/gi, "Bearer [REDACTED]")
      .replace(
        /(api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?[A-Za-z0-9._~+-]{8,}['"]?/gi,
        "$1=[REDACTED]",
      )
      .replace(/sk-[A-Za-z0-9]{16,}/g, "sk-[REDACTED]")
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

  replaceStockUniverseType(
    stocks: StockInfo[],
    securityType: "stock" | "etf",
    provenance: DirectoryProvenance,
  ): void {
    if (stocks.some((stock) => stock.securityType !== securityType)) {
      throw new Error("证券目录类型与替换范围不一致");
    }
    const insert = this.database.prepare(
      `INSERT INTO stock_universe(
         symbol, name, security_type, source, primary_source, fallback_used,
         fallback_reason, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.database.transaction(() => {
      this.database
        .prepare("DELETE FROM stock_universe WHERE security_type = ?")
        .run(securityType);
      for (const stock of stocks) {
        insert.run(
          stock.symbol,
          stock.name,
          securityType,
          provenance.source,
          provenance.primarySource,
          provenance.fallbackUsed ? 1 : 0,
          provenance.fallbackReason ?? null,
          provenance.fetchedAt,
        );
      }
    })();
  }

  listStockUniverse(): StoredStockInfo[] {
    return rows<{
      symbol: string;
      name: string;
      security_type: "stock" | "etf";
      source: string;
      primary_source: string;
      fallback_used: number;
      fallback_reason: string | null;
      fetched_at: string;
    }>(
      this.database,
      `SELECT symbol, name, security_type, source, primary_source,
              fallback_used, fallback_reason, fetched_at
       FROM stock_universe ORDER BY symbol`,
    ).map((row) => ({
      symbol: row.symbol,
      name: row.name,
      securityType: row.security_type,
      source: row.source,
      primarySource: row.primary_source,
      fallbackUsed: Boolean(row.fallback_used),
      ...(row.fallback_reason
        ? { fallbackReason: row.fallback_reason }
        : {}),
      fetchedAt: row.fetched_at,
    }));
  }

  getDirectoryProvenance(
    securityType: "stock" | "etf",
  ): DirectoryProvenance | null {
    // 直接按 security_type 索引读取单行，避免 listStockUniverse() 全表加载
    // 后在内存中 find。stock_universe 表存在主键索引，但 security_type
    // 没有索引；查询仍能利用 SQLite 的早期终止，返回首条匹配即结束。
    const row = rows<{
      source: string;
      primary_source: string;
      fallback_used: number;
      fallback_reason: string | null;
      fetched_at: string;
    }>(
      this.database,
      `SELECT source, primary_source, fallback_used, fallback_reason,
              fetched_at
         FROM stock_universe
        WHERE security_type = ?
        LIMIT 1`,
      [securityType],
    )[0];
    if (!row) return null;
    return {
      source: row.source,
      primarySource: row.primary_source,
      fallbackUsed: Boolean(row.fallback_used),
      ...(row.fallback_reason
        ? { fallbackReason: row.fallback_reason }
        : {}),
      fetchedAt: row.fetched_at,
    };
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
    const dataCutoff =
      entry.provenance.dataCutoff ?? entry.prices.at(-1)?.date;
    if (!dataCutoff && entry.prices.length) {
      throw new Error("行情快照包含价格但缺少实际数据截止日");
    }
    const insertPrice = this.database.prepare(
      buildInsertSql("market_prices", MARKET_PRICE_COLUMNS, true),
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
        dataCutoff,
        entry.provenance.adjustment,
      );
    }
    for (const event of entry.dividends) {
      insertAction.run(entry.symbol, event.date, JSON.stringify(event));
    }
  }

  saveLiveMarketPriceSnapshots(entries: MarketDataCacheEntry[]): void {
    const insertPrice = this.database.prepare(
      buildInsertSql("live_market_prices", LIVE_MARKET_PRICE_COLUMNS, true),
    );
    const insertCoverage = this.database.prepare(
      buildInsertSql(
        "live_market_coverage",
        LIVE_MARKET_COVERAGE_COLUMNS,
        true,
      ),
    );
    this.database.transaction(() => {
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
        insertCoverage.run(
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
            requestedFrom,
            requestedThrough,
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
    return rows<MarketPriceRow>(
      this.database,
      `SELECT ${LIVE_MARKET_PRICE_COLUMNS.join(", ")}
       FROM live_market_prices
       ${where}
       ORDER BY symbol, trade_date`,
      parameters,
    ).map(mapStoredMarketPrice);
  }

  listLiveMarketCoverage(
    symbols?: readonly string[],
  ): StoredMarketCoverage[] {
    const parameters = symbols ? [...symbols] : [];
    if (symbols && !symbols.length) return [];
    const where = symbols
      ? `WHERE symbol IN (${symbols.map(() => "?").join(", ")})`
      : "";
    return rows<MarketCoverageRow>(
      this.database,
      `SELECT ${LIVE_MARKET_COVERAGE_COLUMNS.join(", ")}
       FROM live_market_coverage
       ${where}
       ORDER BY symbol, requested_from, requested_through`,
      parameters,
    ).map(mapStoredMarketCoverage);
  }

  listLiveMarketDates(): string[] {
    return rows<{ trade_date: string }>(
      this.database,
      "SELECT DISTINCT trade_date FROM live_market_prices ORDER BY trade_date",
    ).map((row) => row.trade_date);
  }

  exportBackup(): BackupPayload {
    // 备份范围：业务数据（流水、回测、行情、公司行动、设置、证券目录、工作区）。
    // 刻意排除：
    // - app_logs：运行日志与设备/时点相关，恢复到另一实例无意义；
    // - schema_metadata：schema 指纹由目标库自身在初始化时写入，
    //   从备份恢复会破坏本地指纹一致性校验。
    return {
      schemaVersion: SCHEMA_VERSION,
      schemaFingerprint: SCHEMA_FINGERPRINT,
      exportedAt: new Date().toISOString(),
      application: "stock-income-r1",
      ledgerEntries: this.listLedger(),
      backtestExperiments: this.listBacktestExperiments(
        Number.POSITIVE_INFINITY,
      ).map((summary) => this.getBacktestExperiment(summary.experimentId)!),
      marketPrices: rows(
        this.database,
        `SELECT ${MARKET_PRICE_COLUMNS.join(", ")}
         FROM market_prices ORDER BY symbol, trade_date`,
      ),
      liveMarketPrices: rows(
        this.database,
        `SELECT ${LIVE_MARKET_PRICE_COLUMNS.join(", ")}
         FROM live_market_prices ORDER BY symbol, trade_date`,
      ),
      liveMarketCoverage: rows(
        this.database,
        `SELECT ${LIVE_MARKET_COVERAGE_COLUMNS.join(", ")}
         FROM live_market_coverage
         ORDER BY symbol, requested_from, requested_through`,
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

  /**
   * 用已校验的备份覆盖当前数据库。
   *
   * 参数类型 `ValidatedBackupPayload` 是 branded type，只有
   * `validateBackup()` 能产生。调用方必须先校验：
   *
   * ```ts
   * const validated = validateBackup(payload, version, fingerprint);
   * database.restoreBackup(validated);
   * ```
   *
   * TypeScript 会拒绝直接传入 `BackupPayload` 或 `unknown`，
   * 避免未校验的备份触发破坏性覆盖。
   */
  restoreBackup(backup: ValidatedBackupPayload): void {
    this.database.transaction(() => {
      // 不删除 app_logs 与 schema_metadata：
      // - app_logs 保留恢复操作前后的运行日志，便于审计；
      // - schema_metadata 保存目标库自身的指纹，删除会破坏后续启动校验。
      this.database.exec(`
        DELETE FROM ledger_entries;
        DELETE FROM backtest_results;
        DELETE FROM backtest_experiments;
        DELETE FROM market_prices;
        DELETE FROM live_market_prices;
        DELETE FROM live_market_coverage;
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
        buildInsertSql("market_prices", MARKET_PRICE_COLUMNS),
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
        buildInsertSql("live_market_prices", LIVE_MARKET_PRICE_COLUMNS),
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
      const insertCoverage = this.database.prepare(
        buildInsertSql(
          "live_market_coverage",
          LIVE_MARKET_COVERAGE_COLUMNS,
        ),
      );
      for (const row of backup.liveMarketCoverage) {
        insertCoverage.run(
          row.symbol,
          row.requested_from,
          row.requested_through,
          row.source,
          row.primary_source,
          row.fallback_used,
          row.fallback_reason,
          row.fetched_at,
          row.data_cutoff,
          row.adjustment,
          row.empty_evidence,
          row.result_status,
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
        .run(JSON.stringify(backup.settings));
      const insertStock = this.database.prepare(
        `INSERT INTO stock_universe(
           symbol, name, security_type, source, primary_source, fallback_used,
           fallback_reason, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const stock of backup.stockUniverse) {
        insertStock.run(
          stock.symbol,
          stock.name,
          stock.securityType,
          stock.source,
          stock.primarySource,
          stock.fallbackUsed ? 1 : 0,
          stock.fallbackReason ?? null,
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
