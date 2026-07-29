import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import BetterSqlite3 from "better-sqlite3";
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
  it("组合投资事实任一写入失败时整体回滚", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-ledger-atomic-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    const duplicateId = "linked-entry";
    expect(() =>
      database.addLedgerEntries([
        {
          id: duplicateId,
          type: "dividend",
          businessDate: "2026-07-10",
          recordedAt: "2026-07-10T01:00:00Z",
          currency: "CNY",
          source: "user",
          symbol: "601398",
          amount: 300,
          linkedGroupId: "group-1",
        },
        {
          id: duplicateId,
          type: "buy",
          businessDate: "2026-07-11",
          recordedAt: "2026-07-11T01:00:00Z",
          currency: "CNY",
          source: "user",
          symbol: "601398",
          price: 6,
          quantity: 60,
          linkedGroupId: "group-1",
        },
      ]),
    ).toThrow();
    expect(database.listLedger()).toEqual([]);
  });

  it("导出并恢复 schema v10 的不可变回测试验、投资事实与行情来源", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-r1-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.addLedger({
      id: "entry-1",
      type: "buy",
      businessDate: "2024-01-01",
      recordedAt: "2024-01-01T00:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 200,
      fee: 5,
    });
    database.saveBacktestExperiment(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
    );
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [{ date: "2026-07-24", close: 7.2 }],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-24T08:00:00Z",
          dataCutoff: "2026-07-24",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      },
    ]);

    const backup = database.exportBackup();
    expect(backup.schemaVersion).toBe(10);
    expect(backup.ledgerEntries).toHaveLength(1);
    expect(backup.backtestExperiments).toHaveLength(1);
    expect(backup.liveMarketCoverage).toHaveLength(1);

    const restored = await openDatabase(
      join(directory, "restored.sqlite"),
    );
    restored.restoreBackup(backup);
    expect(restored.listLedger()[0].source).toBe("restore");
    expect(restored.getBacktestExperiment("experiment-1")?.results[0].id).toBe(
      "experiment-1-result",
    );
    expect(restored.listLiveMarketPrices(["601398"])[0]).toMatchObject({
      date: "2026-07-24",
      close: 7.2,
      source: "tencent",
      primarySource: "tencent",
      fallbackUsed: false,
      dataCutoff: "2026-07-24",
      adjustment: "none",
    });
    expect(restored.listLiveMarketCoverage(["601398"])[0]).toMatchObject({
      requestedFrom: "2026-07-24",
      requestedThrough: "2026-07-24",
      resultStatus: "data",
    });
  });

  it("合法空行情区间独立持久化并随备份恢复", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-coverage-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    expect(() =>
      database.saveLiveMarketPriceSnapshots([
        {
          symbol: "601398",
          prices: [],
          dividends: [],
          provenance: {
            source: "sina",
            primarySource: "tencent",
            fallbackUsed: true,
            fallbackReason: "腾讯 HTTP 503，新浪空响应",
            fetchedAt: "2026-02-24T07:59:00Z",
            dataCutoff: null,
            adjustment: "none",
            caliberVersion: BACKTEST_CALIBER_VERSION,
          },
          requestedFrom: "2026-01-01",
          requestedThrough: "2026-07-28",
        },
      ]),
    ).toThrow("空行情覆盖缺少");
    expect(database.listLiveMarketCoverage(["601398"])).toEqual([]);

    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-02-24T08:00:00Z",
          dataCutoff: null,
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
          emptyEvidence: "exchange_calendar",
        },
        requestedFrom: "2026-02-15",
        requestedThrough: "2026-02-23",
      },
    ]);
    expect(database.listLiveMarketPrices(["601398"])).toEqual([]);
    expect(database.listLiveMarketCoverage(["601398"])).toEqual([
      expect.objectContaining({
        symbol: "601398",
        requestedFrom: "2026-02-15",
        requestedThrough: "2026-02-23",
        dataCutoff: null,
        emptyEvidence: "exchange_calendar",
        resultStatus: "empty",
      }),
    ]);

    const restored = await openDatabase(join(directory, "restored.sqlite"));
    const validBackup = database.exportBackup();
    restored.restoreBackup(validBackup);
    expect(restored.listLiveMarketCoverage(["601398"])[0]).toMatchObject({
      requestedFrom: "2026-02-15",
      requestedThrough: "2026-02-23",
      emptyEvidence: "exchange_calendar",
      resultStatus: "empty",
    });

    const invalidEmptyBackup = structuredClone(validBackup);
    invalidEmptyBackup.liveMarketCoverage[0].empty_evidence = null;
    expect(() => restored.restoreBackup(invalidEmptyBackup)).toThrow(
      "备份包含非法行情覆盖记录",
    );

    invalidEmptyBackup.liveMarketCoverage[0].empty_evidence =
      "exchange_calendar";
    invalidEmptyBackup.liveMarketCoverage[0].data_cutoff = "2026-02-23";
    expect(() => restored.restoreBackup(invalidEmptyBackup)).toThrow(
      "备份包含非法行情覆盖记录",
    );
  });

  it("恢复备份时要求非空行情覆盖具有实际截止日且不带空区间证据", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-coverage-data-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [{ date: "2026-07-28", close: 7.2 }],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-28T08:00:00Z",
          dataCutoff: "2026-07-28",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      },
    ]);
    const restored = await openDatabase(join(directory, "restored.sqlite"));
    const missingCutoff = structuredClone(database.exportBackup());
    missingCutoff.liveMarketCoverage[0].data_cutoff = null;
    expect(() => restored.restoreBackup(missingCutoff)).toThrow(
      "备份包含非法行情覆盖记录",
    );

    const unexpectedEvidence = structuredClone(database.exportBackup());
    unexpectedEvidence.liveMarketCoverage[0].empty_evidence =
      "exchange_calendar";
    expect(() => restored.restoreBackup(unexpectedEvidence)).toThrow(
      "备份包含非法行情覆盖记录",
    );
  });

  it("schema 7 升级显式保留买入卖出分红和审计链，丢弃退出 R1 的账户事实", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-migrate-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "legacy.sqlite");
    const legacy = new BetterSqlite3(filePath);
    legacy.exec(`
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    const insert = legacy.prepare(
      "INSERT INTO ledger_entries(id, business_date, recorded_at, type, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    const legacyEntries = [
      {
        id: "buy-old",
        type: "buy",
        businessDate: "2025-01-02",
        recordedAt: "2025-01-02T01:00:00Z",
        currency: "CNY",
        source: "user",
        symbol: "601398",
        price: 5,
        quantity: 100,
      },
      {
        id: "dividend-old",
        type: "dividend",
        businessDate: "2025-06-01",
        paymentDate: "2025-06-05",
        recordedAt: "2025-06-05T01:00:00Z",
        currency: "CNY",
        source: "user",
        symbol: "601398",
        amount: 30,
      },
      {
        id: "adjust-old",
        type: "adjustment",
        businessDate: "2025-01-02",
        recordedAt: "2025-07-01T01:00:00Z",
        currency: "CNY",
        source: "system",
        reversesEntryId: "buy-old",
      },
      {
        id: "transfer-old",
        type: "transfer_in",
        businessDate: "2025-01-01",
        recordedAt: "2025-01-01T01:00:00Z",
        currency: "CNY",
        source: "user",
        amount: 10_000,
      },
      {
        id: "repo-old",
        type: "reverse_repo",
        businessDate: "2025-01-03",
        recordedAt: "2025-01-03T01:00:00Z",
        currency: "CNY",
        source: "user",
        amount: 5_000,
      },
    ];
    for (const entry of legacyEntries) {
      insert.run(
        entry.id,
        entry.businessDate,
        entry.recordedAt,
        entry.type,
        JSON.stringify(entry),
      );
    }
    legacy.pragma("user_version = 7");
    legacy.close();

    const migrated = await openDatabase(filePath);
    const rows = migrated.listLedger();
    expect(rows.map((row) => row.id).sort()).toEqual([
      "adjust-old",
      "buy-old",
      "dividend-old",
    ]);
    expect(rows.find((row) => row.id === "dividend-old")).toMatchObject({
      businessDate: "2025-06-05",
      amount: 30,
    });
    expect(
      "paymentDate" in rows.find((row) => row.id === "dividend-old")!,
    ).toBe(false);
    expect(migrated.exportBackup().schemaVersion).toBe(10);
  });

  it("schema 9 的无证据空覆盖升级后恢复为待请求区间", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-coverage-migrate-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "legacy.sqlite");
    const legacy = new BetterSqlite3(filePath);
    legacy.exec(`
      CREATE TABLE live_market_coverage (
        symbol TEXT NOT NULL,
        requested_from TEXT NOT NULL,
        requested_through TEXT NOT NULL,
        source TEXT NOT NULL,
        primary_source TEXT NOT NULL,
        fallback_used INTEGER NOT NULL,
        fallback_reason TEXT,
        fetched_at TEXT NOT NULL,
        data_cutoff TEXT,
        adjustment TEXT NOT NULL,
        result_status TEXT NOT NULL,
        PRIMARY KEY (symbol, requested_from, requested_through, adjustment)
      );
      INSERT INTO live_market_coverage VALUES (
        '601398', '2026-07-01', '2026-07-28', 'sina', 'tencent', 1,
        '腾讯失败、备用源临时空响应', '2026-07-28T08:00:00Z', NULL,
        'none', 'empty'
      );
      INSERT INTO live_market_coverage VALUES (
        '601939', '2026-07-01', '2026-07-27', 'tencent', 'tencent', 0,
        NULL, '2026-07-27T08:00:00Z', '2026-07-27',
        'none', 'data'
      );
    `);
    legacy.pragma("user_version = 9");
    legacy.close();

    const migrated = await openDatabase(filePath);
    expect(migrated.listLiveMarketCoverage(["601398"])).toEqual([]);
    expect(migrated.listLiveMarketCoverage(["601939"])).toEqual([
      expect.objectContaining({
        resultStatus: "data",
        dataCutoff: "2026-07-27",
      }),
    ]);
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
          provenance: {
            source: "tencent",
            primarySource: "tencent",
            fallbackUsed: false,
            fetchedAt: "2026-07-24T00:00:00Z",
            dataCutoff: "2026-07-24",
            adjustment: "none",
            caliberVersion: BACKTEST_CALIBER_VERSION,
          },
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
        { symbol: "000001", name: "平安银行", securityType: "stock" },
        { symbol: "510300", name: "沪深300ETF", securityType: "etf" },
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
        securityType: "stock",
        source: "test-source",
        fetchedAt: "2026-07-24T00:00:00Z",
      },
      {
        symbol: "510300",
        name: "沪深300ETF",
        securityType: "etf",
        source: "test-source",
        fetchedAt: "2026-07-24T00:00:00Z",
      },
    ]);
    expect(reopened.getBacktestWorkspace()).toEqual(workspace());
  });
});
