import { describe, expect, it } from "vitest";
import {
  latestCompletedTradingDate,
  latestTradingDateInMonth,
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

  it("行情覆盖可以确认春节、国庆和调休周末均为休市日", () => {
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
    // 春节调休上班日仍是周末，证券交易所不开市。
    expect(tradeDateStatus("2026-02-28", context)).toBe("closed");
  });
});
