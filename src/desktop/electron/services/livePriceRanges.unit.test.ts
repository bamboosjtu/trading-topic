import { describe, expect, it } from "vitest";
import type { StoredMarketCoverage } from "../../shared/contracts";
import {
  confirmedCoverageThrough,
  normalizeLivePriceRanges,
} from "./livePriceRanges";

describe("实盘行情请求区间", () => {
  it("按证券合并重叠和同日首尾相接的区间", () => {
    expect(
      normalizeLivePriceRanges([
        { symbol: "601398", startDate: "2026-06-10", endDate: "2026-06-30" },
        { symbol: "600000", startDate: "2026-06-01", endDate: "2026-06-05" },
        { symbol: "601398", startDate: "2026-06-01", endDate: "2026-06-10" },
        { symbol: "601398", startDate: "2026-06-05", endDate: "2026-06-07" },
      ]),
    ).toEqual([
      { symbol: "601398", startDate: "2026-06-01", endDate: "2026-06-30" },
      { symbol: "600000", startDate: "2026-06-01", endDate: "2026-06-05" },
    ]);
  });

  it("partial 不确认覆盖，完整数据和有日历证据的空区间确认到请求末日", () => {
    const base: StoredMarketCoverage = {
      coverageId: 1,
      symbol: "601398",
      requestedFrom: "2026-06-01",
      requestedThrough: "2026-06-30",
      source: "tencent",
      primarySource: "tencent",
      fallbackUsed: false,
      fetchedAt: "2026-07-01T00:00:00.000Z",
      dataCutoff: "2026-06-30",
      adjustment: "none",
      resultStatus: "data",
      issues: [],
    };

    expect(confirmedCoverageThrough(base)).toBe("2026-06-30");
    expect(
      confirmedCoverageThrough({
        ...base,
        resultStatus: "partial",
        issues: [
          {
            type: "gap",
            severity: "error",
            message: "测试缺口",
          },
        ],
      }),
    ).toBeNull();
    expect(
      confirmedCoverageThrough({
        ...base,
        dataCutoff: null,
        resultStatus: "empty",
        emptyEvidence: "exchange_calendar",
      }),
    ).toBe("2026-06-30");
  });
});
