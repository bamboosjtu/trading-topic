import type {
  AccountSummary,
  LedgerEntry,
  PositionSummary,
} from "../../shared/contracts";
import { roundMoney, xirr } from "./finance";
import { currentMarketDate } from "./dateUtils";
import { reduceLedger } from "./ledgerReducer";

export function rebuildAccount(
  entries: LedgerEntry[],
  latestPrices: Record<string, number>,
  dataCutoff: string | null,
  asOfDate = dataCutoff ?? currentMarketDate(),
): AccountSummary {
  const state = reduceLedger(entries, asOfDate);
  const cashflows: Array<{ date: string; amount: number }> = [];
  for (const entry of state.effectiveEntries) {
    const amount = entry.amount ?? 0;
    if (entry.type === "transfer_in") {
      cashflows.push({ date: entry.businessDate, amount: -amount });
    } else if (entry.type === "transfer_out") {
      cashflows.push({ date: entry.businessDate, amount });
    }
  }

  const positionRows: PositionSummary[] = [...state.positions.entries()]
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
  const totalAsset = roundMoney(
    state.cash + marketValue + state.reverseRepoAsset,
  );
  cashflows.push({ date: asOfDate, amount: totalAsset });
  return {
    positions: positionRows,
    availableCash: state.cash,
    marketValue,
    reverseRepoAsset: state.reverseRepoAsset,
    totalAsset,
    totalContribution: state.transferIn,
    totalWithdrawal: state.transferOut,
    totalPnl: roundMoney(
      totalAsset + state.transferOut - state.transferIn,
    ),
    xirr: xirr(cashflows),
    valuationSource: Object.keys(latestPrices).length
      ? "腾讯财经不复权日线"
      : "最近成交成本（无行情快照）",
    dataCutoff,
  };
}
