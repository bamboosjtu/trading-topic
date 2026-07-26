import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestRequest,
  LedgerEntry,
  LedgerEntryInput,
  SimpleBacktestResult,
  BacktestWorkspaceState,
  StockInfo,
} from "../../shared/contracts";
import { buildBacktestStrategyKey } from "../../shared/backtestIdentity";
import {
  BACKTEST_CALIBER_VERSION,
  DATA_SOURCE_THROTTLE_MS,
  STOCK_UNIVERSE_CACHE_MAX_AGE_MS,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import { fetchAStockUniverse } from "../data/stockUniverse";
import {
  fetchCorporateActions,
  fetchUnadjustedPrices,
} from "../data/tencent";
import {
  backtestResultToSimpleResult,
  simulateBacktest,
} from "../domain/analysis";
import { rebuildAccount } from "../domain/ledger";
import { LocalDatabase } from "../storage/database";

function validateLedger(input: LedgerEntryInput): void {
  if (!input.businessDate) throw new Error("业务日期不能为空");
  if (["transfer_in", "transfer_out", "dividend"].includes(input.type)) {
    if (!(Number(input.amount) > 0)) throw new Error("金额必须大于 0");
  }
  if (["buy", "sell"].includes(input.type)) {
    if (!input.symbol || !/^\d{6}$/.test(input.symbol)) {
      throw new Error("请输入有效的 6 位 A 股代码");
    }
    if (!(Number(input.price) > 0)) throw new Error("成交价格必须大于 0");
    if (
      !(Number(input.quantity) > 0) ||
      Number(input.quantity) % 100 !== 0
    ) {
      throw new Error("交易数量必须是 100 股的整数倍");
    }
  }
  if (
    input.type === "dividend" &&
    (!input.symbol || !/^\d{6}$/.test(input.symbol))
  ) {
    throw new Error("现金分红必须关联有效的 A 股代码");
  }
  if (input.type === "reverse_repo" && !(Number(input.amount) > 0)) {
    throw new Error("逆回购本金必须大于 0");
  }
}

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
    const stocks = await this.listStocks();
    const names = new Map(stocks.map((stock) => [stock.symbol, stock.name]));
    const marketData: Array<{
      symbol: string;
      prices: Awaited<ReturnType<typeof fetchUnadjustedPrices>>;
      dividends: Awaited<ReturnType<typeof fetchCorporateActions>>;
    }> = [];
    for (const [index, symbol] of canonicalRequest.symbols.entries()) {
      const prices = await fetchUnadjustedPrices(
        symbol,
        canonicalRequest.startDate,
        canonicalRequest.endDate,
      );
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
      this.database.replaceMarketData(
        symbol,
        prices.rows,
        dividends.rows,
        prices.provenance.source,
        prices.provenance.fetchedAt,
      );
      marketData.push({ symbol, prices, dividends });
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
    const results = marketData.map(({ symbol, prices, dividends }) => {
      const result = simulateBacktest(
        effectiveRequest,
        symbol,
        names.get(symbol) ?? symbol,
        prices.rows,
        dividends.rows,
        [prices.provenance, dividends.provenance],
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
      return result;
    });
    const experiment: BacktestExperiment = {
      experimentId,
      createdAt,
      request: canonicalRequest,
      results,
      dataCutoff,
      caliberVersion: BACKTEST_CALIBER_VERSION,
      status: "completed",
    };
    this.database.saveBacktestExperiment(experiment);
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

  listLedger(): LedgerEntry[] {
    return this.database.listLedger();
  }

  addLedger(input: LedgerEntryInput): LedgerEntry {
    validateLedger(input);
    const entry: LedgerEntry = {
      ...input,
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      currency: "CNY",
      source: "user",
    };
    this.database.addLedger(entry);
    this.database.log("info", `新增流水：${entry.type} ${entry.businessDate}`);
    return entry;
  }

  reverseLedger(entryId: string, reason: string): LedgerEntry {
    const target = this.database.listLedger().find((entry) => entry.id === entryId);
    if (!target) throw new Error("找不到需要冲正的原流水");
    if (
      this.database
        .listLedger()
        .some((entry) => entry.reversesEntryId === entryId)
    ) {
      throw new Error("该流水已经被冲正");
    }
    return this.addLedger({
      type: "adjustment",
      businessDate: new Date().toISOString().slice(0, 10),
      note: reason || `冲正 ${entryId}`,
      reversesEntryId: entryId,
    });
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
