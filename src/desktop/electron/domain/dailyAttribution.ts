import type {
  IncomeCalendarDay,
  LedgerEntry,
} from "../../shared/contracts";
import type { StoredMarketPrice } from "../storage/database";
import { addDays, validDate } from "./dateUtils";
import { roundMoney } from "./finance";
import {
  canonicalLedgerOrder,
  ledgerEntryAmount,
  reduceLedger,
} from "./ledgerReducer";

export interface ContributionAttribution {
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

export function priceOnOrBefore(
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

function reinvestedDividendByBuy(
  entries: readonly LedgerEntry[],
): Map<string, number> {
  const groups = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (
      !entry.linkedGroupId ||
      !entry.symbol ||
      (entry.type !== "buy" && entry.type !== "dividend")
    ) {
      continue;
    }
    const key = `${entry.linkedGroupId}\u0000${entry.symbol}`;
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }

  const result = new Map<string, number>();
  for (const group of groups.values()) {
    const dividends = group
      .filter((entry) => entry.type === "dividend")
      .sort(canonicalLedgerOrder);
    const buys = group
      .filter((entry) => entry.type === "buy")
      .sort(canonicalLedgerOrder);
    let allocated = 0;
    for (const buy of buys) {
      const available = roundMoney(
        dividends
          .filter(
            (dividend) => dividend.businessDate <= buy.businessDate,
          )
          .reduce(
            (sum, dividend) => sum + ledgerEntryAmount(dividend),
            0,
          ) - allocated,
      );
      const buySpend = roundMoney(
        ledgerEntryAmount(buy) + (buy.fee ?? 0),
      );
      const internalFunding = roundMoney(
        Math.max(0, Math.min(buySpend, available)),
      );
      result.set(buy.id, internalFunding);
      allocated = roundMoney(allocated + internalFunding);
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
  const internalFundingByBuy = reinvestedDividendByBuy(entries);
  const holdingIntervals = new Map<
    string,
    Array<{ startDate: string; endDate: string }>
  >();
  const quantities = new Map<string, number>();
  const starts = new Map<string, string>();
  for (const entry of [...entries].sort(canonicalLedgerOrder)) {
    if (
      entry.businessDate > factAsOfDate ||
      !entry.symbol ||
      (entry.type !== "buy" && entry.type !== "sell")
    ) {
      continue;
    }
    const before = quantities.get(entry.symbol) ?? 0;
    const after =
      before +
      (entry.type === "buy"
        ? (entry.quantity ?? 0)
        : -(entry.quantity ?? 0));
    if (before <= 1e-8 && after > 1e-8) {
      starts.set(entry.symbol, entry.businessDate);
    }
    if (before > 1e-8 && after <= 1e-8) {
      const startDate = starts.get(entry.symbol);
      if (startDate) {
        const current = holdingIntervals.get(entry.symbol) ?? [];
        current.push({ startDate, endDate: entry.businessDate });
        holdingIntervals.set(entry.symbol, current);
      }
      starts.delete(entry.symbol);
    }
    quantities.set(entry.symbol, Math.max(0, after));
  }
  for (const [symbol, startDate] of starts) {
    const current = holdingIntervals.get(symbol) ?? [];
    current.push({ startDate, endDate: factAsOfDate });
    holdingIntervals.set(symbol, current);
  }

  const dates = new Set<string>();
  for (const [symbol, rows] of pricesBySymbol) {
    const intervals = holdingIntervals.get(symbol) ?? [];
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
    [...holdingIntervals.values()].some((intervals) =>
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
      const needsOfficialClose =
        Boolean(todaysPrices?.size) ||
        hasTradeToday ||
        (date === valuationCutoff &&
          (openingQuantity > 1e-8 || closingQuantity > 1e-8));
      const item = contributions.get(symbol) ?? emptyContribution();

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
