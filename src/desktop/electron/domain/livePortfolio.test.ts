import { describe, expect, it } from "vitest";
import type {
  LedgerEntry,
  StockInfo,
} from "../../shared/contracts";
import type { StoredMarketPrice } from "../storage/database";
import {
  buildIncomeCalendar,
  buildPositionsOverview,
  queryLedgerRecords,
} from "./livePortfolio";

const stocks: StockInfo[] = [
  { symbol: "601398", name: "工商银行" },
  { symbol: "510300", name: "沪深300ETF" },
];

function entry(
  id: string,
  type: LedgerEntry["type"],
  businessDate: string,
  fields: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id,
    type,
    businessDate,
    recordedAt: `${businessDate}T09:30:00Z`,
    currency: "CNY",
    source: "user",
    ...fields,
  };
}

function price(
  symbol: string,
  date: string,
  close: number,
): StoredMarketPrice {
  return {
    symbol,
    date,
    close,
    source: "test",
    fetchedAt: "2026-07-24T08:00:00Z",
  };
}

describe("实盘只读领域视图", () => {
  it("由领域层返回持仓成本、估值、累计收益和现金", () => {
    const overview = buildPositionsOverview(
      [
        entry("in", "transfer_in", "2026-07-01", { amount: 10_000 }),
        entry("buy", "buy", "2026-07-02", {
          symbol: "601398",
          price: 5,
          quantity: 1_000,
          fee: 5,
        }),
        entry("dividend", "dividend", "2026-07-20", {
          symbol: "601398",
          amount: 200,
          perShare: 0.2,
        }),
      ],
      [
        price("601398", "2026-07-02", 5),
        price("601398", "2026-07-24", 5.5),
      ],
      stocks,
    );

    expect(overview.quality.status).toBe("ready");
    expect(overview.metrics.availableCash).toBe(5_195);
    expect(overview.metrics.marketValue).toBe(5_500);
    expect(overview.metrics.totalAsset).toBe(10_695);
    expect(overview.metrics.totalPnl).toBe(695);
    expect(overview.positions[0]).toMatchObject({
      symbol: "601398",
      name: "工商银行",
      cost: 5_005,
      cumulativeInvestment: 5_005,
      cumulativeDividend: 200,
      unrealizedPnl: 495,
      totalReturn: 695,
    });
  });

  it("缺少持仓行情时返回 partial，不以成本冒充市值", () => {
    const overview = buildPositionsOverview(
      [
        entry("in", "transfer_in", "2026-07-01", { amount: 10_000 }),
        entry("buy", "buy", "2026-07-02", {
          symbol: "601398",
          price: 5,
          quantity: 1_000,
        }),
      ],
      [],
      stocks,
    );

    expect(overview.quality.status).toBe("partial");
    expect(overview.quality.missingSymbols).toEqual(["601398"]);
    expect(overview.positions[0].marketValue).toBeNull();
    expect(overview.positions[0].totalReturn).toBeNull();
    expect(overview.metrics.totalAsset).toBeNull();
  });

  it("冲正后原流水不参与账户和聚合指标", () => {
    const entries = [
      entry("in", "transfer_in", "2026-07-01", { amount: 10_000 }),
      entry("buy", "buy", "2026-07-02", {
        symbol: "601398",
        price: 5,
        quantity: 1_000,
      }),
      entry("reverse", "adjustment", "2026-07-03", {
        reversesEntryId: "buy",
        note: "冲正误录买入",
      }),
    ];
    const overview = buildPositionsOverview(entries, [], stocks);
    const ledger = queryLedgerRecords(
      entries,
      stocks,
      { page: 1, pageSize: 20 },
    );

    expect(overview.positions).toHaveLength(0);
    expect(overview.metrics.availableCash).toBe(10_000);
    expect(ledger.metrics.totalBuy).toBe(0);
    expect(ledger.rows.find((row) => row.id === "buy")?.isReversed).toBe(true);
  });

  it("流水筛选和金额口径在领域层完成", () => {
    const result = queryLedgerRecords(
      [
        entry("buy", "buy", "2026-07-02", {
          symbol: "601398",
          price: 5,
          quantity: 1_000,
          fee: 5,
        }),
        entry("sell", "sell", "2026-07-03", {
          symbol: "601398",
          price: 5.5,
          quantity: 500,
          fee: 3,
        }),
        entry("dividend", "dividend", "2026-07-20", {
          symbol: "601398",
          amount: 200,
        }),
      ],
      stocks,
      {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        symbol: "601398",
        page: 1,
        pageSize: 20,
      },
    );

    expect(result.metrics).toEqual({
      recordCount: 3,
      totalBuy: 5_005,
      totalSell: 2_747,
      totalDividend: 200,
      netTransferIn: 0,
    });
    expect(result.rows.map((row) => row.id)).toEqual([
      "dividend",
      "sell",
      "buy",
    ]);
  });

  it("收益日历区分价格收益和现金分红，累计值不由 Renderer 计算", () => {
    const view = buildIncomeCalendar(
      [
        entry("in", "transfer_in", "2026-07-01", { amount: 10_000 }),
        entry("buy", "buy", "2026-07-02", {
          symbol: "601398",
          price: 5,
          quantity: 1_000,
        }),
        entry("dividend", "dividend", "2026-07-03", {
          symbol: "601398",
          amount: 200,
        }),
      ],
      [
        price("601398", "2026-07-02", 5),
        price("601398", "2026-07-03", 5.1),
      ],
      stocks,
      { month: "2026-07", scope: "all" },
    );

    const dividendDay = view.days.find((day) => day.date === "2026-07-03");
    expect(dividendDay?.pricePnl).toBe(100);
    expect(dividendDay?.dividendPnl).toBe(200);
    expect(dividendDay?.totalPnl).toBe(300);
    expect(view.metrics.month.amount).toBe(300);
    expect(view.metrics.dividend.amount).toBe(200);
  });
});
