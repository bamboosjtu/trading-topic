import type {
  IncomeCalendarDay,
  IncomeCalendarQuery,
  IncomeCalendarView,
  LedgerEntry,
  StockInfo,
} from "../../shared/contracts";
import type { StoredMarketPrice } from "../storage/database";
import { currentMarketDate, monthEnd } from "./dateUtils";
import { roundMoney } from "./finance";
import { reduceLedger } from "./ledgerReducer";
import {
  buildLiveModel,
  qualityFor,
  type LiveModel,
  type LiveModelBoundary,
} from "./positionsView";
import { namesMap } from "./liveViewSupport";
import type { DailyAttribution } from "./dailyAttribution";

function incomeMetric(
  days: readonly DailyAttribution[],
  selector: (day: DailyAttribution) => number | null,
): { amount: number | null; rate: number | null } {
  if (!days.length) return { amount: null, rate: null };
  const values = days.map(selector);
  const amount = values.some((value) => value === null)
    ? null
    : roundMoney(values.reduce<number>((sum, value) => sum + value!, 0));
  const rate =
    days.some(
      (day) =>
        day.isPartial ||
        selector(day) === null ||
        (day.capitalBase <= 0 && selector(day) !== 0),
    )
      ? null
      : days.reduce((result, day) => {
          const value = selector(day)!;
          return day.capitalBase > 0
            ? result * (1 + value / day.capitalBase)
            : result;
        }, 1) - 1;
  return { amount, rate };
}

export function buildIncomeCalendar(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
  query: IncomeCalendarQuery,
  externalIssues: readonly string[] = [],
  boundary: LiveModelBoundary = {
    factAsOfDate: [monthEnd(query.month), currentMarketDate()].sort()[0],
    valuationCutoff: monthEnd(query.month),
  },
): IncomeCalendarView {
  if (!/^\d{4}-\d{2}$/.test(query.month)) {
    throw new Error("收益月份必须使用 YYYY-MM 格式");
  }
  const model = buildLiveModel(
    entries,
    prices,
    stocks,
    "history",
    boundary,
  );
  const names = namesMap(stocks, entries);
  const activeSymbols = new Set(
    [...reduceLedger(entries, currentMarketDate()).positions.entries()]
      .filter(([, position]) => position.quantity > 1e-8)
      .map(([symbol]) => symbol),
  );
  const selectedSymbols = query.symbol
    ? new Set([query.symbol])
    : query.scope === "current"
      ? activeSymbols
      : new Set(model.effectiveEntries.flatMap((entry) => entry.symbol ?? []));

  const filterDay = (day: DailyAttribution): DailyAttribution => {
    if (!query.symbol && query.scope === "all") return day;
    const selectedContributions = new Map(
      [...day.contributions.entries()].filter(([symbol]) =>
        selectedSymbols.has(symbol),
      ),
    );
    const totalValues = [...selectedContributions.values()].map(
      (value) => value.totalPnl,
    );
    const marketPriceValues = [...selectedContributions.values()].map(
      (value) => value.marketPricePnl,
    );
    const totalPnl = totalValues.some((value) => value === null)
      ? null
      : roundMoney(totalValues.reduce<number>((sum, value) => sum + value!, 0));
    const marketPricePnl = marketPriceValues.some((value) => value === null)
      ? null
      : roundMoney(
          marketPriceValues.reduce<number>(
            (sum, value) => sum + value!,
            0,
          ),
        );
    const dividendPnl = roundMoney(
      [...selectedContributions.values()].reduce(
        (sum, value) => sum + value.dividendPnl,
        0,
      ),
    );
    const capitalBase = [...selectedContributions.values()].reduce(
      (sum, value) => sum + value.capitalBase,
      0,
    );
    const tradingCostPnl = roundMoney(
      [...selectedContributions.values()].reduce(
        (sum, value) => sum + value.tradingCostPnl,
        0,
      ),
    );
    return {
      ...day,
      totalPnl,
      marketPricePnl,
      dividendPnl,
      tradingCostPnl,
      capitalBase,
      returnRate:
        totalPnl !== null && capitalBase > 0
          ? totalPnl / capitalBase
          : null,
      contributions: selectedContributions,
      events: day.events.filter((event) =>
        query.symbol
          ? event.symbol === query.symbol
          : !event.symbol || selectedSymbols.has(event.symbol),
      ),
      isPartial: totalValues.some((value) => value === null),
    };
  };

  const filteredDaily = model.daily
    .map(filterDay)
    .filter(
      (day) =>
        (!query.symbol && query.scope === "all") ||
        day.contributions.size > 0 ||
        day.events.length > 0,
    );
  const monthDays = filteredDaily.filter((day) =>
    day.date.startsWith(query.month),
  );
  const year = query.month.slice(0, 4);
  const throughMonth = filteredDaily.filter(
    (day) => day.date <= `${query.month}-31`,
  );
  const yearToDate = throughMonth.filter((day) => day.date.startsWith(year));
  const calendarDays = monthDays.map(
    (day): IncomeCalendarDay => ({
      date: day.date,
      totalPnl: day.totalPnl,
      marketPricePnl: day.marketPricePnl,
      dividendPnl: day.dividendPnl,
      tradingCostPnl: day.tradingCostPnl,
      returnRate: day.returnRate,
      hasMarketData: day.hasMarketData,
      isPartial: day.isPartial,
      contributions: [...day.contributions.entries()]
        .map(([symbol, contribution]) => ({
          symbol,
          name: names.get(symbol) ?? symbol,
          holdingChange: contribution.holdingChange,
          marketPricePnl: contribution.marketPricePnl,
          dividendPnl: contribution.dividendPnl,
          tradingCostPnl: contribution.tradingCostPnl,
          totalPnl: contribution.totalPnl,
        }))
        .sort(
          (left, right) =>
            Math.abs(right.totalPnl ?? 0) - Math.abs(left.totalPnl ?? 0),
        ),
      events: day.events,
    }),
  );
  const monthMarketPrice = incomeMetric(
    monthDays,
    (day) => day.marketPricePnl,
  );
  const monthDividend = incomeMetric(monthDays, (day) => day.dividendPnl);
  const relevantMissingSymbols = model.missingSymbols.filter((symbol) =>
    selectedSymbols.has(symbol),
  );
  const relevantMissingDates = filteredDaily
    .filter((day) => day.isPartial)
    .map((day) => day.date);
  const relevantPostValuationFacts = model.postValuationFacts.filter(
    (entry) => entry.symbol && selectedSymbols.has(entry.symbol),
  );
  const qualityModel: LiveModel = {
    ...model,
    missingSymbols: relevantMissingSymbols,
    missingDates: relevantMissingDates,
    postValuationFacts: relevantPostValuationFacts,
    postValuationSymbols: [
      ...new Set(
        relevantPostValuationFacts.flatMap(
          (entry) => entry.symbol ?? [],
        ),
      ),
    ],
    issues: [
      ...(relevantMissingSymbols.length
        ? [`缺少 ${relevantMissingSymbols.length} 个所选标的的本地行情快照`]
        : []),
      ...(relevantPostValuationFacts.length
        ? [
            `存在估值截止日后的投资事实（${relevantPostValuationFacts.length} 条），正式收益暂不可计算`,
          ]
        : []),
    ],
  };
  const hasScopedFacts = model.effectiveEntries.some(
    (entry) => entry.symbol && selectedSymbols.has(entry.symbol),
  );
  return {
    quality: qualityFor(
      qualityModel,
      hasScopedFacts,
      monthDays.some((day) => day.isPartial)
        ? ["所选月份存在缺失行情，部分收益无法计算", ...externalIssues]
        : [...externalIssues],
      // 已结束历史月份只判断所需区间是否完整，不因距今天较久标记过期。
      query.month >= currentMarketDate().slice(0, 7),
    ),
    provenance: model.provenance,
    valuationSource: model.priceSource,
    month: query.month,
    scope: query.scope,
    symbol: query.symbol ?? null,
    scopeLabel: query.symbol
      ? (names.get(query.symbol) ?? query.symbol)
      : query.scope === "current"
        ? "当前持仓"
        : "全部历史持仓",
    metrics: {
      month: incomeMetric(monthDays, (day) => day.totalPnl),
      marketPrice: monthMarketPrice,
      dividend: monthDividend,
      tradingCost: incomeMetric(monthDays, (day) => day.tradingCostPnl),
      cumulative: incomeMetric(throughMonth, (day) => day.totalPnl),
      yearToDate: incomeMetric(yearToDate, (day) => day.totalPnl),
    },
    days: calendarDays,
    symbolOptions: [
      ...new Set(model.effectiveEntries.flatMap((entry) => entry.symbol ?? [])),
    ]
      .sort()
      .map((symbol) => ({
        symbol,
        name: names.get(symbol) ?? symbol,
        isCurrent: activeSymbols.has(symbol),
      })),
  };
}
