import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
  BacktestRequest,
  BacktestResult,
  LedgerEntry,
  LedgerEntryInput,
  SimpleBacktestResult,
} from "../../shared/contracts";
import { fetchCashDividends, fetchUnadjustedPrices, stockName } from "../data/tencent";
import { simulateBacktest, simulateBacktestSimple } from "../domain/analysis";
import { rebuildAccount } from "../domain/ledger";
import { LocalDatabase } from "../storage/database";

function validateLedger(input: LedgerEntryInput): void {
  if (!input.businessDate) throw new Error("业务日期不能为空");
  if (["transfer_in", "transfer_out", "dividend"].includes(input.type)) {
    if (!(Number(input.amount) > 0)) throw new Error("金额必须大于 0");
  }
  if (["buy", "sell"].includes(input.type)) {
    if (!input.symbol || !/^(?:0|3|6|8)\d{5}$/.test(input.symbol)) {
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
    (!input.symbol || !/^(?:0|3|6|8)\d{5}$/.test(input.symbol))
  ) {
    throw new Error("现金分红必须关联有效的 A 股代码");
  }
  if (input.type === "reverse_repo" && !(Number(input.amount) > 0)) {
    throw new Error("逆回购本金必须大于 0");
  }
}

export class AppService {
  constructor(private readonly database: LocalDatabase) {}

  async runBacktest(request: BacktestRequest): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];
    for (const symbol of request.symbols) {
      const prices = await fetchUnadjustedPrices(
        symbol,
        request.startDate,
        request.endDate,
      );
      // 东财属于补充源，严格串行；多标的之间留出节流窗口。
      if (results.length) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
      const dividends = await fetchCashDividends(
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
      results.push(
        simulateBacktest(
          request,
          symbol,
          stockName(symbol),
          prices.rows,
          dividends.rows,
          [prices.provenance, dividends.provenance],
        ),
      );
    }
    this.database.saveBacktests(results);
    this.database.log(
      "info",
      `完成回测：${request.symbols.join(",")} ${request.startDate}..${request.endDate}`,
    );
    return results;
  }

  listBacktests(): BacktestResult[] {
    return this.database.listBacktests();
  }

  /**
   * 简化交易成本回测（drawer 展示视图）。
   *
   * 复用 runBacktest 的行情/分红拉取与落库逻辑，但调用 simulateBacktestSimple
   * 生成简化明细：费用0、contribution+buy 合并行、分红/除权独立行、零碎股、
   * 分红到账不再投资。结果不落库，仅用于同条件对比展示。
   */
  async runSimpleBacktest(request: BacktestRequest): Promise<SimpleBacktestResult[]> {
    const results: SimpleBacktestResult[] = [];
    for (const symbol of request.symbols) {
      const prices = await fetchUnadjustedPrices(
        symbol,
        request.startDate,
        request.endDate,
      );
      if (results.length) {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
      }
      const dividends = await fetchCashDividends(
        symbol,
        request.startDate,
        request.endDate,
      );
      // 简化视图同样刷新行情落库，保证 drawer 与列表口径一致
      this.database.replaceMarketData(
        symbol,
        prices.rows,
        dividends.rows,
        prices.provenance.source,
        prices.provenance.fetchedAt,
      );
      results.push(
        simulateBacktestSimple(
          request,
          symbol,
          stockName(symbol),
          prices.rows,
          dividends.rows,
        ),
      );
    }
    this.database.log(
      "info",
      `简化回测：${request.symbols.join(",")} ${request.startDate}..${request.endDate}`,
    );
    return results;
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
