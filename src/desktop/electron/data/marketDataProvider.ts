import type {
  AdjustedBar,
  MarketDataIssue,
  MarketFetchResult,
  MarketDataProvenance,
  MarketTailStatus,
  PricePoint,
} from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import {
  fetchAdjustedBars as fetchTencentAdjustedBars,
  fetchUnadjustedPrices as fetchTencentUnadjustedPrices,
} from "./tencent";
import {
  fetchSinaAdjustedBars,
  fetchSinaUnadjustedPrices,
} from "./sina";
import {
  assertValidMarketDateRange,
  expectedTradingDatesInRange,
  isConfirmedMarketClosureDate,
  isConfirmedMarketClosureRange,
  latestCompletedTradingDate,
  latestWeekdayCandidate,
} from "../domain/marketCalendar";
import {
  addDays,
  currentMarketDate,
  daysBetween,
  validDate,
} from "../domain/dateUtils";

/** 适配器返回的行级解析结果：有效行 + 解析期间发现的问题。 */
export interface ProviderFetchResult<T> {
  rows: T[];
  /** 行级解析问题，例如新浪丢弃了非法 OHLCV 行。 */
  issues: MarketDataIssue[];
}

export interface MarketDataProvider {
  readonly source: "tencent" | "sina";
  fetchPrices(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<ProviderFetchResult<PricePoint>>;
  fetchAdjustedBars(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<ProviderFetchResult<AdjustedBar>>;
}

export const tencentProvider: MarketDataProvider = {
  source: "tencent",
  async fetchPrices(symbol, startDate, endDate) {
    return {
      rows: (await fetchTencentUnadjustedPrices(symbol, startDate, endDate)).rows,
      issues: [],
    };
  },
  async fetchAdjustedBars(symbol, startDate, endDate) {
    return {
      rows: (await fetchTencentAdjustedBars(symbol, startDate, endDate)).rows,
      issues: [],
    };
  },
};

export const sinaProvider: MarketDataProvider = {
  source: "sina",
  fetchPrices: fetchSinaUnadjustedPrices,
  fetchAdjustedBars: fetchSinaAdjustedBars,
};

function assertDates(
  rows: readonly { date: string }[],
  label: string,
): void {
  let previous = "";
  for (const row of rows) {
    if (!validDate(row.date)) throw new Error(`${label}包含非法交易日期`);
    // P2-2：拒绝已确认的法定休市日（含周末和官方公告休市），
    // 避免供应商错误返回工作日休市日期时被当成交易日接受。
    if (isConfirmedMarketClosureDate(row.date)) {
      throw new Error(`${label}把非交易日 ${row.date} 标记为交易日`);
    }
    if (previous && row.date <= previous) {
      throw new Error(`${label}交易日期必须严格升序且不重复`);
    }
    if (previous && daysBetween(previous, row.date) > 120) {
      throw new Error(`${label}请求区间存在超过 120 天的异常行情缺口`);
    }
    previous = row.date;
  }
}

/**
 * P2-1：在拥有正式日历的年度中逐交易日核对行情完整性。
 * 返回 warning 级别问题，标记缺失的预期交易日。严格回测层会根据
 * 请求区间判断这些缺失是否落入回测范围并决定是否阻断。
 */
function detectDateCompletenessIssues(
  rows: readonly { date: string }[],
  label: string,
): MarketDataIssue[] {
  if (rows.length < 2) return [];
  const firstDate = rows[0]!.date;
  const lastDate = rows[rows.length - 1]!.date;
  const expected = expectedTradingDatesInRange(firstDate, lastDate);
  if (!expected.length) return [];
  const present = new Set(rows.map((row) => row.date));
  const issues: MarketDataIssue[] = [];
  for (const date of expected) {
    if (!present.has(date)) {
      issues.push({
        date,
        type: "gap",
        severity: "warning",
        message: `${label}在正式交易日历年度内缺少 ${date} 的行情`,
      });
    }
  }
  return issues;
}

export function validatePricePoints(
  rows: readonly PricePoint[],
  symbol: string,
  source: string,
): void {
  if (!/^\d{6}$/.test(symbol)) throw new Error("行情证券代码不合法");
  if (!rows.length) throw new Error(`${symbol} 未取得${source}不复权日线`);
  assertDates(rows, `${source}行情`);
  if (rows.some((row) => !Number.isFinite(row.close) || row.close <= 0)) {
    throw new Error(`${source}行情包含非法收盘价`);
  }
}

export function validateAdjustedBars(
  rows: readonly AdjustedBar[],
  symbol: string,
  source: string,
): void {
  if (!/^\d{6}$/.test(symbol)) throw new Error("行情证券代码不合法");
  if (!rows.length) throw new Error(`${symbol} 未取得${source}前复权日线`);
  assertDates(rows, `${source}行情`);
  for (const row of rows) {
    const values = [row.open, row.high, row.low, row.close, row.volume];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${source}行情包含非有限数值`);
    }
    if (
      row.open <= 0 ||
      row.high <= 0 ||
      row.low <= 0 ||
      row.close <= 0 ||
      row.volume < 0 ||
      row.high < Math.max(row.open, row.close) ||
      row.low > Math.min(row.open, row.close) ||
      row.high < row.low
    ) {
      throw new Error(`${source}行情 OHLCV 关系不合法`);
    }
  }
}

function assertRequestedRange(
  rows: readonly { date: string }[],
  startDate: string,
  endDate: string,
  source: string,
): void {
  if (rows.some((row) => row.date < startDate || row.date > endDate)) {
    throw new Error(`${source}行情返回了请求区间之外的交易日`);
  }
}

export function assertCrossProviderConsistency(
  tencentRows: readonly PricePoint[],
  sinaRows: readonly PricePoint[],
  tolerance = 0.02,
): void {
  const primary = new Map(tencentRows.map((row) => [row.date, row.close]));
  let overlaps = 0;
  for (const row of sinaRows) {
    const reference = primary.get(row.date);
    if (reference === undefined) continue;
    overlaps += 1;
    if (Math.abs(row.close / reference - 1) > tolerance) {
      throw new Error("腾讯与新浪行情结果不一致，本次收益计算已停止");
    }
  }
  if (tencentRows.length && sinaRows.length && overlaps === 0) {
    throw new Error("腾讯与新浪行情没有可校验的重叠交易日，本次收益计算已停止");
  }
}

function completedRows<T extends { date: string }>(
  rows: readonly T[],
  endDate: string,
  now: Date,
): T[] {
  if (endDate < currentMarketDate(now)) return [...rows];
  const cutoff = latestCompletedTradingDate(
    now,
    rows.map((row) => row.date),
  );
  return cutoff ? rows.filter((row) => row.date <= cutoff) : [];
}

function marketTailStatus(
  rows: readonly { date: string }[],
  endDate: string,
  now: Date,
): MarketTailStatus {
  const expectedThrough = [endDate, latestWeekdayCandidate(now)].sort()[0];
  const dataCutoff = rows.at(-1)?.date;
  if (!dataCutoff) return "incomplete";
  if (dataCutoff >= expectedThrough) return "complete";
  return isConfirmedMarketClosureRange(
    addDays(dataCutoff, 1),
    expectedThrough,
  )
    ? "confirmed_non_trading"
    : "incomplete";
}

function provenance(
  source: "tencent" | "sina",
  rows: readonly { date: string }[],
  adjustment: "none" | "qfq",
  fetchedAt: string,
  fallbackReason?: string,
  emptyEvidence?: MarketDataProvenance["emptyEvidence"],
): MarketDataProvenance {
  return {
    source,
    primarySource: "tencent",
    fallbackUsed: source === "sina",
    ...(fallbackReason ? { fallbackReason } : {}),
    fetchedAt,
    dataCutoff: rows.at(-1)?.date ?? null,
    adjustment,
    ...(emptyEvidence ? { emptyEvidence } : {}),
  };
}

export async function fetchWithProviderFallback<T extends { date: string }>(
  operation: "prices" | "bars",
  symbol: string,
  startDate: string,
  endDate: string,
  primary: MarketDataProvider,
  fallback: MarketDataProvider,
  now = new Date(),
): Promise<MarketFetchResult<T>> {
  assertValidMarketDateRange(startDate, endDate);
  interface Candidate {
    rows: T[];
    consistencyRows: PricePoint[];
    tailStatus: MarketTailStatus;
    rowIssues: MarketDataIssue[];
  }

  const adjustment = operation === "prices" ? "none" : "qfq";
  const fetchedAt = now.toISOString();
  const evaluate = async (
    provider: MarketDataProvider,
    label: "腾讯" | "新浪",
  ): Promise<Candidate> => {
    const { rows: raw, issues: rowIssues } =
      operation === "prices"
        ? await provider.fetchPrices(symbol, startDate, endDate)
        : await provider.fetchAdjustedBars(symbol, startDate, endDate);
    assertRequestedRange(raw, startDate, endDate, label);
    if (raw.length) {
      if (operation === "prices") {
        validatePricePoints(raw as PricePoint[], symbol, label);
      } else {
        validateAdjustedBars(raw as AdjustedBar[], symbol, label);
      }
    }
    const completed = completedRows(raw, endDate, now) as unknown as T[];
    assertRequestedRange(completed, startDate, endDate, label);
    if (completed.length) {
      if (operation === "prices") {
        validatePricePoints(
          completed as unknown as PricePoint[],
          symbol,
          label,
        );
      } else {
        validateAdjustedBars(
          completed as unknown as AdjustedBar[],
          symbol,
          label,
        );
      }
    }
    // P2-1：在正式日历年度内逐交易日核对完整性，产出 warning 级别问题。
    const dateIssues = detectDateCompletenessIssues(completed, label);
    return {
      rows: completed,
      consistencyRows:
        operation === "prices"
          ? (completed as unknown as PricePoint[])
          : (completed as unknown as AdjustedBar[]).map(({ date, close }) => ({
              date,
              close,
            })),
      tailStatus: marketTailStatus(completed, endDate, now),
      rowIssues: [...rowIssues, ...dateIssues],
    };
  };

  /** 供应商级失败（已被兜底覆盖）转为 warning 级别问题。 */
  const providerIssue = (message: string): MarketDataIssue => ({
    type: "gap",
    severity: "warning",
    message,
  });

  let primaryCandidate: Candidate | null = null;
  let primaryIssueMessage: string | null = null;
  try {
    primaryCandidate = await evaluate(primary, "腾讯");
    if (
      primaryCandidate.rows.length &&
      primaryCandidate.tailStatus !== "incomplete"
    ) {
      return {
        rows: primaryCandidate.rows,
        requestedThrough: endDate,
        dataCutoff: primaryCandidate.rows.at(-1)?.date ?? null,
        tailStatus: primaryCandidate.tailStatus,
        issues: primaryCandidate.rowIssues,
        provenance: provenance(
          "tencent",
          primaryCandidate.rows,
          adjustment,
          fetchedAt,
        ),
      };
    }
    primaryIssueMessage = primaryCandidate.rows.length
      ? `腾讯行情仅更新至 ${primaryCandidate.rows.at(-1)?.date ?? "未知日期"}，尾部不完整`
      : "腾讯在请求区间返回空数据";
  } catch (error) {
    primaryIssueMessage = error instanceof Error ? error.message : String(error);
  }

  let fallbackCandidate: Candidate | null = null;
  let fallbackIssueMessage: string | null = null;
  try {
    fallbackCandidate = await evaluate(fallback, "新浪");
  } catch (error) {
    fallbackIssueMessage = error instanceof Error ? error.message : String(error);
  }

  if (
    primaryCandidate?.consistencyRows.length &&
    fallbackCandidate?.consistencyRows.length
  ) {
    // 两个来源都给出候选结果时，冲突属于证据冲突而不是可忽略的兜底失败。
    assertCrossProviderConsistency(
      primaryCandidate.consistencyRows,
      fallbackCandidate.consistencyRows,
    );
  }

  if (
    fallbackCandidate?.rows.length &&
    fallbackCandidate.tailStatus !== "incomplete"
  ) {
    return {
      rows: fallbackCandidate.rows,
      requestedThrough: endDate,
      dataCutoff: fallbackCandidate.rows.at(-1)?.date ?? null,
      tailStatus: fallbackCandidate.tailStatus,
      issues: [
        ...(primaryIssueMessage ? [providerIssue(primaryIssueMessage)] : []),
        ...fallbackCandidate.rowIssues,
      ],
      provenance: provenance(
        "sina",
        fallbackCandidate.rows,
        adjustment,
        fetchedAt,
        primaryIssueMessage ?? "腾讯行情不可用",
      ),
    };
  }

  const primaryEmpty = primaryCandidate !== null && !primaryCandidate.rows.length;
  const fallbackEmpty =
    fallbackCandidate !== null && !fallbackCandidate.rows.length;
  if (primaryEmpty && fallbackEmpty) {
    if (!isConfirmedMarketClosureRange(startDate, endDate)) {
      throw new Error(
        "腾讯与新浪均返回空数据，但独立交易日历不能确认请求区间全部休市",
      );
    }
    return {
      rows: [],
      requestedThrough: endDate,
      dataCutoff: null,
      tailStatus: "confirmed_non_trading",
      issues: [],
      provenance: provenance(
        "tencent",
        [],
        adjustment,
        fetchedAt,
        undefined,
        "exchange_calendar",
      ),
    };
  }

  const incompleteCandidates = [
    ...(primaryCandidate?.rows.length
      ? [{ source: "tencent" as const, candidate: primaryCandidate }]
      : []),
    ...(fallbackCandidate?.rows.length
      ? [{ source: "sina" as const, candidate: fallbackCandidate }]
      : []),
  ].sort((left, right) =>
    (right.candidate.rows.at(-1)?.date ?? "").localeCompare(
      left.candidate.rows.at(-1)?.date ?? "",
    ),
  );
  const selected = incompleteCandidates[0];
  if (selected) {
    if (fallbackCandidate?.rows.length) {
      fallbackIssueMessage = `新浪行情仅更新至 ${
        fallbackCandidate.rows.at(-1)?.date ?? "未知日期"
      }，尾部不完整`;
    } else if (!fallbackIssueMessage && fallbackEmpty) {
      fallbackIssueMessage = "新浪在请求区间返回空数据";
    }
    const issues: MarketDataIssue[] = [];
    if (primaryIssueMessage) issues.push(providerIssue(primaryIssueMessage));
    if (fallbackIssueMessage) issues.push(providerIssue(fallbackIssueMessage));
    issues.push(...selected.candidate.rowIssues);
    return {
      rows: selected.candidate.rows,
      requestedThrough: endDate,
      dataCutoff: selected.candidate.rows.at(-1)?.date ?? null,
      tailStatus: "incomplete",
      issues,
      provenance: provenance(
        selected.source,
        selected.candidate.rows,
        adjustment,
        fetchedAt,
        selected.source === "sina"
          ? primaryIssueMessage ?? "腾讯行情不可用"
          : undefined,
      ),
    };
  }

  throw new Error(
    `腾讯行情不可用（${primaryIssueMessage ?? "未知原因"}）；新浪完整区间兜底失败（${
      fallbackIssueMessage ?? "未返回可用行情"
    }）`,
  );
}

export async function fetchMarketPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{
  rows: PricePoint[];
  requestedThrough: string;
  dataCutoff: string | null;
  tailStatus: MarketTailStatus;
  issues: MarketDataIssue[];
  provenance: MarketDataProvenance & { caliberVersion: string };
}> {
  const result = await fetchWithProviderFallback<PricePoint>(
    "prices",
    symbol,
    startDate,
    endDate,
    tencentProvider,
    sinaProvider,
  );
  return {
    rows: result.rows,
    requestedThrough: result.requestedThrough,
    dataCutoff: result.dataCutoff,
    tailStatus: result.tailStatus,
    issues: result.issues,
    provenance: {
      ...result.provenance,
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

export async function fetchMarketAdjustedBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{
  rows: AdjustedBar[];
  requestedThrough: string;
  dataCutoff: string | null;
  tailStatus: MarketTailStatus;
  issues: MarketDataIssue[];
  provenance: MarketDataProvenance & { caliberVersion: string };
}> {
  const result = await fetchWithProviderFallback<AdjustedBar>(
    "bars",
    symbol,
    startDate,
    endDate,
    tencentProvider,
    sinaProvider,
  );
  return {
    rows: result.rows,
    requestedThrough: result.requestedThrough,
    dataCutoff: result.dataCutoff,
    tailStatus: result.tailStatus,
    issues: result.issues,
    provenance: {
      ...result.provenance,
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}
