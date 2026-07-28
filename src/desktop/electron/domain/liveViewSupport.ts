import type {
  LedgerEntry,
  LedgerRecordView,
  SecurityType,
  StockInfo,
} from "../../shared/contracts";
import { ledgerEntryAmount } from "./ledgerReducer";

export function inferSecurityType(
  symbol: string,
  name = "",
): SecurityType {
  if (
    name.toUpperCase().includes("ETF") ||
    /^(15|16|50|51|52|56|58)/.test(symbol)
  ) {
    return "etf";
  }
  return "stock";
}

export function namesMap(
  stocks: readonly StockInfo[],
  entries: readonly LedgerEntry[] = [],
): Map<string, string> {
  const names = new Map(stocks.map((stock) => [stock.symbol, stock.name]));
  for (const entry of entries) {
    if (entry.symbol && entry.instrumentName) {
      names.set(entry.symbol, entry.instrumentName);
    }
  }
  return names;
}

export function securityTypesMap(
  entries: readonly LedgerEntry[],
): Map<string, SecurityType> {
  const result = new Map<string, SecurityType>();
  for (const entry of entries) {
    if (entry.symbol && entry.securityType) {
      result.set(entry.symbol, entry.securityType);
    }
  }
  return result;
}

export function toLedgerRecord(
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
      ? entry.securityType ??
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
    correctsEntryId: entry.correctsEntryId ?? null,
  };
}
