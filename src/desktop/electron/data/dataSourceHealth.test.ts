import { describe, expect, it, vi } from "vitest";
import type {
  AdjustedBar,
  DataProvenance,
  PricePoint,
  StockInfo,
} from "../../shared/contracts";
import {
  checkDataSourceHealth,
  type DataSourceHealthDependencies,
} from "./dataSourceHealth";

const NOW = new Date("2026-08-08T05:00:00.000Z");
const STOCKS: StockInfo[] = Array.from({ length: 1_001 }, (_, index) => ({
  symbol: String(600_000 + index),
  name: `股票${index}`,
  securityType: "stock",
}));
const ETFS: StockInfo[] = Array.from({ length: 1_001 }, (_, index) => ({
  symbol: String(510_000 + index),
  name: `ETF${index}`,
  securityType: "etf",
}));
const PRICES: PricePoint[] = [
  { date: "2026-08-06", close: 1 },
  { date: "2026-08-07", close: 1.01 },
];
const BARS: AdjustedBar[] = PRICES.map((item) => ({
  ...item,
  open: item.close,
  high: item.close,
  low: item.close,
  volume: 1,
  adjustment: "qfq",
}));
const PROVENANCE: DataProvenance = {
  source: "测试源",
  fetchedAt: NOW.toISOString(),
  dataCutoff: "2026-08-07",
  adjustment: "none",
  caliberVersion: "test",
};

function dependencies(): DataSourceHealthDependencies {
  return {
    now: () => NOW,
    sleep: vi.fn().mockResolvedValue(undefined),
    fetchAStockUniverse: vi.fn().mockResolvedValue({
      rows: STOCKS,
      source: "三家交易所",
      primarySource: "official-exchanges",
      fallbackUsed: false,
      fetchedAt: NOW.toISOString(),
    }),
    fetchDomesticEtfUniverse: vi.fn().mockResolvedValue({
      rows: ETFS,
      source: "新浪 ETF",
      primarySource: "sina",
      fallbackUsed: false,
      fetchedAt: NOW.toISOString(),
    }),
    fetchTencentPrices: vi.fn().mockResolvedValue({
      rows: PRICES,
      provenance: PROVENANCE,
    }),
    fetchTencentBars: vi.fn().mockResolvedValue({
      rows: BARS,
      provenance: { ...PROVENANCE, adjustment: "qfq" },
    }),
    fetchSinaPrices: vi.fn().mockResolvedValue({ rows: PRICES, issues: [] }),
    fetchSinaBars: vi.fn().mockResolvedValue({ rows: BARS, issues: [] }),
    fetchCorporateActions: vi.fn().mockResolvedValue({
      rows: [{ date: "2026-06-26" }],
      reportedActions: [],
      provenance: PROVENANCE,
    }),
    fetchEastmoneyTradingSuspensions: vi.fn().mockResolvedValue({
      rows: [
        {
          symbol: "603221",
          startDate: "2026-08-03",
          endDate: "2026-08-05",
          reason: "suspension",
          source: "eastmoney_custom_suspend",
          fetchedAt: NOW.toISOString(),
        },
      ],
      source: "东方财富停复牌",
      sourceKey: "eastmoney_custom_suspend",
      fetchedAt: NOW.toISOString(),
      coverageStart: "2026-08-03",
      coverageEnd: "2026-08-06",
      partialCoverage: false,
      unresolvedOpenIntervals: 0,
    }),
    fetchBaiduTradingSuspensions: vi.fn().mockResolvedValue({
      rows: [
        {
          symbol: "603221",
          startDate: "2026-08-03",
          endDate: "2026-08-05",
          reason: "suspension",
          source: "baidu_suspend",
          fetchedAt: NOW.toISOString(),
        },
      ],
      source: "百度停复牌",
      sourceKey: "baidu_suspend",
      fetchedAt: NOW.toISOString(),
      coverageStart: "2026-08-03",
      coverageEnd: "2026-08-06",
      partialCoverage: false,
      unresolvedOpenIntervals: 0,
    }),
  };
}

describe("checkDataSourceHealth", () => {
  it("七项真实来源都通过时返回 available，并分别验证停复牌主备源", async () => {
    const deps = dependencies();
    const result = await checkDataSourceHealth(deps);

    expect(result.status).toBe("available");
    expect(result.items).toHaveLength(7);
    expect(result.items.map((item) => item.id)).toEqual([
      "a_stock_directory",
      "etf_directory",
      "tencent_market",
      "sina_market",
      "eastmoney_corporate_actions",
      "eastmoney_suspensions",
      "baidu_suspensions",
    ]);
    expect(result.items.slice(-2)).toEqual([
      expect.objectContaining({
        id: "eastmoney_suspensions",
        status: "available",
        detail: expect.stringContaining("1 条"),
      }),
      expect.objectContaining({
        id: "baidu_suspensions",
        status: "available",
        detail: expect.stringContaining("独立备用源"),
      }),
    ]);
    expect(deps.fetchEastmoneyTradingSuspensions).toHaveBeenCalledWith(
      ["603221"],
      "2026-08-03",
      "2026-08-06",
    );
    expect(deps.fetchBaiduTradingSuspensions).toHaveBeenCalledWith(
      ["603221"],
      "2026-08-03",
      "2026-08-06",
    );
  });

  it("ETF 目录明确显示新浪单一主源", async () => {
    const deps = dependencies();
    const result = await checkDataSourceHealth(deps);

    expect(result.items.find((item) => item.id === "etf_directory"))
      .toMatchObject({
        status: "available",
        source: "新浪 ETF",
        route: "新浪财经单一主源",
        detail: expect.stringContaining("新浪目录"),
      });
  });

  it("单点停复牌接口失败时返回结构化 unavailable，不掩盖其他来源", async () => {
    const deps = dependencies();
    vi.mocked(deps.fetchEastmoneyTradingSuspensions).mockRejectedValueOnce(
      new Error("东方财富停复牌 HTTP 503"),
    );

    const result = await checkDataSourceHealth(deps);

    expect(result.status).toBe("unavailable");
    expect(result.items.filter((item) => item.status === "available"))
      .toHaveLength(6);
    expect(
      result.items.find((item) => item.id === "eastmoney_suspensions"),
    ).toMatchObject({
      status: "unavailable",
      detail: "东方财富停复牌 HTTP 503",
    });
    expect(
      result.items.find((item) => item.id === "baidu_suspensions"),
    ).toMatchObject({ status: "available" });
  });

  it("行情源空样本视为不可用，不能把请求成功冒充为数据可用", async () => {
    const deps = dependencies();
    vi.mocked(deps.fetchTencentPrices).mockResolvedValueOnce({
      rows: [],
      provenance: PROVENANCE,
    });

    const result = await checkDataSourceHealth(deps);

    expect(result.status).toBe("unavailable");
    expect(result.items.find((item) => item.id === "tencent_market"))
      .toMatchObject({
        status: "unavailable",
        detail: "腾讯不复权日线未返回样本区间数据",
      });
  });
});
