import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
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
import { validateBackup } from "../domain/backupValidation";
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
    caliberVersion: BACKTEST_CALIBER_VERSION,
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

  it("导出并恢复当前 Schema 1 的不可变回测试验、投资事实与行情来源", async () => {
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
    database.saveBacktestExperimentWithMarketData(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
      [],
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
    expect(backup.schemaVersion).toBe(1);
    expect(backup.schemaFingerprint).toContain("coverage-split-v1");
    expect(backup.ledgerEntries).toHaveLength(1);
    expect(backup.backtestExperiments).toHaveLength(1);
    expect(backup.liveMarketCoverage).toHaveLength(1);

    const restored = await openDatabase(
      join(directory, "restored.sqlite"),
    );
    const validated = validateBackup(
      backup,
      restored.getSchemaVersion(),
      restored.getSchemaFingerprint(),
    );
    restored.restoreBackup(validated);
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

  /**
   * P1-2 验收：无回撤的合法回测备份必须能成功往返。
   * 覆盖四种场景：单交易日、单调上涨、有回撤且已恢复、有回撤且截至期末未恢复。
   * 每个场景执行 exportBackup → validateBackup → restoreBackup 后结果完全一致。
   */
  it("P1-2 回撤指标条件校验下的备份往返覆盖四种回撤场景", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "stock-income-drawdown-roundtrip-"),
    );
    temporaryDirectories.push(directory);

    /**
     * 构造一个 BacktestResult，允许覆盖 metrics 字段和日期区间。
     * 单交易日场景 actualStartDate === actualEndDate，价格序列仅一行。
     */
    const buildResult = (
      experimentId: string,
      id: string,
      overrides: {
        actualStartDate: string;
        actualEndDate: string;
        metrics: BacktestResult["metrics"];
      },
    ): BacktestResult => ({
      id,
      experimentId,
      symbol: "601398",
      name: "工商银行",
      requestedStartDate: "2024-01-01",
      requestedEndDate: "2024-04-01",
      actualStartDate: overrides.actualStartDate,
      actualEndDate: overrides.actualEndDate,
      monthlyAmount: 3000,
      buyDay: 1,
      rangeYears: 3,
      dividendTiming: "ex_date",
      strategyKey: `601398|3|3000|1|ex_date|${BACKTEST_CALIBER_VERSION}`,
      metrics: overrides.metrics,
      transactions: [],
      equityCurve: [],
      priceSeries: [
        {
          date: overrides.actualStartDate,
          close: 5,
        },
        ...(overrides.actualStartDate !== overrides.actualEndDate
          ? [{ date: overrides.actualEndDate, close: 5.1 }]
          : []),
      ],
      chartData: { status: "unavailable", reason: "test" },
      warnings: [],
      provenance: [
        {
          source: "test",
          fetchedAt: "2024-04-01T00:00:00Z",
          dataCutoff: overrides.actualEndDate,
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      ],
      createdAt: "2024-04-01T00:00:00Z",
    });

    /** 无回撤场景的统一 metrics */
    const noDrawdownMetrics: BacktestResult["metrics"] = {
      totalContribution: 3000,
      endingAsset: 3100,
      totalPnl: 100,
      xirr: 0.05,
      maxDrawdown: 0,
      maxDrawdownPeakDate: null,
      maxDrawdownTroughDate: null,
      longestDrawdownMonths: 0,
      longestDrawdownStart: null,
      longestDrawdownEnd: null,
      longestDrawdownRecovered: true,
      totalDividend: 0,
      endingCash: 0,
    };

    /** 有回撤且已恢复的 metrics */
    const recoveredDrawdownMetrics: BacktestResult["metrics"] = {
      totalContribution: 9000,
      endingAsset: 9500,
      totalPnl: 500,
      xirr: 0.08,
      maxDrawdown: -0.15,
      maxDrawdownPeakDate: "2024-01-15",
      maxDrawdownTroughDate: "2024-02-15",
      longestDrawdownMonths: 2,
      longestDrawdownStart: "2024-01-15",
      longestDrawdownEnd: "2024-03-15",
      longestDrawdownRecovered: true,
      totalDividend: 0,
      endingCash: 0,
    };

    /** 有回撤且截至期末未恢复的 metrics */
    const unrecoveredDrawdownMetrics: BacktestResult["metrics"] = {
      totalContribution: 9000,
      endingAsset: 8500,
      totalPnl: -500,
      xirr: -0.06,
      maxDrawdown: -0.2,
      maxDrawdownPeakDate: "2024-01-15",
      maxDrawdownTroughDate: "2024-03-15",
      longestDrawdownMonths: 3,
      longestDrawdownStart: "2024-01-15",
      longestDrawdownEnd: "2024-04-01",
      longestDrawdownRecovered: false,
      totalDividend: 0,
      endingCash: 0,
    };

    const scenarios: Array<{
      label: string;
      experimentId: string;
      resultId: string;
      actualStartDate: string;
      actualEndDate: string;
      metrics: BacktestResult["metrics"];
    }> = [
      {
        label: "单交易日回测无回撤",
        experimentId: "exp-single-day",
        resultId: "exp-single-day-result",
        actualStartDate: "2024-01-15",
        actualEndDate: "2024-01-15",
        metrics: noDrawdownMetrics,
      },
      {
        label: "单调上涨回测无回撤",
        experimentId: "exp-monotonic",
        resultId: "exp-monotonic-result",
        actualStartDate: "2024-01-01",
        actualEndDate: "2024-03-01",
        metrics: noDrawdownMetrics,
      },
      {
        label: "有回撤且已恢复",
        experimentId: "exp-recovered",
        resultId: "exp-recovered-result",
        actualStartDate: "2024-01-01",
        actualEndDate: "2024-03-15",
        metrics: recoveredDrawdownMetrics,
      },
      {
        label: "有回撤且截至期末未恢复",
        experimentId: "exp-unrecovered",
        resultId: "exp-unrecovered-result",
        actualStartDate: "2024-01-01",
        actualEndDate: "2024-04-01",
        metrics: unrecoveredDrawdownMetrics,
      },
    ];

    const sourceDatabase = await openDatabase(
      join(directory, "source.sqlite"),
    );
    const experiments: BacktestExperiment[] = scenarios.map((scenario) => ({
      experimentId: scenario.experimentId,
      createdAt: "2024-04-01T00:00:00Z",
      request: {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-04-01",
        monthlyAmount: 3000,
        buyDay: 1,
        rangeYears: 3,
        dividendTiming: "ex_date",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
      dataCutoff: scenario.actualEndDate,
      caliberVersion: BACKTEST_CALIBER_VERSION,
      status: "completed",
      results: [
        buildResult(
          scenario.experimentId,
          scenario.resultId,
          {
            actualStartDate: scenario.actualStartDate,
            actualEndDate: scenario.actualEndDate,
            metrics: scenario.metrics,
          },
        ),
      ],
    }));

    for (const experiment of experiments) {
      sourceDatabase.saveBacktestExperimentWithMarketData(experiment, []);
    }

    const backup = sourceDatabase.exportBackup();
    expect(backup.backtestExperiments).toHaveLength(scenarios.length);

    // 校验后恢复到全新数据库
    const restored = await openDatabase(join(directory, "restored.sqlite"));
    const validated = validateBackup(
      backup,
      restored.getSchemaVersion(),
      restored.getSchemaFingerprint(),
    );
    restored.restoreBackup(validated);

    // 逐场景断言：metrics 字段完全一致
    for (const scenario of scenarios) {
      const restoredExperiment = restored.getBacktestExperiment(
        scenario.experimentId,
      );
      expect(restoredExperiment).toBeDefined();
      const restoredResult = restoredExperiment?.results[0];
      expect(restoredResult).toBeDefined();
      expect(restoredResult?.id).toBe(scenario.resultId);
      expect(restoredResult?.metrics).toEqual(scenario.metrics);
    }

    // 反向校验：把单交易日场景的 maxDrawdown 改为 0 但保留峰谷日期，必须被校验拒绝。
    const tamperedNoDrawdown = structuredClone(backup);
    const singleDayExperiment = tamperedNoDrawdown.backtestExperiments.find(
      (item) => item.experimentId === "exp-single-day",
    );
    expect(singleDayExperiment).toBeDefined();
    singleDayExperiment!.results[0].metrics.maxDrawdownPeakDate = "2024-01-15";
    expect(() =>
      validateBackup(
        tamperedNoDrawdown,
        restored.getSchemaVersion(),
        restored.getSchemaFingerprint(),
      ),
    ).toThrow("备份回测无回撤但保留了峰谷日期");

    // 反向校验：把已恢复回撤场景的峰谷日期置为 null，必须被校验拒绝。
    const tamperedWithDrawdown = structuredClone(backup);
    const recoveredExperiment = tamperedWithDrawdown.backtestExperiments.find(
      (item) => item.experimentId === "exp-recovered",
    );
    expect(recoveredExperiment).toBeDefined();
    recoveredExperiment!.results[0].metrics.maxDrawdownPeakDate = null;
    expect(() =>
      validateBackup(
        tamperedWithDrawdown,
        restored.getSchemaVersion(),
        restored.getSchemaFingerprint(),
      ),
    ).toThrow("备份回测存在回撤但缺少峰谷日期");

    // 反向校验：把未恢复场景的 longestDrawdownStart 置为 null，
    // 而 longestDrawdownEnd 保留，必须被校验拒绝（必须同时为空或同时非空）。
    const tamperedMismatched = structuredClone(backup);
    const unrecoveredExperiment = tamperedMismatched.backtestExperiments.find(
      (item) => item.experimentId === "exp-unrecovered",
    );
    expect(unrecoveredExperiment).toBeDefined();
    unrecoveredExperiment!.results[0].metrics.longestDrawdownStart = null;
    expect(() =>
      validateBackup(
        tamperedMismatched,
        restored.getSchemaVersion(),
        restored.getSchemaFingerprint(),
      ),
    ).toThrow("备份回测最长回撤起止日期必须同时为空或同时非空");
  });

  /**
   * P2-3 验收：备份校验必须验证核心财务恒等式，拒绝手工修改但结构合法的备份。
   */
  it("P2-3 备份校验拒绝违反财务恒等式的手工修改", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "stock-income-finance-invariants-"),
    );
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.saveBacktestExperimentWithMarketData(
      experiment("experiment-finance", "2026-07-24T09:30:00Z", 150000),
      [],
    );

    const restored = await openDatabase(join(directory, "restored.sqlite"));
    const version = restored.getSchemaVersion();
    const fingerprint = restored.getSchemaFingerprint();
    const valid = database.exportBackup();

    // 1. totalPnl ≠ endingAsset - totalContribution
    const tamperedPnl = structuredClone(valid);
    tamperedPnl.backtestExperiments[0].results[0].metrics.totalPnl = 999999;
    expect(() =>
      validateBackup(tamperedPnl, version, fingerprint),
    ).toThrow("备份回测财务恒等式不成立");

    // 2. actualEndDate > experiment.dataCutoff（P2-3 dataCutoff 一致性校验）
    const tamperedCutoff = structuredClone(valid);
    const exp = tamperedCutoff.backtestExperiments[0];
    exp.dataCutoff = "2020-01-01";
    expect(() =>
      validateBackup(tamperedCutoff, version, fingerprint),
    ).toThrow("备份回测 actualEndDate(2026-07-24) 晚于试验 dataCutoff(2020-01-01)");

    // 3. actualEndDate ≠ priceSeries 最后日期（需先添加价格序列数据）
    const tamperedPriceSeries = structuredClone(valid);
    const resultWithPrices = tamperedPriceSeries.backtestExperiments[0].results[0];
    resultWithPrices.priceSeries = [
      { date: "2023-07-24", close: 5 },
      { date: "2026-07-23", close: 6 },
    ];
    // actualEndDate 保持 "2026-07-24"，但 priceSeries 最后日期为 "2026-07-23"
    expect(() =>
      validateBackup(tamperedPriceSeries, version, fingerprint),
    ).toThrow("备份回测 actualEndDate(2026-07-24) 与价格序列截止日(2026-07-23)不一致");
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
    const validBackup = validateBackup(
      database.exportBackup(),
      restored.getSchemaVersion(),
      restored.getSchemaFingerprint(),
    );
    restored.restoreBackup(validBackup);
    expect(restored.listLiveMarketCoverage(["601398"])[0]).toMatchObject({
      requestedFrom: "2026-02-15",
      requestedThrough: "2026-02-23",
      emptyEvidence: "exchange_calendar",
      resultStatus: "empty",
    });

    const invalidEmptyBackup = structuredClone(validBackup);
    invalidEmptyBackup.liveMarketCoverage[0].empty_evidence = null;
    expect(() =>
      validateBackup(
        invalidEmptyBackup,
        database.getSchemaVersion(),
        database.getSchemaFingerprint(),
      ),
    ).toThrow("备份包含非法行情覆盖记录");

    invalidEmptyBackup.liveMarketCoverage[0].empty_evidence =
      "exchange_calendar";
    invalidEmptyBackup.liveMarketCoverage[0].data_cutoff = "2026-02-23";
    expect(() =>
      validateBackup(
        invalidEmptyBackup,
        database.getSchemaVersion(),
        database.getSchemaFingerprint(),
      ),
    ).toThrow("备份包含非法行情覆盖记录");
  });

  it("拒绝缺失当前设置、资产类型、目录来源或工作区字段的旧备份", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-backup-contract-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.addLedger({
      id: "entry-current",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T00:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    database.replaceStockUniverseType(
      [{ symbol: "601398", name: "工商银行", securityType: "stock" }],
      "stock",
      {
        source: "交易所官方目录",
        primarySource: "exchange_official",
        fallbackUsed: false,
        fetchedAt: "2026-07-30T00:00:00Z",
      },
    );
    const target = await openDatabase(join(directory, "target.sqlite"));
    const valid = database.exportBackup();
    const version = target.getSchemaVersion();
    const fingerprint = target.getSchemaFingerprint();

    const missingSettings = structuredClone(valid) as Partial<typeof valid>;
    delete missingSettings.settings;
    expect(() => validateBackup(missingSettings, version, fingerprint)).toThrow(
      "备份结构或 schema 版本不兼容",
    );

    const oldFingerprint = structuredClone(valid);
    oldFingerprint.schemaFingerprint =
      "stock-income-r1-schema-1-2026-07-30";
    expect(() => validateBackup(oldFingerprint, version, fingerprint)).toThrow(
      "备份结构或 schema 版本不兼容",
    );

    const missingWorkspace = structuredClone(valid) as Partial<typeof valid>;
    delete missingWorkspace.backtestWorkspace;
    expect(() => validateBackup(missingWorkspace, version, fingerprint)).toThrow(
      "备份结构或 schema 版本不兼容",
    );

    const missingSecurityType = structuredClone(valid);
    delete (
      missingSecurityType.ledgerEntries[0] as Partial<
        (typeof missingSecurityType.ledgerEntries)[number]
      >
    ).securityType;
    expect(() => validateBackup(missingSecurityType, version, fingerprint)).toThrow(
      "不属于当前 R1 schema 的投资事实",
    );

    const missingDirectoryProvenance = structuredClone(valid);
    delete (
      missingDirectoryProvenance.stockUniverse[0] as Partial<
        (typeof missingDirectoryProvenance.stockUniverse)[number]
      >
    ).primarySource;
    expect(() =>
      validateBackup(missingDirectoryProvenance, version, fingerprint),
    ).toThrow("不属于当前 R1 schema 的证券目录");
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
    const version = restored.getSchemaVersion();
    const fingerprint = restored.getSchemaFingerprint();
    const missingCutoff = structuredClone(database.exportBackup());
    missingCutoff.liveMarketCoverage[0].data_cutoff = null;
    expect(() => validateBackup(missingCutoff, version, fingerprint)).toThrow(
      "备份包含非法行情覆盖记录",
    );

    const unexpectedEvidence = structuredClone(database.exportBackup());
    unexpectedEvidence.liveMarketCoverage[0].empty_evidence =
      "exchange_calendar";
    expect(() => validateBackup(unexpectedEvidence, version, fingerprint)).toThrow(
      "备份包含非法行情覆盖记录",
    );
  });

  it("拒绝打开非 Schema 1 数据库且不修改既有数据", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-incompatible-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "legacy.sqlite");
    const legacy = new BetterSqlite3(filePath);
    legacy.exec(`
      CREATE TABLE sentinel (value TEXT NOT NULL);
      INSERT INTO sentinel(value) VALUES ('preserve-me');
    `);
    legacy.pragma("user_version = 10");
    legacy.close();
    const before = readFileSync(filePath);

    await expect(openDatabase(filePath)).rejects.toThrow(
      "仅支持 Schema 1",
    );
    expect(readFileSync(filePath)).toEqual(before);
    expect(existsSync(`${filePath}-wal`)).toBe(false);
    const untouched = new BetterSqlite3(filePath, { readonly: true });
    expect(
      untouched.prepare("SELECT value FROM sentinel").pluck().get(),
    ).toBe("preserve-me");
    expect(untouched.pragma("user_version", { simple: true })).toBe(10);
    untouched.close();
  });

  it("拒绝指纹不匹配的 Schema 1 数据库且不修改既有文件", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-fingerprint-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "app.sqlite");
    const initialized = await openDatabase(filePath);
    initialized.close();
    openDatabases.splice(openDatabases.indexOf(initialized), 1);
    const tampered = new BetterSqlite3(filePath);
    tampered
      .prepare("UPDATE schema_metadata SET fingerprint = ? WHERE id = 1")
      .run("legacy-schema-with-same-user-version");
    tampered.close();
    const before = readFileSync(filePath);

    await expect(openDatabase(filePath)).rejects.toThrow(
      "Schema 1 指纹不匹配",
    );
    expect(readFileSync(filePath)).toEqual(before);
    const untouched = new BetterSqlite3(filePath, { readonly: true });
    expect(
      untouched
        .prepare("SELECT fingerprint FROM schema_metadata WHERE id = 1")
        .pluck()
        .get(),
    ).toBe("legacy-schema-with-same-user-version");
    untouched.close();
  });

  it("拒绝实际 DDL 与指纹不一致的同版本数据库且不自动修复", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-shape-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "app.sqlite");
    const initialized = await openDatabase(filePath);
    initialized.close();
    openDatabases.splice(openDatabases.indexOf(initialized), 1);
    const damaged = new BetterSqlite3(filePath);
    damaged.exec("DROP INDEX idx_backtest_results_strategy");
    damaged.close();

    await expect(openDatabase(filePath)).rejects.toThrow(
      "Schema 1 指纹不匹配",
    );
    const untouched = new BetterSqlite3(filePath, { readonly: true });
    expect(
      untouched
        .prepare(
          "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .pluck()
        .get("idx_backtest_results_strategy"),
    ).toBe(0);
    untouched.close();
  });

  it("相同请求重跑仍新增实验，历史结果不覆盖", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-history-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));

    database.saveBacktestExperimentWithMarketData(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
      [],
    );
    database.saveBacktestExperimentWithMarketData(
      experiment("experiment-2", "2026-07-25T09:30:00Z", 160000),
      [],
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
    expect(database.listLiveMarketPrices()).toHaveLength(0);
    expect(database.getBacktestExperiment("experiment-invalid")).toBeNull();
  });

  it("删除实验时级联删除结果，并清除工作区活动实验", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-delete-"));
    temporaryDirectories.push(directory);
    const database = await openDatabase(join(directory, "app.sqlite"));
    database.saveBacktestExperimentWithMarketData(
      experiment("experiment-1", "2026-07-24T09:30:00Z", 150000),
      [],
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
    const fetchedAt = "2026-07-24T00:00:00Z";
    database.replaceStockUniverseType(
      [{ symbol: "000001", name: "平安银行", securityType: "stock" }],
      "stock",
      {
        source: "上交所、深交所、北交所",
        primarySource: "exchange_official",
        fallbackUsed: false,
        fetchedAt,
      },
    );
    database.replaceStockUniverseType(
      [{ symbol: "510300", name: "沪深300ETF", securityType: "etf" }],
      "etf",
      {
        source: "新浪财经",
        primarySource: "eastmoney",
        fallbackUsed: true,
        fallbackReason: "东方财富 HTTP 503",
        fetchedAt,
      },
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
        source: "上交所、深交所、北交所",
        primarySource: "exchange_official",
        fallbackUsed: false,
        fetchedAt,
      },
      {
        symbol: "510300",
        name: "沪深300ETF",
        securityType: "etf",
        source: "新浪财经",
        primarySource: "eastmoney",
        fallbackUsed: true,
        fallbackReason: "东方财富 HTTP 503",
        fetchedAt,
      },
    ]);
    expect(reopened.getBacktestWorkspace()).toEqual(workspace());
  });

  it("恢复前拒绝领域非法的账本、回测、行情、目录和工作区且不触碰现有数据", async () => {
    // 校验逻辑由 domain/backupValidation.ts 的 validateBackup 负责；
    // storage 层的 restoreBackup 只接受已校验的 BackupPayload。
    // 本测试验证：校验失败时（main 进程不会调用 restoreBackup）现有数据不被触碰。
    const directory = mkdtempSync(join(tmpdir(), "stock-income-deep-backup-"));
    temporaryDirectories.push(directory);
    const source = await openDatabase(join(directory, "source.sqlite"));
    source.addLedger({
      id: "source-buy",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    source.saveBacktestExperimentWithMarketData(
      experiment("experiment-last", "2026-07-24T09:30:00Z", 150000),
      [
        {
          symbol: "601398",
          prices: [{ date: "2026-07-24", close: 7.2 }],
          dividends: [
            {
              date: "2026-07-10",
              recordDate: "2026-07-09",
              paymentDate: "2026-07-10",
              perShare: 0.1,
              transferRatio: 0,
              bonusRatio: 0,
              status: "implemented",
            },
          ],
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
      ],
    );
    source.saveLiveMarketPriceSnapshots([
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
    source.replaceStockUniverseType(
      [{ symbol: "601398", name: "工商银行", securityType: "stock" }],
      "stock",
      {
        source: "交易所官方目录",
        primarySource: "exchange_official",
        fallbackUsed: false,
        fetchedAt: "2026-07-24T00:00:00Z",
      },
    );
    source.saveBacktestWorkspace(workspace("experiment-last"));
    const valid = source.exportBackup();

    const target = await openDatabase(join(directory, "target.sqlite"));
    target.addLedger({
      id: "preserve-me",
      type: "dividend",
      businessDate: "2026-07-02",
      recordedAt: "2026-07-02T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      securityType: "stock",
      amount: 1,
    });

    const invalidPayloads: Array<{ payload: typeof valid; message: string }> = [];
    const invalidLedger = structuredClone(valid);
    invalidLedger.ledgerEntries[0].quantity = 1.5;
    invalidPayloads.push({
      payload: invalidLedger,
      message: "价格、数量或费用非法",
    });
    const tradeWithAmount = structuredClone(valid);
    tradeWithAmount.ledgerEntries[0].amount = 1;
    invalidPayloads.push({
      payload: tradeWithAmount,
      message: "不允许的专属字段",
    });
    const dividendWithTradeFields = structuredClone(valid);
    dividendWithTradeFields.ledgerEntries[0].type = "dividend";
    dividendWithTradeFields.ledgerEntries[0].amount = 50;
    invalidPayloads.push({
      payload: dividendWithTradeFields,
      message: "分红流水的金额或日期非法",
    });
    const multipleCorrections = structuredClone(valid);
    const original = multipleCorrections.ledgerEntries[0];
    multipleCorrections.ledgerEntries.push(
      {
        id: "reverse-source-buy",
        type: "adjustment",
        businessDate: "2026-07-02",
        recordedAt: "2026-07-02T01:00:00Z",
        correctedAt: "2026-07-02T01:00:00Z",
        currency: "CNY",
        source: "user",
        reversesEntryId: original.id,
      },
      {
        ...original,
        id: "corrected-source-buy-a",
        recordedAt: "2026-07-02T01:00:01Z",
        correctedAt: "2026-07-02T01:00:00Z",
        correctsEntryId: original.id,
        price: 5.1,
      },
      {
        ...original,
        id: "corrected-source-buy-b",
        recordedAt: "2026-07-02T01:00:02Z",
        correctedAt: "2026-07-02T01:00:00Z",
        correctsEntryId: original.id,
        price: 5.2,
      },
    );
    invalidPayloads.push({
      payload: multipleCorrections,
      message: "同一原流水包含多个修正版本",
    });
    const correctionOfAdjustment = structuredClone(valid);
    const correctionTarget = correctionOfAdjustment.ledgerEntries[0];
    correctionOfAdjustment.ledgerEntries.push(
      {
        id: "reverse-before-illegal-correction",
        type: "adjustment",
        businessDate: "2026-07-02",
        recordedAt: "2026-07-02T01:00:00Z",
        correctedAt: "2026-07-02T01:00:00Z",
        currency: "CNY",
        source: "user",
        reversesEntryId: correctionTarget.id,
      },
      {
        ...correctionTarget,
        id: "illegal-adjustment-correction",
        recordedAt: "2026-07-02T01:00:01Z",
        correctedAt: "2026-07-02T01:00:00Z",
        correctsEntryId: "reverse-before-illegal-correction",
      },
    );
    invalidPayloads.push({
      payload: correctionOfAdjustment,
      message: "修正流水引用了不存在或非法的原流水",
    });
    const changedCorrectionLink = structuredClone(valid);
    const linkedTarget = changedCorrectionLink.ledgerEntries[0];
    changedCorrectionLink.ledgerEntries.push(
      {
        id: "reverse-before-link-change",
        type: "adjustment",
        businessDate: "2026-07-02",
        recordedAt: "2026-07-02T01:00:00Z",
        correctedAt: "2026-07-02T01:00:00Z",
        currency: "CNY",
        source: "user",
        reversesEntryId: linkedTarget.id,
      },
      {
        ...linkedTarget,
        id: "illegal-link-change",
        recordedAt: "2026-07-02T01:00:01Z",
        correctedAt: "2026-07-02T01:00:00Z",
        correctsEntryId: linkedTarget.id,
        linkedGroupId: "unexpected-group",
      },
    );
    invalidPayloads.push({
      payload: changedCorrectionLink,
      message: "关联关系与原事实不一致",
    });
    const invalidBacktest = structuredClone(valid);
    invalidBacktest.backtestExperiments[0].results[0].actualEndDate =
      "2026-07-25";
    invalidPayloads.push({
      payload: invalidBacktest,
      message: "区间或请求参数非法",
    });
    const missingRequestedEnd = structuredClone(valid);
    delete (
      missingRequestedEnd.backtestExperiments[0].results[0] as Partial<
        BacktestResult
      >
    ).requestedEndDate;
    invalidPayloads.push({
      payload: missingRequestedEnd,
      message: "区间或请求参数非法",
    });
    const invalidMarket = structuredClone(valid);
    invalidMarket.liveMarketPrices[0].close = -1;
    invalidPayloads.push({
      payload: invalidMarket,
      message: "非法实盘行情快照",
    });
    const invalidDirectory = structuredClone(valid);
    invalidDirectory.stockUniverse.push({
      ...invalidDirectory.stockUniverse[0],
    });
    invalidPayloads.push({
      payload: invalidDirectory,
      message: "重复的证券目录代码",
    });
    const invalidWorkspace = structuredClone(valid);
    invalidWorkspace.backtestWorkspace!.activeExperimentId = "missing";
    invalidPayloads.push({
      payload: invalidWorkspace,
      message: "工作区字段或实验引用非法",
    });
    const invalidAction = structuredClone(valid);
    invalidAction.corporateActions[0].payload_json = "{broken";
    invalidPayloads.push({
      payload: invalidAction,
      message: "公司行动 JSON 无法解析",
    });

    const version = target.getSchemaVersion();
    const fingerprint = target.getSchemaFingerprint();
    for (const item of invalidPayloads) {
      expect(() =>
        validateBackup(item.payload, version, fingerprint),
      ).toThrow(item.message);
      // 校验失败时 main 进程不会调用 restoreBackup，target 现有数据不被触碰。
      expect(target.listLedger()).toEqual([
        expect.objectContaining({ id: "preserve-me", amount: 1 }),
      ]);
      expect(target.listBacktestExperiments()).toEqual([]);
    }
  });
});
