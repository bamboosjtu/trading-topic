/** 股票与 ETF 投资收益只读视图；投资事实统一由 ledgerReducer 归约。 */
import type {
  LedgerEntry,
  LiveDataQuality,
  MarketDataProvenance,
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
import { roundMoney, xirr } from "./finance";
import {
  addDays,
  currentMarketDate,
  daysBetween,
} from "./dateUtils";
import {
  canonicalLedgerOrderDescending,
  ledgerEntryAmount,
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
  provenance: MarketDataProvenance[];
  missingSymbols: string[];
  missingDates: string[];
  issues: string[];
  effectiveEntries: LedgerEntry[];
  reversedIds: Set<string>;
  positions: Map<string, InstrumentState>;
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

function priceProvenance(
  rows: readonly StoredMarketPrice[],
): MarketDataProvenance[] {
  const result = new Map<string, MarketDataProvenance>();
  for (const row of rows) {
    const item: MarketDataProvenance = {
      source: row.source,
      primarySource: "tencent",
      fallbackUsed: row.fallbackUsed,
      ...(row.fallbackReason ? { fallbackReason: row.fallbackReason } : {}),
      fetchedAt: row.fetchedAt,
      dataCutoff: row.dataCutoff,
      adjustment: row.adjustment,
    };
    const key = JSON.stringify(item);
    result.set(key, item);
  }
  return [...result.values()];
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
    .filter((date): date is string => Boolean(date))
    .filter((date) => date <= asOfDate);
  const cutoff =
    purpose === "history"
      ? requestedCutoff && requestedCutoff <= today
        ? requestedCutoff
        : availableCutoffs.sort().at(-1) ?? null
      : availableCutoffs.length === symbols.length && symbols.length
        ? availableCutoffs.sort()[0]
        : null;
  const missingSymbols = symbols.filter(
    (symbol) => !(pricesBySymbol.get(symbol)?.length),
  );
  const issues = missingSymbols.length
    ? [`缺少 ${missingSymbols.length} 个标的的本地正式收盘行情`]
    : [];
  const latestPrices = new Map<string, StoredMarketPrice>();
  if (cutoff) {
    for (const symbol of symbols) {
      const row = priceOnOrBefore(pricesBySymbol.get(symbol) ?? [], cutoff);
      if (row) latestPrices.set(symbol, row);
    }
  }
  const relevantPrices = prices.filter((row) => symbols.includes(row.symbol));
  const updatedAt =
    relevantPrices
      .map((row) => row.fetchedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const provenance = priceProvenance(relevantPrices);
  const priceSource = !symbols.length
    ? "本地投资事实（当前无持仓）"
    : provenance
        .map((item) =>
          item.fallbackUsed
            ? `新浪（腾讯失败：${item.fallbackReason ?? "未知原因"}）· ${item.adjustment === "qfq" ? "前复权" : "不复权"}`
            : `腾讯 · ${item.adjustment === "qfq" ? "前复权" : "不复权"}`,
        )
        .filter((value, index, array) => array.indexOf(value) === index)
        .join("、") || "无可用正式收盘行情";
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
    provenance,
    missingSymbols,
    missingDates: daily.filter((day) => day.isPartial).map((day) => day.date),
    issues,
    effectiveEntries: effective,
    reversedIds,
    positions: ledgerState.positions,
    latestPrices,
    daily,
  };
}

export function qualityFor(
  model: LiveModel,
  hasFacts: boolean,
  additionalIssues: string[] = [],
  allowStale = true,
): LiveDataQuality {
  const issues = [...model.issues, ...additionalIssues];
  const stale =
    allowStale &&
    model.cutoff !== null &&
    daysBetween(model.cutoff, currentMarketDate()) >
      LIVE_PRICE_STALE_AFTER_DAYS;
  return {
    status: !hasFacts
      ? "empty"
      : model.missingSymbols.length ||
          model.missingDates.length ||
          additionalIssues.length
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
          returnRate: contribution?.returnRate ?? null,
          capitalBase: contribution?.capitalBase ?? 0,
          isPartial: contribution?.totalPnl === null,
        };
      });
    result[period] = compoundReturn(selected);
  }
  return result;
}

function investmentXirr(
  entries: readonly LedgerEntry[],
  endingDate: string | null,
  endingValue: number | null,
): number | null {
  if (endingValue === null) return null;
  const cashflows = entries.flatMap((entry) => {
    const amount = ledgerEntryAmount(entry);
    if (entry.type === "buy") {
      return [{ date: entry.businessDate, amount: -(amount + (entry.fee ?? 0)) }];
    }
    if (entry.type === "sell") {
      return [{ date: entry.businessDate, amount: amount - (entry.fee ?? 0) }];
    }
    if (entry.type === "dividend") {
      return [{ date: entry.businessDate, amount }];
    }
    return [];
  });
  if (endingValue > 0) {
    if (!endingDate) return null;
    cashflows.push({ date: endingDate, amount: endingValue });
  }
  return xirr(cashflows.sort((a, b) => a.date.localeCompare(b.date)));
}

export function buildPositionsOverview(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
): PositionsOverview {
  const model = buildLiveModel(entries, prices, stocks, "positions");
  const state = reduceLedger(entries, currentMarketDate());
  const names = namesMap(stocks, entries);
  const securityTypes = securityTypesMap(stocks, entries);
  const currentPositions = [...state.positions.entries()].filter(
    ([, position]) => position.quantity > 1e-8,
  );
  const positions = currentPositions.map(([symbol, position]) => {
    const quote = model.latestPrices.get(symbol);
    const marketValue = quote
      ? roundMoney(quote.close * position.quantity)
      : null;
    const unrealizedPnl =
      marketValue === null ? null : roundMoney(marketValue - position.cost);
    const totalReturn =
      marketValue === null
        ? null
        : roundMoney(
            marketValue +
              position.cumulativeSellNetIncome +
              position.cumulativeDividend -
              position.cumulativeBuySpend,
          );
    const netInvestment = roundMoney(
      position.cumulativeBuySpend -
        position.cumulativeSellNetIncome -
        position.cumulativeDividend,
    );
    const symbolEntries = model.effectiveEntries.filter(
      (entry) => entry.symbol === symbol,
    );
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
      cumulativeBuySpend: position.cumulativeBuySpend,
      cumulativeSellNetIncome: position.cumulativeSellNetIncome,
      netInvestment,
      unrealizedPnl,
      realizedPnl: position.realizedPnl,
      cumulativeDividend: position.cumulativeDividend,
      totalReturn,
      totalReturnRate:
        totalReturn !== null && netInvestment > 0
          ? totalReturn / netInvestment
          : null,
      xirr: investmentXirr(symbolEntries, model.cutoff, marketValue),
      periodPerformance: periodPerformance(model.daily, model.cutoff, symbol),
      recentEntries: entries
        .filter((entry) => entry.symbol === symbol)
        .sort(canonicalLedgerOrderDescending)
        .slice(0, LIVE_RECENT_LEDGER_LIMIT)
        .map((entry) =>
          toLedgerRecord(entry, names, securityTypes, model.reversedIds),
        ),
    };
  });
  const marketValues = positions.map((position) => position.marketValue);
  const marketValue = marketValues.some((value) => value === null)
    ? null
    : roundMoney(marketValues.reduce<number>((sum, value) => sum + value!, 0));
  const remainingCost = [...state.positions.values()].reduce(
    (sum, position) => sum + position.cost,
    0,
  );
  const unrealizedPnl =
    marketValue === null ? null : roundMoney(marketValue - remainingCost);
  const totalReturn =
    marketValue === null
      ? null
      : roundMoney(
          marketValue +
            state.cumulativeSellNetIncome +
            state.cumulativeDividend -
            state.cumulativeBuySpend,
        );
  const hasFacts = model.effectiveEntries.length > 0;
  const lastFactDate =
    model.effectiveEntries
      .map((entry) => entry.businessDate)
      .sort()
      .at(-1) ?? null;
  return {
    quality: qualityFor(model, hasFacts),
    hasLedgerEntries: hasFacts,
    metrics: {
      marketValue: hasFacts ? marketValue : null,
      cumulativeBuySpend: state.cumulativeBuySpend,
      cumulativeSellNetIncome: state.cumulativeSellNetIncome,
      netInvestment: state.netInvestment,
      unrealizedPnl,
      realizedPnl: state.realizedPnl,
      cumulativeDividend: state.cumulativeDividend,
      totalReturn: hasFacts ? totalReturn : null,
      totalReturnRate:
        totalReturn !== null && state.netInvestment > 0
          ? totalReturn / state.netInvestment
          : null,
      // 已清仓时没有期末估值行情，现金流仍可在最后一笔事实日闭合。
      xirr: investmentXirr(
        model.effectiveEntries,
        model.cutoff ?? lastFactDate,
        marketValue,
      ),
    },
    portfolioPerformance: periodPerformance(model.daily, model.cutoff),
    positions,
    valuationSource: model.priceSource,
    provenance: model.provenance,
  };
}
