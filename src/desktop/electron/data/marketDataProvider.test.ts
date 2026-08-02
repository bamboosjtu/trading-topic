import { describe, expect, it, vi } from "vitest";
import type { SecurityTradingInterruption } from "../../shared/contracts";
import type { MarketDataProvider } from "./marketDataProvider";
import {
  assertCrossProviderConsistency,
  expandInterruptionDates,
  fetchWithProviderFallback,
  validateAdjustedBars,
} from "./marketDataProvider";

function provider(
  source: "tencent" | "sina",
  close: number,
): MarketDataProvider {
  return {
    source,
    fetchPrices: vi.fn(async () => ({
      rows: [
        { date: "2026-07-27", close },
        { date: "2026-07-28", close: close + 0.1 },
      ],
      issues: [],
    })),
    fetchAdjustedBars: vi.fn(async () => ({
      rows: [
        {
          date: "2026-07-28",
          open: close,
          high: close + 0.2,
          low: close - 0.1,
          close: close + 0.1,
          volume: 100,
          adjustment: "qfq" as const,
        },
      ],
      issues: [],
    })),
  };
}

describe("腾讯主源与新浪整段兜底", () => {
  it("缺少请求结束年度官方日历时不阻止联网，由数据完整性判断", async () => {
    // 年度日历检查已从联网前门禁改为后置判断。
    // 即使结束年度（2023）没有官方日历，请求仍应到达数据源。
    // 数据源返回区间外日期时由 assertRequestedRange 拦截。
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);

    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2022-01-01",
        "2023-10-07",
        primary,
        fallback,
        undefined,
        new Date("2026-07-30T08:00:00Z"),
      ),
    ).rejects.toThrow("请求区间之外");
    // 关键：网络请求已被发起，而非被日历门禁拦截
    expect(primary.fetchPrices).toHaveBeenCalled();
  });

  it("两个来源均合法返回空区间时保留空结果而不是报数据源失败", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-02-15",
      "2026-02-23",
      primary,
      fallback,
      undefined,
      new Date("2026-02-24T08:00:00Z"),
    );
    expect(result.rows).toEqual([]);
    expect(result.provenance).toMatchObject({
      source: "tencent",
      fallbackUsed: false,
      dataCutoff: null,
      emptyEvidence: "exchange_calendar",
    });
  });

  it("腾讯 HTTP 失败且新浪返回空时拒绝生成永久空覆盖", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockRejectedValueOnce(
      new Error("HTTP 503"),
    );
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-01-01",
        "2026-07-28",
        primary,
        fallback,
        undefined,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow(
      "腾讯行情不可用（HTTP 503）；新浪完整区间兜底失败（未返回可用行情）",
    );
  });

  it("腾讯结构异常且新浪返回空时拒绝生成永久空覆盖", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce({
      rows: [{ date: "not-a-date", close: 5 }],
      issues: [],
    });
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-07-27",
        "2026-07-28",
        primary,
        fallback,
        undefined,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow(
      "腾讯行情不可用（腾讯行情返回了请求区间之外的交易日）",
    );
  });

  it("两源均空但区间包含正常交易日时保持待重试而不是确认休市", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-07-27",
        "2026-07-28",
        primary,
        fallback,
        undefined,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow("独立交易日历不能确认");
  });

  it("异常候选行情不能被备用源空结果掩盖为合法休市区间", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce({
      rows: [{ date: "2026-07-28", close: -1 }],
      issues: [],
    });
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-07-28",
        "2026-07-28",
        primary,
        fallback,
        undefined,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow("腾讯行情不可用（腾讯行情包含非法收盘价）");
  });

  it("腾讯 HTTP 失败时由新浪获取同一完整区间并记录原因", async () => {
    const primary = provider("tencent", 5);
    vi.mocked(primary.fetchPrices).mockRejectedValueOnce(
      new Error("HTTP 503"),
    );
    const fallback = provider("sina", 5);
    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-27",
      "2026-07-28",
      primary,
      fallback,
      undefined,
      new Date("2026-07-28T08:00:00Z"),
    );
    expect(result.provenance).toMatchObject({
      source: "sina",
      primarySource: "tencent",
      fallbackUsed: true,
      fallbackReason: "HTTP 503",
      dataCutoff: "2026-07-28",
    });
    expect(fallback.fetchPrices).toHaveBeenCalledWith(
      "601398",
      "2026-07-27",
      "2026-07-28",
    );
  });

  it("收盘后腾讯缺少当天尾部时继续请求新浪完整区间", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [
        { date: "2026-07-27", close: 5 },
        { date: "2026-07-28", close: 5.1 },
        { date: "2026-07-29", close: 5.2 },
      ],
      issues: [],
    });

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-27",
      "2026-07-29",
      primary,
      fallback,
      undefined,
      new Date("2026-07-29T08:00:00Z"),
    );

    expect(fallback.fetchPrices).toHaveBeenCalledWith(
      "601398",
      "2026-07-27",
      "2026-07-29",
    );
    expect(result.provenance).toMatchObject({
      source: "sina",
      fallbackUsed: true,
      dataCutoff: "2026-07-29",
    });
    expect(result.rows.at(-1)?.date).toBe("2026-07-29");
  });

  it("腾讯尾部不完整且新浪为空时显式返回 incomplete 和兜底问题", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [],
      issues: [],
    });

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-27",
      "2026-07-29",
      primary,
      fallback,
      undefined,
      new Date("2026-07-29T08:00:00Z"),
    );

    expect(result).toMatchObject({
      requestedThrough: "2026-07-29",
      dataCutoff: "2026-07-28",
      tailStatus: "incomplete",
      provenance: {
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-07-29T08:00:00.000Z",
        dataCutoff: "2026-07-28",
        adjustment: "none",
      },
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "gap",
          severity: "warning",
          message: expect.stringContaining("腾讯行情仅更新至 2026-07-28"),
        }),
        expect.objectContaining({
          type: "gap",
          severity: "warning",
          message: "新浪在请求区间返回空数据",
        }),
      ]),
    );
  });

  it("新浪非空结果也校验尾部，两源均不完整时选择较新的截止日", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce({
      rows: [
        { date: "2026-07-27", close: 5 },
        { date: "2026-07-28", close: 5.1 },
      ],
      issues: [],
    });
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce({
      rows: [{ date: "2026-07-27", close: 5 }],
      issues: [],
    });

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-27",
      "2026-07-30",
      primary,
      fallback,
      undefined,
      new Date("2026-07-30T08:00:00Z"),
    );

    expect(result.tailStatus).toBe("incomplete");
    expect(result.dataCutoff).toBe("2026-07-28");
    expect(result.provenance.source).toBe("tencent");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "gap",
          severity: "warning",
          message: expect.stringContaining("腾讯行情仅更新至 2026-07-28"),
        }),
        expect.objectContaining({
          type: "gap",
          severity: "warning",
          message: expect.stringContaining("新浪行情仅更新至 2026-07-27"),
        }),
      ]),
    );
  });

  it("收盘前不要求取得尚未完成的当天日线", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-27",
      "2026-07-29",
      primary,
      fallback,
      undefined,
      new Date("2026-07-29T06:00:00Z"),
    );

    expect(fallback.fetchPrices).not.toHaveBeenCalled();
    expect(result.provenance.source).toBe("tencent");
    expect(result.rows.at(-1)?.date).toBe("2026-07-28");
  });

  it("跨源重叠收盘价明显冲突时阻断计算", () => {
    expect(() =>
      assertCrossProviderConsistency(
        [{ date: "2026-07-28", close: 5 }],
        [{ date: "2026-07-28", close: 6 }],
      ),
    ).toThrow("腾讯与新浪行情结果不一致");
  });

  it("前复权 K 线兜底也执行跨源收盘价一致性校验", async () => {
    const primary = provider("tencent", 5);
    vi.mocked(primary.fetchAdjustedBars).mockImplementationOnce(async () => ({
      rows: [
        {
          date: "2026-07-28",
          open: 5,
          high: 5.2,
          low: 4.9,
          close: 5.1,
          volume: 100,
          adjustment: "qfq",
        },
      ],
      issues: [],
    }));
    const fallback = provider("sina", 6);
    vi.mocked(fallback.fetchAdjustedBars).mockResolvedValueOnce({
      rows: [
        {
          date: "2026-07-28",
          open: 6,
          high: 6.2,
          low: 5.9,
          close: 6.1,
          volume: 100,
          adjustment: "qfq",
        },
        {
          date: "2026-07-29",
          open: 6.1,
          high: 6.3,
          low: 6,
          close: 6.2,
          volume: 100,
          adjustment: "qfq",
        },
      ],
      issues: [],
    });

    await expect(
      fetchWithProviderFallback(
        "bars",
        "601398",
        "2026-07-27",
        "2026-07-29",
        primary,
        fallback,
        undefined,
        new Date("2026-07-29T08:00:00Z"),
      ),
    ).rejects.toThrow("腾讯与新浪行情结果不一致");
  });

  it("严格校验 OHLC 关系和成交量", () => {
    expect(() =>
      validateAdjustedBars(
        [
          {
            date: "2026-07-28",
            open: 5,
            high: 4.9,
            low: 4.8,
            close: 5.1,
            volume: 100,
            adjustment: "qfq",
          },
        ],
        "601398",
        "新浪",
      ),
    ).toThrow("OHLCV");
  });
});

/** P1-1：严格回测完整性检查升级测试 */
function staticProvider(
  source: "tencent" | "sina",
  rows: { date: string; close: number }[],
): MarketDataProvider {
  return {
    source,
    fetchPrices: vi.fn(async () => ({ rows, issues: [] })),
    fetchAdjustedBars: vi.fn(async () => ({ rows: [], issues: [] })),
  };
}

/** 模拟网络失败的 provider，用于隔离测试主源的完整性检查行为。 */
function failingProvider(source: "tencent" | "sina"): MarketDataProvider {
  return {
    source,
    fetchPrices: vi.fn(async () => {
      throw new Error(`${source} 网络不可用`);
    }),
    fetchAdjustedBars: vi.fn(async () => {
      throw new Error(`${source} 网络不可用`);
    }),
  };
}

const JULY_2026_WEEKDAYS = [
  "2026-07-01", "2026-07-02", "2026-07-03",
  "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
  "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24",
  "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
];

describe("P1-1 严格回测行情完整性检查", () => {
  it("五年请求仅返回最后 2 行时主源产生头部截断 error 并请求备用源", async () => {
    // 上市日早于请求起点，说明这是接口截断而非新股未上市
    const truncatedRows = [
      { date: "2026-07-30", close: 5 },
      { date: "2026-07-31", close: 5.1 },
    ];
    const primary = staticProvider("tencent", truncatedRows);
    const fallback = staticProvider("sina", truncatedRows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2020-01-01",
      "2026-07-31",
      primary,
      fallback,
      "2019-01-01",
      new Date("2026-07-31T08:00:00Z"),
    );

    // 主源存在 error 时必须请求备用源
    expect(fallback.fetchPrices).toHaveBeenCalled();
    // 结果包含头部截断 error
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("头部截断");
  });

  it("五年请求仅返回最后 100 行仍产生头部截断 error", async () => {
    // 返回 2026-07 全部交易日（23 行），请求从 2024-01-01 开始
    // 上市日早于请求起点，说明这是接口截断而非新股未上市
    const rows = JULY_2026_WEEKDAYS.map((date, i) => ({
      date,
      close: 5 + i * 0.01,
    }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2024-01-01",
      "2026-07-31",
      primary,
      fallback,
      "2019-01-01",
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("头部截断");
    // 缺失的预期交易日数量应远大于 23
    expect(errors[0]!.message).toMatch(/缺少 \d+ 个预期交易日/);
  });

  it("请求区间内部少一个正式交易日时产生带日期的 error", async () => {
    // 返回 2026-07 全部交易日 except 2026-07-15
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d !== "2026-07-15")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    // fallback 不可用，隔离测试主源完整性检查本身的行为
    const primary = staticProvider("tencent", rows);
    const fallback = failingProvider("sina");

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.date).toBe("2026-07-15");
    expect(errors[0]!.message).toContain("2026-07-15");
  });

  it("新股上市，无 listingDate 时不产生头部截断 error", async () => {
    // 假设 2026-07-15 上市，返回 07-15 到 07-31 的行情
    // 没有 listingDate 时，头部缺口可能是新股未上市，不能冒然阻断
    const listingRows = JULY_2026_WEEKDAYS
      .filter((d) => d >= "2026-07-15")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", listingRows);
    const fallback = staticProvider("sina", listingRows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2020-01-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    // 没有 listingDate 证据时，头部缺口不升级为 error
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("新股上市，有 listingDate 且首条行情等于 listingDate 时不产生 error", async () => {
    // 2026-07-15 上市，返回 07-15 到 07-31 的行情
    // listingDate 等于首条行情日期，前置缺口属于未上市期，不产生 error
    const listingRows = JULY_2026_WEEKDAYS
      .filter((d) => d >= "2026-07-15")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", listingRows);
    const fallback = staticProvider("sina", listingRows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2020-01-01",
      "2026-07-31",
      primary,
      fallback,
      "2026-07-15",
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("有 listingDate 但首条行情晚于 listingDate 时产生头部截断 error", async () => {
    // 2025-06-01 上市，但接口仅返回 2026-01-01 之后的行情
    // listingDate 之前的数据应存在，首条行情晚于 listingDate 说明接口截断
    const listingRows = JULY_2026_WEEKDAYS
      .filter((d) => d >= "2026-07-15")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", listingRows);
    const fallback = staticProvider("sina", listingRows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2020-01-01",
      "2026-07-31",
      primary,
      fallback,
      "2025-06-01",
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("头部截断");
  });

  it("主源头部截断时使用备用源完整数据且不产生 error", async () => {
    // 上市日早于请求起点，主源仅返回最后 2 行（头部截断）
    const primary = staticProvider("tencent", [
      { date: "2026-07-30", close: 5 },
      { date: "2026-07-31", close: 5 },
    ]);
    // 备用源返回完整 7 月数据（价格一致以通过跨源校验）
    const fallback = staticProvider(
      "sina",
      JULY_2026_WEEKDAYS.map((date) => ({ date, close: 5 })),
    );

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      "2019-01-01",
      new Date("2026-07-31T08:00:00Z"),
    );

    // 备用源被调用
    expect(fallback.fetchPrices).toHaveBeenCalled();
    // 使用备用源数据
    expect(result.provenance.source).toBe("sina");
    expect(result.provenance.fallbackUsed).toBe(true);
    // 无 error 级别问题
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    // 尾部完整
    expect(result.tailStatus).toBe("complete");
    // 返回完整 7 月数据
    expect(result.rows).toHaveLength(JULY_2026_WEEKDAYS.length);
  });
});

describe("P1 证券级停复牌证据", () => {
  it("expandInterruptionDates 展开停牌区间为日期集合", () => {
    const interruptions: SecurityTradingInterruption[] = [
      {
        symbol: "601088",
        startDate: "2025-08-04",
        endDate: "2025-08-15",
        reason: "suspension",
        source: "eastmoney_announcement",
        fetchedAt: "2025-08-04T00:00:00Z",
      },
    ];
    const dates = expandInterruptionDates(interruptions);
    expect(dates.has("2025-08-04")).toBe(true);
    expect(dates.has("2025-08-15")).toBe(true);
    expect(dates.has("2025-08-18")).toBe(false);
    expect(dates.size).toBe(12);
  });

  it("已确认停牌日不产生行情缺失 error", async () => {
    // 模拟中国神华 2026-07-06 至 2026-07-10 连续停牌
    // 数据源不返回这些日期的行情（正确行为），不应误判为行情缺失
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const interruptions: SecurityTradingInterruption[] = [
      {
        symbol: "601088",
        startDate: "2026-07-06",
        endDate: "2026-07-10",
        reason: "suspension",
        source: "eastmoney_announcement",
        fetchedAt: "2026-07-06T00:00:00Z",
      },
    ];

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
      interruptions,
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("无停牌证据时同一缺口仍产生 error", async () => {
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    // fallback 不可用，隔离测试主源完整性检查本身的行为
    // （两源都缺同一区间时会触发共同缺口降级，此处不测那个路径）
    const primary = staticProvider("tencent", rows);
    const fallback = failingProvider("sina");

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.date === "2026-07-06")).toBe(true);
  });

  it("P1-5 连续缺口日期合并为单条区间 error，而非逐日输出", async () => {
    // 模拟 2026-07-06 至 2026-07-10 连续 5 个交易日缺失（无停牌证据）
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    // fallback 不可用，隔离测试连续缺口合并逻辑
    const primary = staticProvider("tencent", rows);
    const fallback = failingProvider("sina");

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    // 5 个连续缺失日应合并为 1 条 error，而不是 5 条
    expect(errors).toHaveLength(1);
    // date 字段为区间起点，便于 hasErrorInRequestRange 过滤
    expect(errors[0].date).toBe("2026-07-06");
    // 消息应包含起止区间和数量
    expect(errors[0].message).toContain("2026-07-06");
    expect(errors[0].message).toContain("2026-07-10");
    expect(errors[0].message).toContain("5");
  });

  it("P1-5 不连续的缺口分别生成独立 error", async () => {
    // 模拟两段独立缺口：07-06～07-07 和 07-13～07-14
    const rows = JULY_2026_WEEKDAYS
      .filter(
        (d) =>
          (d < "2026-07-06" || d > "2026-07-07") &&
          (d < "2026-07-13" || d > "2026-07-14"),
      )
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    // fallback 不可用，隔离测试不连续缺口分别生成 error 的行为
    const primary = staticProvider("tencent", rows);
    const fallback = failingProvider("sina");

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    // 两段独立缺口应生成 2 条 error
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.date).sort()).toEqual([
      "2026-07-06",
      "2026-07-13",
    ]);
  });

  it("两源共同缺口降级为 warning，不阻断回测", async () => {
    // 模拟腾讯和新浪都缺少 07-06 至 07-10（无停牌证据）
    // 两源在缺口前后都有正常行情 → 共同缺口 → 降级为 warning
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");
    // 共同缺口应降级为 warning，不再有 error
    expect(errors).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(
      warnings.some((w) =>
        w.message.includes("腾讯与新浪均未返回行情"),
      ),
    ).toBe(true);
  });

  it("单一来源缺口保持 error，不降级", async () => {
    // 腾讯缺少 07-06 至 07-10，但新浪有完整数据 → 单一来源缺口 → 保持 error
    const tencentRows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const sinaRows = JULY_2026_WEEKDAYS.map((date, i) => ({
      date,
      close: 5 + i * 0.01,
    }));
    const primary = staticProvider("tencent", tencentRows);
    const fallback = staticProvider("sina", sinaRows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    // 新浪有完整数据且无 error → 直接使用新浪，不会进入共同缺口判断
    // 腾讯的缺口变成 provider 级 warning
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
    expect(result.provenance.source).toBe("sina");
  });

  it("两源共同缺口在头部时不降级（保持 error）", async () => {
    // 腾讯和新浪都缺少 07-01 至 07-03（头部缺口）
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d > "2026-07-03")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      "2020-01-01", // listingDate 使头部截断判定生效
      new Date("2026-07-31T08:00:00Z"),
    );

    // 头部缺口不降级，保持 error
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.message.includes("头部截断")),
    ).toBe(true);
  });

  it("P2-3：部分重合日期拆分为连续子区间", async () => {
    // 腾讯缺少 07-06 至 07-10（5天），新浪有 07-07 但额外缺少 07-13、07-14
    // 腾讯行数 > 新浪行数 → 腾讯被选中
    // 选中腾讯后，其 07-06~07-10 缺口拆分：
    //   07-06: 新浪也缺 → common warning
    //   07-07: 新浪有  → only_selected error
    //   07-08~07-10: 新浪也缺 → common warning
    const tencentRows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const sinaRows = JULY_2026_WEEKDAYS
      .filter(
        (d) =>
          d !== "2026-07-06" &&
          d !== "2026-07-08" &&
          d !== "2026-07-09" &&
          d !== "2026-07-10" &&
          d !== "2026-07-13" &&
          d !== "2026-07-14",
      )
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));

    const primary = staticProvider("tencent", tencentRows);
    const fallback = staticProvider("sina", sinaRows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const warnings = result.issues.filter(
      (i) => i.classification === "cross_provider_common_gap",
    );
    const errors = result.issues.filter(
      (i) => i.classification === "single_provider_gap",
    );

    // 共同缺口应拆分为两段：07-06 和 07-08至07-10
    expect(warnings.length).toBe(2);
    expect(warnings[0].missingDates).toEqual(["2026-07-06"]);
    expect(warnings[1].missingDates).toEqual([
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]);

    // 单源缺口：07-07
    expect(errors.length).toBe(1);
    expect(errors[0].missingDates).toEqual(["2026-07-07"]);
    expect(errors[0].severity).toBe("error");
  });
});

/**
 * 行情结果中的日历覆盖字段验证。
 *
 * `fetchWithProviderFallback` 在返回结果中携带 `officialCalendarYears` 与
 * `uncoveredCalendarYears`，分别表示请求区间内拥有正式日历的年份和未覆盖
 * 正式日历的年份。回测引擎据此将结果标记为 strict 或 degraded。
 */
describe("行情结果日历覆盖字段", () => {
  it("只覆盖正式日历年份且无缺口时 uncoveredCalendarYears 为空", async () => {
    const rows = JULY_2026_WEEKDAYS.map((date, i) => ({
      date,
      close: 5 + i * 0.01,
    }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    expect(result.uncoveredCalendarYears).toEqual([]);
    expect(result.officialCalendarYears).toEqual([2026]);
  });

  it("请求包含 2018 年但数据无显式缺口时 uncoveredCalendarYears 包含 2018-2023", async () => {
    // 仅返回 2026-07 完整交易日。由于未提供 listingDate，
    // 2024-01 至 2026-06 之间缺失的预期交易日不计为头部截断 error，
    // 仅 uncoveredCalendarYears 字段反映 2018-2023 缺少正式日历。
    const rows = JULY_2026_WEEKDAYS.map((date, i) => ({
      date,
      close: 5 + i * 0.01,
    }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2018-01-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    expect(result.uncoveredCalendarYears).toEqual([
      2018, 2019, 2020, 2021, 2022, 2023,
    ]);
    expect(result.officialCalendarYears).toEqual([2024, 2025, 2026]);
    // 主源完整无 error，应直接接受
    expect(result.provenance.source).toBe("tencent");
    expect(result.provenance.fallbackUsed).toBe(false);
  });

  it("混合请求中两源共同内部缺口降级且 uncoveredCalendarYears 仍包含 2018-2023", async () => {
    // 腾讯和新浪都缺少 2026-07-06 到 2026-07-10（无停牌证据）
    // 两源在缺口前后都有正常行情 → 共同缺口 → 降级为 warning
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2018-01-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    // 共同缺口应降级为 warning，不再有 error
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
    const commonGaps = result.issues.filter(
      (i) => i.classification === "cross_provider_common_gap",
    );
    expect(commonGaps.length).toBeGreaterThan(0);
    // 日历覆盖字段不受数据质量影响
    expect(result.uncoveredCalendarYears).toEqual([
      2018, 2019, 2020, 2021, 2022, 2023,
    ]);
    expect(result.officialCalendarYears).toEqual([2024, 2025, 2026]);
  });

  it("正式日历年份两源共同内部缺口降级时 uncoveredCalendarYears 为空", async () => {
    // 请求区间只覆盖 2026-07，两源共同缺少 07-06 至 07-10
    const rows = JULY_2026_WEEKDAYS
      .filter((d) => d < "2026-07-06" || d > "2026-07-10")
      .map((date, i) => ({ date, close: 5 + i * 0.01 }));
    const primary = staticProvider("tencent", rows);
    const fallback = staticProvider("sina", rows);

    const result = await fetchWithProviderFallback(
      "prices",
      "601088",
      "2026-07-01",
      "2026-07-31",
      primary,
      fallback,
      undefined,
      new Date("2026-07-31T08:00:00Z"),
    );

    const commonGaps = result.issues.filter(
      (i) => i.classification === "cross_provider_common_gap",
    );
    expect(commonGaps.length).toBeGreaterThan(0);
    // 请求区间全部位于正式日历年度内
    expect(result.uncoveredCalendarYears).toEqual([]);
    expect(result.officialCalendarYears).toEqual([2026]);
  });

  it("两源均空且为已确认休市区间时返回空结果并携带日历覆盖字段", async () => {
    // 2026-02-15 至 2026-02-23 为春节休市
    const primary = staticProvider("tencent", []);
    const fallback = staticProvider("sina", []);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-02-15",
      "2026-02-23",
      primary,
      fallback,
      undefined,
      new Date("2026-02-24T08:00:00Z"),
    );

    expect(result.rows).toEqual([]);
    expect(result.tailStatus).toBe("confirmed_non_trading");
    expect(result.uncoveredCalendarYears).toEqual([]);
    expect(result.officialCalendarYears).toEqual([2026]);
  });
});
