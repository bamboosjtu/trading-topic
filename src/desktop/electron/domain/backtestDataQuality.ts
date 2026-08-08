import type {
  BacktestDataQuality,
  MarketDataIssue,
} from "../../shared/contracts";

const REASON_ORDER: BacktestDataQuality["reasons"] = [
  "cross_provider_common_gap",
  "calendar_coverage_partial",
];

export function assertBacktestDataQuality(
  value: unknown,
  label = "回测数据质量",
): asserts value is BacktestDataQuality {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}结构非法`);
  }
  const quality = value as BacktestDataQuality;
  if (!["strict", "research", "degraded"].includes(quality.level)) {
    throw new Error(`${label}等级非法`);
  }
  if (
    !Array.isArray(quality.reasons) ||
    quality.reasons.some((reason) => !REASON_ORDER.includes(reason))
  ) {
    throw new Error(`${label}降级原因非法`);
  }
  if (
    !Array.isArray(quality.officialCalendarYears) ||
    !Array.isArray(quality.uncoveredCalendarYears)
  ) {
    throw new Error(`${label}年份字段非法`);
  }
  for (const year of [
    ...quality.officialCalendarYears,
    ...quality.uncoveredCalendarYears,
  ]) {
    if (!Number.isInteger(year)) {
      throw new Error(`${label}年份必须为整数`);
    }
  }
  const officialYears = new Set(quality.officialCalendarYears);
  if (quality.uncoveredCalendarYears.some((year) => officialYears.has(year))) {
    throw new Error(`${label}年份不能同时属于已覆盖和未覆盖`);
  }
  if (quality.level === "strict" && quality.reasons.length > 0) {
    throw new Error(`${label} strict 等级不应有降级原因`);
  }
  const hasCalendarGap = quality.reasons.includes(
    "calendar_coverage_partial",
  );
  const hasCommonGap = quality.reasons.includes("cross_provider_common_gap");
  if (hasCalendarGap && quality.uncoveredCalendarYears.length === 0) {
    throw new Error(
      `${label} calendar_coverage_partial 需要有未覆盖年份`,
    );
  }
  if (quality.level === "research" && !hasCalendarGap) {
    throw new Error(
      `${label} research 等级必须包含 calendar_coverage_partial`,
    );
  }
  if (quality.level === "research" && hasCommonGap) {
    throw new Error(
      `${label} research 等级不应包含 cross_provider_common_gap`,
    );
  }
  if (quality.level === "degraded" && !hasCommonGap) {
    throw new Error(
      `${label} degraded 等级必须包含 cross_provider_common_gap`,
    );
  }
}

export function strictBacktestDataQuality(): BacktestDataQuality {
  return {
    level: "strict",
    reasons: [],
    officialCalendarYears: [],
    uncoveredCalendarYears: [],
  };
}

export function backtestDataQualityFromMarketEvidence(
  issues: readonly MarketDataIssue[],
  officialCalendarYears: readonly number[],
  uncoveredCalendarYears: readonly number[],
): BacktestDataQuality {
  const hasCommonGap = issues.some(
    (issue) =>
      issue.severity === "warning" &&
      issue.classification === "cross_provider_common_gap",
  );
  const hasCalendarCoverageGap = uncoveredCalendarYears.length > 0;

  return {
    level: hasCommonGap
      ? "degraded"
      : hasCalendarCoverageGap
        ? "research"
        : "strict",
    reasons: REASON_ORDER.filter(
      (reason) =>
        (reason === "cross_provider_common_gap" && hasCommonGap) ||
        (reason === "calendar_coverage_partial" &&
          hasCalendarCoverageGap),
    ),
    officialCalendarYears: [...officialCalendarYears],
    uncoveredCalendarYears: [...uncoveredCalendarYears],
  };
}

export function aggregateBacktestDataQuality(
  qualities: readonly BacktestDataQuality[],
): BacktestDataQuality {
  const levels = new Set(qualities.map((quality) => quality.level));
  const reasons = new Set(qualities.flatMap((quality) => quality.reasons));

  return {
    level: levels.has("degraded")
      ? "degraded"
      : levels.has("research")
        ? "research"
        : "strict",
    reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
    officialCalendarYears: [
      ...new Set(
        qualities.flatMap((quality) => quality.officialCalendarYears),
      ),
    ].sort((left, right) => left - right),
    uncoveredCalendarYears: [
      ...new Set(
        qualities.flatMap((quality) => quality.uncoveredCalendarYears),
      ),
    ].sort((left, right) => left - right),
  };
}
