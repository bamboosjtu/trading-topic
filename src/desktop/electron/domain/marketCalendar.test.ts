import { describe, expect, it } from "vitest";
import { BACKTEST_RANGE_YEARS } from "../../shared/constants";
import {
  expectedTradingDatesWithCoverage,
  isConfirmedMarketClosureDate,
  isConfirmedMarketClosureRange,
  latestCompletedTradingDate,
  latestTradingDateInMonth,
  latestWeekdayCandidate,
  marketCalendarDiagnostics,
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

  it("公开年度来源诊断：已发布年度 official、未发布年度待更新", () => {
    expect(
      marketCalendarDiagnostics().find((item) => item.year === 2026),
    ).toMatchObject({
      status: "official",
      source: expect.stringContaining("sse.com.cn"),
    });
    expect(
      marketCalendarDiagnostics().find((item) => item.year === 2027),
    ).toMatchObject({
      status: "pending_official_schedule",
      source: null,
    });
    expect(
      marketCalendarDiagnostics(
        new Date("2028-01-10T08:00:00Z"),
      ).find((item) => item.year === 2028),
    ).toEqual({
      year: 2028,
      status: "pending_official_schedule",
      source: null,
    });
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

describe("expectedTradingDatesWithCoverage", () => {
  // 当前仓库 market-calendar 仅 2024-2026 为 official，
  // 2027.json 状态为 pending_official_schedule，不计入 officialYears。
  it("2016—2026 请求返回 officialYears 包含 2024-2026，uncoveredYears 包含 2016-2023", () => {
    const coverage = expectedTradingDatesWithCoverage("2016-01-01", "2026-12-31");
    expect(coverage.officialYears).toEqual([2024, 2025, 2026]);
    expect(coverage.uncoveredYears).toEqual([
      2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
    ]);
  });

  /**
   * P0 回归：发布覆盖范围诊断。
   * 产品支持最大 15 年回测（BACKTEST_RANGE_YEARS 含 15）。
   * 当前年度 2026 时，严格日历要求起始年为 2026 - 15 = 2011（不是 2012）。
   * scripts/check-market-calendar.mjs 使用 `currentYearNum - maxBacktestYears`
   * 计算最小回测年度，本测试同时验证该算术结果与日历覆盖函数一致。
   */
  it("2026 年最大 15 年回测起始年为 2011（不是 2012）", () => {
    // 1. 直接验证脚本算术逻辑：currentYearNum - maxBacktestYears === 2011
    const currentYearNum = 2026;
    const maxBacktestYears = Math.max(...BACKTEST_RANGE_YEARS);
    expect(maxBacktestYears).toBe(15);
    const minBacktestYear = currentYearNum - maxBacktestYears;
    expect(minBacktestYear).toBe(2011);

    // 2. 验证日历覆盖函数：2011-01-01 至 2026-12-31 的请求中
    //    uncoveredYears 必须包含 2011（证明起始年是 2011 而非 2012）。
    const coverage = expectedTradingDatesWithCoverage("2011-01-01", "2026-12-31");
    expect(coverage.uncoveredYears).toContain(2011);
    // 完整未覆盖年份范围应为 2011-2023（正式日历仅 2024/2025/2026）
    expect(coverage.uncoveredYears).toEqual([
      2011, 2012, 2013, 2014, 2015,
      2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
    ]);
    expect(coverage.officialYears).toEqual([2024, 2025, 2026]);
  });

  it("只覆盖正式日历年份时 uncoveredYears 为空", () => {
    const coverage = expectedTradingDatesWithCoverage("2024-01-01", "2026-12-31");
    expect(coverage.uncoveredYears).toEqual([]);
    expect(coverage.officialYears).toEqual([2024, 2025, 2026]);
  });

  it("expectedTradingDates 只包含正式日历年份的交易日", () => {
    const coverage = expectedTradingDatesWithCoverage("2023-06-01", "2024-01-31");
    // 2023 没有 official 日历，不生成 expectedTradingDates
    // 2024-01 的交易日应包含
    expect(coverage.uncoveredYears).toContain(2023);
    expect(coverage.officialYears).toEqual([2024]);
    expect(coverage.expectedTradingDates.some((d) => d.startsWith("2023"))).toBe(false);
    expect(coverage.expectedTradingDates.some((d) => d.startsWith("2024"))).toBe(true);
  });

  it("请求区间仅含未覆盖年份时 officialYears 与 expectedTradingDates 均为空", () => {
    const coverage = expectedTradingDatesWithCoverage("2018-01-01", "2018-12-31");
    expect(coverage.officialYears).toEqual([]);
    expect(coverage.uncoveredYears).toEqual([2018]);
    expect(coverage.expectedTradingDates).toEqual([]);
  });

  it("非法区间返回空覆盖信息", () => {
    const coverage = expectedTradingDatesWithCoverage("2026-12-31", "2026-01-01");
    expect(coverage).toEqual({
      expectedTradingDates: [],
      officialYears: [],
      uncoveredYears: [],
    });
  });
});
