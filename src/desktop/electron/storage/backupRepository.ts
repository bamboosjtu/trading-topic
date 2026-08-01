import BetterSqlite3 from "better-sqlite3";
import type {
  AppSettings,
  BackupPayload,
  StoredStockInfo,
  ValidatedBackupPayload,
} from "../../shared/contracts";
import { buildInsertSql, rows } from "./dbUtil";
import { insertExperiment, listBacktestExperiments, getBacktestExperiment, getBacktestWorkspace } from "./backtestRepository";
import { listLedger } from "./ledgerRepository";
import {
  LIVE_MARKET_COVERAGE_COLUMNS,
  LIVE_MARKET_PRICE_COLUMNS,
  MARKET_PRICE_COLUMNS,
} from "./marketRepository";
import { SCHEMA_FINGERPRINT, SCHEMA_VERSION } from "./schema";

export interface BackupContext {
  getSettings: () => AppSettings;
  listStockUniverse: () => StoredStockInfo[];
}

export function exportBackup(
  database: BetterSqlite3.Database,
  ctx: BackupContext,
): BackupPayload {
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
    ledgerEntries: listLedger(database),
    backtestExperiments: listBacktestExperiments(
      database,
      Number.POSITIVE_INFINITY,
    ).map((summary) => getBacktestExperiment(database, summary.experimentId)!),
    marketPrices: rows(
      database,
      `SELECT ${MARKET_PRICE_COLUMNS.join(", ")}
       FROM market_prices ORDER BY symbol, trade_date`,
    ),
    liveMarketPrices: rows(
      database,
      `SELECT ${LIVE_MARKET_PRICE_COLUMNS.join(", ")}
       FROM live_market_prices ORDER BY symbol, trade_date`,
    ),
    liveMarketCoverage: rows(
      database,
      `SELECT ${LIVE_MARKET_COVERAGE_COLUMNS.join(", ")}
       FROM live_market_coverage
       ORDER BY symbol, requested_from, requested_through`,
    ),
    corporateActions: rows(
      database,
      "SELECT symbol, event_date, payload_json FROM corporate_actions ORDER BY symbol, event_date",
    ),
    settings: ctx.getSettings(),
    stockUniverse: ctx.listStockUniverse(),
    backtestWorkspace: getBacktestWorkspace(database),
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
export function restoreBackup(
  database: BetterSqlite3.Database,
  backup: ValidatedBackupPayload,
): void {
  database.transaction(() => {
    // 不删除 app_logs 与 schema_metadata：
    // - app_logs 保留恢复操作前后的运行日志，便于审计；
    // - schema_metadata 保存目标库自身的指纹，删除会破坏后续启动校验。
    database.exec(`
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
    const insertLedger = database.prepare(
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
      insertExperiment(database, experiment);
    }
    const insertPrice = database.prepare(
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
    const insertCoverage = database.prepare(
      buildInsertSql(
        "live_market_coverage",
        LIVE_MARKET_COVERAGE_COLUMNS,
      ),
    );
    for (const row of backup.liveMarketCoverage) {
      insertCoverage.run(
        row.coverage_id,
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
    const insertLivePrice = database.prepare(
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
        row.coverage_id,
      );
    }
    const insertAction = database.prepare(
      "INSERT INTO corporate_actions(symbol, event_date, payload_json) VALUES (?, ?, ?)",
    );
    for (const row of backup.corporateActions) {
      insertAction.run(row.symbol, row.event_date, row.payload_json);
    }
    database
      .prepare("INSERT INTO settings(key, value_json) VALUES ('app', ?)")
      .run(JSON.stringify(backup.settings));
    const insertStock = database.prepare(
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
      database
        .prepare(
          "INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)",
        )
        .run(JSON.stringify(backup.backtestWorkspace));
    }
  })();
}
