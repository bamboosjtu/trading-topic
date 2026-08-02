import { describe, expect, it, vi } from "vitest";
import type { MarketDataProvider } from "./marketDataProvider";
import {
  assertCrossProviderConsistency,
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
