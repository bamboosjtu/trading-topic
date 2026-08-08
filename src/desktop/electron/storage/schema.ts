import BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import type { AppSettings } from "../../shared/contracts";
import { rows } from "./dbUtil";

export const SCHEMA_VERSION = 1;
export const SCHEMA_FINGERPRINT =
  "stock-income-r1-schema-1-2026-08-08-structured-data-quality";
export const DEFAULT_SETTINGS: AppSettings = {
  priceSource: "tencent_sina",
  dividendSource: "eastmoney",
  commissionRate: 0,
  minimumCommission: 0,
  caliberVersion: BACKTEST_CALIBER_VERSION,
};

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

export function initializeSchema(database: BetterSqlite3.Database): void {
  database.transaction(() => {
    const currentVersion = database.pragma("user_version", {
      simple: true,
    }) as number;
    if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
      throw new Error(
        `数据库版本不兼容：仅支持 Schema ${SCHEMA_VERSION}，当前为 Schema ${currentVersion}`,
      );
    }
    const existingTables = rows<{ name: string }>(
      database,
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
        "pending_dividends",
        "security_trading_interruptions",
      ];
      const missingTables = requiredTables.filter(
        (table) => !existingTables.includes(table),
      );
      if (missingTables.length) {
        throw new Error(
          `Schema ${SCHEMA_VERSION} 数据库结构不完整：缺少 ${missingTables.join("、")}`,
        );
      }
      const metadata = database
        .prepare(
          "SELECT fingerprint, shape_fingerprint FROM schema_metadata WHERE id = 1",
        )
        .get() as
        | { fingerprint: string; shape_fingerprint: string }
        | undefined;
      if (
        metadata?.fingerprint !== SCHEMA_FINGERPRINT ||
        metadata.shape_fingerprint !== schemaShapeFingerprint(database)
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
    database.exec(`
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
        coverage_id INTEGER NOT NULL,
        PRIMARY KEY (symbol, trade_date),
        FOREIGN KEY (coverage_id)
          REFERENCES live_market_coverage(coverage_id)
          ON DELETE CASCADE
      );
      CREATE TABLE live_market_coverage (
        coverage_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        result_status TEXT NOT NULL CHECK (result_status IN ('data', 'empty', 'partial')),
        issues_json TEXT,
        UNIQUE (symbol, requested_from, requested_through, adjustment)
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
        fetched_at TEXT NOT NULL,
        listing_date TEXT
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
      CREATE TABLE pending_dividends (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        instrument_name TEXT NOT NULL,
        security_type TEXT NOT NULL CHECK (security_type IN ('stock', 'etf')),
        ex_date TEXT NOT NULL,
        record_date TEXT NOT NULL,
        payment_date TEXT,
        per_share REAL NOT NULL,
        holding_quantity REAL NOT NULL,
        expected_amount REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'ignored')),
        discovered_at TEXT NOT NULL,
        confirmed_amount REAL,
        linked_entry_id TEXT,
        source TEXT NOT NULL CHECK (source = 'corporate_action'),
        note TEXT,
        UNIQUE(symbol, record_date)
      );
      CREATE TABLE security_trading_interruptions (
        symbol TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT NOT NULL
          CHECK (reason IN ('suspension', 'delisted', 'not_yet_listed')),
        source TEXT NOT NULL,
        source_id TEXT,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY(symbol, start_date, end_date, reason)
      );
      CREATE INDEX idx_backtest_experiments_created_at
        ON backtest_experiments(created_at DESC);
      CREATE INDEX idx_backtest_results_experiment
        ON backtest_results(experiment_id);
      CREATE INDEX idx_backtest_results_strategy
        ON backtest_results(strategy_key);
    `);
    database
      .prepare(
        `INSERT INTO schema_metadata(
           id, fingerprint, shape_fingerprint
         ) VALUES (1, ?, ?)`,
      )
      .run(SCHEMA_FINGERPRINT, schemaShapeFingerprint(database));
    database.pragma(`user_version = ${SCHEMA_VERSION}`);
    database
      .prepare("INSERT INTO settings(key, value_json) VALUES ('app', ?)")
      .run(JSON.stringify(DEFAULT_SETTINGS));
  })();
}
