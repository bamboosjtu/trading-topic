import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockInfo } from "../../shared/contracts";
import {
  BACKTEST_CALIBER_VERSION,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import {
  fetchAdjustedBars,
  fetchCorporateActions,
  fetchUnadjustedPrices,
} from "../data/tencent";
import { LocalDatabase } from "../storage/database";
import { AppService } from "./appService";

vi.mock("../data/tencent", () => ({
  fetchAdjustedBars: vi.fn(),
  fetchCorporateActions: vi.fn(),
  fetchUnadjustedPrices: vi.fn(),
}));

const temporaryDirectories: string[] = [];
const openDatabases: LocalDatabase[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function completeStockUniverse(overrides: StockInfo[]): StockInfo[] {
  const stocks = Array.from({ length: STOCK_UNIVERSE_MIN_SIZE }, (_, index) => ({
    symbol: String(600000 + index),
    name: `沪市股票${index}`,
  }));
  const unique = new Map(stocks.map((stock) => [stock.symbol, stock]));
  for (const stock of overrides) unique.set(stock.symbol, stock);
  return [...unique.values()];
}

function closeTrackedDatabase(database: LocalDatabase): void {
  database.close();
  const index = openDatabases.indexOf(database);
  if (index >= 0) openDatabases.splice(index, 1);
}

describe("AppService 冷启动恢复", () => {
  it("四标的实验和工作区在 SQLite 重开后仍完整可读", async () => {
    const symbols = ["601398", "601288", "601166", "601939"];
    const directory = mkdtempSync(join(tmpdir(), "stock-income-cold-start-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    const database = await LocalDatabase.open(databasePath);
    openDatabases.push(database);
    database.replaceStockUniverse(
      completeStockUniverse([
        { symbol: "601398", name: "工商银行" },
        { symbol: "601288", name: "农业银行" },
        { symbol: "601166", name: "兴业银行" },
        { symbol: "601939", name: "建设银行" },
      ]),
      "cold-start-fixture",
      new Date().toISOString(),
    );

    vi.mocked(fetchUnadjustedPrices).mockImplementation(async (symbol) => {
      const offset = symbols.indexOf(symbol) * 0.1;
      return {
        rows: [
          { date: "2024-01-02", close: 5 + offset },
          { date: "2024-02-01", close: 4.8 + offset },
          { date: "2024-03-01", close: 5.3 + offset },
        ],
        provenance: {
          source: `cold-start-price-${symbol}`,
          fetchedAt: "2026-07-27T00:00:00Z",
          dataCutoff: "2024-03-01",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      };
    });
    vi.mocked(fetchAdjustedBars).mockImplementation(async (symbol) => {
      const offset = symbols.indexOf(symbol) * 0.1;
      return {
        rows: [
          {
            date: "2024-01-02",
            open: 4.9 + offset,
            high: 5.1 + offset,
            low: 4.8 + offset,
            close: 5 + offset,
            volume: 1_000,
            adjustment: "qfq",
          },
          {
            date: "2024-02-01",
            open: 5 + offset,
            high: 5.05 + offset,
            low: 4.7 + offset,
            close: 4.8 + offset,
            volume: 1_200,
            adjustment: "qfq",
          },
          {
            date: "2024-03-01",
            open: 4.85 + offset,
            high: 5.4 + offset,
            low: 4.8 + offset,
            close: 5.3 + offset,
            volume: 1_500,
            adjustment: "qfq",
          },
        ],
        provenance: {
          source: `cold-start-qfq-${symbol}`,
          fetchedAt: "2026-07-27T00:00:00Z",
          dataCutoff: "2024-03-01",
          adjustment: "qfq",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      };
    });
    vi.mocked(fetchCorporateActions).mockImplementation(async (symbol) => ({
      rows: [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 0.1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施分配",
        },
      ],
      provenance: {
        source: `cold-start-action-${symbol}`,
        fetchedAt: "2026-07-27T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));

    const service = new AppService(database);
    const experiment = await service.runBacktest({
      symbols,
      startDate: "2024-01-01",
      endDate: "2024-03-01",
      monthlyAmount: 3_000,
      buyDay: 1,
      rangeYears: 3,
      dividendTiming: "ex_date",
    });
    service.saveBacktestWorkspace({
      request: experiment.request,
      chartMetric: "drawdown",
      candlePeriod: "week",
      chartSymbol: "601166",
      activeExperimentId: experiment.experimentId,
      updatedAt: "2026-07-27T00:01:00Z",
    });

    closeTrackedDatabase(database);
    const reopenedDatabase = await LocalDatabase.open(databasePath);
    openDatabases.push(reopenedDatabase);
    const reopenedService = new AppService(reopenedDatabase);

    const workspace = reopenedService.getBacktestWorkspace();
    expect(workspace).toMatchObject({
      activeExperimentId: experiment.experimentId,
      chartMetric: "drawdown",
      candlePeriod: "week",
      chartSymbol: "601166",
      request: { symbols },
    });

    const restored = reopenedService.getBacktestExperiment(
      workspace!.activeExperimentId!,
    );
    expect(restored.results).toHaveLength(4);
    for (const result of restored.results) {
      expect(result.priceSeries).toHaveLength(3);
      expect(result.chartData).toMatchObject({
        status: "ready",
        data: expect.arrayContaining([
          expect.objectContaining({
            adjustment: "qfq",
            open: expect.any(Number),
            high: expect.any(Number),
            low: expect.any(Number),
            close: expect.any(Number),
            volume: expect.any(Number),
          }),
        ]),
      });
      expect(result.equityCurve.length).toBeGreaterThan(0);
      expect(
        result.equityCurve.every(
          (point) =>
            Number.isFinite(point.returnRate) &&
            Number.isFinite(point.drawdown),
        ),
      ).toBe(true);
      const detail = reopenedService.getBacktestDetail(result.id);
      expect(detail.rows.length).toBeGreaterThan(0);
      expect(detail.rows.some((row) => row.event === "buy")).toBe(true);
      expect(detail.rows.some((row) => row.event === "dividend")).toBe(true);
    }
  }, 15_000);
});
