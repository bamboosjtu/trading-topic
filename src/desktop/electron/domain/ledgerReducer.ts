import type { LedgerEntry } from "../../shared/contracts";
import { currentMarketDate, validDate } from "./dateUtils";
import { roundMoney } from "./finance";

const QUANTITY_EPSILON = 1e-8;

export interface LedgerPositionState {
  quantity: number;
  cost: number;
  cumulativeInvestment: number;
  cumulativeDividend: number;
  realizedPnl: number;
}

export interface LedgerState {
  asOfDate: string;
  effectiveEntries: LedgerEntry[];
  reversedIds: Set<string>;
  cash: number;
  reverseRepoAsset: number;
  reverseRepoIncome: number;
  transferIn: number;
  transferOut: number;
  cumulativeDividend: number;
  positions: Map<string, LedgerPositionState>;
}

export function canonicalLedgerOrder(
  left: LedgerEntry,
  right: LedgerEntry,
): number {
  return (
    left.businessDate.localeCompare(right.businessDate) ||
    left.recordedAt.localeCompare(right.recordedAt) ||
    left.id.localeCompare(right.id)
  );
}

export function canonicalLedgerOrderDescending(
  left: LedgerEntry,
  right: LedgerEntry,
): number {
  return -canonicalLedgerOrder(left, right);
}

export function ledgerEntryAmount(entry: LedgerEntry): number {
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

export function activeLedgerEntries(
  entries: readonly LedgerEntry[],
  asOfDate = currentMarketDate(),
): {
  effective: LedgerEntry[];
  reversedIds: Set<string>;
} {
  if (!validDate(asOfDate)) {
    throw new Error("账本截止日必须使用合法的 YYYY-MM-DD");
  }
  const facts = entries
    .filter((entry) => entry.businessDate <= asOfDate)
    .sort(canonicalLedgerOrder);
  const reversedIds = new Set(
    facts
      .filter((entry) => entry.type === "adjustment" && entry.reversesEntryId)
      .map((entry) => entry.reversesEntryId!),
  );
  const correctionTargets = new Set(
    facts
      .filter((entry) => entry.type === "adjustment" && entry.reversesEntryId)
      .map((entry) => entry.reversesEntryId!),
  );
  return {
    reversedIds,
    effective: facts.filter(
      (entry) =>
        entry.type !== "adjustment" &&
        !reversedIds.has(entry.id) &&
        (!entry.correctsEntryId ||
          correctionTargets.has(entry.correctsEntryId)),
    ),
  };
}

function emptyPosition(): LedgerPositionState {
  return {
    quantity: 0,
    cost: 0,
    cumulativeInvestment: 0,
    cumulativeDividend: 0,
    realizedPnl: 0,
  };
}

export function reduceLedger(
  entries: readonly LedgerEntry[],
  asOfDate = currentMarketDate(),
): LedgerState {
  const { effective, reversedIds } = activeLedgerEntries(entries, asOfDate);
  const positions = new Map<string, LedgerPositionState>();
  let cash = 0;
  let reverseRepoAsset = 0;
  let reverseRepoIncome = 0;
  let transferIn = 0;
  let transferOut = 0;
  let cumulativeDividend = 0;

  for (const entry of effective) {
    const amount = ledgerEntryAmount(entry);
    if (entry.type === "transfer_in") {
      cash += amount;
      transferIn += amount;
      continue;
    }
    if (entry.type === "transfer_out") {
      cash -= amount;
      transferOut += amount;
      continue;
    }
    if (entry.type === "buy" && entry.symbol) {
      const quantity = entry.quantity ?? 0;
      const fee = entry.fee ?? 0;
      const current = positions.get(entry.symbol) ?? emptyPosition();
      cash -= amount + fee;
      current.quantity += quantity;
      current.cost = roundMoney(current.cost + amount + fee);
      current.cumulativeInvestment = roundMoney(
        current.cumulativeInvestment + amount + fee,
      );
      positions.set(entry.symbol, current);
      continue;
    }
    if (entry.type === "sell" && entry.symbol) {
      const quantity = entry.quantity ?? 0;
      const fee = entry.fee ?? 0;
      const current = positions.get(entry.symbol) ?? emptyPosition();
      if (quantity > current.quantity + QUANTITY_EPSILON) {
        throw new Error(`${entry.symbol} 卖出数量超过有效持仓`);
      }
      const releasedCost =
        current.quantity > 0 ? current.cost * (quantity / current.quantity) : 0;
      current.quantity = Math.max(0, current.quantity - quantity);
      current.cost = roundMoney(Math.max(0, current.cost - releasedCost));
      current.realizedPnl = roundMoney(
        current.realizedPnl + amount - fee - releasedCost,
      );
      cash += amount - fee;
      positions.set(entry.symbol, current);
      continue;
    }
    if (entry.type === "dividend") {
      cash += amount;
      cumulativeDividend = roundMoney(cumulativeDividend + amount);
      if (entry.symbol) {
        const current = positions.get(entry.symbol) ?? emptyPosition();
        current.cumulativeDividend = roundMoney(
          current.cumulativeDividend + amount,
        );
        positions.set(entry.symbol, current);
      }
      continue;
    }
    if (entry.type === "reverse_repo") {
      if (!entry.maturityDate || entry.maturityAmount === undefined) {
        throw new Error("逆回购事实缺少实际到期日或实际到期金额");
      }
      cash -= amount;
      if (entry.maturityDate <= asOfDate) {
        cash += entry.maturityAmount;
        reverseRepoIncome = roundMoney(
          reverseRepoIncome + entry.maturityAmount - amount,
        );
      } else {
        // 未到期时只确认本金，不提前确认未来利息。
        reverseRepoAsset += amount;
      }
    }
  }

  return {
    asOfDate,
    effectiveEntries: effective,
    reversedIds,
    cash: roundMoney(cash),
    reverseRepoAsset: roundMoney(reverseRepoAsset),
    reverseRepoIncome: roundMoney(reverseRepoIncome),
    transferIn: roundMoney(transferIn),
    transferOut: roundMoney(transferOut),
    cumulativeDividend,
    positions,
  };
}
