import { randomUUID } from "node:crypto";
import type {
  BacktestRequest,
  BacktestResult,
  BacktestTransaction,
  DataProvenance,
  DividendEvent,
  EquityPoint,
  PricePoint,
} from "../../shared/contracts";
import { maximumDrawdown, roundMoney, xirr } from "./finance";

const LOT_SIZE = 100;
const COMMISSION_RATE = 0.00025;
const MINIMUM_COMMISSION = 5;

function assertInput(input: BacktestRequest): void {
  if (input.symbols.length < 1 || input.symbols.length > 4) {
    throw new Error("R1 支持 1 至 4 个标的同条件并排");
  }
  if (input.symbols.some((symbol) => !/^(?:0|3|6|8)\d{5}$/.test(symbol))) {
    throw new Error("仅支持 6 位 A 股股票代码");
  }
  if (!(input.monthlyAmount > 0)) throw new Error("每月金额必须大于 0");
  if (!Number.isInteger(input.buyDay) || input.buyDay < 1 || input.buyDay > 28) {
    throw new Error("指定买入日必须为 1 至 28");
  }
  if (input.startDate > input.endDate) throw new Error("开始日期不能晚于结束日期");
}

function monthsBetween(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`);
  const result: string[] = [];
  for (const date = start; date <= end; date.setUTCMonth(date.getUTCMonth() + 1)) {
    result.push(date.toISOString().slice(0, 7));
  }
  return result;
}

function commission(amount: number): number {
  return roundMoney(Math.max(MINIMUM_COMMISSION, amount * COMMISSION_RATE));
}

export function simulateBacktest(
  input: BacktestRequest,
  symbol: string,
  name: string,
  priceRows: PricePoint[],
  dividendRows: DividendEvent[],
  provenance: DataProvenance[],
): BacktestResult {
  assertInput(input);
  const prices = priceRows
    .filter((row) => row.date >= input.startDate && row.date <= input.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!prices.length) throw new Error(`${symbol} 在所选区间没有可用行情`);
  if (prices.some((row) => !Number.isFinite(row.close) || row.close <= 0)) {
    throw new Error(`${symbol} 行情包含无效收盘价`);
  }

  const unsupported = dividendRows.filter(
    (row) => row.transferRatio > 0 || row.bonusRatio > 0,
  );
  if (unsupported.length) {
    throw new Error(
      `${symbol} 存在 R1 不支持的送股、转增或配股事件，请缩短区间后重试`,
    );
  }

  const dividendsByDate = new Map<string, DividendEvent[]>();
  for (const event of dividendRows) {
    if (event.date < input.startDate || event.date > input.endDate) continue;
    const group = dividendsByDate.get(event.date) ?? [];
    group.push(event);
    dividendsByDate.set(event.date, group);
  }

  const scheduled = new Map<string, number>();
  const warnings: string[] = [];
  for (const month of monthsBetween(input.startDate, input.endDate)) {
    const target = `${month}-${String(input.buyDay).padStart(2, "0")}`;
    const execution = prices.find(
      (row) => row.date.slice(0, 7) === month && row.date >= target,
    );
    if (execution) {
      scheduled.set(execution.date, (scheduled.get(execution.date) ?? 0) + 1);
    } else {
      warnings.push(`${month} 指定日后无交易日，本月未投入`);
    }
  }

  let shares = 0;
  let cash = 0;
  let totalContribution = 0;
  let totalDividend = 0;
  const holdingsHistory: Array<{ date: string; shares: number }> = [];
  const transactions: BacktestTransaction[] = [];
  const equityCurve: EquityPoint[] = [];
  const cashflows: Array<{ date: string; amount: number }> = [];

  for (const row of prices) {
    const contributionCount = scheduled.get(row.date) ?? 0;
    if (contributionCount) {
      const amount = input.monthlyAmount * contributionCount;
      cash = roundMoney(cash + amount);
      totalContribution = roundMoney(totalContribution + amount);
      cashflows.push({ date: row.date, amount: -amount });
      transactions.push({
        date: row.date,
        type: "contribution",
        quantity: 0,
        price: 0,
        amount,
        fee: 0,
        cashAfter: cash,
      });

      const maximumLots = Math.floor(cash / (row.close * LOT_SIZE));
      let lots = maximumLots;
      while (lots > 0) {
        const tradeAmount = roundMoney(lots * LOT_SIZE * row.close);
        const fee = commission(tradeAmount);
        if (tradeAmount + fee <= cash) {
          const quantity = lots * LOT_SIZE;
          shares += quantity;
          cash = roundMoney(cash - tradeAmount - fee);
          transactions.push({
            date: row.date,
            type: "buy",
            quantity,
            price: row.close,
            amount: tradeAmount,
            fee,
            cashAfter: cash,
          });
          break;
        }
        lots -= 1;
      }
    }

    for (const event of dividendsByDate.get(row.date) ?? []) {
      const entitledShares =
        holdingsHistory
          .filter((item) => item.date <= event.recordDate)
          .at(-1)?.shares ?? 0;
      const amount = roundMoney(entitledShares * event.perShare);
      if (amount <= 0) continue;
      cash = roundMoney(cash + amount);
      totalDividend = roundMoney(totalDividend + amount);
      transactions.push({
        date: row.date,
        type: "dividend",
        quantity: entitledShares,
        price: event.perShare,
        amount,
        fee: 0,
        cashAfter: cash,
      });
      const lots = Math.floor(cash / (row.close * LOT_SIZE));
      if (lots > 0) {
        const quantity = lots * LOT_SIZE;
        const tradeAmount = roundMoney(quantity * row.close);
        const fee = commission(tradeAmount);
        if (tradeAmount + fee <= cash) {
          shares += quantity;
          cash = roundMoney(cash - tradeAmount - fee);
          transactions.push({
            date: row.date,
            type: "dividend_reinvest",
            quantity,
            price: row.close,
            amount: tradeAmount,
            fee,
            cashAfter: cash,
          });
        }
      }
    }

    equityCurve.push({
      date: row.date,
      asset: roundMoney(shares * row.close + cash),
      contribution: totalContribution,
    });
    holdingsHistory.push({ date: row.date, shares });
  }

  const first = prices[0];
  const last = prices.at(-1)!;
  const endingAsset = equityCurve.at(-1)!.asset;
  cashflows.push({ date: last.date, amount: endingAsset });
  return {
    id: randomUUID(),
    symbol,
    name,
    requestedStartDate: input.startDate,
    actualStartDate: first.date,
    actualEndDate: last.date,
    monthlyAmount: input.monthlyAmount,
    buyDay: input.buyDay,
    metrics: {
      totalContribution,
      endingAsset,
      totalPnl: roundMoney(endingAsset - totalContribution),
      xirr: xirr(cashflows),
      maxDrawdown: maximumDrawdown(equityCurve.map((row) => row.asset)),
      totalDividend,
      endingCash: cash,
    },
    transactions,
    equityCurve,
    warnings,
    provenance,
    createdAt: new Date().toISOString(),
  };
}
