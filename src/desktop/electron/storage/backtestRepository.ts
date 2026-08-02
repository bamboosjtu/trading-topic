import BetterSqlite3 from "better-sqlite3";
import { RECENT_BACKTEST_EXPERIMENT_LIMIT } from "../../shared/constants";
import type {
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestResult,
  BacktestWorkspaceState,
  MarketDataCacheEntry,
} from "../../shared/contracts";
import { rows } from "./dbUtil";
import { insertMarketData } from "./marketRepository";

/**
 * 为旧版本持久化的 BacktestResult 补充新增字段默认值。
 *
 * dataQualityStatus 是 P1-2 新增字段，旧实验 JSON 中不存在。
 * P2-1：对 e92fd778 到 ded25eba 之间生成的实验，已允许共同缺口降级
 * 但尚未保存 dataQualityStatus。此时通过检查旧 warning 文案推断状态。
 */
function normalizeBacktestResult(raw: unknown): BacktestResult {
  const result = raw as BacktestResult;
  if (!result.dataQualityStatus) {
    const hasOldCommonGapWarning = result.warnings?.some(
      (warning) =>
        warning.includes("腾讯与新浪均未返回") ||
        warning.includes("按证券不可交易区间处理"),
    );
    result.dataQualityStatus = hasOldCommonGapWarning
      ? "degraded_common_gap"
      : "strict";
  }
  return result;
}

export function insertExperiment(
  database: BetterSqlite3.Database,
  experiment: BacktestExperiment,
): void {
  database
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
  const insertResult = database.prepare(
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

export function saveBacktestExperimentWithMarketData(
  database: BetterSqlite3.Database,
  experiment: BacktestExperiment,
  marketData: MarketDataCacheEntry[],
): void {
  database.transaction(() => {
    for (const entry of marketData) insertMarketData(database, entry);
    insertExperiment(database, experiment);
  })();
}

function listExperimentResults(
  database: BetterSqlite3.Database,
  experimentId: string,
): BacktestResult[] {
  return rows<{ result_json: string }>(
    database,
    `SELECT result_json FROM backtest_results
     WHERE experiment_id = ?
     ORDER BY rowid`,
    [experimentId],
  ).map((row) => normalizeBacktestResult(JSON.parse(row.result_json)));
}

export function listBacktestExperiments(
  database: BetterSqlite3.Database,
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
    has_degraded: number | null;
  }>(
    database,
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
         AS max_drawdown,
       MAX(CASE WHEN json_extract(r.result_json, '$.dataQualityStatus')
            = 'degraded_common_gap' THEN 1 ELSE 0 END)
         AS has_degraded
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
      dataQualityStatus:
        row.has_degraded === 1 ? "degraded_common_gap" : "strict",
    }));
}

export function getBacktestExperiment(
  database: BetterSqlite3.Database,
  id: string,
): BacktestExperiment | null {
  const row = rows<{
    id: string;
    created_at: string;
    request_json: string;
    data_cutoff: string;
    caliber_version: string;
    status: "completed";
  }>(
    database,
    `SELECT id, created_at, request_json, data_cutoff, caliber_version, status
     FROM backtest_experiments WHERE id = ?`,
    [id],
  )[0];
  if (!row) return null;
  const results = listExperimentResults(database, row.id);
  return {
    experimentId: row.id,
    createdAt: row.created_at,
    request: JSON.parse(row.request_json) as BacktestExperiment["request"],
    dataCutoff: row.data_cutoff,
    caliberVersion: row.caliber_version,
    status: row.status,
    results,
    dataQualityStatus: results.some(
      (r) => r.dataQualityStatus === "degraded_common_gap",
    )
      ? "degraded_common_gap"
      : "strict",
  };
}

export function deleteBacktestExperiment(
  database: BetterSqlite3.Database,
  id: string,
): void {
  const workspace = getBacktestWorkspace(database);
  database.transaction(() => {
    database
      .prepare("DELETE FROM backtest_experiments WHERE id = ?")
      .run(id);
    if (workspace?.activeExperimentId === id) {
      database
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

export function getBacktest(
  database: BetterSqlite3.Database,
  id: string,
): BacktestResult | null {
  const row = rows<{ result_json: string }>(
    database,
    "SELECT result_json FROM backtest_results WHERE id = ?",
    [id],
  )[0];
  return row ? normalizeBacktestResult(JSON.parse(row.result_json)) : null;
}

export function getBacktestWorkspace(
  database: BetterSqlite3.Database,
): BacktestWorkspaceState | null {
  const row = rows<{ state_json: string }>(
    database,
    "SELECT state_json FROM backtest_workspace WHERE id = 1",
  )[0];
  return row
    ? (JSON.parse(row.state_json) as BacktestWorkspaceState)
    : null;
}

export function saveBacktestWorkspace(
  database: BetterSqlite3.Database,
  state: BacktestWorkspaceState,
): void {
  database
    .prepare(
      `INSERT INTO backtest_workspace(id, state_json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`,
    )
    .run(JSON.stringify(state));
}
