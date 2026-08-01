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

interface LedgerState {
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

/**
 * 持仓区间：从有效投资事实中按数量变化推导每个证券的持仓时间段。
 *
 * 数量 0→正：记录区间开始日；数量 正→0：关闭区间。
 * 遍历结束后仍持有的区间以 asOfDate 作为结束日。
 *
 * 用于行情请求区间生成、收益日历归因和持仓页 partial 覆盖筛选，
 * 避免各处各写一套持仓周期逻辑导致口径漂移。
 */
export interface HoldingInterval {
  startDate: string;
  endDate: string;
}

export function holdingIntervals(
  entries: readonly LedgerEntry[],
  asOfDate = currentMarketDate(),
): Map<string, HoldingInterval[]> {
  const { effective } = activeLedgerEntries(entries, asOfDate);
  const result = new Map<string, HoldingInterval[]>();
  const quantities = new Map<string, number>();
  const starts = new Map<string, string>();
  for (const entry of [...effective].sort(canonicalLedgerOrder)) {
    if (
      entry.businessDate > asOfDate ||
      !entry.symbol ||
      (entry.type !== "buy" && entry.type !== "sell")
    ) {
      continue;
    }
    const before = quantities.get(entry.symbol) ?? 0;
    const after =
      before +
      (entry.type === "buy"
        ? (entry.quantity ?? 0)
        : -(entry.quantity ?? 0));
    if (before <= QUANTITY_EPSILON && after > QUANTITY_EPSILON) {
      starts.set(entry.symbol, entry.businessDate);
    }
    if (before > QUANTITY_EPSILON && after <= QUANTITY_EPSILON) {
      const startDate = starts.get(entry.symbol);
      if (startDate) {
        const current = result.get(entry.symbol) ?? [];
        current.push({ startDate, endDate: entry.businessDate });
        result.set(entry.symbol, current);
      }
      starts.delete(entry.symbol);
    }
    quantities.set(entry.symbol, Math.max(0, after));
  }
  for (const [symbol, startDate] of starts) {
    const current = result.get(symbol) ?? [];
    current.push({ startDate, endDate: asOfDate });
    result.set(symbol, current);
  }
  return result;
}

/**
 * 返回某证券当前持仓周期的开始日（最后一个未关闭区间的 startDate）。
 * 当前无持仓时返回 null。
 */
export function currentHoldingStart(
  entries: readonly LedgerEntry[],
  symbol: string,
  asOfDate = currentMarketDate(),
): string | null {
  const intervals = holdingIntervals(entries, asOfDate).get(symbol);
  if (!intervals || !intervals.length) return null;
  // 最后一个区间的 endDate 等于 asOfDate 表示当前仍持有
  const last = intervals.at(-1)!;
  return last.endDate >= asOfDate ? last.startDate : null;
}
