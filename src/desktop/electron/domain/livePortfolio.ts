import type {
  IncomeCalendarDay,
  IncomeCalendarQuery,
  IncomeCalendarView,
  LedgerEntry,
  LedgerQuery,
  LedgerQueryResult,
  LedgerRecordView,
  LiveDataQuality,
  PerformancePeriod,
  PeriodPerformance,
  PositionsOverview,
  SecurityType,
  StockInfo,
} from "../../shared/contracts";
import {
  LIVE_PERFORMANCE_PERIOD_DAYS,
  LIVE_PRICE_STALE_AFTER_DAYS,
  LIVE_RECENT_LEDGER_LIMIT,
} from "../../shared/constants";
import type { StoredMarketPrice } from "../storage/database";
import { roundMoney } from "./finance";

const PERFORMANCE_PERIODS = Object.keys(
  LIVE_PERFORMANCE_PERIOD_DAYS,
) as PerformancePeriod[];

interface InstrumentState {
  quantity: number;
  cost: number;
  cumulativeInvestment: number;
  cumulativeDividend: number;
  realizedPnl: number;
}

interface ContributionAttribution {
  holdingChange: number;
  pricePnl: number | null;
  dividendPnl: number;
  totalPnl: number | null;
  returnRate: number | null;
  capitalBase: number;
}

interface DailyAttribution {
  date: string;
  totalPnl: number | null;
  pricePnl: number | null;
  dividendPnl: number;
  returnRate: number | null;
  capitalBase: number;
  hasMarketData: boolean;
  isPartial: boolean;
  contributions: Map<string, ContributionAttribution>;
  events: IncomeCalendarDay["events"];
}

interface LiveModel {
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
  pricesBySymbol: Map<string, StoredMarketPrice[]>;
  latestPrices: Map<string, StoredMarketPrice>;
  daily: DailyAttribution[];
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  return Math.floor(
    (Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) /
      86_400_000,
  );
}

function inferSecurityType(symbol: string, name = ""): SecurityType {
  if (
    name.toUpperCase().includes("ETF") ||
    /^(15|16|50|51|52|56|58)/.test(symbol)
  ) {
    return "etf";
  }
  return "stock";
}

export function activeLedgerEntries(entries: readonly LedgerEntry[]): {
  effective: LedgerEntry[];
  reversedIds: Set<string>;
} {
  const reversedIds = new Set(
    entries
      .filter((entry) => entry.type === "adjustment" && entry.reversesEntryId)
      .map((entry) => entry.reversesEntryId!),
  );
  return {
    reversedIds,
    effective: entries
      .filter(
        (entry) => entry.type !== "adjustment" && !reversedIds.has(entry.id),
      )
      .sort(
        (left, right) =>
          left.businessDate.localeCompare(right.businessDate) ||
          left.recordedAt.localeCompare(right.recordedAt),
      ),
  };
}

function namesMap(stocks: readonly StockInfo[]): Map<string, string> {
  return new Map(stocks.map((stock) => [stock.symbol, stock.name]));
}

function entryAmount(entry: LedgerEntry): number {
  if (entry.amount !== undefined) return roundMoney(entry.amount);
  if (
    (entry.type === "buy" || entry.type === "sell") &&
    entry.price !== undefined &&
    entry.quantity !== undefined
  ) {
    return roundMoney(entry.price * entry.quantity);
  }
  return 0;
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

function rowsBySymbol(
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

function commonCutoff(
  symbols: readonly string[],
  prices: Map<string, StoredMarketPrice[]>,
): string | null {
  const cutoffs = symbols
    .map((symbol) => prices.get(symbol)?.at(-1)?.date)
    .filter((date): date is string => Boolean(date));
  if (!cutoffs.length) return null;
  return cutoffs.sort()[0];
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

function applyEntry(
  state: {
    cash: number;
    reverseRepoAsset: number;
    positions: Map<string, InstrumentState>;
  },
  entry: LedgerEntry,
  today: string,
): void {
  const amount = entryAmount(entry);
  if (entry.type === "transfer_in") {
    state.cash += amount;
    return;
  }
  if (entry.type === "transfer_out") {
    state.cash -= amount;
    return;
  }
  if (entry.type === "buy" && entry.symbol) {
    const quantity = entry.quantity ?? 0;
    const fee = entry.fee ?? 0;
    const current = state.positions.get(entry.symbol) ?? {
      quantity: 0,
      cost: 0,
      cumulativeInvestment: 0,
      cumulativeDividend: 0,
      realizedPnl: 0,
    };
    state.cash -= amount + fee;
    current.quantity += quantity;
    current.cost = roundMoney(current.cost + amount + fee);
    current.cumulativeInvestment = roundMoney(
      current.cumulativeInvestment + amount + fee,
    );
    state.positions.set(entry.symbol, current);
    return;
  }
  if (entry.type === "sell" && entry.symbol) {
    const quantity = entry.quantity ?? 0;
    const fee = entry.fee ?? 0;
    const current = state.positions.get(entry.symbol) ?? {
      quantity: 0,
      cost: 0,
      cumulativeInvestment: 0,
      cumulativeDividend: 0,
      realizedPnl: 0,
    };
    if (quantity > current.quantity + 1e-8) {
      throw new Error(`${entry.symbol} 卖出数量超过有效持仓`);
    }
    const releasedCost =
      current.quantity > 0 ? current.cost * (quantity / current.quantity) : 0;
    current.quantity = Math.max(0, current.quantity - quantity);
    current.cost = roundMoney(Math.max(0, current.cost - releasedCost));
    current.realizedPnl = roundMoney(
      current.realizedPnl + amount - fee - releasedCost,
    );
    state.cash += amount - fee;
    state.positions.set(entry.symbol, current);
    return;
  }
  if (entry.type === "dividend") {
    state.cash += amount;
    if (entry.symbol) {
      const current = state.positions.get(entry.symbol) ?? {
        quantity: 0,
        cost: 0,
        cumulativeInvestment: 0,
        cumulativeDividend: 0,
        realizedPnl: 0,
      };
      current.cumulativeDividend = roundMoney(
        current.cumulativeDividend + amount,
      );
      state.positions.set(entry.symbol, current);
    }
    return;
  }
  if (entry.type === "reverse_repo") {
    state.cash -= amount;
    const maturityDate = entry.maturityDate ?? entry.businessDate;
    const maturityAmount = entry.maturityAmount ?? amount;
    if (maturityDate <= today) state.cash += maturityAmount;
    else state.reverseRepoAsset += maturityAmount;
  }
}

function portfolioValue(
  cash: number,
  reverseRepoAsset: number,
  positions: Map<string, InstrumentState>,
  prices: Map<string, number>,
): number | null {
  let value = cash + reverseRepoAsset;
  for (const [symbol, position] of positions) {
    if (position.quantity <= 1e-8) continue;
    const price = prices.get(symbol);
    if (price === undefined) return null;
    value += position.quantity * price;
  }
  return roundMoney(value);
}

function buildDailyModel(
  entries: readonly LedgerEntry[],
  pricesBySymbol: Map<string, StoredMarketPrice[]>,
  cutoff: string | null,
  names: Map<string, string>,
): DailyAttribution[] {
  if (!cutoff) return [];
  const dates = new Set<string>();
  for (const rows of pricesBySymbol.values()) {
    for (const row of rows) if (row.date <= cutoff) dates.add(row.date);
  }
  for (const entry of entries) {
    if (entry.businessDate <= cutoff) dates.add(entry.businessDate);
    if (
      entry.type === "reverse_repo" &&
      entry.maturityDate &&
      entry.maturityDate <= cutoff
    ) {
      dates.add(entry.maturityDate);
    }
  }
  const orderedDates = [...dates].filter(validDate).sort();
  if (!orderedDates.length) return [];

  const entriesByDate = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const current = entriesByDate.get(entry.businessDate) ?? [];
    current.push(entry);
    entriesByDate.set(entry.businessDate, current);
  }
  const closingByDate = new Map<string, Map<string, number>>();
  const repoMaturitiesByDate = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (entry.type !== "reverse_repo" || !entry.maturityDate) continue;
    const current = repoMaturitiesByDate.get(entry.maturityDate) ?? [];
    current.push(entry);
    repoMaturitiesByDate.set(entry.maturityDate, current);
  }
  for (const [symbol, rows] of pricesBySymbol) {
    for (const row of rows) {
      if (row.date > cutoff) continue;
      const current = closingByDate.get(row.date) ?? new Map<string, number>();
      current.set(symbol, row.close);
      closingByDate.set(row.date, current);
    }
  }

  const positions = new Map<string, InstrumentState>();
  const accountState = {
    cash: 0,
    reverseRepoAsset: 0,
    positions,
  };
  const lastPrices = new Map<string, number>();
  const daily: DailyAttribution[] = [];

  for (const date of orderedDates) {
    const openingPositions = new Map(
      [...positions.entries()].map(([symbol, value]) => [
        symbol,
        { ...value },
      ]),
    );
    const openingValue = portfolioValue(
      accountState.cash,
      accountState.reverseRepoAsset,
      openingPositions,
      lastPrices,
    );
    const todaysPrices = closingByDate.get(date);
    if (todaysPrices) {
      for (const [symbol, price] of todaysPrices) lastPrices.set(symbol, price);
    }
    const todaysEntries = entriesByDate.get(date) ?? [];
    let externalFlow = 0;
    let dividendPnl = 0;
    const contributions = new Map<string, ContributionAttribution>();
    const events: IncomeCalendarDay["events"] = [];

    for (const entry of todaysEntries) {
      if (entry.type === "transfer_in") externalFlow += entryAmount(entry);
      if (entry.type === "transfer_out") externalFlow -= entryAmount(entry);
      if (entry.type === "dividend") dividendPnl += entryAmount(entry);
      if (entry.symbol) {
        const item = contributions.get(entry.symbol) ?? {
          holdingChange: 0,
          pricePnl: 0,
          dividendPnl: 0,
          totalPnl: 0,
          returnRate: null,
          capitalBase: 0,
        };
        if (entry.type === "buy") item.holdingChange += entry.quantity ?? 0;
        if (entry.type === "sell") item.holdingChange -= entry.quantity ?? 0;
        if (entry.type === "dividend") item.dividendPnl += entryAmount(entry);
        contributions.set(entry.symbol, item);
      }
      events.push({
        type: entry.type,
        symbol: entry.symbol ?? null,
        name: entry.symbol ? (names.get(entry.symbol) ?? entry.symbol) : null,
        quantity: entry.quantity ?? null,
        perShare: entry.perShare ?? null,
        amount:
          entry.amount ?? (["buy", "sell"].includes(entry.type) ? entryAmount(entry) : null),
        note: entry.note ?? null,
      });
      if (entry.type === "reverse_repo") {
        const principal = entryAmount(entry);
        accountState.cash -= principal;
        accountState.reverseRepoAsset += principal;
      } else {
        applyEntry(accountState, entry, date);
      }
    }
    for (const repo of repoMaturitiesByDate.get(date) ?? []) {
      const principal = entryAmount(repo);
      const maturityAmount = repo.maturityAmount ?? principal;
      accountState.reverseRepoAsset = Math.max(
        0,
        accountState.reverseRepoAsset - principal,
      );
      accountState.cash += maturityAmount;
      events.push({
        type: "reverse_repo_maturity",
        symbol: null,
        name: null,
        quantity: null,
        perShare: null,
        amount: roundMoney(maturityAmount - principal),
        note: repo.note ?? null,
      });
    }

    for (const symbol of new Set([
      ...openingPositions.keys(),
      ...positions.keys(),
      ...contributions.keys(),
    ])) {
      const item = contributions.get(symbol) ?? {
        holdingChange: 0,
        pricePnl: 0,
        dividendPnl: 0,
        totalPnl: 0,
        returnRate: null,
        capitalBase: 0,
      };
      const previousPrice = priceOnOrBefore(
        pricesBySymbol.get(symbol) ?? [],
        addDays(date, -1),
      )?.close;
      const close = priceOnOrBefore(
        pricesBySymbol.get(symbol) ?? [],
        date,
      )?.close;
      const openingQuantity = openingPositions.get(symbol)?.quantity ?? 0;
      if (
        openingQuantity > 1e-8 &&
        (previousPrice === undefined || close === undefined)
      ) {
        item.pricePnl = null;
        item.totalPnl = null;
        item.returnRate = null;
      } else {
        let pricePnl =
          openingQuantity > 1e-8
            ? openingQuantity * ((close ?? previousPrice ?? 0) - (previousPrice ?? close ?? 0))
            : 0;
        for (const entry of todaysEntries.filter((row) => row.symbol === symbol)) {
          if (entry.type === "buy" && close !== undefined) {
            pricePnl +=
              (entry.quantity ?? 0) * (close - (entry.price ?? close)) -
              (entry.fee ?? 0);
          } else if (entry.type === "sell" && close !== undefined) {
            pricePnl +=
              (entry.quantity ?? 0) * ((entry.price ?? close) - close) -
              (entry.fee ?? 0);
          }
        }
        item.pricePnl = roundMoney(pricePnl);
        item.totalPnl = roundMoney(pricePnl + item.dividendPnl);
        const investedToday = todaysEntries
          .filter((row) => row.symbol === symbol && row.type === "buy")
          .reduce(
            (sum, row) => sum + entryAmount(row) + (row.fee ?? 0),
            0,
          );
        const base =
          openingQuantity * (previousPrice ?? close ?? 0) + investedToday;
        item.capitalBase = base;
        item.returnRate = base > 0 ? item.totalPnl / base : null;
      }
      contributions.set(symbol, item);
    }

    const endValue = portfolioValue(
      accountState.cash,
      accountState.reverseRepoAsset,
      positions,
      lastPrices,
    );
    const totalPnl =
      openingValue === null || endValue === null
        ? null
        : roundMoney(endValue - openingValue - externalFlow);
    const pricePnl =
      totalPnl === null ? null : roundMoney(totalPnl - dividendPnl);
    const base =
      openingValue === null ? 0 : openingValue + Math.max(externalFlow, 0);
    const returnRate =
      totalPnl === null || base <= 0 ? null : totalPnl / base;
    const hasHeldPosition = [...positions.values()].some(
      (position) => position.quantity > 1e-8,
    );
    daily.push({
      date,
      totalPnl,
      pricePnl,
      dividendPnl: roundMoney(dividendPnl),
      returnRate,
      capitalBase: base,
      hasMarketData: Boolean(todaysPrices?.size),
      isPartial: hasHeldPosition && endValue === null,
      contributions,
      events,
    });
  }
  return daily;
}

function buildLiveModel(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
  purpose: "positions" | "history" = "history",
): LiveModel {
  const { effective, reversedIds } = activeLedgerEntries(entries);
  const pricesBySymbol = rowsBySymbol(prices);
  const allSymbols = [
    ...new Set(effective.flatMap((entry) => entry.symbol ?? [])),
  ];
  const provisional = {
    cash: 0,
    reverseRepoAsset: 0,
    positions: new Map<string, InstrumentState>(),
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of effective) applyEntry(provisional, entry, today);
  const heldSymbols = [...provisional.positions.entries()]
    .filter(([, position]) => position.quantity > 1e-8)
    .map(([symbol]) => symbol);
  const symbols = purpose === "positions" ? heldSymbols : allSymbols;
  const cutoff = commonCutoff(symbols, pricesBySymbol);
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
  const state = {
    cash: 0,
    reverseRepoAsset: 0,
    positions: new Map<string, InstrumentState>(),
  };
  let transferIn = 0;
  let transferOut = 0;
  const valuationDate = cutoff ?? today;
  for (const entry of effective) {
    if (entry.type === "transfer_in") transferIn += entryAmount(entry);
    if (entry.type === "transfer_out") transferOut += entryAmount(entry);
    applyEntry(state, entry, valuationDate);
  }
  const daily = buildDailyModel(effective, pricesBySymbol, cutoff, namesMap(stocks));
  return {
    cutoff,
    updatedAt,
    priceSource,
    missingSymbols,
    missingDates: daily.filter((day) => day.isPartial).map((day) => day.date),
    issues,
    effectiveEntries: effective,
    reversedIds,
    positions: state.positions,
    cash: roundMoney(state.cash),
    reverseRepoAsset: roundMoney(state.reverseRepoAsset),
    transferIn: roundMoney(transferIn),
    transferOut: roundMoney(transferOut),
    pricesBySymbol,
    latestPrices,
    daily,
  };
}

function qualityFor(
  model: LiveModel,
  hasFacts: boolean,
  additionalIssues: string[] = [],
): LiveDataQuality {
  const issues = [...model.issues, ...additionalIssues];
  const stale =
    model.cutoff !== null &&
    daysBetween(model.cutoff, new Date().toISOString().slice(0, 10)) >
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
          pricePnl: contribution?.pricePnl ?? 0,
          dividendPnl: contribution?.dividendPnl ?? 0,
          returnRate: contribution?.returnRate ?? null,
          capitalBase: contribution?.capitalBase ?? 0,
          isPartial: contribution?.totalPnl === null,
        };
      });
    result[period] = compoundReturn(selected);
  }
  return result;
}

function toLedgerRecord(
  entry: LedgerEntry,
  names: Map<string, string>,
  reversedIds: Set<string>,
): LedgerRecordView {
  return {
    id: entry.id,
    businessDate: entry.businessDate,
    type: entry.type,
    symbol: entry.symbol ?? null,
    name: entry.symbol ? (names.get(entry.symbol) ?? entry.symbol) : null,
    securityType: entry.symbol
      ? inferSecurityType(entry.symbol, names.get(entry.symbol))
      : null,
    quantity: entry.quantity ?? null,
    price: entry.price ?? null,
    amount:
      entry.amount ??
      (entry.type === "buy" || entry.type === "sell"
        ? entryAmount(entry)
        : null),
    fee: entry.fee ?? 0,
    note: entry.note ?? null,
    repoCode: entry.repoCode ?? null,
    annualRate: entry.annualRate ?? null,
    termDays: entry.termDays ?? null,
    maturityAmount: entry.maturityAmount ?? null,
    maturityDate: entry.maturityDate ?? null,
    perShare: entry.perShare ?? null,
    recordDate: entry.recordDate ?? null,
    paymentDate: entry.paymentDate ?? null,
    isReversed: reversedIds.has(entry.id),
    reversesEntryId: entry.reversesEntryId ?? null,
  };
}

export function buildPositionsOverview(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
): PositionsOverview {
  const model = buildLiveModel(entries, prices, stocks, "positions");
  const names = namesMap(stocks);
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
      securityType: inferSecurityType(symbol, names.get(symbol)),
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
        .sort(
          (left, right) =>
            right.businessDate.localeCompare(left.businessDate) ||
            right.recordedAt.localeCompare(left.recordedAt),
        )
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

function matchesQuery(
  row: LedgerRecordView,
  query: LedgerQuery,
): boolean {
  if (query.startDate && row.businessDate < query.startDate) return false;
  if (query.endDate && row.businessDate > query.endDate) return false;
  if (query.entryTypes?.length && !query.entryTypes.includes(row.type)) return false;
  if (query.securityType && row.securityType !== query.securityType) return false;
  if (query.symbol && row.symbol !== query.symbol) return false;
  if (query.keyword) {
    const keyword = query.keyword.trim().toLowerCase();
    if (
      keyword &&
      ![row.symbol, row.name, row.note]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword))
    ) {
      return false;
    }
  }
  return true;
}

export function queryLedgerRecords(
  entries: readonly LedgerEntry[],
  stocks: readonly StockInfo[],
  query: LedgerQuery,
  integrityError: string | null = null,
): LedgerQueryResult {
  if (![20, 50, 100].includes(query.pageSize)) {
    throw new Error("流水分页大小只支持 20、50 或 100");
  }
  if (
    (query.startDate && !validDate(query.startDate)) ||
    (query.endDate && !validDate(query.endDate))
  ) {
    throw new Error("流水日期筛选必须使用合法的 YYYY-MM-DD");
  }
  if (
    query.startDate &&
    query.endDate &&
    query.startDate > query.endDate
  ) {
    throw new Error("流水开始日期不能晚于结束日期");
  }
  const names = namesMap(stocks);
  const { effective, reversedIds } = activeLedgerEntries(entries);
  const allRows = entries
    .map((entry) => toLedgerRecord(entry, names, reversedIds))
    .filter((row) => matchesQuery(row, query))
    .sort(
      (left, right) =>
        right.businessDate.localeCompare(left.businessDate) ||
        right.id.localeCompare(left.id),
    );
  const effectiveIds = new Set(effective.map((entry) => entry.id));
  const aggregateRows = allRows.filter(
    (row) => effectiveIds.has(row.id) && row.type !== "adjustment",
  );
  const page = Math.max(1, Math.floor(query.page));
  const pageSize = query.pageSize;
  const offset = (page - 1) * pageSize;
  const symbols = [...new Set(entries.flatMap((entry) => entry.symbol ?? []))];
  const quality: LiveDataQuality = {
    status: entries.length ? (integrityError ? "partial" : "ready") : "empty",
    dataCutoff: null,
    updatedAt:
      entries.map((entry) => entry.recordedAt).sort().at(-1) ?? null,
    issues: integrityError ? [`账户完整性校验失败：${integrityError}`] : [],
    missingSymbols: [],
    missingDates: [],
  };
  return {
    quality,
    integrityError,
    metrics: {
      recordCount: allRows.length,
      totalBuy: roundMoney(
        aggregateRows
          .filter((row) => row.type === "buy")
          .reduce((sum, row) => sum + (row.amount ?? 0) + row.fee, 0),
      ),
      totalSell: roundMoney(
        aggregateRows
          .filter((row) => row.type === "sell")
          .reduce((sum, row) => sum + (row.amount ?? 0) - row.fee, 0),
      ),
      totalDividend: roundMoney(
        aggregateRows
          .filter((row) => row.type === "dividend")
          .reduce((sum, row) => sum + (row.amount ?? 0), 0),
      ),
      netTransferIn: roundMoney(
        aggregateRows
          .filter(
            (row) =>
              row.type === "transfer_in" || row.type === "transfer_out",
          )
          .reduce(
            (sum, row) =>
              sum +
              (row.type === "transfer_in" ? 1 : -1) * (row.amount ?? 0),
            0,
          ),
      ),
    },
    rows: allRows.slice(offset, offset + pageSize),
    total: allRows.length,
    page,
    pageSize,
    symbolOptions: symbols
      .sort()
      .map((symbol) => ({
        symbol,
        name: names.get(symbol) ?? symbol,
        securityType: inferSecurityType(symbol, names.get(symbol)),
      })),
  };
}

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
): IncomeCalendarView {
  if (!/^\d{4}-\d{2}$/.test(query.month)) {
    throw new Error("收益月份必须使用 YYYY-MM 格式");
  }
  const model = buildLiveModel(entries, prices, stocks);
  const names = namesMap(stocks);
  const activeSymbols = new Set(
    [...model.positions.entries()]
      .filter(([, position]) => position.quantity > 1e-8)
      .map(([symbol]) => symbol),
  );
  const selectedSymbols =
    query.symbol
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
    const priceValues = [...selectedContributions.values()].map(
      (value) => value.pricePnl,
    );
    const totalPnl = totalValues.some((value) => value === null)
      ? null
      : roundMoney(totalValues.reduce<number>((sum, value) => sum + value!, 0));
    const pricePnl = priceValues.some((value) => value === null)
      ? null
      : roundMoney(priceValues.reduce<number>((sum, value) => sum + value!, 0));
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
    return {
      ...day,
      totalPnl,
      pricePnl,
      dividendPnl,
      capitalBase,
      returnRate:
        totalPnl !== null && capitalBase > 0 ? totalPnl / capitalBase : null,
      contributions: selectedContributions,
      events: day.events.filter(
        (event) => !event.symbol || selectedSymbols.has(event.symbol),
      ),
      isPartial: totalValues.some((value) => value === null),
    };
  };
  const filteredDaily = model.daily.map(filterDay);
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
      pricePnl: day.pricePnl,
      dividendPnl: day.dividendPnl,
      returnRate: day.returnRate,
      hasMarketData: day.hasMarketData,
      isPartial: day.isPartial,
      contributions: [...day.contributions.entries()]
        .map(([symbol, contribution]) => ({
          symbol,
          name: names.get(symbol) ?? symbol,
          holdingChange: contribution.holdingChange,
          pricePnl: contribution.pricePnl,
          dividendPnl: contribution.dividendPnl,
          totalPnl: contribution.totalPnl,
        }))
        .sort(
          (left, right) =>
            Math.abs(right.totalPnl ?? 0) - Math.abs(left.totalPnl ?? 0),
        ),
      events: day.events,
    }),
  );
  const monthPrice = incomeMetric(monthDays, (day) => day.pricePnl);
  const monthDividend = incomeMetric(monthDays, (day) => day.dividendPnl);
  return {
    quality: qualityFor(
      model,
      entries.length > 0,
      monthDays.some((day) => day.isPartial)
        ? ["所选月份存在缺失行情，部分收益无法计算"]
        : [],
    ),
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
      price: monthPrice,
      dividend: monthDividend,
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
