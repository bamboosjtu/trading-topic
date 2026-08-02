import type {
  IncomeCalendarDay,
  LedgerEntry,
  StoredMarketCoverage,
  StoredMarketPrice,
} from "../../shared/contracts";
import { addDays, validDate } from "./dateUtils";
import { roundMoney } from "./finance";
import {
  holdingIntervals,
  ledgerEntryAmount,
  type HoldingInterval,
  reduceLedger,
} from "./ledgerReducer";
import { projectInvestmentCash } from "./investmentCashProjection";

interface ContributionAttribution {
  holdingChange: number;
  marketPricePnl: number | null;
  dividendPnl: number;
  /** 买卖相对当日收盘价的影响，含费用；不利影响为负。 */
  tradingCostPnl: number;
  totalPnl: number | null;
  returnRate: number | null;
  capitalBase: number;
}

export interface DailyAttribution {
  date: string;
  totalPnl: number | null;
  marketPricePnl: number | null;
  dividendPnl: number;
  tradingCostPnl: number;
  returnRate: number | null;
  capitalBase: number;
  hasMarketData: boolean;
  isPartial: boolean;
  contributions: Map<string, ContributionAttribution>;
  events: IncomeCalendarDay["events"];
}

export function rowsBySymbol(
  prices: readonly StoredMarketPrice[],
): Map<string, StoredMarketPrice[]> {
  const result = new Map<string, StoredMarketPrice[]>();
  for (const row of prices) {
    const current = result.get(row.symbol) ?? [];
    current.push(row);
    result.set(row.symbol, current);
  }
  for (const rows of result.values()) {
    rows.sort((left, right) => left.date.localeCompare(right.date));
  }
  return result;
}

function priceOnOrBefore(
  rows: readonly StoredMarketPrice[],
  date: string,
): StoredMarketPrice | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].date <= date) return rows[index];
  }
  return undefined;
}

function emptyContribution(): ContributionAttribution {
  return {
    holdingChange: 0,
    marketPricePnl: 0,
    dividendPnl: 0,
    tradingCostPnl: 0,
    totalPnl: 0,
    returnRate: null,
    capitalBase: 0,
  };
}

function openingPendingReinvestmentCashByDate(
  entries: readonly LedgerEntry[],
  orderedDates: readonly string[],
  internalFundingByBuy: ReadonlyMap<string, number>,
): Map<string, Map<string, number>> {
  const entriesByDate = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const current = entriesByDate.get(entry.businessDate) ?? [];
    current.push(entry);
    entriesByDate.set(entry.businessDate, current);
  }

  const pendingBySymbol = new Map<string, number>();
  const result = new Map<string, Map<string, number>>();
  for (const date of orderedDates) {
    result.set(date, new Map(pendingBySymbol));
    const todaysEntries = entriesByDate.get(date) ?? [];

    for (const entry of todaysEntries) {
      if (
        entry.type !== "dividend" ||
        !entry.linkedGroupId ||
        !entry.symbol
      ) {
        continue;
      }
      pendingBySymbol.set(
        entry.symbol,
        roundMoney(
          (pendingBySymbol.get(entry.symbol) ?? 0) +
            ledgerEntryAmount(entry),
        ),
      );
    }

    for (const entry of todaysEntries) {
      if (entry.type !== "buy" || !entry.symbol) continue;
      const internalFunding = internalFundingByBuy.get(entry.id) ?? 0;
      if (internalFunding <= 0) continue;
      const remaining = roundMoney(
        (pendingBySymbol.get(entry.symbol) ?? 0) - internalFunding,
      );
      if (remaining > 0) pendingBySymbol.set(entry.symbol, remaining);
      else pendingBySymbol.delete(entry.symbol);
    }
  }
  return result;
}

export function buildDailyAttribution(
  entries: readonly LedgerEntry[],
  pricesBySymbol: Map<string, StoredMarketPrice[]>,
  factAsOfDate: string,
  valuationCutoff: string | null,
  names: Map<string, string>,
): DailyAttribution[] {
  const internalFundingByBuy =
    projectInvestmentCash(entries).internalFundingByBuy;
  // P1-2：复用公共持仓区间函数，避免与 incomePriceRanges、positionsView 各写一套。
  const intervalsBySymbol = holdingIntervals(entries, factAsOfDate);

  const dates = new Set<string>();
  for (const [symbol, rows] of pricesBySymbol) {
    const intervals = intervalsBySymbol.get(symbol) ?? [];
    for (const row of rows) {
      if (
        valuationCutoff &&
        row.date <= valuationCutoff &&
        row.date <= factAsOfDate &&
        intervals.some(
          (interval) =>
            interval.startDate <= row.date && interval.endDate >= row.date,
        )
      ) {
        dates.add(row.date);
      }
    }
  }
  for (const entry of entries) {
    if (entry.businessDate <= factAsOfDate) dates.add(entry.businessDate);
  }
  if (
    valuationCutoff &&
    valuationCutoff <= factAsOfDate &&
    [...intervalsBySymbol.values()].some((intervals) =>
      intervals.some(
        (interval) =>
          interval.startDate <= valuationCutoff &&
          interval.endDate >= valuationCutoff,
      ),
    )
  ) {
    // 估值截止日本身也是必须解释的业务日期。即使缓存中只有其他标的或
    // 更早日期，也要生成该日归因，让缺少精确收盘价的持仓明确变为 partial。
    dates.add(valuationCutoff);
  }
  const orderedDates = [...dates].filter(validDate).sort();
  if (!orderedDates.length) return [];
  const openingPendingCashByDate = openingPendingReinvestmentCashByDate(
    entries,
    orderedDates,
    internalFundingByBuy,
  );

  const entriesByDate = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const current = entriesByDate.get(entry.businessDate) ?? [];
    current.push(entry);
    entriesByDate.set(entry.businessDate, current);
  }
  const closingByDate = new Map<string, Map<string, number>>();
  for (const [symbol, rows] of pricesBySymbol) {
    for (const row of rows) {
      if (!valuationCutoff || row.date > valuationCutoff) continue;
      const current = closingByDate.get(row.date) ?? new Map<string, number>();
      current.set(symbol, row.close);
      closingByDate.set(row.date, current);
    }
  }

  const daily: DailyAttribution[] = [];
  for (const date of orderedDates) {
    const previousDate = addDays(date, -1);
    const openingPositions = reduceLedger(entries, previousDate).positions;
    const closingPositions = reduceLedger(entries, date).positions;
    const todaysPrices = closingByDate.get(date);
    const todaysEntries = entriesByDate.get(date) ?? [];
    const openingPendingCash =
      openingPendingCashByDate.get(date) ?? new Map<string, number>();
    const contributions = new Map<string, ContributionAttribution>();
    const events: IncomeCalendarDay["events"] = [];

    for (const entry of todaysEntries) {
      if (!entry.symbol) continue;
      const item = contributions.get(entry.symbol) ?? emptyContribution();
      if (entry.type === "buy") item.holdingChange += entry.quantity ?? 0;
      if (entry.type === "sell") item.holdingChange -= entry.quantity ?? 0;
      if (entry.type === "dividend") {
        item.dividendPnl = roundMoney(
          item.dividendPnl + ledgerEntryAmount(entry),
        );
      }
      contributions.set(entry.symbol, item);
      events.push({
        type: entry.type,
        symbol: entry.symbol,
        name: names.get(entry.symbol) ?? entry.symbol,
        quantity: entry.quantity ?? null,
        perShare: entry.perShare ?? null,
        amount:
          entry.amount ??
          (entry.type === "buy" || entry.type === "sell"
            ? ledgerEntryAmount(entry)
            : null),
        note: entry.note ?? null,
      });
    }

    for (const symbol of new Set([
      ...openingPositions.keys(),
      ...closingPositions.keys(),
      ...contributions.keys(),
      ...openingPendingCash.keys(),
    ])) {
      const openingQuantity = openingPositions.get(symbol)?.quantity ?? 0;
      const closingQuantity = closingPositions.get(symbol)?.quantity ?? 0;
      const symbolRows = pricesBySymbol.get(symbol) ?? [];
      const previousPrice = priceOnOrBefore(symbolRows, previousDate)?.close;
      const exactClose = todaysPrices?.get(symbol);
      const hasTradeToday = todaysEntries.some(
        (entry) =>
          entry.symbol === symbol &&
          (entry.type === "buy" || entry.type === "sell"),
      );
      const hasPostValuationFact =
        (!valuationCutoff || date > valuationCutoff) &&
        todaysEntries.some((entry) => entry.symbol === symbol);
      const needsOfficialClose =
        Boolean(todaysPrices?.size) ||
        hasTradeToday ||
        (date === valuationCutoff &&
          (openingQuantity > 1e-8 || closingQuantity > 1e-8));
      const item = contributions.get(symbol) ?? emptyContribution();

      if (hasPostValuationFact) {
        // 事实仍进入持仓、累计投入与分红等账本指标，但在正式估值截止日
        // 之后没有同日正式收盘资产，不能沿用前收盘价生成完整收益。
        item.marketPricePnl = null;
        item.totalPnl = null;
        item.returnRate = null;
        contributions.set(symbol, item);
        continue;
      }

      if (
        (openingQuantity > 1e-8 && previousPrice === undefined) ||
        ((openingQuantity > 1e-8 ||
          closingQuantity > 1e-8 ||
          hasTradeToday) &&
          needsOfficialClose &&
          exactClose === undefined)
      ) {
        item.marketPricePnl = null;
        item.totalPnl = null;
        item.returnRate = null;
        contributions.set(symbol, item);
        continue;
      }

      const close = exactClose ?? previousPrice;
      const marketPricePnl =
        openingQuantity > 1e-8 && previousPrice !== undefined && close !== undefined
          ? openingQuantity * (close - previousPrice)
          : 0;
      let tradingCostPnl = 0;
      for (const entry of todaysEntries.filter(
        (row) => row.symbol === symbol,
      )) {
        if (entry.type === "buy" && close !== undefined) {
          tradingCostPnl +=
            (entry.quantity ?? 0) * (close - (entry.price ?? close)) -
            (entry.fee ?? 0);
        } else if (entry.type === "sell" && close !== undefined) {
          tradingCostPnl +=
            (entry.quantity ?? 0) * ((entry.price ?? close) - close) -
            (entry.fee ?? 0);
        }
      }
      item.marketPricePnl = roundMoney(marketPricePnl);
      item.tradingCostPnl = roundMoney(tradingCostPnl);
      item.totalPnl = roundMoney(
        item.marketPricePnl + item.dividendPnl + item.tradingCostPnl,
      );
      const externalBuySpend = todaysEntries
        .filter((row) => row.symbol === symbol && row.type === "buy")
        .reduce(
          (sum, row) =>
            sum +
            Math.max(
              0,
              ledgerEntryAmount(row) +
                (row.fee ?? 0) -
                (internalFundingByBuy.get(row.id) ?? 0),
            ),
          0,
        );
      item.capitalBase =
        openingQuantity * (previousPrice ?? close ?? 0) +
        (openingPendingCash.get(symbol) ?? 0) +
        externalBuySpend;
      item.returnRate =
        item.capitalBase > 0 ? item.totalPnl / item.capitalBase : null;
      contributions.set(symbol, item);
    }

    const values = [...contributions.values()];
    const marketPricePnl = values.some((item) => item.marketPricePnl === null)
      ? null
      : roundMoney(
          values.reduce((sum, item) => sum + item.marketPricePnl!, 0),
        );
    const dividendPnl = roundMoney(
      values.reduce((sum, item) => sum + item.dividendPnl, 0),
    );
    const tradingCostPnl = roundMoney(
      values.reduce((sum, item) => sum + item.tradingCostPnl, 0),
    );
    const totalPnl =
      marketPricePnl === null
        ? null
        : roundMoney(marketPricePnl + dividendPnl + tradingCostPnl);
    const capitalBase = values.reduce(
      (sum, item) => sum + item.capitalBase,
      0,
    );
    daily.push({
      date,
      totalPnl,
      marketPricePnl,
      dividendPnl,
      tradingCostPnl,
      returnRate:
        totalPnl !== null && capitalBase > 0 ? totalPnl / capitalBase : null,
      capitalBase,
      hasMarketData: Boolean(todaysPrices?.size),
      isPartial: values.some((item) => item.totalPnl === null),
      contributions,
      events,
    });
  }
  return daily;
}

/**
 * P1-3：结构化的覆盖损伤信息。
 *
 * - `impairedDates`：有具体日期的 error，该日期的收益不可信。
 * - `impairedRanges`：无具体日期的 error，与查询区间相交的整个范围都不可信。
 * - `descriptions`：人类可读的问题描述，用于 quality.issues。
 */
export interface CoverageImpairment {
  symbol: string;
  impairedDates: Set<string>;
  impairedRanges: Array<{ from: string; through: string }>;
  descriptions: string[];
}

/**
 * P1-2 + P1-3：从持久化覆盖记录中筛选与查询相关的损伤。
 *
 * 过滤维度：
 * - 覆盖为 partial；
 * - symbol 属于 selectedSymbols；
 * - 覆盖请求区间与持仓区间在 [rangeStart, rangeEnd] 内有交集；
 * - error 级别问题的日期落在交集内（有日期）或整个交集不可信（无日期）。
 */
export function buildCoverageImpairments(
  coverage: readonly StoredMarketCoverage[],
  selectedSymbols: Set<string>,
  intervalsBySymbol: Map<string, HoldingInterval[]>,
  rangeStart: string,
  rangeEnd: string,
): CoverageImpairment[] {
  if (!coverage.length || !selectedSymbols.size) return [];
  const impairments: CoverageImpairment[] = [];
  for (const item of coverage) {
    if (item.resultStatus !== "partial") continue;
    if (!selectedSymbols.has(item.symbol)) continue;
    const intervals = intervalsBySymbol.get(item.symbol) ?? [];
    // 求覆盖区间与持仓区间在查询范围内的交集
    const relevantIntervals = intervals
      .map((interval) => {
        const from =
          interval.startDate > item.requestedFrom
            ? interval.startDate
            : item.requestedFrom;
        const through =
          interval.endDate < item.requestedThrough
            ? interval.endDate
            : item.requestedThrough;
        const clampedFrom = from > rangeStart ? from : rangeStart;
        const clampedThrough = through < rangeEnd ? through : rangeEnd;
        return clampedFrom <= clampedThrough
          ? { from: clampedFrom, through: clampedThrough }
          : null;
      })
      .filter((v): v is { from: string; through: string } => v !== null);
    if (!relevantIntervals.length) continue;
    const errorIssues = (item.issues ?? []).filter(
      (issue) => issue.severity === "error",
    );
    if (!errorIssues.length) continue;
    const impairedDates = new Set<string>();
    const impairedRanges: Array<{ from: string; through: string }> = [];
    const descriptions: string[] = [];
    for (const issue of errorIssues) {
      if (issue.date) {
        const inRange =
          issue.date >= rangeStart &&
          issue.date <= rangeEnd &&
          relevantIntervals.some(
            (r) => issue.date! >= r.from && issue.date! <= r.through,
          );
        if (inRange) impairedDates.add(issue.date);
      } else {
        impairedRanges.push(...relevantIntervals);
      }
      descriptions.push(
        issue.date ? `${issue.date} ${issue.message}` : issue.message,
      );
    }
    if (impairedDates.size || impairedRanges.length) {
      impairments.push({
        symbol: item.symbol,
        impairedDates,
        impairedRanges,
        descriptions,
      });
    }
  }
  return impairments;
}

/**
 * P1-1：合并同一证券的多条覆盖损伤。
 *
 * 同一证券可能存在多条 partial 覆盖（如不同月份各自有坏行），
 * 直接构造 Map 会丢失前面的记录。合并时：
 * - 合并全部日期集合；
 * - 合并全部区间；
 * - 去重描述。
 */
export function mergeImpairments(
  impairments: readonly CoverageImpairment[],
): CoverageImpairment[] {
  if (impairments.length <= 1) return [...impairments];
  const merged = new Map<string, CoverageImpairment>();
  for (const imp of impairments) {
    const existing = merged.get(imp.symbol);
    if (existing) {
      for (const date of imp.impairedDates) existing.impairedDates.add(date);
      existing.impairedRanges.push(...imp.impairedRanges);
      for (const desc of imp.descriptions) {
        if (!existing.descriptions.includes(desc)) {
          existing.descriptions.push(desc);
        }
      }
    } else {
      merged.set(imp.symbol, {
        symbol: imp.symbol,
        impairedDates: new Set(imp.impairedDates),
        impairedRanges: [...imp.impairedRanges],
        descriptions: [...imp.descriptions],
      });
    }
  }
  return [...merged.values()];
}

/**
 * P1-3：将覆盖损伤应用到日度归因序列。
 *
 * - 标记已有日期中受影响证券的 totalPnl/marketPricePnl/returnRate = null、isPartial = true；
 * - 日级 totalPnl 在任何贡献受损时也必须为 null，不再由子分量重新计算；
 * - 为缺失的损伤日期注入合成 partial 日，使期间收益自动返回 null。
 */
export function applyCoverageImpairments(
  daily: readonly DailyAttribution[],
  impairments: readonly CoverageImpairment[],
): DailyAttribution[] {
  if (!impairments.length) return [...daily];
  // P1-1：合并同一证券的多条覆盖损伤
  const merged = mergeImpairments(impairments);
  const impairmentBySymbol = new Map(merged.map((imp) => [imp.symbol, imp]));
  const marked = daily.map((day) => {
    let changed = false;
    const newContributions = new Map(day.contributions);
    for (const [symbol, contribution] of newContributions) {
      const impairment = impairmentBySymbol.get(symbol);
      if (!impairment) continue;
      const isImpaired =
        impairment.impairedDates.has(day.date) ||
        impairment.impairedRanges.some(
          (range) => day.date >= range.from && day.date <= range.through,
        );
      if (isImpaired && contribution.totalPnl !== null) {
        changed = true;
        // P1-3：价格数据错误时 marketPricePnl、totalPnl、returnRate 都失效。
        // dividendPnl 属于账本事实，可以保留；tradingCostPnl 同理。
        newContributions.set(symbol, {
          ...contribution,
          totalPnl: null,
          marketPricePnl: null,
          returnRate: null,
        });
      }
    }
    if (!changed) return day;
    const values = [...newContributions.values()];
    // P1-3：任何贡献的 totalPnl 为 null 时，日级 totalPnl 也必须为 null
    const hasImpairedContribution = values.some((v) => v.totalPnl === null);
    const marketPriceValues = values.map((v) => v.marketPricePnl);
    const marketPricePnl = marketPriceValues.some((v) => v === null)
      ? null
      : roundMoney(marketPriceValues.reduce<number>((s, v) => s + v!, 0));
    const dividendPnl = roundMoney(
      values.reduce((s, v) => s + v.dividendPnl, 0),
    );
    const tradingCostPnl = roundMoney(
      values.reduce((s, v) => s + v.tradingCostPnl, 0),
    );
    const totalPnl = hasImpairedContribution
      ? null
      : marketPricePnl === null
        ? null
        : roundMoney(marketPricePnl + dividendPnl + tradingCostPnl);
    const capitalBase = values.reduce((s, v) => s + v.capitalBase, 0);
    return {
      ...day,
      contributions: newContributions,
      totalPnl,
      marketPricePnl,
      dividendPnl,
      tradingCostPnl,
      capitalBase,
      // P1-3：受损日的收益率不可计算
      returnRate: null,
      isPartial: true,
    };
  });
  // 为缺失的损伤日期注入合成 partial 日
  const existingDates = new Set(marked.map((day) => day.date));
  const synthetic: DailyAttribution[] = [];
  for (const impairment of merged) {
    for (const date of impairment.impairedDates) {
      if (existingDates.has(date)) continue;
      synthetic.push({
        date,
        totalPnl: null,
        marketPricePnl: null,
        dividendPnl: 0,
        tradingCostPnl: 0,
        capitalBase: 0,
        returnRate: null,
        isPartial: true,
        hasMarketData: false,
        contributions: new Map([
          [
            impairment.symbol,
            {
              holdingChange: 0,
              marketPricePnl: null,
              dividendPnl: 0,
              tradingCostPnl: 0,
              totalPnl: null,
              returnRate: null,
              capitalBase: 0,
            },
          ],
        ]),
        events: [],
      });
    }
  }
  return synthetic.length
    ? [...marked, ...synthetic].sort((a, b) => a.date.localeCompare(b.date))
    : marked;
}

export function coverageIssueStrings(
  impairments: readonly CoverageImpairment[],
): string[] {
  return impairments.map(
    (imp) =>
      `${imp.symbol} 行情覆盖存在数据质量问题：${imp.descriptions.join("；")}`,
  );
}
