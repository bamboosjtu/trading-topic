import { describe, expect, it } from "vitest";
import type {
  LedgerEntry,
  StockInfo,
} from "../../shared/contracts";
import type { StoredMarketPrice } from "../storage/database";
import {
  buildPositionsOverview,
} from "./positionsView";
import { buildIncomeCalendar } from "./incomeCalendar";
import { queryLedgerRecords } from "./ledgerQuery";

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

  it("流水列表与账本归约共用同日创建顺序，列表按其稳定倒序展示", () => {
    const rows = [
      entry("first", "transfer_in", "2026-07-02", {
        amount: 100,
        recordedAt: "2026-07-02T01:00:00Z",
      }),
      entry("second", "transfer_out", "2026-07-02", {
        amount: 40,
        recordedAt: "2026-07-02T02:00:00Z",
      }),
    ];
    const result = queryLedgerRecords(rows, stocks, {
      page: 1,
      pageSize: 20,
    });
    expect(result.rows.map((row) => row.id)).toEqual(["second", "first"]);
    expect(buildPositionsOverview(rows, [], stocks).metrics.availableCash)
      .toBe(60);
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
    expect(dividendDay?.marketPricePnl).toBe(100);
    expect(dividendDay?.dividendPnl).toBe(200);
    expect(dividendDay?.tradingCostPnl).toBe(0);
    expect(dividendDay?.reverseRepoIncome).toBe(0);
    expect(dividendDay?.totalPnl).toBe(300);
    expect(view.metrics.month.amount).toBe(300);
    expect(view.metrics.dividend.amount).toBe(200);
  });

  it("将市场价格、交易影响、分红与逆回购收益分开并满足收益恒等式", () => {
    const view = buildIncomeCalendar(
      [
        entry("in", "transfer_in", "2026-07-01", { amount: 10_000 }),
        entry("buy", "buy", "2026-07-02", {
          symbol: "601398",
          price: 5,
          quantity: 1_000,
          fee: 5,
        }),
        entry("repo", "reverse_repo", "2026-07-03", {
          amount: 1_000,
          maturityDate: "2026-07-05",
          maturityAmount: 1_010,
        }),
      ],
      [
        price("601398", "2026-07-02", 5.2),
        price("601398", "2026-07-03", 5.3),
        price("601398", "2026-07-05", 5.3),
      ],
      stocks,
      { month: "2026-07", scope: "all" },
    );

    const buyDay = view.days.find((day) => day.date === "2026-07-02")!;
    expect(buyDay.marketPricePnl).toBe(0);
    expect(buyDay.tradingCostPnl).toBe(195);
    expect(buyDay.totalPnl).toBe(195);
    const nextDay = view.days.find((day) => day.date === "2026-07-03")!;
    expect(nextDay.marketPricePnl).toBe(100);
    expect(nextDay.tradingCostPnl).toBe(0);
    const maturityDay = view.days.find((day) => day.date === "2026-07-05")!;
    expect(maturityDay.reverseRepoIncome).toBe(10);
    expect(maturityDay.totalPnl).toBe(10);
    for (const day of view.days) {
      if (day.totalPnl === null || day.marketPricePnl === null) continue;
      expect(day.totalPnl).toBeCloseTo(
        day.marketPricePnl +
          day.dividendPnl +
          day.tradingCostPnl +
          day.reverseRepoIncome,
        8,
      );
    }
  });

  it("当前持仓口径保留账户级逆回购收益，单标的口径不分摊", () => {
    const entries = [
      entry("in", "transfer_in", "2026-07-01", { amount: 10_000 }),
      entry("buy", "buy", "2026-07-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("repo", "reverse_repo", "2026-07-03", {
        amount: 1_000,
        maturityDate: "2026-07-05",
        maturityAmount: 1_010,
      }),
    ];
    const prices = [
      price("601398", "2026-07-02", 5),
      price("601398", "2026-07-05", 5),
    ];

    const current = buildIncomeCalendar(entries, prices, stocks, {
      month: "2026-07",
      scope: "current",
    });
    expect(current.metrics.reverseRepo.amount).toBe(10);
    expect(current.days.find((day) => day.date === "2026-07-05")?.totalPnl)
      .toBe(10);

    const single = buildIncomeCalendar(entries, prices, stocks, {
      month: "2026-07",
      scope: "all",
      symbol: "601398",
    });
    expect(single.metrics.reverseRepo.amount).toBe(0);
    expect(single.days.find((day) => day.date === "2026-07-05")?.totalPnl)
      .toBe(0);
  });

  it("已清仓标的的旧行情不截断仍持有标的的收益日历", () => {
    const view = buildIncomeCalendar(
      [
        entry("buy-old", "buy", "2025-01-02", {
          symbol: "601398",
          price: 5,
          quantity: 100,
        }),
        entry("sell-old", "sell", "2025-02-03", {
          symbol: "601398",
          price: 5.2,
          quantity: 100,
        }),
        entry("buy-current", "buy", "2026-07-01", {
          symbol: "510300",
          price: 4,
          quantity: 100,
        }),
      ],
      [
        price("601398", "2025-01-02", 5),
        price("601398", "2025-02-03", 5.2),
        price("510300", "2026-07-01", 4),
        price("510300", "2026-07-24", 4.2),
      ],
      stocks,
      { month: "2026-07", scope: "all" },
    );

    expect(view.quality.dataCutoff).toBe("2026-07-24");
    expect(view.days.at(-1)?.date).toBe("2026-07-24");
    expect(view.days.at(-1)?.marketPricePnl).toBe(20);
    expect(view.days.at(-1)?.isPartial).toBe(false);
  });

  it("只把实际持有且缺少估值的对应日期标记为 partial", () => {
    const view = buildIncomeCalendar(
      [
        entry("buy", "buy", "2026-07-02", {
          symbol: "601398",
          price: 5,
          quantity: 37,
        }),
      ],
      [],
      stocks,
      { month: "2026-07", scope: "all" },
    );
    expect(view.days).toHaveLength(1);
    expect(view.days[0]).toMatchObject({
      date: "2026-07-02",
      marketPricePnl: null,
      totalPnl: null,
      isPartial: true,
    });
    expect(view.quality.missingDates).toEqual(["2026-07-02"]);
  });

  it("同一行情日只把缺少当日价格的在持标的标为 partial", () => {
    const view = buildIncomeCalendar(
      [
        entry("buy-a", "buy", "2026-07-01", {
          symbol: "601398",
          price: 5,
          quantity: 100,
        }),
        entry("buy-b", "buy", "2026-07-01", {
          symbol: "510300",
          price: 4,
          quantity: 100,
        }),
      ],
      [
        price("601398", "2026-07-01", 5),
        price("510300", "2026-07-01", 4),
        price("601398", "2026-07-02", 5.1),
      ],
      stocks,
      { month: "2026-07", scope: "all" },
    );

    const day = view.days.find((item) => item.date === "2026-07-02")!;
    expect(day.isPartial).toBe(true);
    expect(day.contributions.find((item) => item.symbol === "601398")
      ?.marketPricePnl).toBe(10);
    expect(day.contributions.find((item) => item.symbol === "510300")
      ?.marketPricePnl).toBeNull();
    expect(view.quality.missingDates).toContain("2026-07-02");
  });
});
