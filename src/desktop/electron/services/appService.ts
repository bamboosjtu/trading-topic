import { randomUUID } from "node:crypto";
import type {
  AppDiagnostics,
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestRequest,
  BacktestResult,
  LedgerEntry,
  LedgerEntryInput,
  LedgerImpactPreview,
  MarketDataIssue,
  SimpleBacktestResult,
  BacktestWorkspaceState,
  IncomeCalendarQuery,
  IncomeCalendarView,
  LedgerQuery,
  LedgerQueryResult,
  MarketDataCacheEntry,
  MarketRefreshResult,
  PositionsOverview,
  StockInfo,
  DividendReinvestmentInput,
  DividendReinvestmentPreview,
  DividendReinvestmentResult,
  LedgerRecordView,
  StoredMarketCoverage,
} from "../../shared/contracts";
import { buildBacktestStrategyKey } from "../../shared/backtestIdentity";
import {
  BACKTEST_CALIBER_VERSION,
  DATA_SOURCE_THROTTLE_MS,
  ETF_UNIVERSE_MIN_SIZE,
  LIVE_PRICE_REFRESH_LOOKBACK_MONTHS,
  STOCK_UNIVERSE_CACHE_MAX_AGE_MS,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import {
  fetchAStockUniverse,
  fetchDomesticEtfUniverse,
} from "../data/stockUniverse";
import { fetchCorporateActions } from "../data/tencent";
import {
  fetchMarketAdjustedBars,
  fetchMarketPrices,
} from "../data/marketDataProvider";
import {
  assertBacktestRequest,
  backtestResultToSimpleResult,
  simulateBacktest,
} from "../domain/analysis";
import {
  assertLedgerReversal,
  normalizeLedgerInput,
  previewLedgerMutation,
} from "../domain/ledgerCommands";
import { buildPositionsOverview } from "../domain/positionsView";
import { buildIncomeCalendar } from "../domain/incomeCalendar";
import {
  exportLedgerRecords,
  getLedgerRecordById,
  queryLedgerRecords,
} from "../domain/ledgerQuery";
import { LocalDatabase } from "../storage/database";
import {
  addDays,
  addMonths,
  currentMarketDate,
  monthEnd,
} from "../domain/dateUtils";
import {
  activeLedgerEntries,
  reduceLedger,
} from "../domain/ledgerReducer";
import {
  isConfirmedMarketClosureRange,
  latestCompletedTradingDate,
  latestTradingDateInMonth,
  latestWeekdayCandidate,
  marketCalendarDiagnostics,
  type TradeDateContext,
} from "../domain/marketCalendar";

function isCompleteAStockUniverse(stocks: readonly StockInfo[]): boolean {
  return (
    stocks.length >= STOCK_UNIVERSE_MIN_SIZE &&
    stocks.every((item) => item.securityType !== "etf")
  );
}

/**
 * 将结构化问题列表格式化为可读字符串，供实盘行情 issues 和日志使用。
 */
function formatMarketIssues(issues: readonly MarketDataIssue[]): string[] {
  return issues.map((issue) =>
    issue.date ? `${issue.date} ${issue.message}` : issue.message,
  );
}

/**
 * P1-1：判断 error 级别问题是否落在请求区间内。
 * 无日期的 error 视为影响整个区间（保守阻断）。
 */
function hasErrorInRequestRange(
  issues: readonly MarketDataIssue[],
  startDate: string,
  endDate: string,
): boolean {
  return issues.some((issue) => {
    if (issue.severity !== "error") return false;
    if (!issue.date) return true;
    return issue.date >= startDate && issue.date <= endDate;
  });
}

/**
 * P1-2：筛选出请求区间内的 warning 级别问题，用于写入回测结果 warnings。
 * 无日期的 warning 视为通用问题，一并保留。
 */
function warningsInRequestRange(
  issues: readonly MarketDataIssue[],
  startDate: string,
  endDate: string,
): MarketDataIssue[] {
  return issues.filter((issue) => {
    if (issue.severity !== "warning") return false;
    if (!issue.date) return true;
    return issue.date >= startDate && issue.date <= endDate;
  });
}

/**
 * 单个回测标的的市场数据集合：行情、分红、K 线图数据及其来源。
 * 由 `fetchBacktestMarketData` 收集，供 `computeBacktestResults` 与
 * `persistBacktestExperiment` 复用。
 *
 * P1-1：前复权 K 线（chartData / chartProvenance / chartIssues）允许失败，
 * 失败时 chartData 标记为 error/unavailable，仍可继续回测。
 */
interface BacktestMarketDataBundle {
  symbol: string;
  name: string;
  prices: Awaited<ReturnType<typeof fetchMarketPrices>>;
  dividends: Awaited<ReturnType<typeof fetchCorporateActions>>;
  chartData: BacktestResult["chartData"];
  chartProvenance:
    | Awaited<ReturnType<typeof fetchMarketAdjustedBars>>["provenance"]
    | undefined;
  /** 前复权 K 线的问题列表；errors 不阻断回测但写入 warnings。 */
  chartIssues: MarketDataIssue[];
}

function isCompleteEtfUniverse(stocks: readonly StockInfo[]): boolean {
  return (
    stocks.length >= ETF_UNIVERSE_MIN_SIZE &&
    stocks.every((item) => item.securityType === "etf")
  );
}

function isFreshUniverseSnapshot(
  rows: ReadonlyArray<StockInfo & { fetchedAt?: string }>,
): boolean {
  const fetchedAt = rows[0]?.fetchedAt;
  return (
    fetchedAt !== undefined &&
    Number.isFinite(Date.parse(fetchedAt)) &&
    Date.now() - Date.parse(fetchedAt) < STOCK_UNIVERSE_CACHE_MAX_AGE_MS
  );
}

function confirmedCoverageThrough(
  coverage: StoredMarketCoverage,
): string | null {
  if (coverage.resultStatus === "empty") {
    return coverage.emptyEvidence ? coverage.requestedThrough : null;
  }
  // P1-2：partial 状态不返回 null（会导致最新交易日也被视为缺失）。
  // 返回首个 error 日期前一天的连续覆盖截止日；无具体日期时返回 dataCutoff。
  // 这使得 tailStatus 只取决于最新交易日是否有价格，而非内部坏行。
  if (coverage.resultStatus === "partial") {
    if (!coverage.dataCutoff) return null;
    const errorDates = (coverage.issues ?? [])
      .filter((issue) => issue.severity === "error" && issue.date)
      .map((issue) => issue.date!)
      .filter(
        (date) =>
          date >= coverage.requestedFrom &&
          date <= coverage.requestedThrough,
      )
      .sort();
    if (errorDates.length && errorDates[0]! > coverage.requestedFrom) {
      return addDays(errorDates[0]!, -1);
    }
    return coverage.dataCutoff;
  }
  if (!coverage.dataCutoff) return null;
  if (coverage.dataCutoff >= coverage.requestedThrough) {
    return coverage.requestedThrough;
  }
  return isConfirmedMarketClosureRange(
    addDays(coverage.dataCutoff, 1),
    coverage.requestedThrough,
  )
    ? coverage.requestedThrough
    : coverage.dataCutoff;
}

interface LivePriceRange {
  symbol: string;
  startDate: string;
  endDate: string;
}

/**
 * P1-3：按证券合并重叠或相邻的请求区间。
 * 同日清仓再买入会生成首尾相接的区间（A.end === B.start），
 * 不合并会导致两个快照都包含同一天价格，写入时触发价格行冲突。
 */
function normalizeRanges(
  ranges: readonly LivePriceRange[],
): LivePriceRange[] {
  const bySymbol = new Map<string, LivePriceRange[]>();
  for (const range of ranges) {
    const list = bySymbol.get(range.symbol) ?? [];
    list.push(range);
    bySymbol.set(range.symbol, list);
  }
  return [...bySymbol.entries()].flatMap(([symbol, list]) => {
    const sorted = [...list].sort((a, b) =>
      a.startDate.localeCompare(b.startDate),
    );
    type DateRange = { startDate: string; endDate: string };
    const merged: DateRange[] = [];
    for (const range of sorted) {
      const last = merged.at(-1);
      if (last && range.startDate <= last.endDate) {
        // 重叠或相邻：扩展到更大的 endDate
        last.endDate = range.endDate > last.endDate ? range.endDate : last.endDate;
      } else {
        merged.push({ startDate: range.startDate, endDate: range.endDate });
      }
    }
    return merged.map((r) => ({ symbol, ...r }));
  });
}

function incomePriceRanges(
  entries: readonly LedgerEntry[],
  query: IncomeCalendarQuery,
  completedEndDate: string,
): LivePriceRange[] {
  const marketDate = currentMarketDate();
  const endDate = [monthEnd(query.month), marketDate, completedEndDate].sort()[0];
  const currentPositions = reduceLedger(entries, marketDate).positions;
  const { effective } = activeLedgerEntries(entries, marketDate);
  const currentSymbols = new Set(
    [...currentPositions.entries()]
      .filter(([, position]) => position.quantity > 1e-8)
      .map(([symbol]) => symbol),
  );
  const symbols = query.symbol
    ? [query.symbol]
    : query.scope === "current"
      ? [...currentSymbols]
      : [
          ...new Set(
            effective
              .filter((entry) => entry.businessDate <= endDate)
              .flatMap((entry) => entry.symbol ?? []),
          ),
        ];

  return symbols.flatMap((symbol) => {
    const securityFacts = effective.filter(
      (entry) =>
        entry.symbol === symbol &&
        entry.businessDate <= endDate &&
        (entry.type === "buy" || entry.type === "sell"),
    );
    const ranges: LivePriceRange[] = [];
    let quantity = 0;
    let startDate: string | null = null;
    for (const entry of securityFacts) {
      const before = quantity;
      quantity +=
        entry.type === "buy"
          ? (entry.quantity ?? 0)
          : -(entry.quantity ?? 0);
      if (before <= 1e-8 && quantity > 1e-8) {
        startDate = entry.businessDate;
      }
      if (before > 1e-8 && quantity <= 1e-8 && startDate) {
        ranges.push({
          symbol,
          startDate,
          endDate: entry.businessDate,
        });
        startDate = null;
      }
    }
    if (startDate) {
      ranges.push({ symbol, startDate, endDate });
    }
    return ranges;
  });
}

export class AppService {
  constructor(private readonly database: LocalDatabase) {}

  getDiagnostics(): AppDiagnostics {
    return {
      schemaVersion: this.database.getSchemaVersion(),
      stockDirectory: this.database.getDirectoryProvenance("stock"),
      etfDirectory: this.database.getDirectoryProvenance("etf"),
      marketCalendars: marketCalendarDiagnostics(),
    };
  }

  async listAStocks(): Promise<StockInfo[]> {
    const cached = this.database
      .listStockUniverse()
      .filter((item) => item.securityType !== "etf");
    const cachedIsComplete = isCompleteAStockUniverse(cached);
    if (cachedIsComplete && isFreshUniverseSnapshot(cached)) return cached;

    try {
      const response = await fetchAStockUniverse();
      if (!isCompleteAStockUniverse(response.rows)) {
        throw new Error(
          `A 股目录不完整：仅返回 ${response.rows.length} 个标的`,
        );
      }
      this.database.replaceStockUniverseType(
        response.rows,
        "stock",
        response,
      );
      this.database.log(
        "info",
        `已刷新 A 股代码表：${response.rows.length} 个标的`,
      );
      return response.rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cachedIsComplete) {
        this.database.log(
          "warn",
          `刷新 A 股代码表失败，使用上次完整快照：${message}`,
        );
        return cached;
      }
      this.database.log(
        "error",
        `加载 A 股代码表失败，且没有可用的完整快照：${message}`,
      );
      throw new Error(`无法加载完整的 A 股代码表：${message}`);
    }
  }

  async listEtfs(): Promise<StockInfo[]> {
    const cachedEtfs = this.database
      .listStockUniverse()
      .filter((item) => item.securityType === "etf");
    const cachedIsComplete = isCompleteEtfUniverse(cachedEtfs);
    if (cachedIsComplete && isFreshUniverseSnapshot(cachedEtfs)) {
      return cachedEtfs;
    }
    try {
      const response = await fetchDomesticEtfUniverse();
      if (!isCompleteEtfUniverse(response.rows)) {
        throw new Error(
          `境内 ETF 目录不完整：仅返回 ${response.rows.length} 个标的`,
        );
      }
      this.database.replaceStockUniverseType(
        response.rows,
        "etf",
        response,
      );
      this.database.log(
        "info",
        `已刷新境内 ETF 代码表：${response.rows.length} 个标的；实际来源 ${response.source}${
          response.fallbackUsed
            ? `；东方财富失败：${response.fallbackReason ?? "未知原因"}`
            : ""
        }`,
      );
      return response.rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cachedIsComplete) {
        this.database.log(
          "warn",
          `刷新境内 ETF 代码表失败，使用上次完整快照：${message}`,
        );
        return cachedEtfs;
      }
      this.database.log(
        "error",
        `加载境内 ETF 代码表失败，且没有可用的完整快照：${message}`,
      );
      throw new Error(`无法加载完整的境内 ETF 代码表：${message}`);
    }
  }

  async runBacktest(request: BacktestRequest): Promise<BacktestExperiment> {
    const canonicalRequest = this.validateBacktestRequest(request);
    const marketData = await this.fetchBacktestMarketData(canonicalRequest);
    const experimentId = randomUUID();
    const createdAt = new Date().toISOString();
    const { results, dataCutoff } = await this.computeBacktestResults(
      canonicalRequest,
      marketData,
      experimentId,
      createdAt,
    );
    return this.persistBacktestExperiment(
      canonicalRequest,
      experimentId,
      createdAt,
      results,
      dataCutoff,
      marketData,
    );
  }

  /**
   * 校验回测请求的口径版本与领域规则，并确认所有标的都是 A 股股票。
   * 在任何外部请求或缓存写入之前完成，避免无效请求消耗数据源配额。
   */
  private validateBacktestRequest(request: BacktestRequest): BacktestRequest {
    const canonicalRequest: BacktestRequest = {
      ...request,
      caliberVersion: request.caliberVersion ?? BACKTEST_CALIBER_VERSION,
    };
    if (canonicalRequest.caliberVersion !== BACKTEST_CALIBER_VERSION) {
      throw new Error("回测请求的计算口径版本与当前应用不一致");
    }
    assertBacktestRequest(canonicalRequest);
    const cachedInstrumentMap = new Map(
      this.localStockUniverse().map((instrument) => [
        instrument.symbol,
        instrument,
      ]),
    );
    for (const symbol of canonicalRequest.symbols) {
      const cachedInstrument = cachedInstrumentMap.get(symbol);
      if (cachedInstrument && cachedInstrument.securityType !== "stock") {
        throw new Error("历史回测只支持A股股票");
      }
    }
    return canonicalRequest;
  }

  /**
   * 串行获取每个标的的不复权行情、前复权 K 线和分红事件，校验尾部完整性。
   * 标的之间留出节流窗口，避免数据源限流。
   *
   * P1-1：不复权价格用于严格回测证据，失败或不完整必须终止；
   * 前复权 K 线只用于图表浏览，失败或尾部不完整时降级为 error / unavailable
   * 并写入 warnings，不阻断回测。
   */
  private async fetchBacktestMarketData(
    canonicalRequest: BacktestRequest,
  ): Promise<BacktestMarketDataBundle[]> {
    const stocks = await this.listAStocks();
    const instrumentMap = new Map(
      stocks.map((instrument) => [instrument.symbol, instrument]),
    );
    for (const symbol of canonicalRequest.symbols) {
      const instrument = instrumentMap.get(symbol);
      if (!instrument || instrument.securityType !== "stock") {
        throw new Error("历史回测只支持A股股票");
      }
    }
    const marketData: BacktestMarketDataBundle[] = [];
    for (const [index, symbol] of canonicalRequest.symbols.entries()) {
      // P1-1：不复权价格与前复权 K 线使用不同失败策略。
      // - 不复权价格失败或不完整 → 阻断回测
      // - 前复权 K 线失败或不完整 → 回测继续，chartData 降级
      const [pricesSettled, adjustedBarsSettled] = await Promise.allSettled([
        fetchMarketPrices(
          symbol,
          canonicalRequest.startDate,
          canonicalRequest.endDate,
        ),
        fetchMarketAdjustedBars(
          symbol,
          canonicalRequest.startDate,
          canonicalRequest.endDate,
        ),
      ]);
      if (pricesSettled.status === "rejected") {
        throw pricesSettled.reason instanceof Error
          ? pricesSettled.reason
          : new Error(String(pricesSettled.reason));
      }
      const prices = pricesSettled.value;
      if (prices.tailStatus === "incomplete") {
        throw new Error(
          `${symbol} 严格回测行情尾部不完整：${formatMarketIssues(prices.issues).join("；") || `仅更新至 ${prices.dataCutoff ?? "未知日期"}`}`,
        );
      }
      // P1-1：不复权价格用于严格回测，请求范围内存在 error 级别问题必须停止。
      if (
        hasErrorInRequestRange(
          prices.issues,
          canonicalRequest.startDate,
          canonicalRequest.endDate,
        )
      ) {
        const errors = formatMarketIssues(
          prices.issues.filter(
            (issue) => issue.severity === "error",
          ),
        ).join("；");
        throw new Error(
          `${symbol} 严格回测行情存在数据质量问题，拒绝继续：${errors}`,
        );
      }
      // P1-1：前复权 K 线失败或尾部不完整时降级，不阻断回测。
      let chartData: BacktestResult["chartData"];
      let chartProvenance:
        | Awaited<ReturnType<typeof fetchMarketAdjustedBars>>["provenance"]
        | undefined;
      let chartIssues: MarketDataIssue[] = [];
      if (adjustedBarsSettled.status === "fulfilled") {
        const adjustedBars = adjustedBarsSettled.value;
        chartProvenance = adjustedBars.provenance;
        chartIssues = adjustedBars.issues;
        if (adjustedBars.tailStatus === "incomplete") {
          // P1-1：前复权 K 线尾部不完整属于图表降级，不阻断回测。
          chartIssues = [
            ...chartIssues,
            {
              type: "gap",
              severity: "warning",
              message: `${symbol} 前复权 K 线尾部不完整，仅更新至 ${adjustedBars.dataCutoff ?? "未知日期"}；图表降级展示`,
            },
          ];
          chartData = {
            status: "unavailable",
            reason: `前复权 K 线尾部不完整，仅更新至 ${adjustedBars.dataCutoff ?? "未知日期"}`,
          };
        } else {
          chartData = { status: "ready", data: adjustedBars.rows };
        }
      } else {
        const reason =
          adjustedBarsSettled.reason instanceof Error
            ? adjustedBarsSettled.reason.message
            : String(adjustedBarsSettled.reason);
        chartData = {
          status: "error",
          message: `前复权 K 线获取失败：${reason}`,
        };
        chartIssues = [
          {
            type: "gap",
            severity: "warning",
            message: `${symbol} 前复权 K 线获取失败：${reason}`,
          },
        ];
      }
      // 东财属于补充源，严格串行；多标的之间留出节流窗口。
      if (index > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, DATA_SOURCE_THROTTLE_MS),
        );
      }
      const dividends = await fetchCorporateActions(
        symbol,
        canonicalRequest.startDate,
        canonicalRequest.endDate,
      );
      marketData.push({
        symbol,
        name: instrumentMap.get(symbol)?.name ?? symbol,
        prices,
        dividends,
        chartData,
        chartProvenance,
        chartIssues,
      });
    }
    return marketData;
  }

  /**
   * 计算多标的的共同数据截止日，逐标的执行回测模拟，生成配股警告与
   * 多标的起始日不一致警告。每个标的计算前让出事件循环，避免阻塞 IPC。
   */
  private async computeBacktestResults(
    canonicalRequest: BacktestRequest,
    marketData: BacktestMarketDataBundle[],
    experimentId: string,
    createdAt: string,
  ): Promise<{ results: BacktestResult[]; dataCutoff: string }> {
    const names = new Map(marketData.map(({ symbol, name }) => [symbol, name]));
    const dataCutoff = marketData
      .map(({ prices }) => prices.provenance.dataCutoff)
      .filter((date): date is string => Boolean(date))
      .sort()[0];
    if (
      marketData.some(({ prices }) => prices.provenance.dataCutoff === null)
    ) {
      throw new Error("至少一个回测标的没有取得正式交易日行情");
    }
    if (!dataCutoff) throw new Error("回测试验没有共同的数据截止时间");
    const effectiveRequest: BacktestRequest = {
      ...canonicalRequest,
      endDate:
        dataCutoff < canonicalRequest.endDate
          ? dataCutoff
          : canonicalRequest.endDate,
    };
    const results: BacktestResult[] = [];
    for (const { symbol, prices, dividends, chartData, chartProvenance, chartIssues } of marketData) {
      // 在每个标的的同步回测计算之前让出事件循环，避免多标的串行计算
      // 长时间阻塞主进程 IPC 队列。
      await new Promise((resolve) => setImmediate(resolve));
      if (!prices.provenance.dataCutoff) {
        throw new Error(`${symbol} 没有可用于回测的正式行情截止日`);
      }
      const priceProvenance = {
        ...prices.provenance,
        dataCutoff: prices.provenance.dataCutoff,
      };
      const chartSource =
        chartProvenance?.dataCutoff
          ? [
              {
                ...chartProvenance,
                dataCutoff: chartProvenance.dataCutoff,
              },
            ]
          : [];
      const result = simulateBacktest(
        effectiveRequest,
        symbol,
        names.get(symbol) ?? symbol,
        prices.rows,
        dividends.rows,
        [
          priceProvenance,
          dividends.provenance,
          ...chartSource,
        ],
        { id: experimentId, createdAt },
      );
      // 实验保留用户原始请求；共同截止时间单独由 experiment 记录。
      result.requestedStartDate = canonicalRequest.startDate;
      result.requestedEndDate = canonicalRequest.endDate;
      result.rangeYears = canonicalRequest.rangeYears;
      result.strategyKey = buildBacktestStrategyKey(
        canonicalRequest,
        symbol,
      );
      for (const action of dividends.reportedActions) {
        if (
          action.exDate < result.actualStartDate ||
          action.exDate > dataCutoff
        ) {
          continue;
        }
        result.warnings.push(
          `配股事件（除权日 ${action.exDate}，每 10 股可配 ${action.ratioPer10} 股，认购价 ${action.subscriptionPrice.toFixed(2)} 元）：R1 假设不参与且不追加资金；不复权行情中的除权后市场价格变化仍计入收益与回撤。`,
        );
      }
      result.chartData =
        chartData.status === "ready"
          ? {
              status: "ready",
              data: chartData.data.filter(
                (bar) => bar.date <= dataCutoff,
              ),
            }
          : chartData;
      // P1-1：前复权 K 线问题不阻断回测，但必须写入 warnings 以便审计。
      for (const issue of chartIssues) {
        result.warnings.push(
          `前复权 K 线${issue.severity === "error" ? "数据质量" : "完整性"}问题：${issue.message}`,
        );
      }
      // P1-2：不复权行情的 warning 级别问题（如正式日历年度中缺失交易日）
      // 不阻断回测，但必须写入 result.warnings，避免实验结果和备份中没有任何提示。
      for (const issue of warningsInRequestRange(
        prices.issues,
        effectiveRequest.startDate,
        effectiveRequest.endDate,
      )) {
        result.warnings.push(`回测行情完整性问题：${issue.message}`);
      }
      results.push(result);
    }
    const actualStartDates = new Set(
      results.map((result) => result.actualStartDate),
    );
    if (results.length > 1 && actualStartDates.size > 1) {
      const starts = results
        .map((result) => `${result.symbol} ${result.actualStartDate}`)
        .join("、");
      const warning = `多标的实际起始日期不一致（${starts}），本次结果属于非严格同区间比较。`;
      for (const result of results) result.warnings.push(warning);
    }
    return { results, dataCutoff };
  }

  /**
   * 将实验与本次获取的回测证据缓存一次性提交。任一标的数据、计算或
   * 实验写入失败时全部回滚，不留下无对应成功实验的证据快照。
   */
  private persistBacktestExperiment(
    canonicalRequest: BacktestRequest,
    experimentId: string,
    createdAt: string,
    results: BacktestResult[],
    dataCutoff: string,
    marketData: BacktestMarketDataBundle[],
  ): BacktestExperiment {
    const experiment: BacktestExperiment = {
      experimentId,
      createdAt,
      request: canonicalRequest,
      results,
      dataCutoff,
      caliberVersion: BACKTEST_CALIBER_VERSION,
      status: "completed",
    };
    this.database.saveBacktestExperimentWithMarketData(
      experiment,
      marketData.map(({ symbol, prices, dividends }) => ({
        symbol,
        prices: prices.rows,
        dividends: dividends.rows,
        provenance: prices.provenance,
      })),
    );
    this.database.log(
      "info",
      `完成回测试验 ${experimentId}：${canonicalRequest.symbols.join(",")} ${canonicalRequest.startDate}..${canonicalRequest.endDate}`,
    );
    return experiment;
  }

  listBacktestExperiments(): BacktestExperimentSummary[] {
    return this.database.listBacktestExperiments();
  }

  getBacktestExperiment(experimentId: string): BacktestExperiment {
    const experiment = this.database.getBacktestExperiment(experimentId);
    if (!experiment) throw new Error("找不到回测试验");
    return experiment;
  }

  deleteBacktestExperiment(experimentId: string): void {
    if (!this.database.getBacktestExperiment(experimentId)) {
      throw new Error("找不到需要删除的回测试验");
    }
    this.database.deleteBacktestExperiment(experimentId);
    this.database.log("info", `已删除回测试验 ${experimentId}`);
  }

  getBacktestDetail(backtestId: string): SimpleBacktestResult {
    const result = this.database.getBacktest(backtestId);
    if (!result) throw new Error("找不到回测结果");
    return backtestResultToSimpleResult(result);
  }

  getBacktestWorkspace(): BacktestWorkspaceState | null {
    return this.database.getBacktestWorkspace();
  }

  saveBacktestWorkspace(state: BacktestWorkspaceState): void {
    this.database.saveBacktestWorkspace(state);
  }

  private localStockUniverse(): StockInfo[] {
    return this.database.listStockUniverse();
  }

  private liveDataSnapshot(entries?: LedgerEntry[]): {
    entries: LedgerEntry[];
    prices: ReturnType<LocalDatabase["listLiveMarketPrices"]>;
    coverage: ReturnType<LocalDatabase["listLiveMarketCoverage"]>;
  } {
    const loaded = entries ?? this.database.listLedger();
    const { effective } = activeLedgerEntries(loaded, currentMarketDate());
    const symbols = [
      ...new Set(effective.flatMap((entry) => entry.symbol ?? [])),
    ];
    return {
      entries: loaded,
      prices: this.database.listLiveMarketPrices(symbols),
      // P1-1：读取覆盖记录，使 buildPositionsOverview 能感知 partial 状态。
      coverage: this.database.listLiveMarketCoverage(symbols),
    };
  }

  private missingLivePriceRanges(
    requested: readonly LivePriceRange[],
  ): LivePriceRange[] {
    return requested.flatMap((range) => {
      const coverage = this.database
        .listLiveMarketCoverage([range.symbol])
        .filter((item) => item.adjustment === "none")
        .sort((left, right) =>
          left.requestedFrom.localeCompare(right.requestedFrom),
        );
      const missing: LivePriceRange[] = [];
      let cursor = range.startDate;
      for (const item of coverage) {
        const coveredThrough = confirmedCoverageThrough(item);
        if (!coveredThrough || coveredThrough < cursor) continue;
        if (item.requestedFrom > range.endDate) break;
        if (item.requestedFrom > cursor) {
          missing.push({
            ...range,
            startDate: cursor,
            endDate: addDays(item.requestedFrom, -1),
          });
        }
        if (coveredThrough >= cursor) {
          cursor = addDays(coveredThrough, 1);
        }
        if (cursor > range.endDate) break;
      }
      if (cursor <= range.endDate) {
        missing.push({ ...range, startDate: cursor });
      }
      return missing.filter(
        (candidate) => candidate.startDate <= candidate.endDate,
      );
    });
  }

  private tradeDateContext(symbol?: string): TradeDateContext | undefined {
    if (!symbol) return undefined;
    return {
      knownTradingDates: this.database
        .listLiveMarketPrices([symbol])
        .map((row) => row.date),
    };
  }

  private completedMarketDate(now = new Date()): string {
    const knownTradingDate = latestCompletedTradingDate(
      now,
      this.database.listLiveMarketDates(),
    );
    const requestCandidate = latestWeekdayCandidate(now);
    // 本地日历可能尚未包含刚收盘的交易日；候选日只决定请求上界，
    // 最终截止仍以供应商返回并通过校验的正式日线为准。
    return knownTradingDate && knownTradingDate > requestCandidate
      ? knownTradingDate
      : requestCandidate;
  }

  private async fetchLivePriceRanges(
    ranges: readonly LivePriceRange[],
  ): Promise<{ issues: string[] }> {
    // P1-3：按证券合并重叠或相邻区间，避免同日清仓再买入产生价格行冲突。
    const normalized = normalizeRanges(ranges);
    const snapshots: MarketDataCacheEntry[] = [];
    const issues: string[] = [];
    for (const range of this.missingLivePriceRanges(normalized)) {
      try {
        const response = await fetchMarketPrices(
          range.symbol,
          range.startDate,
          range.endDate,
        );
        // P1-3：检测请求区间内的 error 级别行情问题。
        // 即使尾部完整，只要请求范围内存在 error（如被丢弃的非法 OHLCV 行），
        // 覆盖标记为 partial，confirmedCoverageThrough 返回首个错误日期前的截止日，
        // missingLivePriceRanges 后续会重新请求错误日期之后的区间。
        const errorIssuesInRange = response.issues.filter(
          (issue) =>
            issue.severity === "error" &&
            (!issue.date ||
              (issue.date >= range.startDate && issue.date <= range.endDate)),
        );
        const hasError = errorIssuesInRange.length > 0;
        snapshots.push({
          symbol: range.symbol,
          prices: response.rows,
          dividends: [],
          provenance: response.provenance,
          requestedFrom: range.startDate,
          requestedThrough: range.endDate,
          ...(hasError
            ? {
                resultStatus: "partial" as const,
                // P2-1：持久化 error 级别问题列表，用于审计和读模型。
                issues: errorIssuesInRange,
              }
            : {}),
        });
        if (response.tailStatus === "incomplete") {
          issues.push(
            `${range.symbol} ${range.startDate}..${range.endDate} 行情尾部不完整：${
              formatMarketIssues(response.issues).join("；") ||
              `仅更新至 ${response.dataCutoff ?? "暂无可用日期"}`
            }`,
          );
        }
        if (hasError) {
          const errorIssues = response.issues.filter(
            (issue) => issue.severity === "error",
          );
          issues.push(
            `${range.symbol} ${range.startDate}..${range.endDate} 行情存在 error 级别问题，覆盖标记为 partial：${formatMarketIssues(errorIssues).join("；")}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(
          `${range.symbol} ${range.startDate}..${range.endDate} 行情补齐失败：${message}`,
        );
      }
    }
    if (snapshots.length) {
      this.database.saveLiveMarketPriceSnapshots(snapshots);
    }
    for (const issue of issues) this.database.log("warn", issue);
    return { issues };
  }

  getPositionsOverview(): PositionsOverview {
    const snapshot = this.liveDataSnapshot();
    const factAsOfDate = currentMarketDate();
    const valuationCutoff = this.completedMarketDate();
    return buildPositionsOverview(
      snapshot.entries,
      snapshot.prices,
      this.localStockUniverse(),
      { factAsOfDate, valuationCutoff },
      // P1-1：传入覆盖记录，使读模型能感知 partial 状态。
      snapshot.coverage,
    );
  }

  async refreshPositionsMarket(): Promise<MarketRefreshResult> {
    const symbols = this.getPositionsOverview().positions.map(
      (position) => position.symbol,
    );
    if (!symbols.length) {
      return {
        overview: this.getPositionsOverview(),
        requestedCutoff: null,
        actualCutoff: null,
        tailStatus: "complete",
        issues: [],
      };
    }
    const endDate = this.completedMarketDate();
    const startDate = addMonths(
      endDate,
      -LIVE_PRICE_REFRESH_LOOKBACK_MONTHS,
    );
    const requested = symbols.map((symbol) => ({
      symbol,
      startDate,
      endDate,
    }));
    const missing = this.missingLivePriceRanges(requested);
    const snapshots: MarketDataCacheEntry[] = [];
    const fetchIssues: string[] = [];
    let hasDataQualityError = false;
    for (const range of missing) {
      const response = await fetchMarketPrices(
        range.symbol,
        range.startDate,
        range.endDate,
      );
      // P1-3：检测请求区间内的 error 级别行情问题，标记覆盖为 partial。
      const errorIssuesInRange = response.issues.filter(
        (issue) =>
          issue.severity === "error" &&
          (!issue.date ||
            (issue.date >= range.startDate && issue.date <= range.endDate)),
      );
      const hasError = errorIssuesInRange.length > 0;
      snapshots.push({
        symbol: range.symbol,
        prices: response.rows,
        dividends: [],
        provenance: response.provenance,
        requestedFrom: range.startDate,
        requestedThrough: range.endDate,
        ...(hasError
          ? {
              resultStatus: "partial" as const,
              // P2-1：持久化 error 级别问题列表，用于审计和读模型。
              issues: errorIssuesInRange,
            }
          : {}),
      });
      if (response.tailStatus === "incomplete") {
        fetchIssues.push(
          `${range.symbol} 行情尾部不完整：${
            formatMarketIssues(response.issues).join("；") ||
            `仅更新至 ${response.dataCutoff ?? "暂无可用日期"}`
          }`,
        );
      }
      // P1-1：error 级别问题即使尾部完整也标记数据质量降级。
      if (hasError) {
        hasDataQualityError = true;
        fetchIssues.push(
          `${range.symbol} 行情数据质量问题：${formatMarketIssues(errorIssuesInRange).join("；")}`,
        );
      }
    }
    // 持仓刷新仍保持全成功后统一写入，避免半成功估值。
    this.database.saveLiveMarketPriceSnapshots(snapshots);
    const latestBySymbol = new Map<string, string>();
    for (const row of this.database.listLiveMarketPrices(symbols)) {
      if (row.date > endDate) continue;
      const current = latestBySymbol.get(row.symbol);
      if (!current || row.date > current) {
        latestBySymbol.set(row.symbol, row.date);
      }
    }
    const actualCutoff =
      latestBySymbol.size === symbols.length
        ? [...latestBySymbol.values()].sort()[0]
        : null;
    // P1-2：tailStatus 只取决于最新正式交易日是否有价格，不因内部坏行降级。
    // missingLivePriceRanges 对 partial 覆盖会返回首个错误日期之后的缺失区间，
    // 但只要 endDate 本身有价格（所有标的），tail 就是 complete。
    // 内部数据质量问题通过 qualityStatus = partial 表达，与 tailStatus 独立。
    const tailMissingDueToClosure = this.missingLivePriceRanges(
      symbols.map((symbol) => ({
        symbol,
        startDate: endDate,
        endDate,
      })),
    );
    const hasEndPriceForAll = symbols.every(
      (symbol) => latestBySymbol.get(symbol) === endDate,
    );
    const tailComplete = tailMissingDueToClosure.length === 0 || hasEndPriceForAll;
    const overview = this.getPositionsOverview();
    const refreshIssue = tailComplete
      ? null
      : `行情仅更新至 ${actualCutoff ?? "暂无可用日期"}，请求截止 ${endDate} 的尾部尚未确认完整`;
    const issues = [
      ...fetchIssues,
      ...(refreshIssue ? [refreshIssue] : []),
    ];
    // P1-1：尾部完整但存在 error 级别数据质量问题时，仍需标记 partial。
    const needsPartial = Boolean(refreshIssue) || hasDataQualityError;
    const resultOverview = needsPartial
      ? {
          ...overview,
          quality: {
            ...overview.quality,
            status: "partial" as const,
            issues: [...new Set([...overview.quality.issues, ...issues])],
          },
        }
      : overview;
    this.database.log(
      tailComplete && !hasDataQualityError ? "info" : "warn",
      tailComplete && !hasDataQualityError
        ? `已刷新实盘行情：${symbols.length} 个标的，${startDate}..${endDate}`
        : refreshIssue ?? "实盘行情存在数据质量问题",
    );
    return {
      overview: resultOverview,
      requestedCutoff: endDate,
      actualCutoff,
      tailStatus: tailComplete ? "complete" : "incomplete",
      issues,
    };
  }

  queryLedger(query: LedgerQuery): LedgerQueryResult {
    const entries = this.database.listLedger();
    let integrityError: string | null = null;
    try {
      reduceLedger(entries, currentMarketDate());
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
    }
    return queryLedgerRecords(
      entries,
      this.localStockUniverse(),
      query,
      integrityError,
    );
  }

  /**
   * 导出场景下一次性返回全量匹配流水，避免 `ledger:export` 在 IPC 层
   * 逐页调用 `queryLedger` 导致 `listLedger` 与完整性校验被重复执行。
   */
  exportLedger(query: LedgerQuery): LedgerQueryResult {
    const entries = this.database.listLedger();
    let integrityError: string | null = null;
    try {
      reduceLedger(entries, currentMarketDate());
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
    }
    return exportLedgerRecords(
      entries,
      this.localStockUniverse(),
      query,
      integrityError,
    );
  }

  getLedgerRecord(entryId: string): LedgerRecordView {
    const row = getLedgerRecordById(
      this.database.listLedger(),
      this.localStockUniverse(),
      entryId,
    );
    if (!row) throw new Error("关联流水不存在或已无法读取");
    return row;
  }

  async getIncomeCalendar(
    query: IncomeCalendarQuery,
  ): Promise<IncomeCalendarView> {
    const requestedMonthEnd =
      query.month === currentMarketDate().slice(0, 7)
        ? this.completedMarketDate()
        : monthEnd(query.month);
    const entries = this.database.listLedger();
    const coverage = incomePriceRanges(
      entries,
      query,
      requestedMonthEnd,
    );
    const { issues } = await this.fetchLivePriceRanges(coverage);
    const snapshot = this.liveDataSnapshot(entries);
    const actualMonthCutoff =
      latestTradingDateInMonth(
        query.month,
        this.database.listLiveMarketDates(),
      ) ??
      (query.month === currentMarketDate().slice(0, 7)
        ? latestCompletedTradingDate(
            new Date(),
            this.database.listLiveMarketDates(),
          )
        : null);
    const factAsOfDate = [
      monthEnd(query.month),
      currentMarketDate(),
    ].sort()[0];
    return buildIncomeCalendar(
      snapshot.entries,
      snapshot.prices,
      this.localStockUniverse(),
      query,
      issues,
      { factAsOfDate, valuationCutoff: actualMonthCutoff },
    );
  }

  addLedger(input: LedgerEntryInput): LedgerEntry {
    if (input.linkedGroupId) {
      throw new Error("普通单条录入不能加入分红再投入关联组");
    }
    const preview = this.previewLedger(input);
    const entry: LedgerEntry = {
      ...preview.normalizedInput,
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      currency: "CNY",
      source: "user",
    };
    this.database.addLedger(entry);
    this.database.log("info", `新增流水：${entry.type} ${entry.businessDate}`);
    return entry;
  }

  addDividendReinvestment(
    input: DividendReinvestmentInput,
  ): DividendReinvestmentResult {
    const preview = this.previewDividendReinvestment(input);
    const linkedGroupId = randomUUID();
    const recordedAt = new Date().toISOString();
    const dividend: LedgerEntry = {
      ...preview.dividend.normalizedInput,
      linkedGroupId,
      id: randomUUID(),
      recordedAt,
      currency: "CNY",
      source: "user",
    };
    const buy: LedgerEntry = {
      ...preview.buy.normalizedInput,
      linkedGroupId,
      id: randomUUID(),
      recordedAt: new Date(Date.parse(recordedAt) + 1).toISOString(),
      currency: "CNY",
      source: "user",
    };
    // 同一 SQLite 事务提交；任一事实写入失败时整体回滚。
    this.database.addLedgerEntries([dividend, buy]);
    this.database.log(
      "info",
      `新增分红并再投入：${input.symbol}`,
    );
    return { linkedGroupId, dividend, buy };
  }

  previewDividendReinvestment(
    input: DividendReinvestmentInput,
  ): DividendReinvestmentPreview {
    if (input.reinvestmentDate < input.dividendDate) {
      throw new Error("再投入日期不得早于分红到账日期");
    }
    const entries = this.database.listLedger();
    const marketDate = currentMarketDate();
    const common = {
      symbol: input.symbol,
      instrumentName: input.instrumentName,
      securityType: input.securityType,
      note: input.note,
      linkedGroupId: "__preview_reinvestment__",
    };
    const dividend = previewLedgerMutation(
      entries,
      normalizeLedgerInput(
        {
          ...common,
          type: "dividend",
          businessDate: input.dividendDate,
          amount: input.dividendAmount,
          perShare: input.perShare,
          recordDate: input.recordDate,
        },
        marketDate,
      ),
      undefined,
      marketDate,
    );
    const previewDividendEntry: LedgerEntry = {
      ...dividend.normalizedInput,
      id: "__preview_dividend__",
      recordedAt: "9999-12-31T23:59:59.998Z",
      currency: "CNY",
      source: "system",
    };
    const buy = previewLedgerMutation(
      [...entries, previewDividendEntry],
      {
        ...common,
        type: "buy",
        businessDate: input.reinvestmentDate,
        price: input.buyPrice,
        quantity: input.buyQuantity,
        fee: input.fee,
      },
      undefined,
      marketDate,
      this.tradeDateContext(input.symbol),
    );
    return {
      dividend,
      buy,
      before: dividend.before,
      after: buy.after,
      warnings: [...dividend.warnings, ...buy.warnings],
    };
  }

  previewLedger(
    input: LedgerEntryInput,
    replacingEntryId?: string,
  ): LedgerImpactPreview {
    return previewLedgerMutation(
      this.database.listLedger(),
      input,
      replacingEntryId,
      currentMarketDate(),
      this.tradeDateContext(input.symbol),
    );
  }

  correctLedger(entryId: string, input: LedgerEntryInput): LedgerEntry {
    const entries = this.database.listLedger();
    const target = entries.find((entry) => entry.id === entryId);
    if (!target) throw new Error("找不到需要修正的原流水");
    const preview = previewLedgerMutation(
      entries,
      input,
      entryId,
      currentMarketDate(),
      this.tradeDateContext(input.symbol),
    );
    const recordedAt = new Date().toISOString();
    const reversal: LedgerEntry = {
      id: randomUUID(),
      type: "adjustment",
      businessDate: target.businessDate,
      recordedAt,
      correctedAt: recordedAt,
      currency: "CNY",
      source: "system",
      reversesEntryId: entryId,
      note: "追加修正：撤销原记录影响",
    };
    const replacement: LedgerEntry = {
      ...preview.normalizedInput,
      id: randomUUID(),
      recordedAt: new Date(Date.parse(recordedAt) + 1).toISOString(),
      correctedAt: recordedAt,
      currency: "CNY",
      source: "user",
      correctsEntryId: entryId,
      linkedGroupId: preview.normalizedInput.linkedGroupId,
    };
    // 最终随机 ID 与时间戳写入前再次验证完整审计图和关联组，
    // 避免预览对象与实际持久化对象之间出现口径漂移。
    reduceLedger([...entries, reversal, replacement], currentMarketDate());
    this.database.addLedgerEntries([reversal, replacement]);
    this.database.log(
      "info",
      `追加修正流水：${replacement.type} ${replacement.businessDate}`,
    );
    return replacement;
  }

  reverseLedger(entryId: string, reason: string): LedgerEntry {
    const entries = this.database.listLedger();
    assertLedgerReversal(entries, entryId);
    const target = entries.find((item) => item.id === entryId)!;
    const correctedAt = new Date().toISOString();
    const entry: LedgerEntry = {
      id: randomUUID(),
      type: "adjustment",
      businessDate: target.businessDate,
      recordedAt: correctedAt,
      correctedAt,
      currency: "CNY",
      source: "system",
      note: (reason ?? "").trim() || "用户发起冲正",
      reversesEntryId: entryId,
    };
    this.database.addLedger(entry);
    this.database.log("info", `已冲正流水：${entryId}`);
    return entry;
  }
}
