import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
  BacktestRequest,
  BacktestResult,
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
  DEFAULT_STOCKS,
  STOCK_UNIVERSE_CACHE_MAX_AGE_MS,
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

export class AppService {
  constructor(private readonly database: LocalDatabase) {}

  async listStocks(): Promise<StockInfo[]> {
    const cached = this.database.listStockUniverse();
    const fetchedAt = cached[0]?.fetchedAt;
    const cacheIsFresh =
      fetchedAt !== undefined &&
      Date.now() - Date.parse(fetchedAt) < STOCK_UNIVERSE_CACHE_MAX_AGE_MS;
    if (cacheIsFresh) return cached;

    try {
      const response = await fetchAStockUniverse();
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
      this.database.log("warn", `刷新 A 股代码表失败，使用本地快照：${message}`);
      if (cached.length) return cached;
      return DEFAULT_STOCKS.map(({ symbol, name }) => ({ symbol, name }));
    }
  }

  async runBacktest(request: BacktestRequest): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];
    const stocks = await this.listStocks();
    const names = new Map(stocks.map((stock) => [stock.symbol, stock.name]));
    const batchId = randomUUID();
    for (const symbol of request.symbols) {
      const prices = await fetchUnadjustedPrices(
        symbol,
        request.startDate,
        request.endDate,
      );
      // 东财属于补充源，严格串行；多标的之间留出节流窗口。
      if (results.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, DATA_SOURCE_THROTTLE_MS),
        );
      }
      const dividends = await fetchCorporateActions(
        symbol,
        request.startDate,
        request.endDate,
      );
      this.database.replaceMarketData(
        symbol,
        prices.rows,
        dividends.rows,
        prices.provenance.source,
        prices.provenance.fetchedAt,
      );
      const result = simulateBacktest(
        request,
        symbol,
        names.get(symbol) ?? symbol,
        prices.rows,
        dividends.rows,
        [prices.provenance, dividends.provenance],
      );
      result.strategyKey = buildBacktestStrategyKey(request, symbol);
      result.batchId = batchId;
      results.push(result);
    }
    this.database.saveBacktests(results);
    this.database.log(
      "info",
      `完成回测：${request.symbols.join(",")} ${request.startDate}..${request.endDate}`,
    );
    return results;
  }

  listBacktests(): BacktestResult[] {
    // v3 改为零碎股、费用 0、分红回购和送转入账。旧口径结果仍保留在
    // SQLite/备份中，但不与当前结果混排，避免用户把不可比数字当成同口径比较。
    return this.database
      .listBacktests()
      .filter((result) =>
        result.provenance.some(
          (item) => item.caliberVersion === BACKTEST_CALIBER_VERSION,
        ),
      );
  }

  getBacktestDetail(backtestId: string): SimpleBacktestResult {
    const result = this.database.getBacktest(backtestId);
    if (!result) throw new Error("找不到回测记录，可能已被新参数结果替换");
    return backtestResultToSimpleResult(result);
  }

  getBacktestWorkspace(): BacktestWorkspaceState | null {
    return this.database.getBacktestWorkspace();
  }

  saveBacktestWorkspace(state: BacktestWorkspaceState): void {
    this.database.saveBacktestWorkspace(state);
  }

  listBacktestsByIds(ids: string[]): BacktestResult[] {
    return this.database.listBacktestsByIds(ids);
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
