import type { LedgerEntry } from "../../shared/contracts";
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
  externalCashflows: InvestmentCashflow[];
  externalBuySpendBySymbol: Map<string, number>;
  externalDividendIncomeBySymbol: Map<string, number>;
  externalCashflowsBySymbol: Map<string, InvestmentCashflow[]>;
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

export function projectInvestmentCash(
  entries: readonly LedgerEntry[],
): InvestmentCashProjection {
  const ordered = [...entries]
    .filter((entry) => entry.type !== "adjustment")
    .sort(canonicalLedgerOrder);

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
      externalBuySpend = roundMoney(externalBuySpend + spend);
      addAmount(externalBuySpendBySymbol, entry.symbol, spend);
      const cashflow = { date: entry.businessDate, amount: -spend };
      externalCashflows.push(cashflow);
      addCashflow(externalCashflowsBySymbol, entry.symbol, cashflow);
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
    if (entry.type === "dividend") {
      externalDividendIncome = roundMoney(externalDividendIncome + amount);
      addAmount(externalDividendIncomeBySymbol, entry.symbol, amount);
      const cashflow = { date: entry.businessDate, amount };
      externalCashflows.push(cashflow);
      addCashflow(externalCashflowsBySymbol, entry.symbol, cashflow);
    }
  }

  return {
    externalBuySpend,
    externalDividendIncome,
    externalCashflows: externalCashflows.sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    externalBuySpendBySymbol,
    externalDividendIncomeBySymbol,
    externalCashflowsBySymbol,
  };
}
