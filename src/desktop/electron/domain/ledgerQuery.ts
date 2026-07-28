import type {
  LedgerEntry,
  LedgerQuery,
  LedgerQueryResult,
  LedgerRecordView,
  LiveDataQuality,
  StockInfo,
} from "../../shared/contracts";
import { validDate } from "./dateUtils";
import { roundMoney } from "./finance";
import {
  activeLedgerEntries,
  canonicalLedgerOrderDescending,
} from "./ledgerReducer";
import {
  inferSecurityType,
  namesMap,
  securityTypesMap,
  toLedgerRecord,
} from "./liveViewSupport";

function matchesQuery(
  row: LedgerRecordView,
  query: LedgerQuery,
): boolean {
  if (query.startDate && row.businessDate < query.startDate) return false;
  if (query.endDate && row.businessDate > query.endDate) return false;
  if (query.entryTypes?.length && !query.entryTypes.includes(row.type)) {
    return false;
  }
  if (query.securityType && row.securityType !== query.securityType) {
    return false;
  }
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
  const names = namesMap(stocks, entries);
  const securityTypes = securityTypesMap(entries);
  const { effective, reversedIds } = activeLedgerEntries(entries);
  const allRows = [...entries]
    .sort(canonicalLedgerOrderDescending)
    .map((entry) => toLedgerRecord(entry, names, reversedIds))
    .filter((row) => matchesQuery(row, query));
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
              (row.type === "transfer_in" ? 1 : -1) *
                (row.amount ?? 0),
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
        securityType:
          securityTypes.get(symbol) ??
          inferSecurityType(symbol, names.get(symbol)),
      })),
  };
}
