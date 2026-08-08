import BetterSqlite3 from "better-sqlite3";
import { RECENT_BACKTEST_EXPERIMENT_LIMIT } from "../../shared/constants";
import type {
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestResult,
  BacktestWorkspaceState,
  MarketDataCacheEntry,
} from "../../shared/contracts";
import {
  aggregateBacktestDataQuality,
  assertBacktestDataQuality,
} from "../domain/backtestDataQuality";
import { rows } from "./dbUtil";
import { insertMarketData } from "./marketRepository";

export function insertExperiment(
  database: BetterSqlite3.Database,
  experiment: BacktestExperiment,
): void {
  assertBacktestDataQuality(experiment.dataQuality, "回测试验数据质量");
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
    assertBacktestDataQuality(
      result.dataQuality,
      `回测结果 ${result.id} 数据质量`,
    );
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
  ).map((row) => JSON.parse(row.result_json) as BacktestResult);
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
    has_cross_provider_gap: number | null;
    has_calendar_partial: number | null;
    has_degraded_level: number | null;
    has_research_level: number | null;
    official_calendar_years_json: string;
    uncovered_calendar_years_json: string;
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
       MAX(CASE WHEN
            json_extract(r.result_json, '$.dataQuality.reasons')
              LIKE '%cross_provider_common_gap%'
            THEN 1 ELSE 0 END)
         AS has_cross_provider_gap,
       MAX(CASE WHEN
           json_extract(r.result_json, '$.dataQuality.reasons')
             LIKE '%calendar_coverage_partial%'
           THEN 1 ELSE 0 END)
         AS has_calendar_partial,
       MAX(CASE WHEN
            json_extract(r.result_json, '$.dataQuality.level') = 'degraded'
           THEN 1 ELSE 0 END)
         AS has_degraded_level,
       MAX(CASE WHEN
            json_extract(r.result_json, '$.dataQuality.level') = 'research'
           THEN 1 ELSE 0 END)
         AS has_research_level,
       COALESCE((
         SELECT json_group_array(year)
         FROM (
           SELECT DISTINCT CAST(calendar_year.value AS INTEGER) AS year
           FROM backtest_results year_result,
                json_each(
                  year_result.result_json,
                  '$.dataQuality.officialCalendarYears'
                ) AS calendar_year
           WHERE year_result.experiment_id = e.id
           ORDER BY year
         )
       ), '[]') AS official_calendar_years_json,
       COALESCE((
         SELECT json_group_array(year)
         FROM (
           SELECT DISTINCT CAST(calendar_year.value AS INTEGER) AS year
           FROM backtest_results year_result,
                json_each(
                  year_result.result_json,
                  '$.dataQuality.uncoveredCalendarYears'
                ) AS calendar_year
           WHERE year_result.experiment_id = e.id
           ORDER BY year
         )
       ), '[]') AS uncovered_calendar_years_json
     FROM backtest_experiments e
     LEFT JOIN backtest_results r ON r.experiment_id = e.id
     GROUP BY e.id
     ORDER BY created_at DESC
     LIMIT ?`,
    [boundedLimit],
  ).map((row) => {
      const hasCommonGap = row.has_cross_provider_gap === 1;
      const hasPartial = row.has_calendar_partial === 1;
      const hasDegraded = row.has_degraded_level === 1;
      const hasResearchLevel = row.has_research_level === 1;
      const level: "strict" | "research" | "degraded" = hasDegraded
        ? "degraded"
        : hasResearchLevel
          ? "research"
          : "strict";
      // reasons 单独合并：仅展示数据中实际出现的降级原因
      const reasons: Array<
        "cross_provider_common_gap" | "calendar_coverage_partial"
      > = [];
      if (hasCommonGap) reasons.push("cross_provider_common_gap");
      if (hasPartial) reasons.push("calendar_coverage_partial");
      return {
        experimentId: row.id,
        createdAt: row.created_at,
        request: JSON.parse(row.request_json) as BacktestExperiment["request"],
        dataCutoff: row.data_cutoff,
        caliberVersion: row.caliber_version,
        status: row.status,
        resultCount: row.result_count,
        bestXirr: row.best_xirr,
        maxDrawdown: row.max_drawdown ?? 0,
        dataQuality: {
          level,
          reasons,
          officialCalendarYears: JSON.parse(
            row.official_calendar_years_json,
          ) as number[],
          uncoveredCalendarYears: JSON.parse(
            row.uncovered_calendar_years_json,
          ) as number[],
        },
      };
    });
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
  const dataQuality = aggregateBacktestDataQuality(
    results.map((result) => result.dataQuality),
  );
  return {
    experimentId: row.id,
    createdAt: row.created_at,
    request: JSON.parse(row.request_json) as BacktestExperiment["request"],
    dataCutoff: row.data_cutoff,
    caliberVersion: row.caliber_version,
    status: row.status,
    results,
    dataQuality,
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
  return row ? (JSON.parse(row.result_json) as BacktestResult) : null;
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
