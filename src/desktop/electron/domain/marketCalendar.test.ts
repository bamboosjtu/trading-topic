import { describe, expect, it } from "vitest";
import {
  isConfirmedMarketClosureDate,
  isConfirmedMarketClosureRange,
  latestCompletedTradingDate,
  latestTradingDateInMonth,
  latestWeekdayCandidate,
  tradeDateStatus,
} from "./marketCalendar";

describe("正式收盘日边界", () => {
  const calendar = [
    "2026-07-24",
    "2026-07-27",
    "2026-07-28",
    "2026-07-31",
  ];

  it("交易日收盘前使用上一交易日，收盘缓冲后使用当日", () => {
    expect(
      latestCompletedTradingDate(
        new Date("2026-07-28T06:30:00Z"),
        calendar,
      ),
    ).toBe("2026-07-27");
    expect(
      latestCompletedTradingDate(
        new Date("2026-07-28T07:11:00Z"),
        calendar,
      ),
    ).toBe("2026-07-28");
  });

  it("周末和历史月份使用最近有效交易日", () => {
    expect(
      latestCompletedTradingDate(
        new Date("2026-08-01T08:00:00Z"),
        calendar,
      ),
    ).toBe("2026-07-31");
    expect(latestTradingDateInMonth("2026-07", calendar)).toBe("2026-07-31");
  });

  it("独立交易日历确认春节、国庆和调休周末均为休市日", () => {
    const context = {
      knownTradingDates: ["2026-02-24", "2026-10-08"],
      coveredRanges: [
        { startDate: "2026-02-15", endDate: "2026-02-24" },
        { startDate: "2026-10-01", endDate: "2026-10-08" },
      ],
    };
    expect(tradeDateStatus("2026-02-23", context)).toBe("closed");
    expect(tradeDateStatus("2026-02-24", context)).toBe("trading");
    expect(tradeDateStatus("2026-10-07", context)).toBe("closed");
    expect(tradeDateStatus("2026-10-08", context)).toBe("trading");
    expect(tradeDateStatus("2026-02-28", context)).toBe("closed");
  });

  it("证券自身覆盖区间没有价格行时不冒充市场休市", () => {
    const context = {
      knownTradingDates: [],
      coveredRanges: [
        { startDate: "2026-07-27", endDate: "2026-07-28" },
      ],
    };
    expect(tradeDateStatus("2026-07-27", context)).toBe("unknown");
    expect(isConfirmedMarketClosureRange("2026-02-15", "2026-02-23")).toBe(
      true,
    );
    expect(isConfirmedMarketClosureRange("2026-07-27", "2026-07-28")).toBe(
      false,
    );
  });

  it("识别 2024 至 2026 年官方法定休市日", () => {
    expect(isConfirmedMarketClosureDate("2024-02-09")).toBe(true);
    expect(isConfirmedMarketClosureDate("2025-02-03")).toBe(true);
    expect(isConfirmedMarketClosureDate("2026-10-07")).toBe(true);
    expect(isConfirmedMarketClosureDate("2025-02-05")).toBe(false);
  });

  it("官方安排未发布前不猜测 2027 年工作日休市", () => {
    expect(isConfirmedMarketClosureDate("2027-02-08")).toBe(false);
    expect(isConfirmedMarketClosureDate("2027-02-07")).toBe(true);
  });

  it("节假日期间的请求上界回退到最近候选交易日", () => {
    expect(
      latestWeekdayCandidate(new Date("2025-02-03T08:00:00Z")),
    ).toBe("2025-01-27");
    expect(
      isConfirmedMarketClosureRange("2025-01-28", "2025-02-04"),
    ).toBe(true);
  });
});
