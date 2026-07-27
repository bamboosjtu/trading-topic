import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
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
  PositionsOverview,
  StockInfo,
} from "../../shared/contracts";
import { buildBacktestStrategyKey } from "../../shared/backtestIdentity";
import {
  BACKTEST_CALIBER_VERSION,
  DATA_SOURCE_THROTTLE_MS,
  LIVE_PRICE_REFRESH_LOOKBACK_MONTHS,
  STOCK_UNIVERSE_CACHE_MAX_AGE_MS,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import { fetchAStockUniverse } from "../data/stockUniverse";
import {
  fetchAdjustedBars,
  fetchCorporateActions,
  fetchUnadjustedPrices,
} from "../data/tencent";
import {
  assertBacktestRequest,
  backtestResultToSimpleResult,
  simulateBacktest,
} from "../domain/analysis";
import { rebuildAccount } from "../domain/ledger";
import {
  assertLedgerReversal,
  previewLedgerMutation,
} from "../domain/ledgerCommands";
import {
  activeLedgerEntries,
  buildIncomeCalendar,
  buildPositionsOverview,
  queryLedgerRecords,
} from "../domain/livePortfolio";
import { LocalDatabase } from "../storage/database";

function isCompleteStockUniverse(stocks: readonly StockInfo[]): boolean {
  return stocks.length >= STOCK_UNIVERSE_MIN_SIZE;
}

export class AppService {
  constructor(private readonly database: LocalDatabase) {}

  async listStocks(): Promise<StockInfo[]> {
    const cached = this.database.listStockUniverse();
    const fetchedAt = cached[0]?.fetchedAt;
    const cachedIsComplete = isCompleteStockUniverse(cached);
    const cacheIsFresh =
      cachedIsComplete &&
      fetchedAt !== undefined &&
      Number.isFinite(Date.parse(fetchedAt)) &&
      Date.now() - Date.parse(fetchedAt) < STOCK_UNIVERSE_CACHE_MAX_AGE_MS;
    if (cacheIsFresh) return cached;

    try {
      const response = await fetchAStockUniverse();
      if (!isCompleteStockUniverse(response.rows)) {
        throw new Error(
          `A 股代码表不完整：仅返回 ${response.rows.length} 个标的`,
        );
      }
      this.database.replaceStockUniverse(
        response.rows,
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
        `加载全 A 股代码表失败，且没有可用的完整快照：${message}`,
      );
      throw new Error(`无法加载完整的全 A 股代码表：${message}`);
    }
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
    const stocks = await this.listStocks();
    const names = new Map(stocks.map((stock) => [stock.symbol, stock.name]));
    const marketData: Array<{
      symbol: string;
      prices: Awaited<ReturnType<typeof fetchUnadjustedPrices>>;
      dividends: Awaited<ReturnType<typeof fetchCorporateActions>>;
      chartData: BacktestResult["chartData"];
      chartProvenance: Awaited<
        ReturnType<typeof fetchAdjustedBars>
      >["provenance"];
    }> = [];
    for (const [index, symbol] of canonicalRequest.symbols.entries()) {
      const [prices, adjustedBars] = await Promise.all([
        fetchUnadjustedPrices(
          symbol,
          canonicalRequest.startDate,
          canonicalRequest.endDate,
        ),
        fetchAdjustedBars(
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
      .sort()[0];
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
        const result = simulateBacktest(
          effectiveRequest,
          symbol,
          names.get(symbol) ?? symbol,
          prices.rows,
          dividends.rows,
          [
            prices.provenance,
            dividends.provenance,
            ...(chartProvenance ? [chartProvenance] : []),
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
    // 回测试验与本次获取的共享行情缓存一次性提交。任一标的数据、计算或
    // 实验写入失败时，事务回滚，避免失败实验污染账户估值所使用的缓存。
    this.database.saveBacktestExperimentWithMarketData(
      experiment,
      marketData.map(({ symbol, prices, dividends }) => ({
        symbol,
        prices: prices.rows,
        dividends: dividends.rows,
        source: prices.provenance.source,
        fetchedAt: prices.provenance.fetchedAt,
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
    prices: ReturnType<LocalDatabase["listMarketPrices"]>;
  } {
    const entries = this.database.listLedger();
    const { effective } = activeLedgerEntries(entries);
    const symbols = [
      ...new Set(effective.flatMap((entry) => entry.symbol ?? [])),
    ];
    return {
      entries,
      prices: this.database.listMarketPrices(symbols),
    };
  }

  getPositionsOverview(): PositionsOverview {
    const snapshot = this.liveDataSnapshot();
    return buildPositionsOverview(
      snapshot.entries,
      snapshot.prices,
      this.localStockUniverse(),
    );
  }

  async refreshPositionsMarket(): Promise<PositionsOverview> {
    const symbols = this.getPositionsOverview().positions.map(
      (position) => position.symbol,
    );
    if (!symbols.length) return this.getPositionsOverview();
    const endDate = new Date().toISOString().slice(0, 10);
    const start = new Date(`${endDate}T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - LIVE_PRICE_REFRESH_LOOKBACK_MONTHS);
    const startDate = start.toISOString().slice(0, 10);
    const snapshots = [];
    for (const symbol of symbols) {
      const response = await fetchUnadjustedPrices(symbol, startDate, endDate);
      snapshots.push({
        symbol,
        prices: response.rows,
        dividends: [],
        source: response.provenance.source,
        fetchedAt: response.provenance.fetchedAt,
      });
    }
    // 所有标的数据成功后才一次性写入，避免半成功刷新污染账户估值。
    this.database.saveMarketPriceSnapshots(snapshots);
    this.database.log(
      "info",
      `已刷新实盘行情：${symbols.length} 个标的，${startDate}..${endDate}`,
    );
    return this.getPositionsOverview();
  }

  queryLedger(query: LedgerQuery): LedgerQueryResult {
    let integrityError: string | null = null;
    try {
      const latest = this.database.latestPrices();
      rebuildAccount(
        this.database.listLedger(),
        latest.prices,
        latest.dataCutoff,
      );
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

  getIncomeCalendar(query: IncomeCalendarQuery): IncomeCalendarView {
    const snapshot = this.liveDataSnapshot();
    return buildIncomeCalendar(
      snapshot.entries,
      snapshot.prices,
      this.localStockUniverse(),
      query,
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

  previewLedger(
    input: LedgerEntryInput,
    replacingEntryId?: string,
  ): LedgerImpactPreview {
    return previewLedgerMutation(
      this.database.listLedger(),
      input,
      replacingEntryId,
    );
  }

  correctLedger(entryId: string, input: LedgerEntryInput): LedgerEntry {
    const preview = this.previewLedger(input, entryId);
    const recordedAt = new Date().toISOString();
    const reversal: LedgerEntry = {
      id: randomUUID(),
      type: "adjustment",
      businessDate: recordedAt.slice(0, 10),
      recordedAt,
      currency: "CNY",
      source: "system",
      reversesEntryId: entryId,
      note: "追加修正：撤销原记录影响",
    };
    const replacement: LedgerEntry = {
      ...preview.normalizedInput,
      id: randomUUID(),
      recordedAt: new Date(Date.parse(recordedAt) + 1).toISOString(),
      currency: "CNY",
      source: "user",
      correctsEntryId: entryId,
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
    const entry: LedgerEntry = {
      id: randomUUID(),
      type: "adjustment",
      businessDate: new Date().toISOString().slice(0, 10),
      recordedAt: new Date().toISOString(),
      currency: "CNY",
      source: "system",
      note: (reason ?? "").trim() || "用户发起冲正",
      reversesEntryId: entryId,
    };
    this.database.addLedger(entry);
    this.database.log("info", `已冲正流水：${entryId}`);
    return entry;
  }

  accountSummary(): AccountSummary {
    const latest = this.database.latestPrices();
    return rebuildAccount(
      this.database.listLedger(),
      latest.prices,
      latest.dataCutoff,
    );
  }
}
