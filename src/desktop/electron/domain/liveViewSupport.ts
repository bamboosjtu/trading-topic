import type {
  LedgerEntry,
  LedgerRecordView,
  SecurityType,
  StockInfo,
} from "../../shared/contracts";
import { activeLedgerEntries, ledgerEntryAmount } from "./ledgerReducer";
import { securityTypeForInstrument } from "../../shared/instruments";

function recordedOrder(left: LedgerEntry, right: LedgerEntry): number {
  return (
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.businessDate.localeCompare(right.businessDate) ||
    left.id.localeCompare(right.id)
  );
}

export function inferSecurityType(
  symbol: string,
  name = "",
): SecurityType {
  return securityTypeForInstrument({ symbol, name });
}

export function namesMap(
  stocks: readonly StockInfo[],
  entries: readonly LedgerEntry[] = [],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of activeLedgerEntries(entries).effective.sort(recordedOrder)) {
    if (entry.symbol && entry.instrumentName) {
      names.set(entry.symbol, entry.instrumentName);
    }
  }
  // 完整证券目录是事实标准，优先级高于用户历史输入。
  for (const stock of stocks) names.set(stock.symbol, stock.name);
  return names;
}

export function securityTypesMap(
  stocks: readonly StockInfo[],
  entries: readonly LedgerEntry[],
): Map<string, SecurityType> {
  const result = new Map<string, SecurityType>();
  for (const entry of activeLedgerEntries(entries).effective.sort(recordedOrder)) {
    if (entry.symbol && entry.securityType) {
      result.set(entry.symbol, entry.securityType);
    }
  }
  for (const stock of stocks) {
    result.set(stock.symbol, securityTypeForInstrument(stock));
  }
  return result;
}

export function toLedgerRecord(
  entry: LedgerEntry,
  names: Map<string, string>,
  securityTypes: Map<string, SecurityType>,
  reversedIds: Set<string>,
): LedgerRecordView {
  return {
    id: entry.id,
    businessDate: entry.businessDate,
    type: entry.type,
    symbol: entry.symbol ?? null,
    name: entry.symbol ? (names.get(entry.symbol) ?? entry.symbol) : null,
    securityType: entry.symbol
      ? securityTypes.get(entry.symbol) ??
        entry.securityType ??
        inferSecurityType(entry.symbol, names.get(entry.symbol))
      : null,
    quantity: entry.quantity ?? null,
    price: entry.price ?? null,
    amount:
      entry.amount ??
      (entry.type === "buy" || entry.type === "sell"
        ? ledgerEntryAmount(entry)
        : null),
    fee: entry.fee ?? 0,
    note: entry.note ?? null,
    perShare: entry.perShare ?? null,
    recordDate: entry.recordDate ?? null,
    recordedAt: entry.recordedAt,
    correctedAt: entry.correctedAt ?? null,
    linkedOperation: null,
    linkedRecords: [],
    isReversed: reversedIds.has(entry.id),
    reversesEntryId: entry.reversesEntryId ?? null,
    correctsEntryId: entry.correctsEntryId ?? null,
  };
}
