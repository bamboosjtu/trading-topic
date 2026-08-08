import type {
  IncomeCalendarQuery,
  LedgerEntry,
  StoredMarketCoverage,
} from "../../shared/contracts";
import { addDays, currentMarketDate, monthEnd } from "../domain/dateUtils";
import {
  activeLedgerEntries,
  holdingIntervals,
  reduceLedger,
} from "../domain/ledgerReducer";
import { isConfirmedMarketClosureRange } from "../domain/marketCalendar";

export interface LivePriceRange {
  symbol: string;
  startDate: string;
  endDate: string;
}

export function confirmedCoverageThrough(
  coverage: StoredMarketCoverage,
): string | null {
  if (coverage.resultStatus === "empty") {
    return coverage.emptyEvidence ? coverage.requestedThrough : null;
  }
  // partial 不确认任何覆盖区间，后续必须重新请求完整原始区间，避免替换
  // partial 覆盖时级联丢失错误日期之前的正常价格行。
  if (coverage.resultStatus === "partial" || !coverage.dataCutoff) {
    return null;
  }
  if (coverage.dataCutoff >= coverage.requestedThrough) {
    return coverage.requestedThrough;
  }
  return isConfirmedMarketClosureRange(
    addDays(coverage.dataCutoff, 1),
    coverage.requestedThrough,
  )
    ? coverage.requestedThrough
    : coverage.dataCutoff;
}

/** 按证券合并重叠或首尾相接的行情请求区间。 */
export function normalizeLivePriceRanges(
  ranges: readonly LivePriceRange[],
): LivePriceRange[] {
  const bySymbol = new Map<string, LivePriceRange[]>();
  for (const range of ranges) {
    const list = bySymbol.get(range.symbol) ?? [];
    list.push(range);
    bySymbol.set(range.symbol, list);
  }

  return [...bySymbol.entries()].flatMap(([symbol, list]) => {
    const sorted = [...list].sort((left, right) =>
      left.startDate.localeCompare(right.startDate),
    );
    const merged: Array<{ startDate: string; endDate: string }> = [];
    for (const range of sorted) {
      const last = merged.at(-1);
      if (last && range.startDate <= last.endDate) {
        if (range.endDate > last.endDate) last.endDate = range.endDate;
      } else {
        merged.push({
          startDate: range.startDate,
          endDate: range.endDate,
        });
      }
    }
    return merged.map((range) => ({ symbol, ...range }));
  });
}

export function incomeCalendarPriceRanges(
  entries: readonly LedgerEntry[],
  query: IncomeCalendarQuery,
  completedEndDate: string,
): LivePriceRange[] {
  const marketDate = currentMarketDate();
  const endDate = [monthEnd(query.month), marketDate, completedEndDate].sort()[0];
  const currentPositions = reduceLedger(entries, marketDate).positions;
  const { effective } = activeLedgerEntries(entries, marketDate);
  const currentSymbols = new Set(
    [...currentPositions.entries()]
      .filter(([, position]) => position.quantity > 1e-8)
      .map(([symbol]) => symbol),
  );
  const symbols = query.symbol
    ? [query.symbol]
    : query.scope === "current"
      ? [...currentSymbols]
      : [
          ...new Set(
            effective
              .filter((entry) => entry.businessDate <= endDate)
              .flatMap((entry) => entry.symbol ?? []),
          ),
        ];

  const intervalsBySymbol = holdingIntervals(entries, endDate);
  return symbols.flatMap((symbol) =>
    (intervalsBySymbol.get(symbol) ?? []).map((interval) => ({
      symbol,
      startDate: interval.startDate,
      endDate: interval.endDate > endDate ? endDate : interval.endDate,
    })),
  );
}
