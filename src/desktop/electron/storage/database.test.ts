import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BacktestExperiment,
  BacktestRequest,
  BacktestResult,
  BacktestWorkspaceState,
} from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import { LocalDatabase } from "./database";

const temporaryDirectories: string[] = [];
const openDatabases: LocalDatabase[] = [];

async function openDatabase(filePath: string): Promise<LocalDatabase> {
  const database = await LocalDatabase.open(filePath);
  openDatabases.push(database);
  return database;
}

function request(rangeYears: 3 | 5 = 3): BacktestRequest {
  return {
    symbols: ["601398"],
    startDate: rangeYears === 3 ? "2023-07-24" : "2021-07-24",
    endDate: "2026-07-24",
    monthlyAmount: 3000,
    buyDay: 1,
    rangeYears,
    dividendTiming: "ex_date",
  };
}

function result(
  experimentId: string,
  id: string,
  endingAsset: number,
): BacktestResult {
  return {
    id,
    experimentId,
    symbol: "601398",
    name: "工商银行",
    requestedStartDate: "2023-07-24",
    requestedEndDate: "2026-07-24",
    actualStartDate: "2023-07-24",
    actualEndDate: "2026-07-24",
    monthlyAmount: 3000,
    buyDay: 1,
    rangeYears: 3,
    dividendTiming: "ex_date",
    strategyKey: `601398|3|3000|1|ex_date|${BACKTEST_CALIBER_VERSION}`,
    metrics: {
      totalContribution: 108000,
      endingAsset,
      totalPnl: endingAsset - 108000,
      xirr: endingAsset / 1_000_000,
      maxDrawdown: -0.2,
      maxDrawdownPeakDate: "2025-01-01",
      maxDrawdownTroughDate: "2025-03-01",
      longestDrawdownMonths: 5,
      longestDrawdownStart: "2025-01-01",
      longestDrawdownEnd: "2025-06-01",
      longestDrawdownRecovered: true,
      totalDividend: 12000,
      endingCash: 0,
    },
    transactions: [],
    equityCurve: [],
    priceSeries: [],
    chartData: { status: "unavailable", reason: "test" },
    warnings: [],
    provenance: [
      {
        source: "test",
        fetchedAt: "2026-07-24T00:00:00Z",
        dataCutoff: "2026-07-24",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    ],
    createdAt: "2026-07-24T00:00:00Z",
  };
}

function experiment(
  id: string,
  createdAt: string,
  endingAsset: number,
): BacktestExperiment {
  return {
    experimentId: id,
    createdAt,
    request: request(),
    dataCutoff: "2026-07-24",
    caliberVersion: BACKTEST_CALIBER_VERSION,
    status: "completed",
    results: [result(id, `${id}-result`, endingAsset)],
  };
}

function workspace(activeExperimentId = "experiment-last"): BacktestWorkspaceState {
  return {
    request: {
      ...request(),
      symbols: ["601398", "601939"],
    },
    chartMetric: "return",
    candlePeriod: "week",
    chartSymbol: "601939",
    activeExperimentId,
    updatedAt: "2026-07-24T00:00:00Z",
  };
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("LocalDatabase", () => {
  it("导出并恢复 schema v5 的不可变回测试验与流水", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-r1-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.addLedger({
      id: "entry-1",
      type: "transfer_in",
      businessDate: "2024-01-01",
      recordedAt: "2024-01-01T00:00:00Z",
      currency: "CNY",
      source: "user",
      amount: 1_000,
    });
    database.saveBacktestExperiment(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
    );

    const backup = database.exportBackup();
    expect(backup.schemaVersion).toBe(5);
    expect(backup.ledgerEntries).toHaveLength(1);
    expect(backup.backtestExperiments).toHaveLength(1);

    const restored = await openDatabase(
      join(directory, "restored.sqlite"),
    );
    restored.restoreBackup(backup);
    expect(restored.listLedger()[0].source).toBe("restore");
    expect(restored.getBacktestExperiment("experiment-1")?.results[0].id).toBe(
      "experiment-1-result",
    );
  });

  it("相同请求重跑仍新增实验，历史结果不覆盖", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-history-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));

    database.saveBacktestExperiment(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
    );
    database.saveBacktestExperiment(
      experiment("experiment-2", "2026-07-25T09:30:00Z", 160000),
    );

    const summaries = database.listBacktestExperiments();
    expect(summaries.map((item) => item.experimentId)).toEqual([
      "experiment-2",
      "experiment-1",
    ]);
    expect(database.getBacktestExperiment("experiment-1")?.results[0].metrics.endingAsset)
      .toBe(150000);
    expect(database.getBacktestExperiment("experiment-2")?.results[0].metrics.endingAsset)
      .toBe(160000);
  });

  it("行情缓存与实验保存使用同一事务，实验失败时缓存回滚", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-atomic-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    const invalidExperiment = experiment(
      "experiment-invalid",
      "2026-07-24T09:30:00Z",
      150000,
    );
    invalidExperiment.results.push(
      result(
        "experiment-invalid",
        "experiment-invalid-result-2",
        160000,
      ),
    );

    expect(() =>
      database.saveBacktestExperimentWithMarketData(invalidExperiment, [
        {
          symbol: "601398",
          prices: [{ date: "2026-07-24", close: 5 }],
          dividends: [],
          source: "test",
          fetchedAt: "2026-07-24T00:00:00Z",
        },
      ]),
    ).toThrow();
    expect(database.latestPrices()).toEqual({
      prices: {},
      dataCutoff: null,
    });
    expect(database.getBacktestExperiment("experiment-invalid")).toBeNull();
  });

  it("删除实验时级联删除结果，并清除工作区活动实验", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-delete-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.saveBacktestExperiment(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
    );
    database.saveBacktestWorkspace(workspace("experiment-1"));

    database.deleteBacktestExperiment("experiment-1");

    expect(database.getBacktestExperiment("experiment-1")).toBeNull();
    expect(database.getBacktest("experiment-1-result")).toBeNull();
    expect(database.getBacktestWorkspace()?.activeExperimentId).toBeUndefined();
  });

  it("持久化全市场代码快照与当前工作区", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-workspace-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "app.sqlite");
    const database = await openDatabase(filePath);
    database.replaceStockUniverse(
      [
        { symbol: "000001", name: "平安银行" },
        { symbol: "601398", name: "工商银行" },
      ],
      "test-source",
      "2026-07-24T00:00:00Z",
    );
    database.saveBacktestWorkspace(workspace());

    database.close();
    openDatabases.splice(openDatabases.indexOf(database), 1);
    const reopened = await openDatabase(filePath);
    expect(reopened.listStockUniverse()).toEqual([
      {
        symbol: "000001",
        name: "平安银行",
        source: "test-source",
        fetchedAt: "2026-07-24T00:00:00Z",
      },
      {
        symbol: "601398",
        name: "工商银行",
        source: "test-source",
        fetchedAt: "2026-07-24T00:00:00Z",
      },
    ]);
    expect(reopened.getBacktestWorkspace()).toEqual(workspace());
  });
});
