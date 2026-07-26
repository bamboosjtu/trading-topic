import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BacktestResult,
  BacktestWorkspaceState,
} from "../../shared/contracts";
import { LocalDatabase } from "./database";

const temporaryDirectories: string[] = [];

function backtest(
  id: string,
  rangeYears: 3 | 5,
  startDate: string,
  endingAsset: number,
): BacktestResult {
  return {
    id,
    symbol: "601398",
    name: "工商银行",
    requestedStartDate: startDate,
    requestedEndDate: "2026-07-24",
    actualStartDate: startDate,
    actualEndDate: "2026-07-24",
    monthlyAmount: 3000,
    buyDay: 1,
    rangeYears,
    dividendTiming: "ex_date",
    metrics: {
      totalContribution: 108000,
      endingAsset,
      totalPnl: endingAsset - 108000,
      xirr: 0.12,
      maxDrawdown: -0.2,
      totalDividend: 12000,
      endingCash: 0,
    },
    transactions: [],
    equityCurve: [],
    priceSeries: [],
    warnings: [],
    provenance: [
      {
        source: "test",
        fetchedAt: "2026-07-24T00:00:00Z",
        dataCutoff: "2026-07-24",
        adjustment: "none",
        caliberVersion: "bank-dca-r1-node-v3",
      },
    ],
    createdAt: `${startDate}T00:00:00Z`,
  };
}

function workspace(): BacktestWorkspaceState {
  return {
    request: {
      symbols: ["601398", "601939"],
      startDate: "2023-07-24",
      endDate: "2026-07-24",
      monthlyAmount: 3000,
      buyDay: 1,
      rangeYears: 3,
    },
    chartMetric: "return",
    candlePeriod: "week",
    chartSymbol: "601939",
    lastBatchId: "batch-last",
    updatedAt: "2026-07-24T00:00:00Z",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("LocalDatabase", () => {
  it("把流水写入 SQLite 并导出可恢复的 JSON 业务备份", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-r1-"));
    temporaryDirectories.push(directory);
    const database = await LocalDatabase.open(
      join(directory, "app.sqlite"),
      process.cwd(),
    );
    database.addLedger({
      id: "entry-1",
      type: "transfer_in",
      businessDate: "2024-01-01",
      recordedAt: "2024-01-01T00:00:00Z",
      currency: "CNY",
      source: "user",
      amount: 1_000,
    });

    const backup = database.exportBackup();
    expect(backup.schemaVersion).toBe(2);
    expect(backup.ledgerEntries).toHaveLength(1);
    expect(backup.marketPrices).toEqual([]);

    const restored = await LocalDatabase.open(
      join(directory, "restored.sqlite"),
      process.cwd(),
    );
    restored.restoreBackup(backup);
    expect(restored.listLedger()[0].source).toBe("restore");
    expect(restored.listLedger()[0].amount).toBe(1_000);
  });

  it("按标的和完整参数更新同一记录，区间参数变化时新增记录", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-upsert-"));
    temporaryDirectories.push(directory);
    const database = await LocalDatabase.open(
      join(directory, "app.sqlite"),
      process.cwd(),
    );

    database.saveBacktests([
      backtest("three-old", 3, "2023-07-24", 150000),
    ]);
    database.saveBacktests([
      // 快捷区间同为 3 年：即使滚动起始日变化，也更新原策略记录。
      backtest("three-new", 3, "2023-07-25", 160000),
    ]);
    database.saveBacktests([
      backtest("five-years", 5, "2021-07-24", 220000),
    ]);

    const results = database.listBacktests();
    expect(results).toHaveLength(2);
    expect(results.find((result) => result.rangeYears === 3)?.id).toBe(
      "three-new",
    );
    expect(
      results.find((result) => result.rangeYears === 3)?.metrics.endingAsset,
    ).toBe(160000);
    expect(results.find((result) => result.rangeYears === 5)?.id).toBe(
      "five-years",
    );
  });

  it("持久化全市场代码快照与历史回测工作区状态", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-workspace-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "app.sqlite");
    const database = await LocalDatabase.open(filePath, process.cwd());
    database.replaceStockUniverse(
      [
        { symbol: "000001", name: "平安银行" },
        { symbol: "601398", name: "工商银行" },
      ],
      "test-source",
      "2026-07-24T00:00:00Z",
    );
    database.saveBacktestWorkspace(workspace());

    const reopened = await LocalDatabase.open(filePath, process.cwd());
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
