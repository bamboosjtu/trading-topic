import type {
  AccountSummary,
  LedgerEntry,
  PositionSummary,
} from "../../shared/contracts";
import { roundMoney, xirr } from "./finance";

function effectiveEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const reversed = new Set(
    entries
      .filter((entry) => entry.type === "adjustment" && entry.reversesEntryId)
      .map((entry) => entry.reversesEntryId!),
  );
  return entries.filter(
    (entry) => entry.type !== "adjustment" && !reversed.has(entry.id),
  );
}

export function rebuildAccount(
  entries: LedgerEntry[],
  latestPrices: Record<string, number>,
  dataCutoff: string | null,
): AccountSummary {
  let cash = 0;
  let transferIn = 0;
  let transferOut = 0;
  let reverseRepoAsset = 0;
  const positions = new Map<string, { quantity: number; cost: number }>();
  const cashflows: Array<{ date: string; amount: number }> = [];
  const today = dataCutoff ?? new Date().toISOString().slice(0, 10);

  for (const entry of effectiveEntries(entries).sort((a, b) =>
    a.businessDate.localeCompare(b.businessDate),
  )) {
    const amount = entry.amount ?? 0;
    if (entry.type === "transfer_in") {
      cash += amount;
      transferIn += amount;
      cashflows.push({ date: entry.businessDate, amount: -amount });
    } else if (entry.type === "transfer_out") {
      cash -= amount;
      transferOut += amount;
      cashflows.push({ date: entry.businessDate, amount });
    } else if (entry.type === "buy" && entry.symbol) {
      const quantity = entry.quantity ?? 0;
      const tradeAmount = roundMoney((entry.price ?? 0) * quantity);
      cash -= tradeAmount + (entry.fee ?? 0);
      const current = positions.get(entry.symbol) ?? { quantity: 0, cost: 0 };
      current.quantity += quantity;
      current.cost = roundMoney(current.cost + tradeAmount + (entry.fee ?? 0));
      positions.set(entry.symbol, current);
    } else if (entry.type === "sell" && entry.symbol) {
      const quantity = entry.quantity ?? 0;
      const current = positions.get(entry.symbol) ?? { quantity: 0, cost: 0 };
      if (quantity > current.quantity) {
        throw new Error(`${entry.symbol} 卖出数量超过有效持仓`);
      }
      const releasedCost =
        current.quantity > 0 ? current.cost * (quantity / current.quantity) : 0;
      current.quantity -= quantity;
      current.cost = roundMoney(current.cost - releasedCost);
      positions.set(entry.symbol, current);
      cash += roundMoney((entry.price ?? 0) * quantity - (entry.fee ?? 0));
    } else if (entry.type === "dividend") {
      cash += amount;
    } else if (entry.type === "reverse_repo") {
      const maturityDate = entry.maturityDate ?? entry.businessDate;
      cash -= amount;
      if (maturityDate <= today) {
        cash += entry.maturityAmount ?? amount;
      } else {
        reverseRepoAsset += entry.maturityAmount ?? amount;
      }
    }
  }

  const positionRows: PositionSummary[] = [...positions.entries()]
    .filter(([, value]) => value.quantity > 0)
    .map(([symbol, value]) => {
      const lastPrice = latestPrices[symbol] ?? null;
      const marketValue = lastPrice
        ? roundMoney(lastPrice * value.quantity)
        : value.cost;
      return {
        symbol,
        quantity: value.quantity,
        cost: roundMoney(value.cost),
        averageCost: roundMoney(value.cost / value.quantity),
        lastPrice,
        marketValue,
        pnl: roundMoney(marketValue - value.cost),
      };
    });
  const marketValue = roundMoney(
    positionRows.reduce((sum, item) => sum + item.marketValue, 0),
  );
  const totalAsset = roundMoney(cash + marketValue + reverseRepoAsset);
  cashflows.push({ date: today, amount: totalAsset });
  return {
    positions: positionRows,
    availableCash: roundMoney(cash),
    marketValue,
    reverseRepoAsset: roundMoney(reverseRepoAsset),
    totalAsset,
    totalContribution: roundMoney(transferIn),
    totalWithdrawal: roundMoney(transferOut),
    totalPnl: roundMoney(totalAsset + transferOut - transferIn),
    xirr: xirr(cashflows),
    valuationSource: Object.keys(latestPrices).length
      ? "腾讯财经不复权日线"
      : "最近成交成本（无行情快照）",
    dataCutoff,
  };
}
