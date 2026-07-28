import type {
  IncomeCalendarDay,
  LedgerEntry,
} from "../../shared/contracts";
import type { StoredMarketPrice } from "../storage/database";
import { addDays, validDate } from "./dateUtils";
import { roundMoney } from "./finance";
import {
  ledgerEntryAmount,
  reduceLedger,
  type LedgerPositionState,
} from "./ledgerReducer";

export interface ContributionAttribution {
  holdingChange: number;
  marketPricePnl: number | null;
  dividendPnl: number;
  tradingCostPnl: number;
  reverseRepoIncome: number;
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
  reverseRepoIncome: number;
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

function portfolioValue(
  cash: number,
  reverseRepoAsset: number,
  positions: Map<string, LedgerPositionState>,
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

export function buildDailyAttribution(
  entries: readonly LedgerEntry[],
  pricesBySymbol: Map<string, StoredMarketPrice[]>,
  cutoff: string | null,
  names: Map<string, string>,
): DailyAttribution[] {
  if (!cutoff) return [];
  const dates = new Set<string>();
  for (const rows of pricesBySymbol.values()) {
    for (const row of rows) {
      if (row.date <= cutoff) dates.add(row.date);
    }
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

  const daily: DailyAttribution[] = [];
  for (const date of orderedDates) {
    const previousDate = addDays(date, -1);
    const openingState = reduceLedger(entries, previousDate);
    const closingState = reduceLedger(entries, date);
    const openingPositions = openingState.positions;
    const positions = closingState.positions;
    const previousPrices = new Map<string, number>();
    const closingPrices = new Map<string, number>();
    for (const symbol of new Set([
      ...openingPositions.keys(),
      ...positions.keys(),
    ])) {
      const rows = pricesBySymbol.get(symbol) ?? [];
      const previous = priceOnOrBefore(rows, previousDate);
      const closing = priceOnOrBefore(rows, date);
      if (previous) previousPrices.set(symbol, previous.close);
      if (closing) closingPrices.set(symbol, closing.close);
    }
    const openingValue = portfolioValue(
      openingState.cash,
      openingState.reverseRepoAsset,
      openingPositions,
      previousPrices,
    );
    const todaysPrices = closingByDate.get(date);
    const todaysEntries = entriesByDate.get(date) ?? [];
    let externalFlow = 0;
    let dividendPnl = 0;
    const contributions = new Map<string, ContributionAttribution>();
    const events: IncomeCalendarDay["events"] = [];

    for (const entry of todaysEntries) {
      if (entry.type === "transfer_in") {
        externalFlow += ledgerEntryAmount(entry);
      }
      if (entry.type === "transfer_out") {
        externalFlow -= ledgerEntryAmount(entry);
      }
      if (entry.type === "dividend") {
        dividendPnl += ledgerEntryAmount(entry);
      }
      if (entry.symbol) {
        const item = contributions.get(entry.symbol) ?? {
          holdingChange: 0,
          marketPricePnl: 0,
          dividendPnl: 0,
          tradingCostPnl: 0,
          reverseRepoIncome: 0,
          totalPnl: 0,
          returnRate: null,
          capitalBase: 0,
        };
        if (entry.type === "buy") item.holdingChange += entry.quantity ?? 0;
        if (entry.type === "sell") item.holdingChange -= entry.quantity ?? 0;
        if (entry.type === "dividend") {
          item.dividendPnl += ledgerEntryAmount(entry);
        }
        contributions.set(entry.symbol, item);
      }
      events.push({
        type: entry.type,
        symbol: entry.symbol ?? null,
        name: entry.symbol ? (names.get(entry.symbol) ?? entry.symbol) : null,
        quantity: entry.quantity ?? null,
        perShare: entry.perShare ?? null,
        amount:
          entry.amount ??
          (["buy", "sell"].includes(entry.type)
            ? ledgerEntryAmount(entry)
            : null),
        note: entry.note ?? null,
      });
    }

    let reverseRepoIncome = 0;
    for (const repo of repoMaturitiesByDate.get(date) ?? []) {
      const principal = ledgerEntryAmount(repo);
      if (repo.maturityAmount === undefined) {
        throw new Error("逆回购事实缺少实际到期金额");
      }
      const income = roundMoney(repo.maturityAmount - principal);
      reverseRepoIncome = roundMoney(reverseRepoIncome + income);
      events.push({
        type: "reverse_repo_maturity",
        symbol: null,
        name: null,
        quantity: null,
        perShare: null,
        amount: income,
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
        marketPricePnl: 0,
        dividendPnl: 0,
        tradingCostPnl: 0,
        reverseRepoIncome: 0,
        totalPnl: 0,
        returnRate: null,
        capitalBase: 0,
      };
      const previousPrice = priceOnOrBefore(
        pricesBySymbol.get(symbol) ?? [],
        previousDate,
      )?.close;
      const exactClose = todaysPrices?.get(symbol);
      // 其他标的在该日有行情时，不能用更早收盘价掩盖本标的的数据缺口。
      // 只有流水/逆回购产生的非行情日期才沿用前一有效估值。
      const close =
        exactClose ??
        (todaysPrices?.size
          ? undefined
          : priceOnOrBefore(pricesBySymbol.get(symbol) ?? [], date)?.close);
      const openingQuantity = openingPositions.get(symbol)?.quantity ?? 0;
      const closingQuantity = positions.get(symbol)?.quantity ?? 0;
      const hasTradeToday = todaysEntries.some(
        (entry) =>
          entry.symbol === symbol &&
          (entry.type === "buy" || entry.type === "sell"),
      );
      if (
        (openingQuantity > 1e-8 && previousPrice === undefined) ||
        ((openingQuantity > 1e-8 ||
          closingQuantity > 1e-8 ||
          hasTradeToday) &&
          close === undefined)
      ) {
        item.marketPricePnl = null;
        item.totalPnl = null;
        item.returnRate = null;
      } else {
        const marketPricePnl =
          openingQuantity > 1e-8
            ? openingQuantity *
              ((close ?? previousPrice ?? 0) -
                (previousPrice ?? close ?? 0))
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
          marketPricePnl + item.dividendPnl + tradingCostPnl,
        );
        const investedToday = todaysEntries
          .filter((row) => row.symbol === symbol && row.type === "buy")
          .reduce(
            (sum, row) => sum + ledgerEntryAmount(row) + (row.fee ?? 0),
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
      closingState.cash,
      closingState.reverseRepoAsset,
      positions,
      closingPrices,
    );
    const contributionValues = [...contributions.values()];
    const marketPricePnl = contributionValues.some(
      (item) => item.marketPricePnl === null,
    )
      ? null
      : roundMoney(
          contributionValues.reduce(
            (sum, item) => sum + item.marketPricePnl!,
            0,
          ),
        );
    const tradingCostPnl = roundMoney(
      contributionValues.reduce(
        (sum, item) => sum + item.tradingCostPnl,
        0,
      ),
    );
    const totalPnl =
      openingValue === null ||
      endValue === null ||
      marketPricePnl === null
        ? null
        : roundMoney(
            marketPricePnl +
              dividendPnl +
              tradingCostPnl +
              reverseRepoIncome,
          );
    const base =
      openingValue === null ? 0 : openingValue + Math.max(externalFlow, 0);
    const returnRate =
      totalPnl === null || base <= 0 ? null : totalPnl / base;
    const isPartial =
      contributionValues.some((item) => item.totalPnl === null) ||
      ([...openingPositions.values(), ...positions.values()].some(
        (position) => position.quantity > 1e-8,
      ) &&
        (openingValue === null || endValue === null));
    daily.push({
      date,
      totalPnl,
      marketPricePnl,
      dividendPnl: roundMoney(dividendPnl),
      tradingCostPnl,
      reverseRepoIncome,
      returnRate,
      capitalBase: base,
      hasMarketData: Boolean(todaysPrices?.size),
      isPartial,
      contributions,
      events,
    });
  }
  return daily;
}
