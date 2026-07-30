import type { LedgerEntry } from "../../shared/contracts";
import { currentMarketDate, validDate } from "./dateUtils";
import { roundMoney } from "./finance";
import { projectInvestmentCash } from "./investmentCashProjection";

const QUANTITY_EPSILON = 1e-8;

export interface LedgerPositionState {
  quantity: number;
  /** 当前剩余持仓的含费成本。 */
  cost: number;
  cumulativeBuySpend: number;
  cumulativeSellNetIncome: number;
  cumulativeDividend: number;
  realizedPnl: number;
}

export interface LedgerState {
  asOfDate: string;
  effectiveEntries: LedgerEntry[];
  reversedIds: Set<string>;
  cumulativeBuySpend: number;
  cumulativeSellNetIncome: number;
  cumulativeDividend: number;
  pendingReinvestmentCash: number;
  netInvestment: number;
  realizedPnl: number;
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

/**
 * 返回当前知识下的有效投资事实。
 *
 * 修正和冲正采用“历史重述”：调整记录的 recordedAt/correctedAt 仅供审计，
 * 不决定其业务生效日。先在完整审计链中确定当前有效版本，再用有效事实自身
 * 的 businessDate 投影到 asOfDate。
 */
export function activeLedgerEntries(
  entries: readonly LedgerEntry[],
  asOfDate = currentMarketDate(),
): {
  effective: LedgerEntry[];
  reversedIds: Set<string>;
} {
  if (!validDate(asOfDate)) {
    throw new Error("投资事实截止日必须使用合法的 YYYY-MM-DD");
  }
  const reversedIds = new Set(
    entries
      .filter((entry) => entry.type === "adjustment" && entry.reversesEntryId)
      .map((entry) => entry.reversesEntryId!),
  );
  const correctionTargets = new Set(
    entries
      .filter((entry) => entry.type === "adjustment" && entry.reversesEntryId)
      .map((entry) => entry.reversesEntryId!),
  );
  return {
    reversedIds,
    effective: entries
      .filter(
        (entry) =>
          entry.type !== "adjustment" &&
          entry.businessDate <= asOfDate &&
          !reversedIds.has(entry.id) &&
          (!entry.correctsEntryId ||
            correctionTargets.has(entry.correctsEntryId)),
      )
      .sort(canonicalLedgerOrder),
  };
}

function emptyPosition(): LedgerPositionState {
  return {
    quantity: 0,
    cost: 0,
    cumulativeBuySpend: 0,
    cumulativeSellNetIncome: 0,
    cumulativeDividend: 0,
    realizedPnl: 0,
  };
}

export function reduceLedger(
  entries: readonly LedgerEntry[],
  asOfDate = currentMarketDate(),
): LedgerState {
  const { effective, reversedIds } = activeLedgerEntries(entries, asOfDate);
  const cashProjection = projectInvestmentCash(effective);
  const positions = new Map<string, LedgerPositionState>();
  let cumulativeBuySpend = 0;
  let cumulativeSellNetIncome = 0;
  let cumulativeDividend = 0;
  let realizedPnl = 0;

  for (const entry of effective) {
    const amount = ledgerEntryAmount(entry);
    if (entry.type === "buy" && entry.symbol) {
      const quantity = entry.quantity ?? 0;
      const fee = entry.fee ?? 0;
      const spend = roundMoney(amount + fee);
      const current = positions.get(entry.symbol) ?? emptyPosition();
      current.quantity += quantity;
      current.cost = roundMoney(current.cost + spend);
      current.cumulativeBuySpend = roundMoney(
        current.cumulativeBuySpend + spend,
      );
      cumulativeBuySpend = roundMoney(cumulativeBuySpend + spend);
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
      const netIncome = roundMoney(amount - fee);
      const salePnl = roundMoney(netIncome - releasedCost);
      current.quantity = Math.max(0, current.quantity - quantity);
      current.cost = roundMoney(Math.max(0, current.cost - releasedCost));
      current.cumulativeSellNetIncome = roundMoney(
        current.cumulativeSellNetIncome + netIncome,
      );
      current.realizedPnl = roundMoney(current.realizedPnl + salePnl);
      cumulativeSellNetIncome = roundMoney(
        cumulativeSellNetIncome + netIncome,
      );
      realizedPnl = roundMoney(realizedPnl + salePnl);
      positions.set(entry.symbol, current);
      continue;
    }
    if (entry.type === "dividend") {
      cumulativeDividend = roundMoney(cumulativeDividend + amount);
      if (entry.symbol) {
        const current = positions.get(entry.symbol) ?? emptyPosition();
        current.cumulativeDividend = roundMoney(
          current.cumulativeDividend + amount,
        );
        positions.set(entry.symbol, current);
      }
    }
  }

  return {
    asOfDate,
    effectiveEntries: effective,
    reversedIds,
    cumulativeBuySpend,
    cumulativeSellNetIncome,
    cumulativeDividend,
    pendingReinvestmentCash: cashProjection.pendingReinvestmentCash,
    netInvestment: roundMoney(
      cashProjection.externalBuySpend -
        cumulativeSellNetIncome -
        cashProjection.externalDividendIncome,
    ),
    realizedPnl,
    positions,
  };
}
