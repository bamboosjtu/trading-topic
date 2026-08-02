import { randomUUID } from "node:crypto";
import type {
  DividendEvent,
  LedgerEntry,
  PendingDividend,
  StockInfo,
} from "../../shared/contracts";
import { holdingQuantityOnDate } from "./ledgerReducer";

export interface DividendDiscoveryInput {
  /** All ledger entries */
  entries: readonly LedgerEntry[];
  /** Symbol → stock info lookup */
  stockLookup: Map<string, StockInfo>;
  /** Corporate action results per symbol */
  corporateActions: Map<string, { dividends: DividendEvent[]; fetchedAt: string }>;
  /** Existing pending dividend recordDate set (to skip duplicates) */
  existingPendingKeys: Set<string>; // "symbol:recordDate"
  /** Existing confirmed dividend ledger entries (to skip already recorded) */
  existingDividendKeys: Set<string>; // "symbol:recordDate"
}

export function discoverPendingDividends(
  input: DividendDiscoveryInput,
): PendingDividend[] {
  const candidates: PendingDividend[] = [];
  for (const [symbol, { dividends, fetchedAt }] of input.corporateActions) {
    const stock = input.stockLookup.get(symbol);
    if (!stock) continue;
    for (const event of dividends) {
      // Skip if transferRatio or bonusRatio > 0 (stock splits, not cash dividends)
      if (event.transferRatio > 0 || event.bonusRatio > 0) continue;
      if (event.perShare <= 0) continue;

      const key = `${symbol}:${event.recordDate}`;
      if (input.existingPendingKeys.has(key)) continue;
      if (input.existingDividendKeys.has(key)) continue;

      const holdingQuantity = holdingQuantityOnDate(
        input.entries,
        symbol,
        event.recordDate,
      );
      if (holdingQuantity <= 0) continue;

      candidates.push({
        id: randomUUID(),
        symbol,
        instrumentName: stock.name,
        securityType: stock.securityType,
        exDate: event.date,
        recordDate: event.recordDate,
        paymentDate: event.paymentDate,
        perShare: event.perShare,
        holdingQuantity,
        expectedAmount:
          Math.round(holdingQuantity * event.perShare * 100) / 100,
        status: "pending",
        discoveredAt: fetchedAt,
        source: "corporate_action",
      });
    }
  }
  return candidates;
}
