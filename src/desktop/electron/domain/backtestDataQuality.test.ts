import { describe, expect, it } from "vitest";
import type { BacktestDataQuality, MarketDataIssue } from "../../shared/contracts";
import {
  aggregateBacktestDataQuality,
  assertBacktestDataQuality,
  backtestDataQualityFromMarketEvidence,
  strictBacktestDataQuality,
} from "./backtestDataQuality";

describe("回测数据质量", () => {
  it("按行情异常和日历覆盖生成三级质量状态", () => {
    expect(strictBacktestDataQuality()).toEqual({
      level: "strict",
      reasons: [],
      officialCalendarYears: [],
      uncoveredCalendarYears: [],
    });

    expect(
      backtestDataQualityFromMarketEvidence([], [2024, 2025, 2026], [2023]),
    ).toEqual({
      level: "research",
      reasons: ["calendar_coverage_partial"],
      officialCalendarYears: [2024, 2025, 2026],
      uncoveredCalendarYears: [2023],
    });

    const commonGap: MarketDataIssue = {
      date: "2026-07-06",
      type: "gap",
      severity: "warning",
      classification: "cross_provider_common_gap",
      message: "两源共同缺口",
    };
    expect(
      backtestDataQualityFromMarketEvidence(
        [commonGap],
        [2024, 2025, 2026],
        [2023],
      ),
    ).toEqual({
      level: "degraded",
      reasons: [
        "cross_provider_common_gap",
        "calendar_coverage_partial",
      ],
      officialCalendarYears: [2024, 2025, 2026],
      uncoveredCalendarYears: [2023],
    });
  });

  it("多标的聚合遵循 degraded > research > strict 并合并年份", () => {
    expect(aggregateBacktestDataQuality([])).toEqual(
      strictBacktestDataQuality(),
    );
    const qualities: BacktestDataQuality[] = [
      {
        level: "research",
        reasons: ["calendar_coverage_partial"],
        officialCalendarYears: [2025, 2026],
        uncoveredCalendarYears: [2023, 2024],
      },
      {
        level: "degraded",
        reasons: ["cross_provider_common_gap"],
        officialCalendarYears: [2024, 2025],
        uncoveredCalendarYears: [],
      },
    ];

    expect(aggregateBacktestDataQuality(qualities)).toEqual({
      level: "degraded",
      reasons: [
        "cross_provider_common_gap",
        "calendar_coverage_partial",
      ],
      officialCalendarYears: [2024, 2025, 2026],
      uncoveredCalendarYears: [2023, 2024],
    });
  });

  it("拒绝缺失或自相矛盾的数据质量结构", () => {
    expect(() => assertBacktestDataQuality(undefined)).toThrow(
      "回测数据质量结构非法",
    );
    expect(() =>
      assertBacktestDataQuality({
        level: "research",
        reasons: [],
        officialCalendarYears: [2026],
        uncoveredCalendarYears: [],
      }),
    ).toThrow(
      "回测数据质量 research 等级必须包含 calendar_coverage_partial",
    );
  });
});
