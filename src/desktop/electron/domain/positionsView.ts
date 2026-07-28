/** 持仓与账户估值只读视图；账本事实统一由 ledgerReducer 归约。 */
import type {
  LedgerEntry,
  LiveDataQuality,
  PerformancePeriod,
  PeriodPerformance,
  PositionsOverview,
  StockInfo,
} from "../../shared/contracts";
import {
  LIVE_PERFORMANCE_PERIOD_DAYS,
  LIVE_PRICE_STALE_AFTER_DAYS,
  LIVE_RECENT_LEDGER_LIMIT,
} from "../../shared/constants";
import type { StoredMarketPrice } from "../storage/database";
import { roundMoney } from "./finance";
import {
  addDays,
  currentMarketDate,
  daysBetween,
} from "./dateUtils";
import {
  canonicalLedgerOrderDescending,
  reduceLedger,
  type LedgerPositionState,
} from "./ledgerReducer";
import {
  buildDailyAttribution,
  priceOnOrBefore,
  rowsBySymbol,
  type DailyAttribution,
} from "./dailyAttribution";
import {
  inferSecurityType,
  namesMap,
  securityTypesMap,
  toLedgerRecord,
} from "./liveViewSupport";

const PERFORMANCE_PERIODS = Object.keys(
  LIVE_PERFORMANCE_PERIOD_DAYS,
) as PerformancePeriod[];

type InstrumentState = LedgerPositionState;

export interface LiveModel {
  cutoff: string | null;
  updatedAt: string | null;
  priceSource: string;
  missingSymbols: string[];
  missingDates: string[];
  issues: string[];
  effectiveEntries: LedgerEntry[];
  reversedIds: Set<string>;
  positions: Map<string, InstrumentState>;
  cash: number;
  reverseRepoAsset: number;
  transferIn: number;
  transferOut: number;
  latestPrices: Map<string, StoredMarketPrice>;
  daily: DailyAttribution[];
}

function emptyPeriodPerformance(): PeriodPerformance {
  return {
    day: null,
    week: null,
    month: null,
    threeMonths: null,
    sixMonths: null,
    year: null,
  };
}

export function buildLiveModel(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
  purpose: "positions" | "history" = "history",
  requestedCutoff?: string,
): LiveModel {
  const today = currentMarketDate();
  const asOfDate =
    requestedCutoff && requestedCutoff < today ? requestedCutoff : today;
  const ledgerState = reduceLedger(entries, asOfDate);
  const { effectiveEntries: effective, reversedIds } = ledgerState;
  const pricesBySymbol = rowsBySymbol(prices);
  const allSymbols = [
    ...new Set(
      effective
        .filter((entry) => entry.type === "buy" || entry.type === "sell")
        .flatMap((entry) => entry.symbol ?? []),
    ),
  ];
  const heldSymbols = [...ledgerState.positions.entries()]
    .filter(([, position]) => position.quantity > 1e-8)
    .map(([symbol]) => symbol);
  const symbols = purpose === "positions" ? heldSymbols : allSymbols;
  const availableCutoffs = symbols
    .map((symbol) => pricesBySymbol.get(symbol)?.at(-1)?.date)
    .filter((date): date is string => Boolean(date));
  const factCutoffs = effective.flatMap((entry) => [
    entry.businessDate,
    ...(entry.type === "reverse_repo" &&
    entry.maturityDate &&
    entry.maturityDate <= asOfDate
      ? [entry.maturityDate]
      : []),
  ]);
  const currentAvailableCutoff = [...availableCutoffs, ...factCutoffs]
    .filter((date) => date <= asOfDate)
    .sort()
    .at(-1) ?? null;
  const cutoff =
    purpose === "history"
      ? requestedCutoff && requestedCutoff < today
        ? requestedCutoff
        : currentAvailableCutoff
      : availableCutoffs.length
        ? availableCutoffs.sort()[0]
        : null;
  const missingSymbols = symbols.filter(
    (symbol) => !(pricesBySymbol.get(symbol)?.length),
  );
  const issues: string[] = [];
  if (missingSymbols.length) {
    issues.push(`缺少 ${missingSymbols.length} 个标的的本地行情快照`);
  }
  const latestPrices = new Map<string, StoredMarketPrice>();
  if (cutoff) {
    for (const symbol of symbols) {
      const row = priceOnOrBefore(pricesBySymbol.get(symbol) ?? [], cutoff);
      if (row) latestPrices.set(symbol, row);
    }
  }
  const updatedAt = prices
    .map((row) => row.fetchedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const priceSource =
    purpose === "positions" && !heldSymbols.length
      ? "本地流水（当前无持仓行情）"
      : prices.map((row) => row.source).filter(Boolean).sort().at(-1) ??
        "本地流水（无行情快照）";
  const daily = buildDailyAttribution(
    effective,
    pricesBySymbol,
    cutoff,
    namesMap(stocks, entries),
  );
  return {
    cutoff,
    updatedAt,
    priceSource,
    missingSymbols,
    missingDates: daily.filter((day) => day.isPartial).map((day) => day.date),
    issues,
    effectiveEntries: effective,
    reversedIds,
    positions: ledgerState.positions,
    cash: ledgerState.cash,
    reverseRepoAsset: ledgerState.reverseRepoAsset,
    transferIn: ledgerState.transferIn,
    transferOut: ledgerState.transferOut,
    latestPrices,
    daily,
  };
}

export function qualityFor(
  model: LiveModel,
  hasFacts: boolean,
  additionalIssues: string[] = [],
): LiveDataQuality {
  const issues = [...model.issues, ...additionalIssues];
  const stale =
    model.cutoff !== null &&
    daysBetween(model.cutoff, currentMarketDate()) >
      LIVE_PRICE_STALE_AFTER_DAYS;
  return {
    status: !hasFacts
      ? "empty"
      : model.missingSymbols.length || model.missingDates.length || additionalIssues.length
        ? "partial"
        : stale
          ? "stale"
          : "ready",
    dataCutoff: model.cutoff,
    updatedAt: model.updatedAt,
    issues,
    missingSymbols: model.missingSymbols,
    missingDates: [...new Set(model.missingDates)],
  };
}

function compoundReturn(days: readonly DailyAttribution[]): number | null {
  const relevant = days.filter((day) => day.returnRate !== null);
  if (!relevant.length || days.some((day) => day.isPartial)) return null;
  return relevant.reduce((result, day) => result * (1 + day.returnRate!), 1) - 1;
}

function periodPerformance(
  daily: readonly DailyAttribution[],
  cutoff: string | null,
  symbol?: string,
): PeriodPerformance {
  if (!cutoff) return emptyPeriodPerformance();
  const result = emptyPeriodPerformance();
  for (const period of PERFORMANCE_PERIODS) {
    const start = addDays(cutoff, -LIVE_PERFORMANCE_PERIOD_DAYS[period] + 1);
    const selected = daily
      .filter((day) => day.date >= start && day.date <= cutoff)
      .map((day) => {
        if (!symbol) return day;
        const contribution = day.contributions.get(symbol);
        return {
          ...day,
          totalPnl: contribution?.totalPnl ?? 0,
          marketPricePnl: contribution?.marketPricePnl ?? 0,
          dividendPnl: contribution?.dividendPnl ?? 0,
          tradingCostPnl: contribution?.tradingCostPnl ?? 0,
          reverseRepoIncome: 0,
          returnRate: contribution?.returnRate ?? null,
          capitalBase: contribution?.capitalBase ?? 0,
          isPartial: contribution?.totalPnl === null,
        };
      });
    result[period] = compoundReturn(selected);
  }
  return result;
}

export function buildPositionsOverview(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
): PositionsOverview {
  const model = buildLiveModel(entries, prices, stocks, "positions");
  const names = namesMap(stocks, entries);
  const securityTypes = securityTypesMap(entries);
  const currentPositions = [...model.positions.entries()].filter(
    ([, position]) => position.quantity > 1e-8,
  );
  const positions = currentPositions.map(([symbol, position]) => {
    const quote = model.latestPrices.get(symbol);
    const marketValue = quote
      ? roundMoney(quote.close * position.quantity)
      : null;
    const unrealizedPnl =
      marketValue === null ? null : roundMoney(marketValue - position.cost);
    return {
      symbol,
      name: names.get(symbol) ?? symbol,
      securityType:
        securityTypes.get(symbol) ?? inferSecurityType(symbol, names.get(symbol)),
      quantity: position.quantity,
      cost: position.cost,
      averageCost: roundMoney(position.cost / position.quantity),
      lastPrice: quote?.close ?? null,
      marketValue,
      cumulativeInvestment: position.cumulativeInvestment,
      unrealizedPnl,
      realizedPnl: position.realizedPnl,
      cumulativeDividend: position.cumulativeDividend,
      totalReturn:
        unrealizedPnl === null
          ? null
          : roundMoney(
              unrealizedPnl +
                position.realizedPnl +
                position.cumulativeDividend,
            ),
      periodPerformance: periodPerformance(model.daily, model.cutoff, symbol),
      recentEntries: entries
        .filter((entry) => entry.symbol === symbol)
        .sort(canonicalLedgerOrderDescending)
        .slice(0, LIVE_RECENT_LEDGER_LIMIT)
        .map((entry) => toLedgerRecord(entry, names, model.reversedIds)),
    };
  });
  const marketValues = positions.map((position) => position.marketValue);
  const marketValue = marketValues.some((value) => value === null)
    ? null
    : roundMoney(marketValues.reduce<number>((sum, value) => sum + value!, 0));
  const totalAsset =
    marketValue === null
      ? null
      : roundMoney(model.cash + model.reverseRepoAsset + marketValue);
  const totalPnl =
    totalAsset === null
      ? null
      : roundMoney(totalAsset + model.transferOut - model.transferIn);
  const totalReturnRate =
    totalPnl === null || model.transferIn <= 0
      ? null
      : totalPnl / model.transferIn;
  const hasFacts = entries.length > 0;
  return {
    quality: qualityFor(model, hasFacts),
    hasLedgerEntries: hasFacts,
    metrics: {
      totalAsset: hasFacts ? totalAsset : null,
      marketValue: hasFacts ? marketValue : null,
      totalPnl: hasFacts ? totalPnl : null,
      totalReturnRate: hasFacts ? totalReturnRate : null,
      availableCash: model.cash,
      positionRatio:
        hasFacts &&
        totalAsset !== null &&
        totalAsset > 0 &&
        marketValue !== null
          ? marketValue / totalAsset
          : null,
    },
    portfolioPerformance: periodPerformance(model.daily, model.cutoff),
    positions,
    valuationSource: model.priceSource,
  };
}
