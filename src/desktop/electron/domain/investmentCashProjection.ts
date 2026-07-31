import type { LedgerEntry, SecurityType } from "../../shared/contracts";
import { roundMoney } from "./finance";
import {
  canonicalLedgerOrder,
  ledgerEntryAmount,
} from "./ledgerReducer";

interface InvestmentCashflow {
  date: string;
  amount: number;
}

interface InvestmentCashProjection {
  externalBuySpend: number;
  externalDividendIncome: number;
  pendingReinvestmentCash: number;
  externalCashflows: InvestmentCashflow[];
  externalBuySpendBySymbol: Map<string, number>;
  externalDividendIncomeBySymbol: Map<string, number>;
  pendingReinvestmentCashBySymbol: Map<string, number>;
  externalCashflowsBySymbol: Map<string, InvestmentCashflow[]>;
  internalFundingByBuy: Map<string, number>;
}

interface LinkedReinvestmentGroup {
  symbol: string;
  securityType: SecurityType;
  dividend?: LedgerEntry;
  buy?: LedgerEntry;
}

function addAmount(
  target: Map<string, number>,
  symbol: string,
  amount: number,
): void {
  target.set(symbol, roundMoney((target.get(symbol) ?? 0) + amount));
}

function addCashflow(
  target: Map<string, InvestmentCashflow[]>,
  symbol: string,
  cashflow: InvestmentCashflow,
): void {
  const rows = target.get(symbol) ?? [];
  rows.push(cashflow);
  target.set(symbol, rows);
}

export function validateLinkedReinvestmentGroups(
  entries: readonly LedgerEntry[],
): Map<string, LinkedReinvestmentGroup> {
  const groups = new Map<string, LinkedReinvestmentGroup>();
  for (const entry of entries) {
    if (!entry.linkedGroupId) continue;
    if (
      (entry.type !== "buy" && entry.type !== "dividend") ||
      !entry.symbol ||
      !entry.securityType
    ) {
      throw new Error("分红再投入关联组只允许包含明确标的和资产类型的分红、买入事实");
    }
    const existing = groups.get(entry.linkedGroupId);
    if (
      existing &&
      (existing.symbol !== entry.symbol ||
        existing.securityType !== entry.securityType)
    ) {
      throw new Error("分红再投入关联组必须使用同一标的和资产类型");
    }
    const group = existing ?? {
      symbol: entry.symbol,
      securityType: entry.securityType,
    };
    if (entry.type === "dividend") {
      if (group.dividend) {
        throw new Error("分红再投入关联组最多只能有一个有效分红事实");
      }
      group.dividend = entry;
    } else {
      if (group.buy) {
        throw new Error("分红再投入关联组最多只能有一个有效买入事实");
      }
      group.buy = entry;
    }
    groups.set(entry.linkedGroupId, group);
  }
  for (const group of groups.values()) {
    if (
      group.dividend &&
      group.buy &&
      group.dividend.businessDate > group.buy.businessDate
    ) {
      throw new Error("分红再投入的买入日期不得早于分红到账日期");
    }
  }
  return groups;
}

export function projectInvestmentCash(
  entries: readonly LedgerEntry[],
): InvestmentCashProjection {
  const ordered = [...entries]
    .filter((entry) => entry.type !== "adjustment")
    .sort(canonicalLedgerOrder);
  const groups = validateLinkedReinvestmentGroups(ordered);
  const internalFundingByBuy = new Map<string, number>();
  const pendingReinvestmentCashBySymbol = new Map<string, number>();

  for (const group of groups.values()) {
    const dividendAmount = group.dividend
      ? ledgerEntryAmount(group.dividend)
      : 0;
    const buySpend = group.buy
      ? roundMoney(ledgerEntryAmount(group.buy) + (group.buy.fee ?? 0))
      : 0;
    const internalFunding = roundMoney(
      Math.max(0, Math.min(dividendAmount, buySpend)),
    );
    if (group.buy) {
      internalFundingByBuy.set(group.buy.id, internalFunding);
    }
    const pending = roundMoney(dividendAmount - internalFunding);
    if (pending > 0) {
      addAmount(
        pendingReinvestmentCashBySymbol,
        group.symbol,
        pending,
      );
    }
  }

  const externalCashflows: InvestmentCashflow[] = [];
  const externalCashflowsBySymbol = new Map<
    string,
    InvestmentCashflow[]
  >();
  const externalBuySpendBySymbol = new Map<string, number>();
  const externalDividendIncomeBySymbol = new Map<string, number>();
  let externalBuySpend = 0;
  let externalDividendIncome = 0;

  for (const entry of ordered) {
    if (!entry.symbol) continue;
    const amount = ledgerEntryAmount(entry);
    if (entry.type === "buy") {
      const spend = roundMoney(amount + (entry.fee ?? 0));
      const externalSpend = roundMoney(
        spend - (internalFundingByBuy.get(entry.id) ?? 0),
      );
      if (externalSpend > 0) {
        externalBuySpend = roundMoney(
          externalBuySpend + externalSpend,
        );
        addAmount(
          externalBuySpendBySymbol,
          entry.symbol,
          externalSpend,
        );
        const cashflow = {
          date: entry.businessDate,
          amount: -externalSpend,
        };
        externalCashflows.push(cashflow);
        addCashflow(externalCashflowsBySymbol, entry.symbol, cashflow);
      }
      continue;
    }
    if (entry.type === "sell") {
      const netIncome = roundMoney(amount - (entry.fee ?? 0));
      if (netIncome !== 0) {
        const cashflow = {
          date: entry.businessDate,
          amount: netIncome,
        };
        externalCashflows.push(cashflow);
        addCashflow(externalCashflowsBySymbol, entry.symbol, cashflow);
      }
      continue;
    }
    if (entry.type === "dividend" && !entry.linkedGroupId) {
      externalDividendIncome = roundMoney(
        externalDividendIncome + amount,
      );
      addAmount(
        externalDividendIncomeBySymbol,
        entry.symbol,
        amount,
      );
      const cashflow = {
        date: entry.businessDate,
        amount,
      };
      externalCashflows.push(cashflow);
      addCashflow(externalCashflowsBySymbol, entry.symbol, cashflow);
    }
  }

  return {
    externalBuySpend,
    externalDividendIncome,
    pendingReinvestmentCash: roundMoney(
      [...pendingReinvestmentCashBySymbol.values()].reduce(
        (sum, amount) => sum + amount,
        0,
      ),
    ),
    externalCashflows: externalCashflows.sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    externalBuySpendBySymbol,
    externalDividendIncomeBySymbol,
    pendingReinvestmentCashBySymbol,
    externalCashflowsBySymbol,
    internalFundingByBuy,
  };
}
