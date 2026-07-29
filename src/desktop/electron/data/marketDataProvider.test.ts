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
    fetchPrices: vi.fn(async () => [
      { date: "2026-07-27", close },
      { date: "2026-07-28", close: close + 0.1 },
    ]),
    fetchAdjustedBars: vi.fn(async () => [
      {
        date: "2026-07-28",
        open: close,
        high: close + 0.2,
        low: close - 0.1,
        close: close + 0.1,
        volume: 100,
        adjustment: "qfq" as const,
      },
    ]),
  };
}

describe("腾讯主源与新浪整段兜底", () => {
  it("两个来源均合法返回空区间时保留空结果而不是报数据源失败", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce([]);
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce([]);
    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-02-15",
      "2026-02-23",
      primary,
      fallback,
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
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce([]);
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-01-01",
        "2026-07-28",
        primary,
        fallback,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow("无法证明请求区间没有交易数据");
  });

  it("腾讯结构异常且新浪返回空时拒绝生成永久空覆盖", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce([
      { date: "not-a-date", close: 5 },
    ]);
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce([]);
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-07-27",
        "2026-07-28",
        primary,
        fallback,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow("无法证明请求区间没有交易数据");
  });

  it("两源均空但区间包含正常交易日时保持待重试而不是确认休市", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce([]);
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce([]);
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-07-27",
        "2026-07-28",
        primary,
        fallback,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow("独立交易日历不能确认");
  });

  it("异常候选行情不能被备用源空结果掩盖为合法休市区间", async () => {
    const primary = provider("tencent", 5);
    const fallback = provider("sina", 5);
    vi.mocked(primary.fetchPrices).mockResolvedValueOnce([
      { date: "2026-07-28", close: -1 },
    ]);
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce([]);
    await expect(
      fetchWithProviderFallback(
        "prices",
        "601398",
        "2026-07-28",
        "2026-07-28",
        primary,
        fallback,
        new Date("2026-07-28T08:00:00Z"),
      ),
    ).rejects.toThrow("无法验证腾讯的异常候选行情");
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
    vi.mocked(fallback.fetchPrices).mockResolvedValueOnce([
      { date: "2026-07-27", close: 5 },
      { date: "2026-07-28", close: 5.1 },
      { date: "2026-07-29", close: 5.2 },
    ]);

    const result = await fetchWithProviderFallback(
      "prices",
      "601398",
      "2026-07-27",
      "2026-07-29",
      primary,
      fallback,
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
    vi.mocked(primary.fetchAdjustedBars).mockImplementationOnce(async () => [
      {
        date: "2026-07-28",
        open: 5,
        high: 5.2,
        low: 4.9,
        close: 5.1,
        volume: -1,
        adjustment: "qfq",
      },
    ]);
    const fallback = provider("sina", 6);

    await expect(
      fetchWithProviderFallback(
        "bars",
        "601398",
        "2026-07-27",
        "2026-07-28",
        primary,
        fallback,
        new Date("2026-07-28T08:00:00Z"),
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
