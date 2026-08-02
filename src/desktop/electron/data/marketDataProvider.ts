import type {
  AdjustedBar,
  MarketDataIssue,
  MarketFetchResult,
  MarketDataProvenance,
  MarketTailStatus,
  PricePoint,
  SecurityTradingInterruption,
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

/**
 * 把证券级停复牌证据展开为具体日期集合（含 startDate，不含 endDate 之后的复牌日）。
 *
 * 区间约定：[startDate, endDate] 均为停牌日；endDate 之后第一个交易日为复牌日，
 * 不在停牌区间内。这与 `SecurityTradingInterruption` 字段语义一致。
 *
 * 注意：endDate 可以等于 startDate（单日停牌）。
 */
export function expandInterruptionDates(
  interruptions: readonly SecurityTradingInterruption[],
): Set<string> {
  const dates = new Set<string>();
  for (const item of interruptions) {
    if (!validDate(item.startDate) || !validDate(item.endDate)) continue;
    if (item.startDate > item.endDate) continue;
    for (
      let date = item.startDate;
      date <= item.endDate;
      date = addDays(date, 1)
    ) {
      dates.add(date);
    }
  }
  return dates;
}

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
 * P1-1：在拥有正式日历的年度中逐交易日核对行情完整性。
 *
 * 检查范围覆盖请求区间 [startDate, endDate]，而非仅 [firstDate, lastDate]。
 * 已有正式日历年度内缺少的预期交易日升级为 error，严格回测必须阻断。
 *
 * 头部截断（首条返回行情晚于请求开始日）生成单条无日期 error，
 * 表示整个前置区间不可信。内部缺口逐日生成带日期 error。
 * 尾部缺失由 tailStatus 处理，不在此生成 error。
 *
 * 没有正式日历的区间仍检查极端截断，仅生成 warning。
 *
 * P1-1 修订：上市日期 listingDate 用于区分"新上市股票的预期前置缺口"与
 * "接口截断"。
 * - 提供 listingDate 且晚于 startDate：仅检查 [listingDate, endDate] 完整性。
 *   若首条行情等于或早于 listingDate，前置缺口属于未上市期，不生成 error。
 *   若首条行情晚于 listingDate，说明接口截断了已上市期间的数据，生成 error。
 * - 未提供 listingDate：不能排除"接口未返回上市前的预期间隔"，故
 *   不生成头部截断 error；仅检查 [firstRowDate, lastRowDate] 内部缺口。
 *
 * P1 修订（停复牌证据）：增加 interruptions 参数。已确认停牌/退市/未上市的
 * 日期属于"交易所开市但该证券不交易"，应从"预期行情日"中排除，不应升级为
 * error。这是证券级证据，与交易所级休市日历（isConfirmedMarketClosureDate）
 * 互补，但不互相替代。
 */
function detectDateCompletenessIssues(
  rows: readonly { date: string }[],
  label: string,
  startDate: string,
  endDate: string,
  listingDate?: string,
  interruptions: readonly SecurityTradingInterruption[] = [],
): MarketDataIssue[] {
  const issues: MarketDataIssue[] = [];
  // 有效起点：上市日晚于请求起点时，上市前的交易日不参与完整性校验
  const effectiveStartDate =
    listingDate && listingDate > startDate ? listingDate : startDate;
  const expected = expectedTradingDatesInRange(effectiveStartDate, endDate);
  // P1：把证券级停复牌证据展开为日期集合，从"预期行情日"中排除。
  // 这样"交易所开市 + 证券停牌"的合法缺口不会误判为行情问题。
  const interruptionDates = expandInterruptionDates(interruptions);
  if (!expected.length) {
    // 没有正式日历的区间仍检查极端截断
    if (rows.length < 2) {
      const span = daysBetween(startDate, endDate);
      if (span > 30 && rows.length <= 1) {
        issues.push({
          type: "gap",
          severity: "warning",
          message: `${label}请求区间 ${startDate}～${endDate} 跨度 ${span} 天但仅返回 ${rows.length} 行行情，可能存在接口截断`,
        });
      }
    }
    return issues;
  }
  const present = new Set(rows.map((row) => row.date));
  // 无法解释的缺口 = 预期交易日 - 已返回 - 已确认停牌日
  const missing = expected.filter(
    (date) => !present.has(date) && !interruptionDates.has(date),
  );
  if (!missing.length) return issues;

  const firstRowDate = rows[0]?.date;
  const lastRowDate = rows.at(-1)?.date;
  // 头部截断：首条返回行情之前的缺失
  const headMissing = firstRowDate
    ? missing.filter((date) => date < firstRowDate)
    : missing;
  // 内部缺口：首条和末条返回行情之间的缺失
  const internalMissingSet = new Set(
    firstRowDate && lastRowDate
      ? missing.filter((date) => date > firstRowDate && date < lastRowDate)
      : [],
  );

  // P1-1 修订：只有在拥有 listingDate 这一独立证据时才能判定头部截断。
  // 没有 listingDate 时，头部缺口可能是新上市股票的预期前置缺口，
  // 不能贸然升级为 error。
  if (listingDate && headMissing.length) {
    // 仅当首条行情晚于 listingDate 时才能确认接口截断了已上市期间的数据
    if (firstRowDate && firstRowDate > listingDate) {
      issues.push({
        type: "gap",
        severity: "error",
        message: `${label}请求区间 ${startDate}～${endDate} 内存在头部截断，缺少 ${headMissing.length} 个预期交易日（首个预期交易日 ${headMissing[0]}，首条返回行情 ${firstRowDate ?? "无"}）`,
      });
    }
  }
  // P1-5：合并连续缺口日期为区间消息。
  // 旧实现逐日生成 error，10 天停牌会产生 10 条同质 error，淹没真正需要
  // 关注的独立缺口。现在按"在 expected 交易日序列中相邻"分组：相邻的
  // 缺失日合并为一条带起止区间和数量的 error；孤立缺失日仍单独成条。
  // date 字段设为区间起点，便于 hasErrorInRequestRange 按请求区间过滤。
  const missingRuns: string[][] = [];
  let currentRun: string[] = [];
  for (const date of expected) {
    if (internalMissingSet.has(date)) {
      currentRun.push(date);
    } else if (currentRun.length > 0) {
      missingRuns.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) missingRuns.push(currentRun);

  for (const run of missingRuns) {
    if (run.length === 1) {
      issues.push({
        date: run[0],
        missingDates: run,
        type: "gap",
        severity: "error",
        message: `${label}在正式交易日历年度内缺少 ${run[0]} 的行情`,
      });
    } else {
      const start = run[0];
      const end = run.at(-1) ?? run[0];
      issues.push({
        date: start,
        endDate: end,
        missingDates: run,
        type: "gap",
        severity: "error",
        message: `${label}在正式交易日历年度内缺少 ${start} 至 ${end} 共 ${run.length} 个交易日的行情`,
      });
    }
  }
  // 尾部缺失由 tailStatus 处理，不生成 error
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
  listingDate?: string,
  now = new Date(),
  interruptions: readonly SecurityTradingInterruption[] = [],
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
    const dateIssues = detectDateCompletenessIssues(
      completed,
      label,
      startDate,
      endDate,
      listingDate,
      interruptions,
    );
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

  /** 判断候选是否存在 error 级别数据质量问题（头部截断或内部缺口）。 */
  const hasErrorIssues = (candidate: Candidate | null): boolean =>
    candidate?.rowIssues.some((issue) => issue.severity === "error") ?? false;

  /**
   * 两源共同缺口兜底：当腾讯和新浪都缺少相同日期，且缺口前后两源都有
   * 正常行情（不是头部或尾部截断）时，将 error 降级为 warning。
   *
   * P1-1 严格化：旧实现只检查 issue.date（区间起始日），无法证明另一个
   * 来源也缺少整个区间。现在使用 missingDates 精确计算交集：
   * - 整个缺口区间的日期都属于两源共同缺失 → 整体降级为 warning
   * - 只有部分日期属于共同缺失 → 拆分为：共同缺口部分 warning + 单源缺口部分 error
   * - 仅对 type === "gap" 执行降级，invalid_ohlcv/invalid_date/duplicate 不受影响
   *
   * 处理原则：
   * - 不插值、不生成虚假收盘价；
   * - 不允许在缺口日期成交（由回测引擎保证）；
   * - 定投计划顺延到下一条真实行情；
   * - 单一来源缺口、头部缺口、尾部缺口仍保持 error。
   */
  const downgradeCrossProviderCommonGaps = (
    issues: MarketDataIssue[],
    selectedRows: readonly { date: string }[],
    otherRows: readonly { date: string }[],
  ): MarketDataIssue[] => {
    if (!selectedRows.length || !otherRows.length) return issues;

    const otherPresentDates = new Set(otherRows.map((r) => r.date));
    const selectedSorted = [...new Set(selectedRows.map((r) => r.date))].sort();
    const otherSorted = [...otherPresentDates].sort();
    const selFirst = selectedSorted[0];
    const selLast = selectedSorted.at(-1) ?? "";
    const otherFirst = otherSorted[0];
    const otherLast = otherSorted.at(-1) ?? "";

    const result: MarketDataIssue[] = [];
    for (const issue of issues) {
      // 仅对 type === "gap" 的 error 执行降级判断
      if (issue.type !== "gap" || issue.severity !== "error" || !issue.date) {
        result.push(issue);
        continue;
      }
      const missingDates = issue.missingDates ?? [issue.date];
      // 检查每个缺失日是否在另一来源中也缺失，且不是任一来源的头部/尾部
      const commonMissing: string[] = [];
      const onlySelectedMissing: string[] = [];
      for (const date of missingDates) {
        // 另一来源有该日期 → 单一来源缺口 → 保持 error
        if (otherPresentDates.has(date)) {
          onlySelectedMissing.push(date);
          continue;
        }
        // 在选中来源是头部或尾部 → 保持 error
        if (date <= selFirst || date >= selLast) {
          onlySelectedMissing.push(date);
          continue;
        }
        // 在另一来源是头部或尾部 → 保持 error
        if (date <= otherFirst || date >= otherLast) {
          onlySelectedMissing.push(date);
          continue;
        }
        // 两源共同缺口且前后都有正常行情
        commonMissing.push(date);
      }

      // 共同缺口部分降级为 warning
      if (commonMissing.length > 0) {
        const cStart = commonMissing[0];
        const cEnd = commonMissing.at(-1) ?? cStart;
        const cMessage =
          commonMissing.length === 1
            ? `${commonMissing[0]} 腾讯与新浪均未返回行情`
            : `${cStart} 至 ${cEnd} 共 ${commonMissing.length} 个交易日腾讯与新浪均未返回行情`;
        result.push({
          date: cStart,
          ...(commonMissing.length > 1 ? { endDate: cEnd } : {}),
          missingDates: commonMissing,
          type: "gap",
          severity: "warning",
          message: `${issue.message}（${cMessage}，缺少独立停牌证据，本次按降级数据继续计算）`,
        });
      }

      // 单源缺口部分保持 error
      if (onlySelectedMissing.length > 0) {
        const sStart = onlySelectedMissing[0];
        const sEnd = onlySelectedMissing.at(-1) ?? sStart;
        const sMessage =
          onlySelectedMissing.length === 1
            ? `${labelPrefix(issue.message)}缺少 ${sStart} 的行情`
            : `${labelPrefix(issue.message)}缺少 ${sStart} 至 ${sEnd} 共 ${onlySelectedMissing.length} 个交易日的行情`;
        result.push({
          date: sStart,
          ...(onlySelectedMissing.length > 1 ? { endDate: sEnd } : {}),
          missingDates: onlySelectedMissing,
          type: "gap",
          severity: "error",
          message: sMessage,
        });
      }
    }
    return result;
  };

  /** 从原始 issue message 中提取 label 前缀（如"腾讯"），用于拆分后的 error 文案。 */
  function labelPrefix(message: string): string {
    const match = /^(\S+?)(?:在正式交易日历|请求区间)/.exec(message);
    return match ? match[1] : "";
  }

  let primaryCandidate: Candidate | null = null;
  let primaryIssueMessage: string | null = null;
  try {
    primaryCandidate = await evaluate(primary, "腾讯");
    // P1-1：主源存在 error 级别问题（头部截断、内部缺口）时不能直接接受，
    // 必须请求备用源尝试获取更完整的数据。
    if (
      primaryCandidate.rows.length &&
      primaryCandidate.tailStatus !== "incomplete" &&
      !hasErrorIssues(primaryCandidate)
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
      ? hasErrorIssues(primaryCandidate)
        ? `腾讯行情存在数据质量问题（${primaryCandidate.rowIssues.filter((i) => i.severity === "error").length} 个 error）`
        : `腾讯行情仅更新至 ${primaryCandidate.rows.at(-1)?.date ?? "未知日期"}，尾部不完整`
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
    fallbackCandidate.tailStatus !== "incomplete" &&
    !hasErrorIssues(fallbackCandidate)
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

  // P1-1：两个来源都未被直接接受时（均有 error 或尾部不完整），
  // 选择行情行数更多（截断更少）的候选。保留实际 tailStatus：
  // 头部截断但尾部完整时保持 "complete"，error 问题负责阻断回测。
  const bestCandidates = [
    ...(primaryCandidate?.rows.length
      ? [{ source: "tencent" as const, candidate: primaryCandidate }]
      : []),
    ...(fallbackCandidate?.rows.length
      ? [{ source: "sina" as const, candidate: fallbackCandidate }]
      : []),
  ].sort((left, right) =>
    right.candidate.rows.length - left.candidate.rows.length ||
    (right.candidate.rows.at(-1)?.date ?? "").localeCompare(
      left.candidate.rows.at(-1)?.date ?? "",
    ),
  );
  const selected = bestCandidates[0];
  if (selected) {
    if (fallbackCandidate?.rows.length && selected.source === "tencent") {
      fallbackIssueMessage = hasErrorIssues(fallbackCandidate)
        ? `新浪行情存在数据质量问题`
        : `新浪行情仅更新至 ${
            fallbackCandidate.rows.at(-1)?.date ?? "未知日期"
          }，尾部不完整`;
    } else if (!fallbackIssueMessage && fallbackEmpty) {
      fallbackIssueMessage = "新浪在请求区间返回空数据";
    }
    const issues: MarketDataIssue[] = [];
    if (primaryIssueMessage) issues.push(providerIssue(primaryIssueMessage));
    if (fallbackIssueMessage) issues.push(providerIssue(fallbackIssueMessage));
    issues.push(...selected.candidate.rowIssues);
    // 两源共同缺口兜底：腾讯和新浪都缺少相同日期且前后有正常行情时，
    // 将 error 降级为 warning，避免停牌接口不可用时回测完全阻断。
    const otherCandidate =
      selected.source === "tencent" ? fallbackCandidate : primaryCandidate;
    const downgradedIssues = otherCandidate
      ? downgradeCrossProviderCommonGaps(
          issues,
          selected.candidate.rows,
          otherCandidate.rows,
        )
      : issues;
    // P1-1：保留候选的实际 tailStatus。头部截断但尾部完整时为 "complete"，
    // error 问题负责阻断回测；尾部不完整时为 "incomplete"。
    const tailStatus: MarketTailStatus = selected.candidate.tailStatus;
    return {
      rows: selected.candidate.rows,
      requestedThrough: endDate,
      dataCutoff: selected.candidate.rows.at(-1)?.date ?? null,
      tailStatus,
      issues: downgradedIssues,
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
  listingDate?: string,
  interruptions: readonly SecurityTradingInterruption[] = [],
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
    listingDate,
    undefined,
    interruptions,
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
  listingDate?: string,
  interruptions: readonly SecurityTradingInterruption[] = [],
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
    listingDate,
    undefined,
    interruptions,
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
