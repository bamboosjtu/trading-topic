import { randomUUID } from "node:crypto";
import { buildBacktestStrategyKey } from "../../shared/backtestIdentity";
import {
  BACKTEST_DIVIDEND_TIMINGS,
  BACKTEST_MAX_SYMBOLS,
  BACKTEST_RANGE_YEARS,
} from "../../shared/constants";
import type {
  BacktestRequest,
  BacktestResult,
  BacktestTransaction,
  DataProvenance,
  DividendEvent,
  EquityPoint,
  PricePoint,
  SimpleBacktestResult,
  SimpleBacktestRow,
} from "../../shared/contracts";
import { strictBacktestDataQuality } from "./backtestDataQuality";
import { drawdownProfile, roundMoney, xirr } from "./finance";

/** 内部股数保留 6 位小数，界面按需显示 2 位，避免长期累计漂移。 */
function roundShares(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** 东方财富送股、转增字段均为“每 10 股增加多少股”。 */
function shareIncreaseRatio(event: DividendEvent): number {
  return (event.transferRatio + event.bonusRatio) / 10;
}

function isStrictIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function assertBacktestRequest(input: BacktestRequest): void {
  if (!input || !Array.isArray(input.symbols)) {
    throw new Error("回测标的必须是数组");
  }
  if (
    input.symbols.length < 1 ||
    input.symbols.length > BACKTEST_MAX_SYMBOLS
  ) {
    throw new Error(`R1 支持 1 至 ${BACKTEST_MAX_SYMBOLS} 个标的同条件并排`);
  }
  if (
    input.symbols.some(
      (symbol) => typeof symbol !== "string" || !/^\d{6}$/.test(symbol),
    )
  ) {
    throw new Error("仅支持 6 位 A 股股票代码");
  }
  if (new Set(input.symbols).size !== input.symbols.length) {
    throw new Error("回测标的不能重复");
  }
  if (
    !Number.isFinite(input.monthlyAmount) ||
    !(input.monthlyAmount > 0)
  ) {
    throw new Error("每月金额必须是大于 0 的有限数字");
  }
  if (!Number.isInteger(input.buyDay) || input.buyDay < 1 || input.buyDay > 28) {
    throw new Error("指定买入日必须为 1 至 28");
  }
  if (
    !isStrictIsoDate(input.startDate) ||
    !isStrictIsoDate(input.endDate)
  ) {
    throw new Error("回测日期必须是合法的 YYYY-MM-DD");
  }
  if (input.startDate > input.endDate) throw new Error("开始日期不能晚于结束日期");
  if (
    input.rangeYears !== undefined &&
    !(BACKTEST_RANGE_YEARS as readonly number[]).includes(input.rangeYears)
  ) {
    throw new Error(
      `快捷区间仅支持 ${BACKTEST_RANGE_YEARS.join("、")} 年`,
    );
  }
  if (
    input.dividendTiming !== undefined &&
    !(BACKTEST_DIVIDEND_TIMINGS as readonly string[]).includes(
      input.dividendTiming,
    )
  ) {
    throw new Error("分红处理方式仅支持除权日或到账日");
  }
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

export function simulateBacktest(
  input: BacktestRequest,
  symbol: string,
  name: string,
  priceRows: PricePoint[],
  dividendRows: DividendEvent[],
  provenance: DataProvenance[],
  experimentContext: {
    id: string;
    createdAt: string;
  } = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  },
): BacktestResult {
  assertBacktestRequest(input);
  const prices = priceRows
    .filter((row) => row.date >= input.startDate && row.date <= input.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!prices.length) throw new Error(`${symbol} 在所选区间没有可用行情`);
  if (prices.some((row) => !Number.isFinite(row.close) || row.close <= 0)) {
    throw new Error(`${symbol} 行情包含无效收盘价`);
  }

  const dividendsByDate = new Map<string, DividendEvent[]>();
  for (const event of dividendRows) {
    if (event.date < input.startDate || event.date > input.endDate) continue;
    const group = dividendsByDate.get(event.date) ?? [];
    group.push(event);
    dividendsByDate.set(event.date, group);
  }

  // 分红到账日模式区分。默认 ex_date；payment_date 使用实际到账日，若到账日
  // 不是交易日，则在下一个有收盘价的交易日执行回购。
  const dividendTiming = input.dividendTiming ?? "ex_date";
  const dividendsByPaymentDate = new Map<string, DividendEvent[]>();
  if (dividendTiming === "payment_date") {
    for (const event of dividendRows) {
      if (event.date < input.startDate || event.date > input.endDate) continue;
      const effective = event.paymentDate ?? event.date;
      if (effective < input.startDate || effective > input.endDate) continue;
      const execution = prices.find((row) => row.date >= effective);
      if (!execution) continue;
      const group = dividendsByPaymentDate.get(execution.date) ?? [];
      group.push(event);
      dividendsByPaymentDate.set(execution.date, group);
    }
  }
  const activeDividends =
    dividendTiming === "payment_date" ? dividendsByPaymentDate : dividendsByDate;

  // 起始月份处理。当月计划买入日早于回测开始日期时，跳过本月，下月再投入。
  // 例如 startDate=2021-07-25, buyDay=1 → 2021-07-01 已过去 → 第一次投入在 2021-08。
  // 首个可用行情月份之前不生成计划，避免股票尚未上市时的历史月份全部
  // 积压到上市首日。首个可用月份若指定日早于首个行情日，则当月只在
  // 首个行情日投入一次。
  // 非交易日跨月顺延：每一个自然月的投入计划都独立寻找 >= target 的
  // 首个交易日。上月计划即使顺延到本月，也不能占用或取消本月计划；
  // 两个月的计划允许落在同一交易日，并合并为一次外部投入和买入流水。
  const scheduled = new Map<string, number>();
  const warnings: string[] = [];
  const firstAvailableDate = prices[0].date;
  const firstAvailableMonth = firstAvailableDate.slice(0, 7);
  for (const month of monthsBetween(input.startDate, input.endDate)) {
    if (month < firstAvailableMonth) {
      continue;
    }
    const target = `${month}-${String(input.buyDay).padStart(2, "0")}`;
    if (target < input.startDate) {
      // 请求从月中开始时，不补投请求起点之前已经过去的计划。
      continue;
    }
    const execution =
      month === firstAvailableMonth && target < firstAvailableDate
        ? prices[0]
        : prices.find((row) => row.date >= target);
    if (execution) {
      scheduled.set(
        execution.date,
        (scheduled.get(execution.date) ?? 0) + 1,
      );
    } else {
      warnings.push(`${month} 指定日后至回测结束无交易日，该月未投入`);
    }
  }

  let shares = 0;
  // 现金按来源隔离，便于审计：定投资金与分红资金分别产生买入流水。
  let dcaCash = 0;
  let dividendCash = 0;
  const totalCash = () => roundMoney(dcaCash + dividendCash);
  let totalContribution = 0;
  let totalDividend = 0;
  const holdingsHistory: Array<{ date: string; shares: number }> = [];
  const transactions: BacktestTransaction[] = [];
  const equityCurve: EquityPoint[] = [];
  const cashflows: Array<{ date: string; amount: number }> = [];

  // 构建剔除外部投入的标的总收益净值。每日收益率 =
  // (close × 送转因子 + 当日每股现金分红) / 前收 - 1，
  // 累乘得 nav。最大回撤基于 nav 而非总资产，避免每月投入抬高净值掩盖真实跌幅。
  // 注意：nav 始终按除权日分红计算（标的理论净值），不受 dividendTiming 影响。
  let prevClose: number | null = null;
  let nav = 1;
  let navPeak = 1;

  for (const row of prices) {
    // 送股/转增在除权日先入账。资格股数按登记日收盘后的历史持仓确定，
    // 比例字段为“每 10 股增加多少股”，不是直接乘数。
    for (const event of dividendsByDate.get(row.date) ?? []) {
      const entitledShares =
        holdingsHistory
          .filter((item) => item.date <= event.recordDate)
          .at(-1)?.shares ?? 0;
      const ratio = shareIncreaseRatio(event);
      const addedShares = roundShares(entitledShares * ratio);
      if (addedShares <= 0) continue;
      shares = roundShares(shares + addedShares);
      transactions.push({
        date: row.date,
        type: "share_adjustment",
        quantity: addedShares,
        price: row.close,
        amount: 0,
        fee: 0,
        cashAfter: totalCash(),
        shareRatio: event.transferRatio + event.bonusRatio,
      });
    }

    // P1-3：按 dividendTiming 选择到账日索引。现金分红到账后立即用分红池
    // 全额回购原标的；R1 允许零碎股，因此分红不会因交易单位门槛长期滞留现金。
    for (const event of activeDividends.get(row.date) ?? []) {
      const entitledShares =
        holdingsHistory
          .filter((item) => item.date <= event.recordDate)
          .at(-1)?.shares ?? 0;
      const amount = roundMoney(entitledShares * event.perShare);
      if (amount <= 0) continue;
      dividendCash = roundMoney(dividendCash + amount);
      totalDividend = roundMoney(totalDividend + amount);
      transactions.push({
        date: row.date,
        type: "dividend",
        quantity: entitledShares,
        price: event.perShare,
        amount,
        fee: 0,
        cashAfter: totalCash(),
      });

      const tradeAmount = dividendCash;
      const quantity = roundShares(tradeAmount / row.close);
      if (quantity > 0) {
        shares = roundShares(shares + quantity);
        dividendCash = 0;
        transactions.push({
          date: row.date,
          type: "dividend_reinvest",
          quantity,
          price: row.close,
          amount: tradeAmount,
          fee: 0,
          cashAfter: totalCash(),
        });
      }
    }

    const contributionCount = scheduled.get(row.date) ?? 0;
    if (contributionCount) {
      const amount = input.monthlyAmount * contributionCount;
      dcaCash = roundMoney(dcaCash + amount);
      totalContribution = roundMoney(totalContribution + amount);
      cashflows.push({ date: row.date, amount: -amount });
      transactions.push({
        date: row.date,
        type: "contribution",
        quantity: 0,
        price: 0,
        amount,
        fee: 0,
        cashAfter: totalCash(),
      });

      // R1 为研究回测口径：费用为 0、允许零碎股，定投资金全额买入。
      const tradeAmount = dcaCash;
      const quantity = roundShares(tradeAmount / row.close);
      if (quantity > 0) {
        shares = roundShares(shares + quantity);
        dcaCash = 0;
        transactions.push({
          date: row.date,
          type: "buy",
          quantity,
          price: row.close,
          amount: tradeAmount,
          fee: 0,
          cashAfter: totalCash(),
        });
      }
    }

    // nav 始终按除权日分红计算（标的理论净值）
    const corporateActionsToday = dividendsByDate.get(row.date) ?? [];
    const dividendPerShareToday = corporateActionsToday.reduce(
      (sum, event) => sum + event.perShare,
      0,
    );
    const shareRatioToday = corporateActionsToday.reduce(
      (sum, event) => sum + shareIncreaseRatio(event),
      0,
    );
    if (prevClose === null) {
      nav = 1;
    } else if (prevClose > 0) {
      nav =
        nav *
        (row.close * (1 + shareRatioToday) + dividendPerShareToday) /
        prevClose;
    }
    prevClose = row.close;

    navPeak = Math.max(navPeak, nav);
    const asset = roundMoney(shares * row.close + totalCash());
    equityCurve.push({
      date: row.date,
      asset,
      contribution: totalContribution,
      nav,
      returnRate:
        totalContribution > 0 ? asset / totalContribution - 1 : 0,
      drawdown: navPeak > 0 ? nav / navPeak - 1 : 0,
    });
    holdingsHistory.push({ date: row.date, shares });
  }

  const first = prices[0];
  const last = prices.at(-1)!;
  const endingAsset = equityCurve.at(-1)!.asset;
  cashflows.push({ date: last.date, amount: endingAsset });
  // 最大回撤基于剔除后续投入影响的标的总收益净值（nav）。
  // 外部每月投入会不断抬高总资产序列，掩盖真实跌幅；nav 剔除外部现金流，
  // 该口径不会被后续外部投入人为抬高。
  const drawdown = drawdownProfile(
    equityCurve.map((row) => ({ date: row.date, value: row.nav ?? 1 })),
  );
  return {
    id: randomUUID(),
    experimentId: experimentContext.id,
    symbol,
    name,
    requestedStartDate: input.startDate,
    requestedEndDate: input.endDate,
    actualStartDate: first.date,
    actualEndDate: last.date,
    monthlyAmount: input.monthlyAmount,
    buyDay: input.buyDay,
    rangeYears: input.rangeYears,
    dividendTiming,
    strategyKey: buildBacktestStrategyKey(input, symbol),
    metrics: {
      totalContribution,
      endingAsset,
      totalPnl: roundMoney(endingAsset - totalContribution),
      xirr: xirr(cashflows),
      ...drawdown,
      totalDividend,
      endingCash: totalCash(),
    },
    transactions,
    equityCurve,
    priceSeries: prices,
    chartData: {
      status: "unavailable",
      reason: "本次结果没有前复权 OHLCV 快照",
    },
    warnings,
    provenance,
    // P1：simulateBacktest 不直接知道停复牌证据；由 appService 在调用后填充。
    // 这里给空数组作为默认值，避免回测结果对象缺少必要字段。
    interruptionsUsed: [],
    // 领域计算默认只描述计算本身；服务层会用本次行情证据覆盖该值。
    dataQuality: strictBacktestDataQuality(),
    createdAt: experimentContext.createdAt,
  };
}

/**
 * 将已持久化的主回测结果转换为审计明细。
 *
 * 详情弹窗和 XLSX 导出都使用这一转换，不再重新请求行情或二次回测，
 * 因而与用户当时看到的结果使用完全相同的数据快照。
 */
export function backtestResultToSimpleResult(
  backtest: BacktestResult,
): SimpleBacktestResult {
  const prices = [...(backtest.priceSeries ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const pricesByDate = new Map(prices.map((row) => [row.date, row.close]));
  const rows: SimpleBacktestRow[] = [];
  let cumulativeShares = 0;
  let cumulativeContribution = 0;
  let cumulativeInvestment = 0;
  let pendingContribution = 0;
  let totalDividendAmount = 0;

  const addRow = (
    transaction: BacktestTransaction,
    event: SimpleBacktestRow["event"],
    openingCash: number,
    extras: Partial<SimpleBacktestRow> = {},
  ): void => {
    const price = pricesByDate.get(transaction.date) ?? transaction.price;
    const endingCash = transaction.cashAfter;
    const marketValue = roundMoney(cumulativeShares * price);
    const returnRate =
      cumulativeContribution > 0
        ? (marketValue + endingCash) / cumulativeContribution - 1
        : 0;
    rows.push({
      date: transaction.date,
      event,
      openingCash: roundMoney(openingCash),
      price,
      shares:
        event === "dividend" ? 0 : roundShares(transaction.quantity),
      cumulativeShares: roundShares(cumulativeShares),
      externalContribution: 0,
      cumulativeContribution: roundMoney(cumulativeContribution),
      tradeAmount: 0,
      cumulativeInvestment: roundMoney(cumulativeInvestment),
      cumulativeDividend: roundMoney(totalDividendAmount),
      endingCash: roundMoney(endingCash),
      returnRate,
      ...extras,
    });
  };

  for (const transaction of backtest.transactions) {
    if (transaction.type === "contribution") {
      pendingContribution = roundMoney(
        pendingContribution + transaction.amount,
      );
      cumulativeContribution = roundMoney(
        cumulativeContribution + transaction.amount,
      );
      continue;
    }

    if (transaction.type === "share_adjustment") {
      cumulativeShares = roundShares(
        cumulativeShares + transaction.quantity,
      );
      addRow(transaction, "share_adjustment", transaction.cashAfter, {
        shareRatio: transaction.shareRatio,
      });
      continue;
    }

    if (transaction.type === "dividend") {
      totalDividendAmount = roundMoney(
        totalDividendAmount + transaction.amount,
      );
      addRow(
        transaction,
        "dividend",
        transaction.cashAfter - transaction.amount,
        {
          dividendPerShare: transaction.price,
          dividendAmount: transaction.amount,
        },
      );
      continue;
    }

    if (
      transaction.type === "buy" ||
      transaction.type === "dividend_reinvest"
    ) {
      cumulativeShares = roundShares(
        cumulativeShares + transaction.quantity,
      );
      cumulativeInvestment = roundMoney(
        cumulativeInvestment + transaction.amount,
      );
      const contribution =
        transaction.type === "buy" ? pendingContribution : 0;
      addRow(
        transaction,
        transaction.type,
        transaction.cashAfter + transaction.amount + transaction.fee,
        {
          externalContribution: contribution,
          tradeAmount: transaction.amount,
        },
      );
      if (transaction.type === "buy") pendingContribution = 0;
    }
  }

  const lastPrice =
    prices.at(-1)?.close ??
    [...backtest.transactions]
      .reverse()
      .find((transaction) => transaction.price > 0)?.price ??
    0;
  const endingShares = cumulativeShares;
  const endingCost = cumulativeContribution;
  const endingInvestment = cumulativeInvestment;
  const endingMarketValue = roundMoney(endingShares * lastPrice);
  const endingCash = backtest.metrics.endingCash;
  const returnRate =
    endingCost > 0
      ? (endingMarketValue + endingCash) / endingCost - 1
      : 0;

  return {
    symbol: backtest.symbol,
    name: backtest.name,
    requestedStartDate: backtest.requestedStartDate,
    actualStartDate: backtest.actualStartDate,
    actualEndDate: backtest.actualEndDate,
    monthlyAmount: backtest.monthlyAmount,
    buyDay: backtest.buyDay,
    rows,
    endingShares,
    endingCost,
    endingInvestment,
    endingMarketValue,
    endingCash,
    totalDividendAmount,
    returnRate,
    warnings: backtest.warnings,
  };
}
