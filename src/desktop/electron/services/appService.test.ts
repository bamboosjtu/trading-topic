import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StockInfo } from "../../shared/contracts";
import { STOCK_UNIVERSE_MIN_SIZE } from "../../shared/constants";
import { fetchAStockUniverse } from "../data/stockUniverse";
import {
  fetchAdjustedBars,
  fetchCorporateActions,
  fetchUnadjustedPrices,
} from "../data/tencent";
import { LocalDatabase } from "../storage/database";
import { AppService } from "./appService";

vi.mock("../data/stockUniverse", () => ({
  fetchAStockUniverse: vi.fn(),
}));
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

async function serviceWithDatabase(): Promise<{
  service: AppService;
  database: LocalDatabase;
}> {
  const directory = mkdtempSync(join(tmpdir(), "stock-income-service-"));
  temporaryDirectories.push(directory);
  const database = await LocalDatabase.open(join(directory, "app.sqlite"));
  openDatabases.push(database);
  return { service: new AppService(database), database };
}

function completeStockUniverse(overrides: StockInfo[] = []): StockInfo[] {
  const stocks = Array.from({ length: STOCK_UNIVERSE_MIN_SIZE }, (_, index) => ({
    symbol: String(600000 + index),
    name: `沪市股票${index}`,
  }));
  const unique = new Map(stocks.map((stock) => [stock.symbol, stock]));
  for (const stock of overrides) unique.set(stock.symbol, stock);
  return [...unique.values()];
}

describe("AppService 股票目录", () => {
  it("七天内直接使用完整 SQLite 快照，不重复联网", async () => {
    const { service, database } = await serviceWithDatabase();
    const snapshot = completeStockUniverse([
      { symbol: "000001", name: "平安银行" },
    ]);
    database.replaceStockUniverse(
      snapshot,
      "cached",
      new Date().toISOString(),
    );

    const result = await service.listStocks();
    expect(result).toHaveLength(snapshot.length);
    expect(result.find((stock) => stock.symbol === "000001")).toMatchObject({
      name: "平安银行",
      source: "cached",
      fetchedAt: expect.any(String),
    });
    expect(fetchAStockUniverse).not.toHaveBeenCalled();
  });

  it("不把新鲜的 7 条旧缓存当成全 A 股目录，并立即重新拉取", async () => {
    const { service, database } = await serviceWithDatabase();
    database.replaceStockUniverse(
      Array.from({ length: 7 }, (_, index) => ({
        symbol: String(601000 + index),
        name: `旧银行股${index}`,
      })),
      "legacy-fallback",
      new Date().toISOString(),
    );
    const refreshed = completeStockUniverse([
      { symbol: "000001", name: "平安银行" },
    ]);
    vi.mocked(fetchAStockUniverse).mockResolvedValue({
      rows: refreshed,
      source: "official-exchanges",
      fetchedAt: "2026-07-26T00:00:00Z",
    });

    const result = await service.listStocks();

    expect(fetchAStockUniverse).toHaveBeenCalledOnce();
    expect(result).toHaveLength(refreshed.length);
    expect(database.listStockUniverse()).toHaveLength(refreshed.length);
  });

  it("刷新失败时回退到上次成功的全市场快照", async () => {
    const { service, database } = await serviceWithDatabase();
    const snapshot = completeStockUniverse([
      { symbol: "601398", name: "工商银行" },
    ]);
    database.replaceStockUniverse(
      snapshot,
      "cached",
      "2020-01-01T00:00:00Z",
    );
    vi.mocked(fetchAStockUniverse).mockRejectedValue(
      new Error("network unavailable"),
    );

    const result = await service.listStocks();
    expect(result).toHaveLength(snapshot.length);
    expect(result.find((stock) => stock.symbol === "601398")).toMatchObject({
      name: "工商银行",
      source: "cached",
      fetchedAt: "2020-01-01T00:00:00Z",
    });
  });

  it("没有完整快照且刷新失败时明确报错，不回退到 7 只银行股", async () => {
    const { service, database } = await serviceWithDatabase();
    database.replaceStockUniverse(
      [{ symbol: "601398", name: "工商银行" }],
      "legacy-fallback",
      new Date().toISOString(),
    );
    vi.mocked(fetchAStockUniverse).mockRejectedValue(
      new Error("network unavailable"),
    );

    await expect(service.listStocks()).rejects.toThrow(
      "无法加载完整的全 A 股代码表",
    );
  });
});

describe("AppService 回测试验", () => {
  it("每次运行返回并保存新的不可变实验", async () => {
    const { service, database } = await serviceWithDatabase();
    database.replaceStockUniverse(
      completeStockUniverse([
        { symbol: "601398", name: "工商银行" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      rows: [
        { date: "2024-01-02", close: 5 },
        { date: "2024-02-01", close: 5.2 },
      ],
      provenance: {
        source: "test-price",
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: "bank-dca-r1-node-v3",
      },
    });
    vi.mocked(fetchAdjustedBars).mockResolvedValue({
      rows: [
        {
          date: "2024-01-02",
          open: 4.9,
          high: 5.1,
          low: 4.8,
          close: 5,
          volume: 1000,
          adjustment: "qfq",
        },
        {
          date: "2024-02-01",
          open: 5,
          high: 5.3,
          low: 4.9,
          close: 5.2,
          volume: 1200,
          adjustment: "qfq",
        },
      ],
      provenance: {
        source: "test-qfq",
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "qfq",
        caliberVersion: "bank-dca-r1-node-v3",
      },
    });
    vi.mocked(fetchCorporateActions).mockResolvedValue({
      rows: [],
      provenance: {
        source: "test-action",
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: "bank-dca-r1-node-v3",
      },
    });
    const request = {
      symbols: ["601398"],
      startDate: "2024-01-01",
      endDate: "2024-02-01",
      monthlyAmount: 3000,
      buyDay: 1,
    };

    const first = await service.runBacktest(request);
    const second = await service.runBacktest(request);

    expect(first.experimentId).not.toBe(second.experimentId);
    expect(first.results[0].experimentId).toBe(first.experimentId);
    expect(first.request.caliberVersion).toBe("bank-dca-r1-node-v3");
    expect(first.results[0].chartData).toMatchObject({
      status: "ready",
      data: [
        {
          date: "2024-01-02",
          open: 4.9,
          high: 5.1,
          low: 4.8,
          close: 5,
          volume: 1000,
          adjustment: "qfq",
        },
        {
          date: "2024-02-01",
          open: 5,
          high: 5.3,
          low: 4.9,
          close: 5.2,
          volume: 1200,
          adjustment: "qfq",
        },
      ],
    });
    expect(first.results[0].provenance).toContainEqual(
      expect.objectContaining({
        source: "test-qfq",
        adjustment: "qfq",
      }),
    );
    expect(database.listBacktestExperiments()).toHaveLength(2);
  });
});
