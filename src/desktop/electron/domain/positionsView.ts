/** 股票与 ETF 投资收益只读视图；投资事实统一由 ledgerReducer 归约。 */
import type {
  LedgerEntry,
  LiveDataQuality,
  MarketDataProvenance,
  PerformancePeriod,
  PeriodPerformance,
  PositionView,
  PositionsOverview,
  StockInfo,
  StoredMarketCoverage,
  StoredMarketPrice,
  XirrStatus,
} from "../../shared/contracts";
import {
  LIVE_PERFORMANCE_PERIOD_DAYS,
  LIVE_PRICE_STALE_AFTER_DAYS,
  LIVE_RECENT_LEDGER_LIMIT,
} from "../../shared/constants";
import { roundMoney, xirr } from "./finance";
import {
  addDays,
  currentMarketDate,
  daysBetween,
} from "./dateUtils";
import {
  canonicalLedgerOrderDescending,
  holdingIntervals,
  reduceLedger,
  type LedgerPositionState,
} from "./ledgerReducer";
import {
  applyCoverageImpairments,
  buildCoverageImpairments,
  buildDailyAttribution,
  coverageIssueStrings,
  rowsBySymbol,
  type DailyAttribution,
} from "./dailyAttribution";
import {
  namesMap,
  requiredSecurityType,
  securityTypesMap,
  toLedgerRecord,
} from "./liveViewSupport";
import { projectInvestmentCash } from "./investmentCashProjection";

const PERFORMANCE_PERIODS = Object.keys(
  LIVE_PERFORMANCE_PERIOD_DAYS,
) as PerformancePeriod[];
type InstrumentState = LedgerPositionState;

export interface LiveModel {
  factAsOfDate: string;
  cutoff: string | null;
  updatedAt: string | null;
  priceSource: string;
  provenance: MarketDataProvenance[];
  missingSymbols: string[];
  postValuationFacts: LedgerEntry[];
  postValuationSymbols: string[];
  missingDates: string[];
  issues: string[];
  effectiveEntries: LedgerEntry[];
  reversedIds: Set<string>;
  positions: Map<string, InstrumentState>;
  latestPrices: Map<string, StoredMarketPrice>;
  daily: DailyAttribution[];
}

export interface LiveModelBoundary {
  factAsOfDate: string;
  valuationCutoff: string | null;
}

function emptyPeriodPerformance(): PeriodPerformance {
  return {
    day: null,
    week: null,
    month: null,
    threeMonths: null,
    sixMonths: null,
    year: null,
  };
}

function priceProvenance(
  rows: readonly StoredMarketPrice[],
): MarketDataProvenance[] {
  const result = new Map<string, MarketDataProvenance>();
  for (const row of rows) {
    const item: MarketDataProvenance = {
      source: row.source,
      primarySource: "tencent",
      fallbackUsed: row.fallbackUsed,
      ...(row.fallbackReason ? { fallbackReason: row.fallbackReason } : {}),
      fetchedAt: row.fetchedAt,
      dataCutoff: row.dataCutoff,
      adjustment: row.adjustment,
    };
    const key = JSON.stringify(item);
    result.set(key, item);
  }
  return [...result.values()];
}

export function buildLiveModel(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
  purpose: "positions" | "history" = "history",
  boundary?: LiveModelBoundary,
): LiveModel {
  const today = currentMarketDate();
  const factAsOfDate = boundary?.factAsOfDate ?? today;
  const ledgerState = reduceLedger(entries, factAsOfDate);
  const { effectiveEntries: effective, reversedIds } = ledgerState;
  const pricesBySymbol = rowsBySymbol(prices);
  const allSymbols = [
    ...new Set(
      effective
        .filter((entry) => entry.type === "buy" || entry.type === "sell")
        .flatMap((entry) => entry.symbol ?? []),
    ),
  ];
  const heldSymbols = [...ledgerState.positions.entries()]
    .filter(([, position]) => position.quantity > 1e-8)
    .map(([symbol]) => symbol);
  const symbols = purpose === "positions" ? heldSymbols : allSymbols;
  const availableCutoffs = symbols
    .map((symbol) => pricesBySymbol.get(symbol)?.at(-1)?.date)
    .filter((date): date is string => Boolean(date))
    .filter((date) => date <= factAsOfDate);
  const cutoff = boundary
    ? boundary.valuationCutoff
    : purpose === "history"
      ? availableCutoffs.sort().at(-1) ?? null
      : availableCutoffs.length === symbols.length && symbols.length
        ? availableCutoffs.sort()[0]
        : null;
  const symbolsWithoutPrices = symbols.filter(
    (symbol) => !(pricesBySymbol.get(symbol)?.length),
  );
  const valuationSymbols = cutoff
    ? [...reduceLedger(effective, cutoff).positions.entries()]
        .filter(([, position]) => position.quantity > 1e-8)
        .map(([symbol]) => symbol)
    : heldSymbols;
  const symbolsWithoutCutoffPrice = cutoff
    ? valuationSymbols.filter(
        (symbol) =>
          !pricesBySymbol
            .get(symbol)
            ?.some((row) => row.date === cutoff),
      )
    : valuationSymbols;
  const missingSymbols = [
    ...new Set([...symbolsWithoutPrices, ...symbolsWithoutCutoffPrice]),
  ];
  const postValuationFacts = cutoff
    ? effective.filter((entry) => entry.businessDate > cutoff)
    : [];
  const postValuationSymbols = [
    ...new Set(
      postValuationFacts.flatMap((entry) => entry.symbol ?? []),
    ),
  ];
  const issues = [
    ...(symbolsWithoutPrices.length
      ? [`缺少 ${symbolsWithoutPrices.length} 个标的的本地正式收盘行情`]
      : []),
    ...(symbolsWithoutCutoffPrice.length
      ? [
          `${symbolsWithoutCutoffPrice.length} 个标的缺少估值截止日 ${cutoff ?? "未知"} 的精确正式收盘价，未使用更早价格代替`,
        ]
      : []),
    ...(postValuationFacts.length
      ? [
          `存在估值截止日后的投资事实（${postValuationFacts.length} 条），正式市值、投资总收益、XIRR 和期间收益率暂不可计算`,
        ]
      : []),
  ];
  const latestPrices = new Map<string, StoredMarketPrice>();
  if (cutoff) {
    for (const symbol of symbols) {
      const row = pricesBySymbol
        .get(symbol)
        ?.find((item) => item.date === cutoff);
      if (row) latestPrices.set(symbol, row);
    }
  }
  const relevantPrices = prices.filter((row) => symbols.includes(row.symbol));
  const updatedAt =
    relevantPrices
      .map((row) => row.fetchedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const provenance = priceProvenance(relevantPrices);
  const priceSource = !symbols.length
    ? "本地投资事实（当前无持仓）"
    : provenance
        .map((item) =>
          item.fallbackUsed
            ? `新浪（腾讯失败：${item.fallbackReason ?? "未知原因"}）· ${item.adjustment === "qfq" ? "前复权" : "不复权"}`
            : `腾讯 · ${item.adjustment === "qfq" ? "前复权" : "不复权"}`,
        )
        .filter((value, index, array) => array.indexOf(value) === index)
        .join("、") || "无可用正式收盘行情";
  const daily = buildDailyAttribution(
    effective,
    pricesBySymbol,
    factAsOfDate,
    cutoff,
    namesMap(stocks, entries),
  );
  return {
    factAsOfDate,
    cutoff,
    updatedAt,
    priceSource,
    provenance,
    missingSymbols,
    postValuationFacts,
    postValuationSymbols,
    missingDates: daily.filter((day) => day.isPartial).map((day) => day.date),
    issues,
    effectiveEntries: effective,
    reversedIds,
    positions: ledgerState.positions,
    latestPrices,
    daily,
  };
}

export function qualityFor(
  model: LiveModel,
  hasFacts: boolean,
  additionalIssues: string[] = [],
  allowStale = true,
): LiveDataQuality {
  const issues = [...model.issues, ...additionalIssues];
  const stale =
    allowStale &&
    model.cutoff !== null &&
    daysBetween(model.cutoff, currentMarketDate()) >
      LIVE_PRICE_STALE_AFTER_DAYS;
  return {
    status: !hasFacts
      ? "empty"
      : model.missingSymbols.length ||
          model.postValuationFacts.length ||
          model.missingDates.length ||
          additionalIssues.length
        ? "partial"
        : stale
          ? "stale"
          : "ready",
    dataCutoff: model.cutoff,
    updatedAt: model.updatedAt,
    issues,
    missingSymbols: model.missingSymbols,
    missingDates: [...new Set(model.missingDates)],
  };
}

function compoundReturn(days: readonly DailyAttribution[]): number | null {
  const relevant = days.filter((day) => day.returnRate !== null);
  if (!relevant.length || days.some((day) => day.isPartial)) return null;
  return relevant.reduce((result, day) => result * (1 + day.returnRate!), 1) - 1;
}

function periodPerformance(
  daily: readonly DailyAttribution[],
  cutoff: string | null,
  symbol?: string,
): PeriodPerformance {
  if (!cutoff) return emptyPeriodPerformance();
  const exposureDays = symbol
    ? daily.filter((day) => {
        const contribution = day.contributions.get(symbol);
        return contribution !== undefined && contribution.capitalBase > 0;
      })
    : daily.filter((day) => day.capitalBase > 0);
  const firstExposureDate = exposureDays[0]?.date ?? null;
  const result = emptyPeriodPerformance();
  for (const period of PERFORMANCE_PERIODS) {
    const start = addDays(cutoff, -LIVE_PERFORMANCE_PERIOD_DAYS[period] + 1);
    // 组合和单标的分别按自身首次形成投资敞口的日期判断样本完整性。
    // 不能用老标的历史替新标的通过一年期完整性校验。
    if (!firstExposureDate || firstExposureDate > start) {
      result[period] = null;
      continue;
    }
    const selected = daily
      .filter((day) => day.date >= start && day.date <= cutoff)
      .map((day) => {
        if (!symbol) return day;
        const contribution = day.contributions.get(symbol);
        return {
          ...day,
          totalPnl: contribution?.totalPnl ?? 0,
          marketPricePnl: contribution?.marketPricePnl ?? 0,
          dividendPnl: contribution?.dividendPnl ?? 0,
          tradingCostPnl: contribution?.tradingCostPnl ?? 0,
          returnRate: contribution?.returnRate ?? null,
          capitalBase: contribution?.capitalBase ?? 0,
          isPartial: contribution?.totalPnl === null,
        };
      });
    result[period] = compoundReturn(selected);
  }
  return result;
}

function investmentXirr(
  entries: readonly LedgerEntry[],
  endingDate: string | null,
  endingStockValue: number | null,
): { value: number | null; status: XirrStatus } {
  if (endingStockValue === null) {
    return { value: null, status: "missing_valuation" };
  }
  const projection = projectInvestmentCash(entries);
  const cashflows = [...projection.externalCashflows];
  const endingValue = roundMoney(
    endingStockValue + projection.pendingReinvestmentCash,
  );
  if (endingValue > 0) {
    if (!endingDate) {
      return { value: null, status: "missing_valuation" };
    }
    cashflows.push({ date: endingDate, amount: endingValue });
  }
  cashflows.sort((a, b) => a.date.localeCompare(b.date));
  // 短期样本年化会产生极端 XIRR（例如 7 天 5.6% 年化为 ~1600%），
  // 直接展示会误导用户。样本期不足 30 天时不返回 XIRR。
  if (
    cashflows.length < 2 ||
    !cashflows.some((flow) => flow.amount < 0) ||
    !cashflows.some((flow) => flow.amount > 0)
  ) {
    return { value: null, status: "insufficient_cashflows" };
  }
  const sampleDays = daysBetween(cashflows[0].date, cashflows[cashflows.length - 1].date);
  if (sampleDays < 30) {
    return { value: null, status: "short_sample" };
  }
  const value = xirr(cashflows);
  return value === null
    ? { value: null, status: "no_solution" }
    : { value, status: "ready" };
}

/**
 * P1-3：将持久化覆盖损伤应用到持仓读模型。
 *
 * 复用 dailyAttribution 的 buildCoverageImpairments + applyCoverageImpairments，
 * 使 partial 覆盖不仅改变质量状态，还使受影响日期的收益指标失效。
 */

export function buildPositionsOverview(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  stocks: readonly StockInfo[],
  boundary?: LiveModelBoundary,
  coverage?: readonly StoredMarketCoverage[],
): PositionsOverview {
  const model = buildLiveModel(
    entries,
    prices,
    stocks,
    "positions",
    boundary,
  );
  const state = reduceLedger(entries, model.factAsOfDate);
  const portfolioCash = projectInvestmentCash(model.effectiveEntries);
  const names = namesMap(stocks, entries);
  const securityTypes = securityTypesMap(stocks, entries);
  const currentPositions = [...state.positions.entries()].filter(
    ([, position]) => position.quantity > 1e-8,
  );
  // P1-3：在 positions map 之前计算覆盖损伤并应用到日度序列，
  // 使 periodPerformance 和 dayPnl 都能反映 partial 覆盖造成的缺失。
  const heldSymbolsForImpairment = new Set(
    currentPositions.map(([symbol]) => symbol),
  );
  const impairments = coverage?.length
    ? buildCoverageImpairments(
        coverage,
        heldSymbolsForImpairment,
        holdingIntervals(entries, model.factAsOfDate),
        model.effectiveEntries
          .map((entry) => entry.businessDate)
          .sort()
          .at(0) ?? model.factAsOfDate,
        model.cutoff ?? model.factAsOfDate,
      )
    : [];
  const impairedDaily = applyCoverageImpairments(model.daily, impairments);
  const positions: PositionView[] = currentPositions.map(([symbol, position]) => {
    const quote = model.latestPrices.get(symbol);
    const hasPostValuationFact =
      model.postValuationSymbols.includes(symbol);
    const marketValue = quote && !hasPostValuationFact
      ? roundMoney(quote.close * position.quantity)
      : null;
    const unrealizedPnl =
      marketValue === null ? null : roundMoney(marketValue - position.cost);
    const totalReturn =
      marketValue === null
        ? null
        : roundMoney(
            marketValue +
              position.cumulativeSellNetIncome +
              position.cumulativeDividend -
              position.cumulativeBuySpend,
          );
    const symbolEntries = model.effectiveEntries.filter(
      (entry) => entry.symbol === symbol,
    );
    const symbolCash = projectInvestmentCash(symbolEntries);
    const pendingReinvestmentCash =
      symbolCash.pendingReinvestmentCashBySymbol.get(symbol) ?? 0;
    const externalBuySpend =
      symbolCash.externalBuySpendBySymbol.get(symbol) ?? 0;
    const externalDividendIncome =
      symbolCash.externalDividendIncomeBySymbol.get(symbol) ?? 0;
    const netInvestment = roundMoney(
      externalBuySpend -
        position.cumulativeSellNetIncome -
        externalDividendIncome,
    );
    const symbolXirr = investmentXirr(
      symbolEntries,
      model.cutoff,
      marketValue,
    );
    const symbolPeriodPerformance = hasPostValuationFact
      ? emptyPeriodPerformance()
      : periodPerformance(impairedDaily, model.cutoff, symbol);
    // P1-1：当日盈亏直接读取估值截止日的归因金额，不再由收益率反推。
    // 反推公式在分红/交易场景下不准确（如分红日会低估）。
    const dayContribution = impairedDaily
      .find((day) => day.date === model.cutoff)
      ?.contributions.get(symbol);
    const dayPnl =
      dayContribution?.totalPnl == null
        ? null
        : roundMoney(dayContribution.totalPnl);
    return {
      symbol,
      name: names.get(symbol) ?? symbol,
      securityType: requiredSecurityType(symbol, securityTypes),
      quantity: position.quantity,
      cost: position.cost,
      // 保留原始精度，避免展示值反算后无法对账累计买入支出。
      averageCost: position.cost / position.quantity,
      lastPrice: quote?.close ?? null,
      marketValue,
      // weight 在总市值计算后回填
      weight: null,
      dayPnl,
      cumulativeBuySpend: position.cumulativeBuySpend,
      cumulativeSellNetIncome: position.cumulativeSellNetIncome,
      netInvestment,
      pendingReinvestmentCash,
      unrealizedPnl,
      realizedPnl: position.realizedPnl,
      cumulativeDividend: position.cumulativeDividend,
      totalReturn,
      xirr: symbolXirr.value,
      xirrStatus: symbolXirr.status,
      periodPerformance: symbolPeriodPerformance,
      recentEntries: entries
        .filter((entry) => entry.symbol === symbol)
        .sort(canonicalLedgerOrderDescending)
        .slice(0, LIVE_RECENT_LEDGER_LIMIT)
        .map((entry) =>
          toLedgerRecord(entry, names, securityTypes, model.reversedIds),
        ),
    };
  });
  const marketValues = positions.map((position) => position.marketValue);
  const marketValue =
    model.postValuationFacts.length ||
    marketValues.some((value) => value === null)
    ? null
    : roundMoney(marketValues.reduce<number>((sum, value) => sum + value!, 0));
  // P-UI：回填持仓占比
  if (marketValue !== null && marketValue > 0) {
    for (const position of positions) {
      if (position.marketValue !== null) {
        position.weight = position.marketValue / marketValue;
      }
    }
  }
  const remainingCost = [...state.positions.values()].reduce(
    (sum, position) => sum + position.cost,
    0,
  );
  const unrealizedPnl =
    marketValue === null ? null : roundMoney(marketValue - remainingCost);
  const totalReturn =
    marketValue === null
      ? null
      : roundMoney(
          marketValue +
            state.cumulativeSellNetIncome +
            state.cumulativeDividend -
            state.cumulativeBuySpend,
        );
  const hasFacts = model.effectiveEntries.length > 0;
  const lastFactDate =
    model.effectiveEntries
      .map((entry) => entry.businessDate)
      .sort()
      .at(-1) ?? null;
  const portfolioXirr = investmentXirr(
    model.effectiveEntries,
    model.cutoff ?? lastFactDate,
    marketValue,
  );
  // P1-3：覆盖损伤已在上文计算并应用到 impairedDaily，
  // 这里仅将结构化问题转为字符串传给 qualityFor。
  const partialCoverageIssues = coverageIssueStrings(impairments);
  return {
    quality: qualityFor(model, hasFacts, partialCoverageIssues),
    hasLedgerEntries: hasFacts,
    metrics: {
      marketValue: hasFacts ? marketValue : null,
      cumulativeBuySpend: state.cumulativeBuySpend,
      cumulativeSellNetIncome: state.cumulativeSellNetIncome,
      netInvestment: state.netInvestment,
      pendingReinvestmentCash: portfolioCash.pendingReinvestmentCash,
      unrealizedPnl,
      realizedPnl: state.realizedPnl,
      cumulativeDividend: state.cumulativeDividend,
      totalReturn: hasFacts ? totalReturn : null,
      // 已清仓时没有期末估值行情，现金流仍可在最后一笔事实日闭合。
      xirr: portfolioXirr.value,
      xirrStatus: portfolioXirr.status,
    },
    portfolioPerformance: model.postValuationFacts.length
      ? emptyPeriodPerformance()
      : periodPerformance(impairedDaily, model.cutoff),
    positions,
    valuationSource: model.priceSource,
    provenance: model.provenance,
  };
}
