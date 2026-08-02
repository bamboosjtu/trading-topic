import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BacktestRequest,
  MarketDataProvenance,
  MarketFetchResult,
  PendingDividend,
  StockInfo,
} from "../../shared/contracts";
import {
  BACKTEST_CALIBER_VERSION,
  ETF_UNIVERSE_MIN_SIZE,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import {
  fetchAStockUniverse,
  fetchDomesticEtfUniverse,
} from "../data/stockUniverse";
import {
  fetchCorporateActions,
} from "../data/tencent";
import {
  fetchMarketAdjustedBars,
  fetchMarketPrices,
} from "../data/marketDataProvider";
import { latestWeekdayCandidate } from "../domain/marketCalendar";
import { LocalDatabase } from "../storage/database";
import { AppService } from "./appService";

vi.mock("../data/stockUniverse", () => ({
  fetchAStockUniverse: vi.fn(),
  fetchDomesticEtfUniverse: vi.fn(),
}));
vi.mock("../data/tencent", () => ({
  fetchCorporateActions: vi.fn(),
}));
vi.mock("../data/marketDataProvider", () => ({
  fetchMarketAdjustedBars: vi.fn(),
  fetchMarketPrices: vi.fn(),
}));
const fetchUnadjustedPrices = fetchMarketPrices;
const fetchAdjustedBars = fetchMarketAdjustedBars;

const temporaryDirectories: string[] = [];
const openDatabases: LocalDatabase[] = [];

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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
  const stocks: StockInfo[] = Array.from({ length: STOCK_UNIVERSE_MIN_SIZE }, (_, index) => ({
    symbol: String(600000 + index),
    name: `沪市股票${index}`,
    securityType: "stock" as const,
  }));
  stocks.push(
    ...Array.from({ length: ETF_UNIVERSE_MIN_SIZE }, (_, index) => ({
      symbol: String(510000 + index),
      name: `ETF示例${index}`,
      securityType: "etf" as const,
    })),
  );
  const unique = new Map(stocks.map((stock) => [stock.symbol, stock]));
  for (const stock of overrides) unique.set(stock.symbol, stock);
  return [...unique.values()];
}

function seedStockUniverse(
  database: LocalDatabase,
  stocks: StockInfo[],
  source: string,
  fetchedAt: string,
): void {
  for (const securityType of ["stock", "etf"] as const) {
    const rows = stocks.filter((stock) => stock.securityType === securityType);
    if (!rows.length) continue;
    database.replaceStockUniverseType(rows, securityType, {
      source,
      primarySource: source,
      fallbackUsed: false,
      fetchedAt,
    });
  }
}

function completeMarketResponse<
  T extends { date: string },
  P extends MarketDataProvenance,
>(
  response: { rows: T[]; provenance: P },
): MarketFetchResult<T, P> {
  return {
    ...response,
    requestedThrough:
      response.provenance.dataCutoff ?? response.rows.at(-1)?.date ?? "",
    dataCutoff: response.provenance.dataCutoff,
    tailStatus: "complete" as const,
    issues: [],
    officialCalendarYears: [],
    uncoveredCalendarYears: [],
  };
}

describe("AppService 股票目录", () => {
  it("七天内直接使用完整 A 股 SQLite 快照，不重复联网", async () => {
    const { service, database } = await serviceWithDatabase();
    const snapshot = completeStockUniverse([
      { symbol: "000001", name: "平安银行", securityType: "stock" },
    ]);
    seedStockUniverse(database,
      snapshot,
      "cached",
      new Date().toISOString(),
    );

    const result = await service.listAStocks();
    expect(result).toHaveLength(STOCK_UNIVERSE_MIN_SIZE + 1);
    expect(result.find((stock) => stock.symbol === "000001")).toMatchObject({
      name: "平安银行",
      source: "cached",
      fetchedAt: expect.any(String),
    });
    expect(fetchAStockUniverse).not.toHaveBeenCalled();
    expect(fetchDomesticEtfUniverse).not.toHaveBeenCalled();
  });

  it("不把新鲜的 7 条旧缓存当成全 A 股目录，并立即重新拉取", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      Array.from({ length: 7 }, (_, index) => ({
        symbol: String(601000 + index),
        name: `旧银行股${index}`,
        securityType: "stock" as const,
      })),
      "legacy-fallback",
      new Date().toISOString(),
    );
    const refreshed = completeStockUniverse([
      { symbol: "000001", name: "平安银行", securityType: "stock" },
    ]).filter((item) => item.securityType !== "etf");
    vi.mocked(fetchAStockUniverse).mockResolvedValue({
      rows: refreshed,
      source: "official-exchanges",
      primarySource: "official-exchanges",
      fallbackUsed: false,
      fetchedAt: "2026-07-26T00:00:00Z",
    });

    const result = await service.listAStocks();

    expect(fetchAStockUniverse).toHaveBeenCalledOnce();
    expect(result).toHaveLength(refreshed.length);
    expect(database.listStockUniverse()).toHaveLength(refreshed.length);
  });

  it("刷新失败时回退到上次成功的全市场快照", async () => {
    const { service, database } = await serviceWithDatabase();
    const snapshot = completeStockUniverse([
      { symbol: "601398", name: "工商银行", securityType: "stock" },
    ]);
    seedStockUniverse(database,
      snapshot,
      "cached",
      "2020-01-01T00:00:00Z",
    );
    vi.mocked(fetchAStockUniverse).mockRejectedValue(
      new Error("network unavailable"),
    );

    const result = await service.listAStocks();
    expect(result).toHaveLength(
      snapshot.filter((item) => item.securityType !== "etf").length,
    );
    expect(result.find((stock) => stock.symbol === "601398")).toMatchObject({
      name: "工商银行",
      source: "cached",
      fetchedAt: "2020-01-01T00:00:00Z",
    });
  });

  it("没有完整快照且刷新失败时明确报错，不回退到 7 只银行股", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      [{ symbol: "601398", name: "工商银行", securityType: "stock" }],
      "legacy-fallback",
      new Date().toISOString(),
    );
    vi.mocked(fetchAStockUniverse).mockRejectedValue(
      new Error("network unavailable"),
    );

    await expect(service.listAStocks()).rejects.toThrow(
      "无法加载完整的 A 股代码表",
    );
  });

  it("ETF 数据源故障不阻断 A 股目录和历史回测用例", async () => {
    const { service } = await serviceWithDatabase();
    const stocks = completeStockUniverse().filter(
      (item) => item.securityType !== "etf",
    );
    vi.mocked(fetchAStockUniverse).mockResolvedValue({
      rows: stocks,
      source: "official-exchanges",
      primarySource: "official-exchanges",
      fallbackUsed: false,
      fetchedAt: "2026-07-29T00:00:00Z",
    });
    vi.mocked(fetchDomesticEtfUniverse).mockRejectedValue(
      new Error("ETF source unavailable"),
    );

    await expect(service.listAStocks()).resolves.toHaveLength(
      stocks.length,
    );
    expect(fetchDomesticEtfUniverse).not.toHaveBeenCalled();
  });
});

describe("AppService 回测试验", () => {
  it("每次运行返回并保存新的不可变实验", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      completeStockUniverse([
      { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(completeMarketResponse({
      rows: [
        { date: "2024-01-02", close: 5 },
        { date: "2024-02-01", close: 5.2 },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));
    vi.mocked(fetchAdjustedBars).mockResolvedValue(completeMarketResponse({
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
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "qfq",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));
    vi.mocked(fetchCorporateActions).mockResolvedValue({
      rows: [],
      reportedActions: [],
      provenance: {
        source: "test-action",
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
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
    expect(first.request.caliberVersion).toBe(BACKTEST_CALIBER_VERSION);
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
        source: "tencent",
        adjustment: "qfq",
      }),
    );
    expect(database.listBacktestExperiments()).toHaveLength(2);
  });

  it("在任何数据请求前拒绝重复标的", async () => {
    const { service } = await serviceWithDatabase();

    await expect(
      service.runBacktest({
        symbols: ["601398", "601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 3000,
        buyDay: 1,
      }),
    ).rejects.toThrow("回测标的不能重复");
    expect(fetchAStockUniverse).not.toHaveBeenCalled();
    expect(fetchUnadjustedPrices).not.toHaveBeenCalled();
  });

  it("在获取回测行情前拒绝 ETF 标的", async () => {
    const { service } = await serviceWithDatabase();

    await expect(
      service.runBacktest({
        symbols: ["510300"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 3000,
        buyDay: 1,
      }),
    ).rejects.toThrow("历史回测只支持A股股票");
    expect(fetchAStockUniverse).toHaveBeenCalledOnce();
    expect(fetchUnadjustedPrices).not.toHaveBeenCalled();
    expect(fetchAdjustedBars).not.toHaveBeenCalled();
    expect(fetchCorporateActions).not.toHaveBeenCalled();
  });

  const invalidRuntimeRequests: Array<
    [label: string, patch: Record<string, unknown>, expected: string]
  > = [
    [
      "非法日期",
      { startDate: "2024-02-30" },
      "回测日期必须是合法的 YYYY-MM-DD",
    ],
    [
      "无限金额",
      { monthlyAmount: Number.POSITIVE_INFINITY },
      "每月金额必须是大于 0 的有限数字",
    ],
    ["非法快捷区间", { rangeYears: 7 }, "快捷区间仅支持 3、5、10、15 年"],
    [
      "非法分红口径",
      { dividendTiming: "unknown" },
      "分红处理方式仅支持除权日或到账日",
    ],
  ];

  it.each(invalidRuntimeRequests)(
    "在任何数据请求前拒绝%s",
    async (_label, patch, expected) => {
      const { service } = await serviceWithDatabase();
      const invalidRequest = {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 3000,
        buyDay: 1,
        ...patch,
      } as unknown as BacktestRequest;

      await expect(service.runBacktest(invalidRequest)).rejects.toThrow(
        expected,
      );
      expect(fetchAStockUniverse).not.toHaveBeenCalled();
      expect(fetchUnadjustedPrices).not.toHaveBeenCalled();
    },
  );

  it("展示各自实际区间，并报告配股和非严格同区间比较", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
        { symbol: "601916", name: "浙商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    vi.mocked(fetchUnadjustedPrices).mockImplementation(async (symbol) => completeMarketResponse({
      rows:
        symbol === "601398"
          ? [
              { date: "2024-01-02", close: 5 },
              { date: "2024-02-01", close: 5.2 },
            ]
          : [
              { date: "2024-01-15", close: 2.5 },
              { date: "2024-02-01", close: 2.6 },
            ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));
    vi.mocked(fetchAdjustedBars).mockImplementation(async (symbol) => {
      const close = symbol === "601398" ? 5 : 2.5;
      return completeMarketResponse({
        rows: [
          {
            date: symbol === "601398" ? "2024-01-02" : "2024-01-15",
            open: close,
            high: close,
            low: close,
            close,
            volume: 1000,
            adjustment: "qfq",
          },
        ],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-26T00:00:00Z",
          dataCutoff: "2024-02-01",
          adjustment: "qfq",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      });
    });
    vi.mocked(fetchCorporateActions).mockImplementation(async (symbol) => ({
      rows: [],
      reportedActions:
        symbol === "601916"
          ? [
              {
                type: "rights_issue",
                sourceId: "42784",
                exDate: "2024-01-20",
                recordDate: "2024-01-19",
                paymentStartDate: "2024-01-21",
                paymentEndDate: "2024-01-25",
                listingDate: "2024-02-05",
                ratioPer10: 3,
                subscriptionPrice: 2.02,
              },
              {
                type: "rights_issue",
                sourceId: "after-cutoff",
                exDate: "2024-02-15",
                recordDate: "2024-02-14",
                paymentStartDate: "2024-02-16",
                paymentEndDate: "2024-02-20",
                listingDate: "2024-03-01",
                ratioPer10: 2,
                subscriptionPrice: 2.1,
              },
            ]
          : [],
      provenance: {
        source: "test-action",
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-02-01",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));

    const experiment = await service.runBacktest({
      symbols: ["601398", "601916"],
      startDate: "2024-01-01",
      endDate: "2024-02-01",
      monthlyAmount: 3000,
      buyDay: 1,
    });

    expect(experiment.results.map((result) => result.actualStartDate)).toEqual([
      "2024-01-02",
      "2024-01-15",
    ]);
    expect(experiment.results[0].warnings).toContainEqual(
      expect.stringContaining("非严格同区间比较"),
    );
    const rightsIssueWarnings = experiment.results[1].warnings.filter(
      (warning) => warning.startsWith("配股事件"),
    );
    expect(rightsIssueWarnings).toHaveLength(1);
    expect(rightsIssueWarnings[0]).toContain("除权日 2024-01-20");
    expect(rightsIssueWarnings[0]).toContain("R1 假设不参与");
  });

  it("任一标的数据获取失败时不写入回测行情缓存", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
        { symbol: "601916", name: "浙商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    vi.mocked(fetchUnadjustedPrices)
      .mockResolvedValueOnce(completeMarketResponse({
        rows: [{ date: "2024-01-02", close: 5 }],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-26T00:00:00Z",
          dataCutoff: "2024-01-02",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      }))
      .mockRejectedValueOnce(new Error("第二个标的响应结构损坏"));
    vi.mocked(fetchAdjustedBars).mockResolvedValue(completeMarketResponse({
      rows: [
        {
          date: "2024-01-02",
          open: 5,
          high: 5,
          low: 5,
          close: 5,
          volume: 1000,
          adjustment: "qfq",
        },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-01-02",
        adjustment: "qfq",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));
    vi.mocked(fetchCorporateActions).mockResolvedValue({
      rows: [],
      reportedActions: [],
      provenance: {
        source: "test-action",
        fetchedAt: "2026-07-26T00:00:00Z",
        dataCutoff: "2024-01-02",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    });

    await expect(
      service.runBacktest({
        symbols: ["601398", "601916"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 3000,
        buyDay: 1,
      }),
    ).rejects.toThrow("第二个标的响应结构损坏");
    expect(database.listLiveMarketPrices()).toHaveLength(0);
    expect(database.listBacktestExperiments()).toEqual([]);
  });

  it("严格回测拒绝 incomplete 行情尾部且不保存 completed 实验", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(
      database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      rows: [{ date: "2024-02-28", close: 5 }],
      requestedThrough: "2024-02-29",
      dataCutoff: "2024-02-28",
      tailStatus: "incomplete",
      issues: [
        { type: "gap", severity: "warning", message: "腾讯尾部不完整" },
        { type: "gap", severity: "warning", message: "新浪兜底失败" },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-30T00:00:00Z",
        dataCutoff: "2024-02-28",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
      officialCalendarYears: [],
      uncoveredCalendarYears: [],
    });
    vi.mocked(fetchAdjustedBars).mockResolvedValue(
      completeMarketResponse({
        rows: [
          {
            date: "2024-02-29",
            open: 5,
            high: 5,
            low: 5,
            close: 5,
            volume: 100,
            adjustment: "qfq",
          },
        ],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-30T00:00:00Z",
          dataCutoff: "2024-02-29",
          adjustment: "qfq",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      }),
    );

    await expect(
      service.runBacktest({
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-29",
        monthlyAmount: 3_000,
        buyDay: 1,
      }),
    ).rejects.toThrow(
      "601398 严格回测行情尾部不完整：腾讯尾部不完整；新浪兜底失败",
    );
    expect(fetchCorporateActions).not.toHaveBeenCalled();
    expect(database.listBacktestExperiments()).toEqual([]);
    expect(database.listLiveMarketPrices()).toHaveLength(0);
  });

  /**
   * P0 回归：fetchMarketPrices 包装层曾遗漏 officialCalendarYears 与
   * uncoveredCalendarYears 字段转发，导致服务层永远读到空数组，最终错误
   * 标记为 strict。本测试验证全链路：mock 返回未覆盖年份 2016-2023 时，
   * 回测结果必须为 research（仅日历覆盖不完整，未触发真实行情异常）
   * 且 reasons 包含 calendar_coverage_partial。
   */
  it("P0 回归：未覆盖正式日历的年份触发 calendar_coverage_partial 标记为 research（2016-2026 请求）", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    // 关键：mock 返回的对象必须包含 officialCalendarYears 与
    // uncoveredCalendarYears 字段（现在是必填）。
    // 2016-2023 没有正式日历，必须触发 calendar_coverage_partial 标记为 research。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      ...completeMarketResponse({
        rows: [
          { date: "2024-01-02", close: 5 },
          { date: "2026-07-31", close: 5.2 },
        ],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-31T00:00:00Z",
          dataCutoff: "2026-07-31",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      }),
      officialCalendarYears: [2024, 2025, 2026],
      uncoveredCalendarYears: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    });
    vi.mocked(fetchAdjustedBars).mockResolvedValue(completeMarketResponse({
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
          date: "2026-07-31",
          open: 5,
          high: 5.3,
          low: 4.9,
          close: 5.2,
          volume: 1200,
          adjustment: "qfq",
        },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-31T00:00:00Z",
        dataCutoff: "2026-07-31",
        adjustment: "qfq",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));
    vi.mocked(fetchCorporateActions).mockResolvedValue({
      rows: [],
      reportedActions: [],
      provenance: {
        source: "test-action",
        fetchedAt: "2026-07-31T00:00:00Z",
        dataCutoff: "2026-07-31",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    });

    const experiment = await service.runBacktest({
      symbols: ["601398"],
      startDate: "2016-08-02",
      endDate: "2026-07-31",
      monthlyAmount: 3000,
      buyDay: 1,
    });

    // 实验级别：dataQuality.level 必须为 research（仅日历覆盖不完整，无真实行情异常）
    expect(experiment.dataQuality?.level).toBe("research");
    // 兼容字段：research 合并为 degraded
    expect(experiment.dataQualityStatus).toBe("degraded");
    // reasons 必须包含 calendar_coverage_partial
    expect(experiment.dataQuality?.reasons).toContain("calendar_coverage_partial");
    // reasons 不应包含 cross_provider_common_gap（mock 数据没有共同缺口）
    expect(experiment.dataQuality?.reasons).not.toContain("cross_provider_common_gap");
    // uncoveredCalendarYears 必须包含 2016-2023
    expect(experiment.dataQuality?.uncoveredCalendarYears).toEqual([
      2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
    ]);
    expect(experiment.dataQuality?.officialCalendarYears).toEqual([2024, 2025, 2026]);
    // 结果级别也应为 research
    expect(experiment.results[0].dataQuality?.level).toBe("research");
    expect(experiment.results[0].dataQuality?.reasons).toContain("calendar_coverage_partial");
    expect(experiment.results[0].dataQuality?.reasons).not.toContain("cross_provider_common_gap");
    expect(experiment.results[0].dataQualityStatus).toBe("degraded");
    // 实验已持久化
    expect(database.listBacktestExperiments()).toHaveLength(1);
  });

  /**
   * P0 回归对照：当请求区间只覆盖正式日历年份（2024-2026）且无任何 issues 时，
   * 回测结果必须为 strict，reasons 为空数组。
   */
  it("P0 回归对照：只覆盖正式日历年份且无 issues 时结果为 strict", async () => {
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    // 关键：officialCalendarYears 包含 2024-2026，uncoveredCalendarYears 为空。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      ...completeMarketResponse({
        rows: [
          { date: "2024-01-02", close: 5 },
          { date: "2026-07-31", close: 5.2 },
        ],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-31T00:00:00Z",
          dataCutoff: "2026-07-31",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      }),
      officialCalendarYears: [2024, 2025, 2026],
      uncoveredCalendarYears: [],
    });
    vi.mocked(fetchAdjustedBars).mockResolvedValue(completeMarketResponse({
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
          date: "2026-07-31",
          open: 5,
          high: 5.3,
          low: 4.9,
          close: 5.2,
          volume: 1200,
          adjustment: "qfq",
        },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-31T00:00:00Z",
        dataCutoff: "2026-07-31",
        adjustment: "qfq",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));
    vi.mocked(fetchCorporateActions).mockResolvedValue({
      rows: [],
      reportedActions: [],
      provenance: {
        source: "test-action",
        fetchedAt: "2026-07-31T00:00:00Z",
        dataCutoff: "2026-07-31",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    });

    const experiment = await service.runBacktest({
      symbols: ["601398"],
      startDate: "2024-01-01",
      endDate: "2026-07-31",
      monthlyAmount: 3000,
      buyDay: 1,
    });

    // 实验级别：dataQuality.level 必须为 strict
    expect(experiment.dataQuality?.level).toBe("strict");
    expect(experiment.dataQualityStatus).toBe("strict");
    // reasons 必须为空数组
    expect(experiment.dataQuality?.reasons).toEqual([]);
    // uncoveredCalendarYears 必须为空
    expect(experiment.dataQuality?.uncoveredCalendarYears).toEqual([]);
    expect(experiment.dataQuality?.officialCalendarYears).toEqual([2024, 2025, 2026]);
    // 结果级别也应为 strict
    expect(experiment.results[0].dataQuality?.level).toBe("strict");
    expect(experiment.results[0].dataQuality?.reasons).toEqual([]);
    expect(experiment.results[0].dataQualityStatus).toBe("strict");
    // 实验已持久化
    expect(database.listBacktestExperiments()).toHaveLength(1);
  });
});

describe("AppService 实盘流水", () => {
  it("追加修正原子保留原记录、冲正记录与修正后记录", async () => {
    const { service, database } = await serviceWithDatabase();
    const original = service.addLedger({
      type: "buy",
      businessDate: "2026-01-05",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 1_000,
      fee: 5,
    });

    const replacement = service.correctLedger(original.id, {
      type: "buy",
      businessDate: "2026-01-05",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 4,
      quantity: 100,
      fee: 1,
    });
    const rows = database.listLedger();

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === original.id)).toBeDefined();
    expect(rows).toContainEqual(
      expect.objectContaining({
        type: "adjustment",
        reversesEntryId: original.id,
      }),
    );
    expect(replacement).toMatchObject({
      correctsEntryId: original.id,
      quantity: 100,
      price: 4,
    });
    expect(service.getPositionsOverview().positions[0]).toMatchObject({
      symbol: "601398",
      quantity: 100,
      cost: 401,
    });
  });

  it("已冲正流水不能重复冲正或修正", async () => {
    const { service } = await serviceWithDatabase();
    const original = service.addLedger({
      type: "buy",
      businessDate: "2026-01-05",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
    });
    service.reverseLedger(original.id, "测试冲正");

    expect(() => service.reverseLedger(original.id, "再次冲正")).toThrow(
      "已经被冲正或修正",
    );
    expect(() =>
      service.correctLedger(original.id, {
        type: "buy",
        businessDate: "2026-01-05",
        symbol: "601398",
        securityType: "stock",
        price: 4.9,
        quantity: 100,
      }),
    ).toThrow("已经被冲正或修正");
  });

  it("收益日历按历史持有区间补齐独立实盘行情缓存", async () => {
    const { service, database } = await serviceWithDatabase();
    for (const input of [
      {
        type: "buy" as const,
        businessDate: "2025-01-02",
        symbol: "601398",
        securityType: "stock" as const,
        price: 5,
        quantity: 37,
      },
      {
        type: "sell" as const,
        businessDate: "2025-02-05",
        symbol: "601398",
        securityType: "stock" as const,
        price: 5.2,
        quantity: 37,
      },
      {
        type: "buy" as const,
        businessDate: "2026-05-06",
        symbol: "601398",
        securityType: "stock" as const,
        price: 5.3,
        quantity: 37,
      },
      {
        type: "sell" as const,
        businessDate: "2026-06-08",
        symbol: "601398",
        securityType: "stock" as const,
        price: 5.4,
        quantity: 37,
      },
      {
        type: "buy" as const,
        businessDate: "2026-07-01",
        symbol: "601939",
        securityType: "stock" as const,
        price: 7,
        quantity: 101,
      },
    ]) {
      service.addLedger(input);
    }
    vi.mocked(fetchUnadjustedPrices).mockImplementation(
      async (symbol, startDate, endDate) => completeMarketResponse({
        rows: [
          { date: startDate, close: symbol === "601398" ? 5 : 7 },
          { date: endDate, close: symbol === "601398" ? 5.2 : 7.2 },
        ],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-28T01:00:00Z",
          dataCutoff: endDate,
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      }),
    );

    const expectedCurrentCutoff = latestWeekdayCandidate(new Date());
    const view = await service.getIncomeCalendar({
      month: "2026-07",
      scope: "all",
    });

    expect(fetchUnadjustedPrices).toHaveBeenCalledWith(
      "601398",
      "2025-01-02",
      "2025-02-05",
      undefined,
      [],
    );
    expect(fetchUnadjustedPrices).toHaveBeenCalledWith(
      "601939",
      "2026-07-01",
      expectedCurrentCutoff,
      undefined,
      [],
    );
    expect(fetchUnadjustedPrices).toHaveBeenCalledWith(
      "601398",
      "2026-05-06",
      "2026-06-08",
      undefined,
      [],
    );
    expect(fetchUnadjustedPrices).not.toHaveBeenCalledWith(
      "601398",
      "2025-02-03",
      "2026-05-06",
      undefined,
    );
    expect(database.listLiveMarketPrices()).toHaveLength(6);
    expect(view.quality.dataCutoff).toBe(expectedCurrentCutoff);

    vi.mocked(fetchUnadjustedPrices).mockClear();
    await service.getIncomeCalendar({
      month: "2026-07",
      scope: "all",
    });
    expect(fetchUnadjustedPrices).not.toHaveBeenCalled();
  });

  it("历史月份以月内最后有效交易日作为实际数据截止", async () => {
    const { service } = await serviceWithDatabase();
    service.addLedger({
      type: "buy",
      businessDate: "2026-05-06",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
    });
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(completeMarketResponse({
      rows: [
        { date: "2026-05-06", close: 5 },
        { date: "2026-05-29", close: 5.2 },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-06-01T01:00:00Z",
        dataCutoff: "2026-05-29",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));

    const view = await service.getIncomeCalendar({
      month: "2026-05",
      scope: "all",
    });

    expect(fetchUnadjustedPrices).toHaveBeenCalledWith(
      "601398",
      "2026-05-06",
      "2026-05-31",
      undefined,
      [],
    );
    expect(view.quality.dataCutoff).toBe("2026-05-29");
    expect(view.quality.status).toBe("ready");

    vi.mocked(fetchUnadjustedPrices).mockClear();
    await service.getIncomeCalendar({ month: "2026-05", scope: "all" });
    expect(fetchUnadjustedPrices).not.toHaveBeenCalled();
  });

  it("非空覆盖只覆盖到实际数据截止日并继续补齐请求尾部", async () => {
    const { service, database } = await serviceWithDatabase();
    service.addLedger({
      type: "buy",
      businessDate: "2026-06-01",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
    });
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-06-01", close: 5 },
          { date: "2026-06-29", close: 5.1 },
        ],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-06-29T08:00:00Z",
          dataCutoff: "2026-06-29",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
        requestedFrom: "2026-06-01",
        requestedThrough: "2026-06-30",
      },
    ]);
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(completeMarketResponse({
      rows: [{ date: "2026-06-30", close: 5.2 }],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-06-30T08:00:00Z",
        dataCutoff: "2026-06-30",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
    }));

    const view = await service.getIncomeCalendar({
      month: "2026-06",
      scope: "all",
    });

    expect(fetchUnadjustedPrices).toHaveBeenCalledWith(
      "601398",
      "2026-06-30",
      "2026-06-30",
      undefined,
      [],
    );
    expect(view.quality.dataCutoff).toBe("2026-06-30");
    expect(view.quality.status).toBe("ready");
  });

  it("持仓刷新返回请求与实际截止日并将未确认尾部标记为 partial", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T08:00:00Z"));
    const { service, database } = await serviceWithDatabase();
    database.addLedger({
      id: "holding",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      rows: [{ date: "2026-07-28", close: 5.2 }],
      requestedThrough: "2026-07-29",
      dataCutoff: "2026-07-28",
      tailStatus: "incomplete",
      issues: [
        { type: "gap", severity: "warning", message: "腾讯行情尾部不完整" },
        { type: "gap", severity: "warning", message: "新浪兜底失败" },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-29T08:00:00Z",
        dataCutoff: "2026-07-28",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
      officialCalendarYears: [],
      uncoveredCalendarYears: [],
    });

    const result = await service.refreshPositionsMarket();

    expect(result).toMatchObject({
      requestedCutoff: "2026-07-29",
      actualCutoff: "2026-07-28",
      tailStatus: "incomplete",
      issues: expect.arrayContaining([
        "601398 行情尾部不完整：腾讯行情尾部不完整；新浪兜底失败",
        "行情仅更新至 2026-07-28，请求截止 2026-07-29 的尾部尚未确认完整",
      ]),
    });
    expect(result.overview.quality.status).toBe("partial");
    expect(result.overview.quality.issues).toContain(
      "行情仅更新至 2026-07-28，请求截止 2026-07-29 的尾部尚未确认完整",
    );
    expect(result.overview.positions[0].marketValue).toBeNull();
  });
});

describe("AppService P1-1/P1-2/P1-3 修复", () => {
  it("partial 覆盖使持仓读模型降级，数据库重开后仍为 partial", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T08:00:00Z"));
    const directory = mkdtempSync(join(tmpdir(), "stock-income-partial-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "app.sqlite");
    const database = await LocalDatabase.open(dbPath);
    openDatabases.push(database);
    seedStockUniverse(
      database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    const service = new AppService(database);
    database.addLedger({
      id: "holding",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    // 直接持久化一个 partial 覆盖：含 2026-07-15 内部错误，但 2026-07-31 有价格。
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-14", close: 5.1 },
          { date: "2026-07-16", close: 5.2 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-31T08:00:00Z",
          dataCutoff: "2026-07-31",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          {
            date: "2026-07-15",
            type: "invalid_ohlcv",
            severity: "error",
            message: "OHLCV 校验失败：开盘价 0 非正数",
          },
        ],
      },
    ]);

    // 直接调用 getPositionsOverview，应感知 partial 状态。
    const overview1 = service.getPositionsOverview();
    expect(overview1.quality.status).toBe("partial");
    expect(
      overview1.quality.issues.some((issue) => issue.includes("2026-07-15")),
    ).toBe(true);

    // 覆盖记录已持久化 issues_json。
    const coverage = database.listLiveMarketCoverage(["601398"]);
    expect(coverage[0]?.resultStatus).toBe("partial");
    expect(coverage[0]?.issues?.length).toBe(1);
    expect(coverage[0]?.issues?.[0]?.date).toBe("2026-07-15");

    // 关闭数据库并重新打开，partial 状态应持久化。
    database.close();
    const reopened = await LocalDatabase.open(dbPath);
    openDatabases.push(reopened);
    const reopenedService = new AppService(reopened);
    const overview2 = reopenedService.getPositionsOverview();
    expect(overview2.quality.status).toBe("partial");
    expect(
      overview2.quality.issues.some((issue) => issue.includes("2026-07-15")),
    ).toBe(true);
  });

  it("完整覆盖替代 partial 后持仓质量恢复为 ready", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T08:00:00Z"));
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(
      database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    database.addLedger({
      id: "holding",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    // 先保存 partial 覆盖。
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-31T08:00:00Z",
          dataCutoff: "2026-07-31",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          {
            date: "2026-07-15",
            type: "gap",
            severity: "error",
            message: "缺失 2026-07-15 行情",
          },
        ],
      },
    ]);
    expect(service.getPositionsOverview().quality.status).toBe("partial");

    // 用完整覆盖替代 partial（旧 partial 被删除）。
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-15", close: 5.2 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-07-31T10:00:00Z",
          dataCutoff: "2026-07-31",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
      },
    ]);
    expect(service.getPositionsOverview().quality.status).toBe("ready");
  });

  it("partial 但最新交易日存在时 tailStatus 为 complete", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T08:00:00Z"));
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(
      database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    database.addLedger({
      id: "holding",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    // 刷新返回 partial（内部 error）但 tailStatus = complete（最新日有价格）。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      rows: [
        { date: "2026-07-14", close: 5.1 },
        { date: "2026-07-16", close: 5.2 },
        { date: "2026-07-31", close: 5.3 },
      ],
      requestedThrough: "2026-07-31",
      dataCutoff: "2026-07-31",
      tailStatus: "complete",
      issues: [
        {
          date: "2026-07-15",
          type: "gap",
          severity: "error",
          message: "缺失 2026-07-15 行情",
        },
      ],
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-31T08:00:00Z",
        dataCutoff: "2026-07-31",
        adjustment: "none",
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
      officialCalendarYears: [],
      uncoveredCalendarYears: [],
    });

    const result = await service.refreshPositionsMarket();
    // P1-2：tailStatus 只取决于最新交易日是否有价格，不因内部坏行降级。
    expect(result.tailStatus).toBe("complete");
    expect(result.actualCutoff).toBe("2026-07-31");
    // 但质量仍为 partial，因为存在 error 级别问题。
    expect(result.overview.quality.status).toBe("partial");
    expect(result.issues.some((issue) => issue.includes("2026-07-15"))).toBe(true);
  });

  it("同日清仓再买入不会产生覆盖冲突", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T08:00:00Z"));
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(
      database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    // 2026-06-10 上午卖出全部，下午重新买入 → 区间 A 和 B 在 06-10 首尾相接。
    database.addLedger({
      id: "buy1",
      type: "buy",
      businessDate: "2026-06-01",
      recordedAt: "2026-06-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    database.addLedger({
      id: "sell1",
      type: "sell",
      businessDate: "2026-06-10",
      recordedAt: "2026-06-10T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5.5,
      quantity: 100,
      fee: 0,
    });
    database.addLedger({
      id: "buy2",
      type: "buy",
      businessDate: "2026-06-10",
      recordedAt: "2026-06-10T02:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5.6,
      quantity: 200,
      fee: 0,
    });

    // 收益日历会生成两个首尾相接的区间，normalizeRanges 合并为一个。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(
      completeMarketResponse({
        rows: [{ date: "2026-06-10", close: 5.5 }],
        provenance: {
          source: "tencent",
          primarySource: "tencent",
          fallbackUsed: false,
          fetchedAt: "2026-06-10T08:00:00Z",
          dataCutoff: "2026-06-10",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      }),
    );

    // 不应抛出"行情价格行冲突"。
    const view = await service.getIncomeCalendar({
      month: "2026-06",
      scope: "all",
    });
    expect(view).toBeDefined();
    // 06-10 只应请求一次（合并后）。
    const calls = vi.mocked(fetchUnadjustedPrices).mock.calls.filter(
      (call) => call[0] === "601398",
    );
    // 06-10 不会被重复请求。
    expect(calls.filter((call) => call[1] === "2026-06-10" && call[2] === "2026-06-10")).toHaveLength(0);
  });
});

describe("AppService P0 partial 覆盖完整区间替换", () => {
  const JULY_2026_WEEKDAYS = [
    "2026-07-01", "2026-07-02", "2026-07-03",
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
    "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
    "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
  ];

  function julyWeekdayPrices(exclude?: string): { date: string; close: number }[] {
    return JULY_2026_WEEKDAYS
      .filter((d) => d !== exclude)
      .map((d) => ({ date: d, close: 5 + JULY_2026_WEEKDAYS.indexOf(d) * 0.01 }));
  }

  function tencentProvenance(
    dataCutoff: string,
    fetchedAt = "2026-07-31T08:00:00Z",
  ): MarketDataProvenance & { caliberVersion: string } {
    return {
      source: "tencent",
      primarySource: "tencent",
      fallbackUsed: false,
      fetchedAt,
      dataCutoff,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    };
  }

  async function setupJulyHolding() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T08:00:00Z"));
    const { service, database } = await serviceWithDatabase();
    seedStockUniverse(
      database,
      completeStockUniverse([
        { symbol: "601398", name: "工商银行", securityType: "stock" },
      ]),
      "cached",
      new Date().toISOString(),
    );
    database.addLedger({
      id: "holding",
      type: "buy",
      businessDate: "2026-07-01",
      recordedAt: "2026-07-01T01:00:00Z",
      currency: "CNY",
      source: "user",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      price: 5,
      quantity: 100,
      fee: 0,
    });
    return { service, database };
  }

  it("中间日期错误，修复后前缀价格不丢失", async () => {
    const { service, database } = await setupJulyHolding();
    // 持久化 partial 覆盖：07-15 存在错误，07-01/07-14/07-16/07-31 有价格。
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-14", close: 5.1 },
          { date: "2026-07-16", close: 5.2 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: tencentProvenance("2026-07-31"),
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          { date: "2026-07-15", type: "gap", severity: "error", message: "缺失 2026-07-15 行情" },
        ],
      },
    ]);
    // 模拟完整区间返回（包含 07-01 前缀）。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(
      completeMarketResponse({
        rows: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-14", close: 5.1 },
          { date: "2026-07-15", close: 5.15 },
          { date: "2026-07-16", close: 5.2 },
          { date: "2026-07-31", close: 5.3 },
        ],
        provenance: tencentProvenance("2026-07-31", "2026-07-31T10:00:00Z"),
      }),
    );

    await service.getIncomeCalendar({ month: "2026-07", scope: "all" });

    // P0：前缀价格 07-01、07-14 在替换后仍存在。
    const dates = database.listLiveMarketPrices(["601398"]).map((p) => p.date);
    expect(dates).toContain("2026-07-01");
    expect(dates).toContain("2026-07-14");
    // 覆盖已恢复为 data。
    const coverage = database.listLiveMarketCoverage(["601398"]);
    expect(coverage[0]?.resultStatus).toBe("data");
  });

  it("错误发生在 requestedFrom 当天时仍会重试", async () => {
    const { service, database } = await setupJulyHolding();
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-02", close: 5.01 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: tencentProvenance("2026-07-31"),
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          { date: "2026-07-01", type: "invalid_ohlcv", severity: "error", message: "07-01 OHLCV 非法" },
        ],
      },
    ]);
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(
      completeMarketResponse({
        rows: julyWeekdayPrices(),
        provenance: tencentProvenance("2026-07-31", "2026-07-31T10:00:00Z"),
      }),
    );

    await service.getIncomeCalendar({ month: "2026-07", scope: "all" });

    // P1-1：错误在 requestedFrom 当天也应重试完整区间。
    const calls = vi.mocked(fetchUnadjustedPrices).mock.calls.filter(
      (call) => call[0] === "601398",
    );
    expect(
      calls.some((call) => call[1] === "2026-07-01" && call[2] === "2026-07-31"),
    ).toBe(true);
  });

  it("无具体日期的 error 会重试整个区间", async () => {
    const { service, database } = await setupJulyHolding();
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: tencentProvenance("2026-07-31"),
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          { type: "invalid_ohlcv", severity: "error", message: "区间内存在非法 OHLCV" },
        ],
      },
    ]);
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(
      completeMarketResponse({
        rows: julyWeekdayPrices(),
        provenance: tencentProvenance("2026-07-31", "2026-07-31T10:00:00Z"),
      }),
    );

    await service.getIncomeCalendar({ month: "2026-07", scope: "all" });

    // 无日期 error 也应重试完整区间。
    const calls = vi.mocked(fetchUnadjustedPrices).mock.calls.filter(
      (call) => call[0] === "601398",
    );
    expect(
      calls.some((call) => call[1] === "2026-07-01" && call[2] === "2026-07-31"),
    ).toBe(true);
  });

  it("再次请求仍为 partial 时，价格范围不会逐步缩水", async () => {
    const { service, database } = await setupJulyHolding();
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: [
          { date: "2026-07-01", close: 5 },
          { date: "2026-07-14", close: 5.1 },
          { date: "2026-07-16", close: 5.2 },
          { date: "2026-07-31", close: 5.3 },
        ],
        dividends: [],
        provenance: tencentProvenance("2026-07-31"),
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          { date: "2026-07-15", type: "gap", severity: "error", message: "缺失 2026-07-15 行情" },
        ],
      },
    ]);
    // 模拟再次返回 partial（07-15 仍然错误）。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue({
      rows: [
        { date: "2026-07-01", close: 5 },
        { date: "2026-07-14", close: 5.1 },
        { date: "2026-07-16", close: 5.2 },
        { date: "2026-07-31", close: 5.3 },
      ],
      requestedThrough: "2026-07-31",
      dataCutoff: "2026-07-31",
      tailStatus: "complete",
      issues: [
        { date: "2026-07-15", type: "gap", severity: "error", message: "缺失 2026-07-15 行情" },
      ],
      provenance: tencentProvenance("2026-07-31", "2026-07-31T10:00:00Z"),
      officialCalendarYears: [],
      uncoveredCalendarYears: [],
    });

    // 第一次请求：partial → 重新请求完整区间 → 仍为 partial
    await service.getIncomeCalendar({ month: "2026-07", scope: "all" });
    // 第二次请求：仍为 partial → 应再次请求完整区间（不缩水）
    await service.getIncomeCalendar({ month: "2026-07", scope: "all" });

    const calls = vi.mocked(fetchUnadjustedPrices).mock.calls.filter(
      (call) => call[0] === "601398",
    );
    // 两次都应请求 07-01..07-31，不能缩水为 07-15..07-31 或 07-16..07-31。
    for (const call of calls) {
      expect(call[1]).toBe("2026-07-01");
      expect(call[2]).toBe("2026-07-31");
    }
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("修复后收益日历全月收益与原始完整数据一致", async () => {
    const { service, database } = await setupJulyHolding();
    // 先保存 partial 覆盖（07-15 缺失）。
    database.saveLiveMarketPriceSnapshots([
      {
        symbol: "601398",
        prices: julyWeekdayPrices("2026-07-15"),
        dividends: [],
        provenance: tencentProvenance("2026-07-31"),
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        resultStatus: "partial",
        issues: [
          { date: "2026-07-15", type: "gap", severity: "error", message: "缺失 2026-07-15 行情" },
        ],
      },
    ]);
    // 模拟完整区间返回。
    vi.mocked(fetchUnadjustedPrices).mockResolvedValue(
      completeMarketResponse({
        rows: julyWeekdayPrices(),
        provenance: tencentProvenance("2026-07-31", "2026-07-31T10:00:00Z"),
      }),
    );

    // 第一次：partial → 修复为完整 → 计算月度收益。
    const fixed = await service.getIncomeCalendar({ month: "2026-07", scope: "all" });
    expect(fixed.quality.status).toBe("ready");
    const fixedRate = fixed.metrics.month.rate;
    expect(fixedRate).not.toBeNull();

    // 第二次：完整覆盖 → 无需请求 → 计算月度收益。
    vi.mocked(fetchUnadjustedPrices).mockClear();
    const baseline = await service.getIncomeCalendar({ month: "2026-07", scope: "all" });
    expect(vi.mocked(fetchUnadjustedPrices)).not.toHaveBeenCalled();
    const baselineRate = baseline.metrics.month.rate;

    // 修复后全月收益与原始完整数据一致。
    expect(fixedRate).toBe(baselineRate);
  });
});

describe("AppService 分红候选确认与发现", () => {
  function makePendingDividend(overrides: Partial<PendingDividend> = {}): PendingDividend {
    return {
      id: "pending-1",
      symbol: "601398",
      instrumentName: "工商银行",
      securityType: "stock",
      exDate: "2026-07-15",
      recordDate: "2026-07-14",
      paymentDate: null,
      perShare: 0.2,
      holdingQuantity: 100,
      expectedAmount: 20,
      status: "pending",
      discoveredAt: "2026-07-15T00:00:00Z",
      source: "corporate_action",
      ...overrides,
    };
  }

  it("确认分红时缺少到账日且未填写实际到账日则拒绝", async () => {
    const { service, database } = await serviceWithDatabase();
    service.addLedger({
      type: "buy",
      businessDate: "2026-06-01",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
      instrumentName: "工商银行",
    });
    database.insertPendingDividend(makePendingDividend({ paymentDate: null }));

    expect(() =>
      service.confirmPendingDividend("pending-1", { actualAmount: 20 }),
    ).toThrow("缺少分红到账日");
  });

  it("确认分红时填写实际到账日则成功写入且候选状态更新", async () => {
    const { service, database } = await serviceWithDatabase();
    service.addLedger({
      type: "buy",
      businessDate: "2026-06-01",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
      instrumentName: "工商银行",
    });
    database.insertPendingDividend(makePendingDividend({ paymentDate: null }));

    const result = service.confirmPendingDividend("pending-1", {
      actualAmount: 20,
      actualPaymentDate: "2026-07-20",
    });

    // P1：业务日期应为实际到账日，而非除权日
    expect(result.businessDate).toBe("2026-07-20");
    expect(result.type).toBe("dividend");
    // P1：候选状态在同一事务中更新为 confirmed
    const pending = database.getPendingDividend("pending-1");
    expect(pending?.status).toBe("confirmed");
    expect(pending?.linkedEntryId).toBe(result.id);
  });

  it("确认分红时候选已公告到账日则直接使用 paymentDate", async () => {
    const { service, database } = await serviceWithDatabase();
    service.addLedger({
      type: "buy",
      businessDate: "2026-06-01",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
      instrumentName: "工商银行",
    });
    database.insertPendingDividend(
      makePendingDividend({ paymentDate: "2026-07-18" }),
    );

    const result = service.confirmPendingDividend("pending-1", {
      actualAmount: 20,
    });

    expect(result.businessDate).toBe("2026-07-18");
  });

  it("发现分红时报告失败的标的并继续检查其他标的", async () => {
    const { service } = await serviceWithDatabase();
    service.addLedger({
      type: "buy",
      businessDate: "2026-06-02",
      symbol: "601398",
      securityType: "stock",
      price: 5,
      quantity: 100,
      instrumentName: "工商银行",
    });
    service.addLedger({
      type: "buy",
      businessDate: "2026-06-02",
      symbol: "601939",
      securityType: "stock",
      price: 7,
      quantity: 100,
      instrumentName: "建设银行",
    });

    vi.mocked(fetchCorporateActions).mockImplementation(async (symbol) => {
      if (symbol === "601939") throw new Error("数据源访问失败");
      return {
        rows: [],
        reportedActions: [],
        provenance: {
          source: "eastmoney",
          fetchedAt: "2026-07-31T00:00:00Z",
          dataCutoff: "2026-07-31",
          adjustment: "none",
          caliberVersion: BACKTEST_CALIBER_VERSION,
        },
      };
    });

    const result = await service.discoverPendingDividends();

    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.discovered).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.symbol).toBe("601939");
    expect(result.issues[0]!.message).toContain("数据源访问失败");
  });
});
