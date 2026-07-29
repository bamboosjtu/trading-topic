import { randomUUID } from "node:crypto";
import type {
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestRequest,
  BacktestResult,
  LedgerEntry,
  LedgerEntryInput,
  LedgerImpactPreview,
  SimpleBacktestResult,
  BacktestWorkspaceState,
  IncomeCalendarQuery,
  IncomeCalendarView,
  LedgerQuery,
  LedgerQueryResult,
  MarketRefreshResult,
  PositionsOverview,
  StockInfo,
  DividendReinvestmentInput,
  DividendReinvestmentPreview,
  DividendReinvestmentResult,
  LedgerRecordView,
} from "../../shared/contracts";
import { buildBacktestStrategyKey } from "../../shared/backtestIdentity";
import { securityTypeForInstrument } from "../../shared/instruments";
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
  getLedgerRecordById,
  queryLedgerRecords,
} from "../domain/ledgerQuery";
import {
  LocalDatabase,
  type MarketDataCacheEntry,
  type StoredMarketCoverage,
} from "../storage/database";
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
  type TradeDateContext,
} from "../domain/marketCalendar";

function isCompleteAStockUniverse(stocks: readonly StockInfo[]): boolean {
  return (
    stocks.length >= STOCK_UNIVERSE_MIN_SIZE &&
    stocks.every((item) => item.securityType !== "etf")
  );
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

function mergeInstrumentUniverse(
  stocks: readonly StockInfo[],
  etfs: readonly StockInfo[],
): StockInfo[] {
  return [...stocks, ...etfs].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

function confirmedCoverageThrough(
  coverage: StoredMarketCoverage,
): string | null {
  if (coverage.resultStatus === "empty") {
    return coverage.emptyEvidence ? coverage.requestedThrough : null;
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
        response.source,
        response.fetchedAt,
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
      const rows = await fetchDomesticEtfUniverse();
      if (!isCompleteEtfUniverse(rows)) {
        throw new Error(`境内 ETF 目录不完整：仅返回 ${rows.length} 个标的`);
      }
      const fetchedAt = new Date().toISOString();
      this.database.replaceStockUniverseType(
        rows,
        "etf",
        "东方财富 / 新浪财经境内交易所 ETF 代码表（产品域独立适配）",
        fetchedAt,
      );
      this.database.log("info", `已刷新境内 ETF 代码表：${rows.length} 个标的`);
      return rows;
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

  async listInstruments(): Promise<StockInfo[]> {
    const [stocks, etfs] = await Promise.all([
      this.listAStocks(),
      this.listEtfs(),
    ]);
    return mergeInstrumentUniverse(stocks, etfs);
  }

  async runBacktest(request: BacktestRequest): Promise<BacktestExperiment> {
    const canonicalRequest: BacktestRequest = {
      ...request,
      caliberVersion: request.caliberVersion ?? BACKTEST_CALIBER_VERSION,
    };
    if (canonicalRequest.caliberVersion !== BACKTEST_CALIBER_VERSION) {
      throw new Error("回测请求的计算口径版本与当前应用不一致");
    }
    // 在任何外部请求或缓存写入之前完成领域校验，避免重复标的等无效请求
    // 消耗数据源配额，或最终才由数据库唯一约束报错。
    assertBacktestRequest(canonicalRequest);
    const cachedInstrumentMap = new Map(
      this.localStockUniverse().map((instrument) => [
        instrument.symbol,
        instrument,
      ]),
    );
    for (const symbol of canonicalRequest.symbols) {
      const cachedInstrument = cachedInstrumentMap.get(symbol);
      if (
        securityTypeForInstrument(
          cachedInstrument ?? { symbol, name: "" },
        ) !== "stock"
      ) {
        throw new Error("历史回测只支持A股股票");
      }
    }
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
    const names = new Map(stocks.map((stock) => [stock.symbol, stock.name]));
    const marketData: Array<{
      symbol: string;
      prices: Awaited<ReturnType<typeof fetchMarketPrices>>;
      dividends: Awaited<ReturnType<typeof fetchCorporateActions>>;
      chartData: BacktestResult["chartData"];
      chartProvenance: Awaited<
        ReturnType<typeof fetchMarketAdjustedBars>
      >["provenance"];
    }> = [];
    for (const [index, symbol] of canonicalRequest.symbols.entries()) {
      const [prices, adjustedBars] = await Promise.all([
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
        prices,
        dividends,
        chartData: { status: "ready", data: adjustedBars.rows },
        chartProvenance: adjustedBars.provenance,
      });
    }

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
    const experimentId = randomUUID();
    const createdAt = new Date().toISOString();
    const effectiveRequest: BacktestRequest = {
      ...canonicalRequest,
      endDate:
        dataCutoff < canonicalRequest.endDate
          ? dataCutoff
          : canonicalRequest.endDate,
    };
    const results = marketData.map(
      ({ symbol, prices, dividends, chartData, chartProvenance }) => {
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
        return result;
      },
    );
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
    const experiment: BacktestExperiment = {
      experimentId,
      createdAt,
      request: canonicalRequest,
      results,
      dataCutoff,
      caliberVersion: BACKTEST_CALIBER_VERSION,
      status: "completed",
    };
    // 回测试验与本次获取的回测证据缓存一次性提交。任一标的数据、计算或
    // 实验写入失败时全部回滚，不留下无对应成功实验的证据快照。
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

  private liveDataSnapshot(): {
    entries: LedgerEntry[];
    prices: ReturnType<LocalDatabase["listLiveMarketPrices"]>;
  } {
    const entries = this.database.listLedger();
    const { effective } = activeLedgerEntries(entries, currentMarketDate());
    const symbols = [
      ...new Set(effective.flatMap((entry) => entry.symbol ?? [])),
    ];
    return {
      entries,
      prices: this.database.listLiveMarketPrices(symbols),
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
    const snapshots: MarketDataCacheEntry[] = [];
    const issues: string[] = [];
    for (const range of this.missingLivePriceRanges(ranges)) {
      try {
        const response = await fetchMarketPrices(
          range.symbol,
          range.startDate,
          range.endDate,
        );
        snapshots.push({
          symbol: range.symbol,
          prices: response.rows,
          dividends: [],
          provenance: response.provenance,
          requestedFrom: range.startDate,
          requestedThrough: range.endDate,
        });
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
        tailComplete: true,
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
    for (const range of missing) {
      const response = await fetchMarketPrices(
        range.symbol,
        range.startDate,
        range.endDate,
      );
      snapshots.push({
        symbol: range.symbol,
        prices: response.rows,
        dividends: [],
        provenance: response.provenance,
        requestedFrom: range.startDate,
        requestedThrough: range.endDate,
      });
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
    const tailComplete =
      this.missingLivePriceRanges(
        symbols.map((symbol) => ({
          symbol,
          startDate: endDate,
          endDate,
        })),
      ).length === 0;
    const overview = this.getPositionsOverview();
    const refreshIssue = tailComplete
      ? null
      : `行情仅更新至 ${actualCutoff ?? "暂无可用日期"}，请求截止 ${endDate} 的尾部尚未确认完整`;
    const resultOverview = refreshIssue
      ? {
          ...overview,
          quality: {
            ...overview.quality,
            status: "partial" as const,
            issues: [...new Set([...overview.quality.issues, refreshIssue])],
          },
        }
      : overview;
    this.database.log(
      tailComplete ? "info" : "warn",
      tailComplete
        ? `已刷新实盘行情：${symbols.length} 个标的，${startDate}..${endDate}`
        : refreshIssue!,
    );
    return {
      overview: resultOverview,
      requestedCutoff: endDate,
      actualCutoff,
      tailComplete,
    };
  }

  queryLedger(query: LedgerQuery): LedgerQueryResult {
    let integrityError: string | null = null;
    try {
      reduceLedger(this.database.listLedger(), currentMarketDate());
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
    }
    return queryLedgerRecords(
      this.database.listLedger(),
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
    const coverage = incomePriceRanges(
      this.database.listLedger(),
      query,
      requestedMonthEnd,
    );
    const { issues } = await this.fetchLivePriceRanges(coverage);
    const snapshot = this.liveDataSnapshot();
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
    const preview = this.previewLedger(input, entryId);
    const target = this.database
      .listLedger()
      .find((entry) => entry.id === entryId)!;
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
      linkedGroupId:
        preview.normalizedInput.linkedGroupId ?? target.linkedGroupId,
    };
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
