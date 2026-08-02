import BetterSqlite3 from "better-sqlite3";
import { RECENT_BACKTEST_EXPERIMENT_LIMIT } from "../../shared/constants";
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
  PendingDividend,
  PendingDividendStatus,
  StoredMarketCoverage,
  StoredMarketPrice,
  StoredStockInfo,
  StockInfo,
  ValidatedBackupPayload,
} from "../../shared/contracts";
import { rows } from "./dbUtil";
import {
  DEFAULT_SETTINGS,
  SCHEMA_FINGERPRINT,
  SCHEMA_VERSION,
  initializeSchema,
} from "./schema";
import {
  addLedger as addLedgerEntry,
  addLedgerEntries as addLedgerEntriesTo,
  listLedger as listLedgerFrom,
} from "./ledgerRepository";
import {
  deleteBacktestExperiment as deleteBacktestExperimentFrom,
  getBacktest as getBacktestFrom,
  getBacktestExperiment as getBacktestExperimentFrom,
  getBacktestWorkspace as getBacktestWorkspaceFrom,
  listBacktestExperiments as listBacktestExperimentsFrom,
  saveBacktestExperimentWithMarketData as saveBacktestExperimentWithMarketDataFrom,
  saveBacktestWorkspace as saveBacktestWorkspaceFrom,
} from "./backtestRepository";
import {
  listLiveMarketCoverage as listLiveMarketCoverageFrom,
  listLiveMarketDates as listLiveMarketDatesFrom,
  listLiveMarketPrices as listLiveMarketPricesFrom,
  saveLiveMarketPriceSnapshots as saveLiveMarketPriceSnapshotsFrom,
} from "./marketRepository";
import {
  deleteAllPendingDividends as deleteAllPendingDividendsFrom,
  findPendingDividend as findPendingDividendFrom,
  getPendingDividend as getPendingDividendFrom,
  insertPendingDividend as insertPendingDividendFrom,
  insertPendingDividends as insertPendingDividendsFrom,
  listPendingDividends as listPendingDividendsFrom,
  listPendingDividendsByStatus as listPendingDividendsByStatusFrom,
  updatePendingDividendStatus as updatePendingDividendStatusFrom,
} from "./pendingDividendRepository";
import {
  exportBackup as exportBackupFrom,
  restoreBackup as restoreBackupFrom,
} from "./backupRepository";

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
    initializeSchema(this.database);
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
    addLedgerEntry(this.database, entry);
  }

  addLedgerEntries(entries: readonly LedgerEntry[]): void {
    addLedgerEntriesTo(this.database, entries);
  }

  listLedger(): LedgerEntry[] {
    return listLedgerFrom(this.database);
  }

  saveBacktestExperimentWithMarketData(
    experiment: BacktestExperiment,
    marketData: MarketDataCacheEntry[],
  ): void {
    saveBacktestExperimentWithMarketDataFrom(
      this.database,
      experiment,
      marketData,
    );
  }

  listBacktestExperiments(
    limit = RECENT_BACKTEST_EXPERIMENT_LIMIT,
  ): BacktestExperimentSummary[] {
    return listBacktestExperimentsFrom(this.database, limit);
  }

  getBacktestExperiment(id: string): BacktestExperiment | null {
    return getBacktestExperimentFrom(this.database, id);
  }

  deleteBacktestExperiment(id: string): void {
    deleteBacktestExperimentFrom(this.database, id);
  }

  getBacktest(id: string): BacktestResult | null {
    return getBacktestFrom(this.database, id);
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
         fallback_reason, fetched_at, listing_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          stock.listingDate ?? null,
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
      listing_date: string | null;
    }>(
      this.database,
      `SELECT symbol, name, security_type, source, primary_source,
              fallback_used, fallback_reason, fetched_at, listing_date
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
      ...(row.listing_date ? { listingDate: row.listing_date } : {}),
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
    return getBacktestWorkspaceFrom(this.database);
  }

  saveBacktestWorkspace(state: BacktestWorkspaceState): void {
    saveBacktestWorkspaceFrom(this.database, state);
  }

  saveLiveMarketPriceSnapshots(entries: MarketDataCacheEntry[]): void {
    saveLiveMarketPriceSnapshotsFrom(this.database, entries);
  }

  listLiveMarketPrices(symbols?: readonly string[]): StoredMarketPrice[] {
    return listLiveMarketPricesFrom(this.database, symbols);
  }

  listLiveMarketCoverage(
    symbols?: readonly string[],
  ): StoredMarketCoverage[] {
    return listLiveMarketCoverageFrom(this.database, symbols);
  }

  listLiveMarketDates(): string[] {
    return listLiveMarketDatesFrom(this.database);
  }

  listPendingDividends(): PendingDividend[] {
    return listPendingDividendsFrom(this.database);
  }

  listPendingDividendsByStatus(
    status: PendingDividendStatus,
  ): PendingDividend[] {
    return listPendingDividendsByStatusFrom(this.database, status);
  }

  getPendingDividend(id: string): PendingDividend | null {
    return getPendingDividendFrom(this.database, id);
  }

  insertPendingDividend(candidate: PendingDividend): void {
    insertPendingDividendFrom(this.database, candidate);
  }

  updatePendingDividendStatus(
    id: string,
    status: PendingDividendStatus,
    confirmedAmount?: number,
    linkedEntryId?: string,
  ): void {
    updatePendingDividendStatusFrom(
      this.database,
      id,
      status,
      confirmedAmount,
      linkedEntryId,
    );
  }

  findPendingDividend(
    symbol: string,
    recordDate: string,
  ): PendingDividend | null {
    return findPendingDividendFrom(this.database, symbol, recordDate);
  }

  deleteAllPendingDividends(): void {
    deleteAllPendingDividendsFrom(this.database);
  }

  insertPendingDividends(candidates: readonly PendingDividend[]): void {
    insertPendingDividendsFrom(this.database, candidates);
  }

  exportBackup(): BackupPayload {
    return exportBackupFrom(this.database, {
      getSettings: () => this.getSettings(),
      listStockUniverse: () => this.listStockUniverse(),
      listPendingDividends: () => this.listPendingDividends(),
    });
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
    restoreBackupFrom(this.database, backup);
  }
}
