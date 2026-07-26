import { randomUUID } from "node:crypto";
import type {
  BacktestDetailResult,
  BacktestDetailRow,
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
import { maximumDrawdown, roundMoney, xirr } from "./finance";

const LOT_SIZE = 100;
const COMMISSION_RATE = 0.00025;
const MINIMUM_COMMISSION = 5;

function calendarDaysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** 零碎股保留 2 位小数（用于回测明细列表的同条件比较视图） */
function roundShares(value: number): number {
  return Math.round(value * 100) / 100;
}

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

  // P1-3：分红到账日模式区分。默认 ex_date（研究兼容模式，对齐
  // research/bank-dca v1：除权日立即派息并再投资）。真实交易模式 payment_date
  // 暂只建立索引，R2 完整支持（实际到账日后才能使用现金）。
  const dividendTiming = input.dividendTiming ?? "ex_date";
  const dividendsByPaymentDate = new Map<string, DividendEvent[]>();
  if (dividendTiming === "payment_date") {
    for (const event of dividendRows) {
      if (event.date < input.startDate || event.date > input.endDate) continue;
      const effective = event.paymentDate ?? event.date;
      if (effective < input.startDate || effective > input.endDate) continue;
      const group = dividendsByPaymentDate.get(effective) ?? [];
      group.push(event);
      dividendsByPaymentDate.set(effective, group);
    }
  }
  const activeDividends =
    dividendTiming === "payment_date" ? dividendsByPaymentDate : dividendsByDate;

  // P1-1：起始月份处理。当月计划买入日早于回测开始日期时，跳过本月，下月再投入。
  // 例如 startDate=2021-07-25, buyDay=1 → 2021-07-01 已过去 → 第一次投入在 2021-08。
  // P1-2：非交易日跨月顺延。去掉"只在同一自然月内查找"的限制，改为找 >= target
  // 的下一个交易日（允许跨月）。用 lastSelectedDate 防止同一交易日被多月重复选中，
  // 并在被上月顺延占用的月份跳过本月计划投入，避免双倍投入。
  const scheduled = new Map<string, number>();
  const warnings: string[] = [];
  let lastSelectedDate = "";
  for (const month of monthsBetween(input.startDate, input.endDate)) {
    const target = `${month}-${String(input.buyDay).padStart(2, "0")}`;
    if (target < input.startDate) {
      // P1-1：当月计划买入日早于回测开始日期，跳过本月
      continue;
    }
    if (lastSelectedDate && lastSelectedDate.slice(0, 7) === month) {
      warnings.push(`${month} 已被上月顺延占用，本月不再投入`);
      continue;
    }
    const execution = prices.find(
      (row) => row.date >= target && row.date > lastSelectedDate,
    );
    if (execution) {
      scheduled.set(execution.date, 1);
      lastSelectedDate = execution.date;
    } else {
      warnings.push(`${month} 指定日后至回测结束无交易日，本月未投入`);
    }
  }

  let shares = 0;
  // P1-4：现金隔离。拆分为定投待用现金与分红待再投资现金，避免分红日动用
  // 全部剩余现金（含此前因不足一手而保留的定投资金）。剩余定投资金滚动至
  // 下一次计划投资日，分红优先回购原标的，只使用分红池。
  let dcaCash = 0;
  let dividendCash = 0;
  const totalCash = () => roundMoney(dcaCash + dividendCash);
  let totalContribution = 0;
  let totalDividend = 0;
  let totalRepoInterest = 0;
  const holdingsHistory: Array<{ date: string; shares: number }> = [];
  const transactions: BacktestTransaction[] = [];
  const equityCurve: EquityPoint[] = [];
  const cashflows: Array<{ date: string; amount: number }> = [];

  // P0-2：构建标的总收益净值（剔除外部投入），对齐 research
  // build_total_return_history。每日收益率 = (close + 当日每股分红) / 前收 - 1，
  // 累乘得 nav。最大回撤基于 nav 而非总资产，避免每月投入抬高净值掩盖真实跌幅。
  // 注意：nav 始终按除权日分红计算（标的理论净值），不受 dividendTiming 影响。
  let prevClose: number | null = null;
  let nav = 1;

  // P1-5：国债逆回购计息。repoRate > 0 时，闲置现金（定投池 + 分红池）按
  // 实际日历天数计息，对齐 research verification 的 repo_assumption
  // "前一交易日 204001 定盘利率按实际日历天数计息至下一交易日"。
  // R1 用固定保守年化利率；R2 接入历史 204001 定盘利率。
  const repoRate = input.repoRate ?? 0;
  let prevDate: string | null = null;

  for (const row of prices) {
    // P1-5：每日先对闲置现金按日历日计息（前一交易日 → 当前交易日）
    if (repoRate > 0 && prevDate !== null) {
      const days = calendarDaysBetween(prevDate, row.date);
      if (days > 0) {
        const dcaInterest = roundMoney(dcaCash * repoRate * days / 365);
        const dividendInterest = roundMoney(dividendCash * repoRate * days / 365);
        if (dcaInterest > 0) {
          dcaCash = roundMoney(dcaCash + dcaInterest);
          totalRepoInterest = roundMoney(totalRepoInterest + dcaInterest);
          transactions.push({
            date: row.date,
            type: "repo_interest",
            quantity: 0,
            price: 0,
            amount: dcaInterest,
            fee: 0,
            cashAfter: totalCash(),
          });
        }
        if (dividendInterest > 0) {
          dividendCash = roundMoney(dividendCash + dividendInterest);
          totalRepoInterest = roundMoney(totalRepoInterest + dividendInterest);
          transactions.push({
            date: row.date,
            type: "repo_interest",
            quantity: 0,
            price: 0,
            amount: dividendInterest,
            fee: 0,
            cashAfter: totalCash(),
          });
        }
      }
    }
    prevDate = row.date;

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

      // P1-4：定投买入只用定投池现金
      const maximumLots = Math.floor(dcaCash / (row.close * LOT_SIZE));
      let lots = maximumLots;
      while (lots > 0) {
        const tradeAmount = roundMoney(lots * LOT_SIZE * row.close);
        const fee = commission(tradeAmount);
        if (tradeAmount + fee <= dcaCash) {
          const quantity = lots * LOT_SIZE;
          shares += quantity;
          dcaCash = roundMoney(dcaCash - tradeAmount - fee);
          transactions.push({
            date: row.date,
            type: "buy",
            quantity,
            price: row.close,
            amount: tradeAmount,
            fee,
            cashAfter: totalCash(),
          });
          break;
        }
        lots -= 1;
      }
    }

    // P1-3：按 dividendTiming 选择到账日索引。ex_date 模式下分红在除权日处理，
    // payment_date 模式下分红在实际到账日处理（R2 完整支持，当前已建立索引）。
    for (const event of activeDividends.get(row.date) ?? []) {
      const entitledShares =
        holdingsHistory
          .filter((item) => item.date <= event.recordDate)
          .at(-1)?.shares ?? 0;
      const amount = roundMoney(entitledShares * event.perShare);
      if (amount <= 0) continue;
      // P1-4：分红进入分红池，不与定投池混用
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
      // P1-4：分红再投资只用分红池现金，不动用定投剩余资金。
      // 递减 lots 直到手续费+金额 <= dividendCash（与定投买入逻辑一致）。
      let lots = Math.floor(dividendCash / (row.close * LOT_SIZE));
      while (lots > 0) {
        const quantity = lots * LOT_SIZE;
        const tradeAmount = roundMoney(quantity * row.close);
        const fee = commission(tradeAmount);
        if (tradeAmount + fee <= dividendCash) {
          shares += quantity;
          dividendCash = roundMoney(dividendCash - tradeAmount - fee);
          transactions.push({
            date: row.date,
            type: "dividend_reinvest",
            quantity,
            price: row.close,
            amount: tradeAmount,
            fee,
            cashAfter: totalCash(),
          });
          break;
        }
        lots -= 1;
      }
    }

    // nav 始终按除权日分红计算（标的理论净值）
    const dividendPerShareToday = (dividendsByDate.get(row.date) ?? []).reduce(
      (sum, e) => sum + e.perShare,
      0,
    );
    if (prevClose === null) {
      nav = 1;
    } else if (prevClose > 0) {
      nav = nav * (row.close + dividendPerShareToday) / prevClose;
    }
    prevClose = row.close;

    equityCurve.push({
      date: row.date,
      asset: roundMoney(shares * row.close + totalCash()),
      contribution: totalContribution,
      nav,
    });
    holdingsHistory.push({ date: row.date, shares });
  }

  const first = prices[0];
  const last = prices.at(-1)!;
  const endingAsset = equityCurve.at(-1)!.asset;
  cashflows.push({ date: last.date, amount: endingAsset });
  // P0-2：最大回撤基于标的总收益净值（nav），而非每日账户总资产。
  // 外部每月投入会不断抬高总资产序列，掩盖真实跌幅；nav 剔除外部现金流，
  // 与 research build_total_return_history 的 drawdown 口径一致。
  const navSeries = equityCurve.map((row) => row.nav ?? 1);
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
      maxDrawdown: maximumDrawdown(navSeries),
      totalDividend,
      endingCash: totalCash(),
      totalRepoInterest,
    },
    transactions,
    equityCurve,
    warnings,
    provenance,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 回测明细列表（同条件比较视图）。
 *
 * 与 `simulateBacktest` 的差异：
 * - 零碎股（2 位小数），消除 100 股整数倍离散误差；
 * - 无手续费、无逆回购、无现金结转，纯理论持仓曲线；
 * - 分红日按除权前持仓全额分红再投资（零碎股），等价于后复权总收益口径；
 * - 输出每笔买入/分红再投资的明细行：买入股数、累计股数、价格、累计投入、累计盈亏。
 *
 * 顺序遵循研究端：除权日先分红再投资（用除权前持仓），再处理当月定投买入。
 * 不复权价格 + 显式分红再投资在数学上等价于后复权总收益：
 * 收益率 = 期末市值 / 累计投入 - 1。
 */
export function simulateBacktestDetail(
  input: BacktestRequest,
  symbol: string,
  name: string,
  priceRows: PricePoint[],
  dividendRows: DividendEvent[],
): BacktestDetailResult {
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
      `${symbol} 存在不支持的送股、转增或配股事件，请缩短区间后重试`,
    );
  }

  // 分红按除权日分组（明细列表始终用 ex_date 口径，对齐研究端 total_return）
  const dividendsByDate = new Map<string, DividendEvent[]>();
  for (const event of dividendRows) {
    if (event.date < input.startDate || event.date > input.endDate) continue;
    const group = dividendsByDate.get(event.date) ?? [];
    group.push(event);
    dividendsByDate.set(event.date, group);
  }

  // 复用 P1-1/P1-2 的 scheduled 逻辑：起始月份跳过 + 非交易日跨月顺延
  const scheduled = new Map<string, number>();
  const warnings: string[] = [];
  let lastSelectedDate = "";
  for (const month of monthsBetween(input.startDate, input.endDate)) {
    const target = `${month}-${String(input.buyDay).padStart(2, "0")}`;
    if (target < input.startDate) continue;
    if (lastSelectedDate && lastSelectedDate.slice(0, 7) === month) {
      warnings.push(`${month} 已被上月顺延占用，本月不再投入`);
      continue;
    }
    const execution = prices.find(
      (row) => row.date >= target && row.date > lastSelectedDate,
    );
    if (execution) {
      scheduled.set(execution.date, 1);
      lastSelectedDate = execution.date;
    } else {
      warnings.push(`${month} 指定日后至回测结束无交易日，本月未投入`);
    }
  }

  const rows: BacktestDetailRow[] = [];
  let cumulativeShares = 0;
  let cumulativeCost = 0;
  let cumulativeDividendShares = 0;
  let totalDividendAmount = 0;

  for (const row of prices) {
    const price = row.close;

    // 除权日：用除权前持仓算分红，全额按除权后价格买入零碎股。
    // 处理顺序在 monthly_buy 之前，确保分红用除权前持仓（对齐研究端 recordDate 口径）。
    const dividends = dividendsByDate.get(row.date);
    if (dividends) {
      const totalPerShare = dividends.reduce((sum, e) => sum + e.perShare, 0);
      if (totalPerShare > 0 && cumulativeShares > 0) {
        const dividendAmount = roundMoney(cumulativeShares * totalPerShare);
        const newShares = roundShares(dividendAmount / price);
        cumulativeShares = roundShares(cumulativeShares + newShares);
        cumulativeDividendShares = roundShares(
          cumulativeDividendShares + newShares,
        );
        totalDividendAmount = roundMoney(totalDividendAmount + dividendAmount);
        const marketValue = roundMoney(cumulativeShares * price);
        rows.push({
          date: row.date,
          event: "dividend_reinvest",
          shares: newShares,
          cumulativeShares,
          price,
          amount: 0,
          cumulativeCost,
          cumulativeDividendShares,
          marketValue,
          cumulativePnl: roundMoney(marketValue - cumulativeCost),
          dividendPerShare: totalPerShare,
          dividendAmount,
        });
      }
    }

    // 月度定投买入日：零碎股
    if (scheduled.has(row.date)) {
      const amount = input.monthlyAmount;
      const newShares = roundShares(amount / price);
      cumulativeShares = roundShares(cumulativeShares + newShares);
      cumulativeCost = roundMoney(cumulativeCost + amount);
      const marketValue = roundMoney(cumulativeShares * price);
      rows.push({
        date: row.date,
        event: "monthly_buy",
        shares: newShares,
        cumulativeShares,
        price,
        amount,
        cumulativeCost,
        cumulativeDividendShares,
        marketValue,
        cumulativePnl: roundMoney(marketValue - cumulativeCost),
      });
    }
  }

  const last = prices.at(-1)!;
  const endingShares = cumulativeShares;
  const endingCost = cumulativeCost;
  const endingMarketValue = roundMoney(endingShares * last.close);
  const endingPnl = roundMoney(endingMarketValue - endingCost);
  const totalReturn = endingCost > 0 ? endingMarketValue / endingCost - 1 : 0;

  return {
    symbol,
    name,
    requestedStartDate: input.startDate,
    actualStartDate: prices[0].date,
    actualEndDate: last.date,
    monthlyAmount: input.monthlyAmount,
    buyDay: input.buyDay,
    rows,
    endingShares,
    endingCost,
    endingMarketValue,
    endingPnl,
    totalDividendShares: cumulativeDividendShares,
    totalDividendAmount,
    totalReturn,
    warnings,
  };
}

/**
 * 简化交易成本回测（drawer 展示视图）。
 *
 * 规则：
 * - 交易费用统一按 0 计算；
 * - contribution（资金投入）与 buy（股票买入）合并为一行；
 * - 分红到账与除权调整各自独立行；
 * - 零碎股（2 位小数），分红以现金到账不再投资。
 *
 * 列：期初现金、收盘价、本期买入股数、累计股数、累计投入、期末现金、盈亏率。
 * 盈亏率 = (收盘价 × 累计股数 + 期末现金) / 累计投入 - 1。
 *
 * 事件顺序（同一天）：ex_right（除权信息）→ dividend（分红到账）→ buy（定投买入）。
 */
export function simulateBacktestSimple(
  input: BacktestRequest,
  symbol: string,
  name: string,
  priceRows: PricePoint[],
  dividendRows: DividendEvent[],
): SimpleBacktestResult {
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
      `${symbol} 存在不支持的送股、转增或配股事件，请缩短区间后重试`,
    );
  }

  // 除权日分组（ex_right 行）与分红到账日分组（dividend 行）
  const dividendsByExDate = new Map<string, DividendEvent[]>();
  const dividendsByPaymentDate = new Map<string, DividendEvent[]>();
  for (const event of dividendRows) {
    if (event.date < input.startDate || event.date > input.endDate) continue;
    const exGroup = dividendsByExDate.get(event.date) ?? [];
    exGroup.push(event);
    dividendsByExDate.set(event.date, exGroup);
    const payment = event.paymentDate ?? event.date;
    if (payment >= input.startDate && payment <= input.endDate) {
      const payGroup = dividendsByPaymentDate.get(payment) ?? [];
      payGroup.push(event);
      dividendsByPaymentDate.set(payment, payGroup);
    }
  }

  // 复用 P1-1/P1-2 的 scheduled 逻辑
  const scheduled = new Map<string, number>();
  const warnings: string[] = [];
  let lastSelectedDate = "";
  for (const month of monthsBetween(input.startDate, input.endDate)) {
    const target = `${month}-${String(input.buyDay).padStart(2, "0")}`;
    if (target < input.startDate) continue;
    if (lastSelectedDate && lastSelectedDate.slice(0, 7) === month) {
      warnings.push(`${month} 已被上月顺延占用，本月不再投入`);
      continue;
    }
    const execution = prices.find(
      (row) => row.date >= target && row.date > lastSelectedDate,
    );
    if (execution) {
      scheduled.set(execution.date, 1);
      lastSelectedDate = execution.date;
    } else {
      warnings.push(`${month} 指定日后至回测结束无交易日，本月未投入`);
    }
  }

  const rows: SimpleBacktestRow[] = [];
  let cumulativeShares = 0;
  let cumulativeCost = 0;
  // 分红现金与定投现金隔离（修复分红重复计入后续定投期初现金的 bug）：
  // - dcaCash：定投池，每月投入全额买入零碎股，始终为 0；
  // - dividendCash：分红池，累积分红到账金额，不参与定投买入。
  // 期初现金（buy 行）= dcaCash + 本期投入（不含 dividendCash）；
  // 期末现金（任意行）= dcaCash + dividendCash（反映账户实际现金余额）。
  let dcaCash = 0;
  let dividendCash = 0;
  let totalDividendAmount = 0;
  let prevClose: number | null = null;

  const buildRow = (
    date: string,
    event: SimpleBacktestRow["event"],
    openingCash: number,
    price: number,
    shares: number,
    amount: number,
    endingCash: number,
    extras: Partial<SimpleBacktestRow> = {},
  ): SimpleBacktestRow => {
    const marketValue = roundMoney(cumulativeShares * price);
    const returnRate = cumulativeCost > 0 ? (marketValue + endingCash) / cumulativeCost - 1 : 0;
    return {
      date,
      event,
      openingCash: roundMoney(openingCash),
      price,
      shares: roundShares(shares),
      cumulativeShares: roundShares(cumulativeShares),
      cumulativeCost: roundMoney(cumulativeCost),
      endingCash: roundMoney(endingCash),
      returnRate,
      amount: roundMoney(amount),
      ...extras,
    };
  };

  for (const row of prices) {
    const price = row.close;

    // 除权日：ex_right 行（信息性，记录价格变化，不改股数/现金）
    const exEvents = dividendsByExDate.get(row.date);
    if (exEvents) {
      const totalPerShare = exEvents.reduce((sum, e) => sum + e.perShare, 0);
      const cashBefore = roundMoney(dcaCash + dividendCash);
      rows.push(
        buildRow(row.date, "ex_right", cashBefore, price, 0, 0, cashBefore, {
          prevClose: prevClose ?? price,
          dividendPerShare: totalPerShare,
        }),
      );
    }

    // 分红到账日：dividend 行（增加 dividendCash，不再投资）
    const payEvents = dividendsByPaymentDate.get(row.date);
    if (payEvents) {
      const totalPerShare = payEvents.reduce((sum, e) => sum + e.perShare, 0);
      const dividendAmount = roundMoney(cumulativeShares * totalPerShare);
      const openingCash = roundMoney(dcaCash + dividendCash);
      dividendCash = roundMoney(dividendCash + dividendAmount);
      totalDividendAmount = roundMoney(totalDividendAmount + dividendAmount);
      const endingCash = roundMoney(dcaCash + dividendCash);
      rows.push(
        buildRow(row.date, "dividend", openingCash, price, 0, dividendAmount, endingCash, {
          dividendPerShare: totalPerShare,
        }),
      );
    }

    // 定投买入日：buy 行（contribution + buy 合并）
    // 期初现金 = dcaCash + 本期投入（不含分红池），避免分红重复计入。
    if (scheduled.has(row.date)) {
      const amount = input.monthlyAmount;
      const openingCash = roundMoney(dcaCash + amount);
      const shares = amount / price;
      cumulativeShares = roundShares(cumulativeShares + shares);
      cumulativeCost = roundMoney(cumulativeCost + amount);
      // 定投全额买入零碎股，dcaCash 始终为 0；dividendCash 不参与买入。
      dcaCash = 0;
      const endingCash = roundMoney(dcaCash + dividendCash);
      rows.push(buildRow(row.date, "buy", openingCash, price, shares, amount, endingCash));
    }

    prevClose = price;
  }

  const last = prices.at(-1)!;
  const endingShares = cumulativeShares;
  const endingCost = cumulativeCost;
  const endingMarketValue = roundMoney(endingShares * last.close);
  const endingCash = roundMoney(dcaCash + dividendCash);
  const returnRate = endingCost > 0 ? (endingMarketValue + endingCash) / endingCost - 1 : 0;

  return {
    symbol,
    name,
    requestedStartDate: input.startDate,
    actualStartDate: prices[0].date,
    actualEndDate: last.date,
    monthlyAmount: input.monthlyAmount,
    buyDay: input.buyDay,
    rows,
    endingShares,
    endingCost,
    endingMarketValue,
    endingCash,
    totalDividendAmount,
    returnRate,
    warnings,
  };
}
