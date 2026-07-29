import { describe, expect, it } from "vitest";
import type {
  EntryType,
  LedgerEntry,
  StockInfo,
} from "../../shared/contracts";
import type { StoredMarketPrice } from "../storage/database";
import {
  buildDailyAttribution,
  rowsBySymbol,
} from "./dailyAttribution";
import { buildIncomeCalendar } from "./incomeCalendar";
import { queryLedgerRecords } from "./ledgerQuery";
import { activeLedgerEntries } from "./ledgerReducer";
import { buildPositionsOverview } from "./positionsView";

const stocks: StockInfo[] = [
  { symbol: "601398", name: "工商银行" },
  { symbol: "510300", name: "沪深300ETF" },
];

function entry(
  id: string,
  type: EntryType,
  businessDate: string,
  fields: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id,
    type,
    businessDate,
    recordedAt: `${businessDate}T01:00:00Z`,
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
    source: "tencent",
    primarySource: "tencent",
    fallbackUsed: false,
    fetchedAt: "2026-07-28T08:00:00Z",
    dataCutoff: date,
    adjustment: "none",
  };
}

function dailyAttribution(
  entries: readonly LedgerEntry[],
  prices: readonly StoredMarketPrice[],
  cutoff: string,
) {
  return buildDailyAttribution(
    activeLedgerEntries(entries, cutoff).effective,
    rowsBySymbol(prices),
    cutoff,
    cutoff,
    new Map(),
  );
}

describe("投资收益视图", () => {
  it("仅凭投资现金流即可计算持仓与总收益", () => {
    const entries = [
      entry("buy", "buy", "2026-07-01", {
        symbol: "601398",
        instrumentName: "旧名称",
        securityType: "stock",
        price: 5,
        quantity: 100,
        fee: 5,
      }),
      entry("dividend", "dividend", "2026-07-10", {
        symbol: "601398",
        amount: 20,
      }),
      entry("sell", "sell", "2026-07-15", {
        symbol: "601398",
        price: 6,
        quantity: 40,
        fee: 2,
      }),
    ];
    const overview = buildPositionsOverview(
      entries,
      [
        price("601398", "2026-06-30", 5),
        price("601398", "2026-07-28", 7),
      ],
      stocks,
    );
    expect(overview.positions[0]).toMatchObject({
      name: "工商银行",
      quantity: 60,
      cumulativeBuySpend: 505,
      cumulativeSellNetIncome: 238,
      netInvestment: 247,
      marketValue: 420,
      realizedPnl: 36,
      cumulativeDividend: 20,
      totalReturn: 173,
    });
    expect(overview.metrics).toMatchObject({
      marketValue: 420,
      cumulativeBuySpend: 505,
      cumulativeSellNetIncome: 238,
      cumulativeDividend: 20,
      netInvestment: 247,
      totalReturn: 173,
    });
    expect(overview.provenance[0]).toMatchObject({
      source: "tencent",
      fallbackUsed: false,
      adjustment: "none",
    });
  });

  it("已清仓标的仍保留完整历史收益，但不进入当前持仓", () => {
    const entries = [
      entry("buy", "buy", "2026-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("sell", "sell", "2026-02-02", {
        symbol: "601398",
        price: 6,
        quantity: 100,
      }),
      entry("dividend", "dividend", "2026-01-20", {
        symbol: "601398",
        amount: 10,
      }),
    ];
    const overview = buildPositionsOverview(entries, [], stocks);
    expect(overview.positions).toHaveLength(0);
    expect(overview.metrics).toMatchObject({
      cumulativeBuySpend: 500,
      cumulativeSellNetIncome: 600,
      cumulativeDividend: 10,
      netInvestment: -110,
      realizedPnl: 100,
      totalReturn: 110,
    });
    expect(overview.metrics.xirr).not.toBeNull();
    expect("totalReturnRate" in overview.metrics).toBe(false);
  });

  it("事实截止日晚于估值截止日时保留当日交易，但不使用昨日收盘估值", () => {
    const entries = [
      entry("buy-today", "buy", "2026-07-28", {
        symbol: "601398",
        price: 5.2,
        quantity: 100,
      }),
    ];
    const overview = buildPositionsOverview(
      entries,
      [price("601398", "2026-07-27", 5)],
      stocks,
      {
        factAsOfDate: "2026-07-28",
        valuationCutoff: "2026-07-27",
      },
    );
    expect(overview.positions[0]).toMatchObject({
      quantity: 100,
      marketValue: null,
      totalReturn: null,
    });
    expect(overview.metrics).toMatchObject({
      cumulativeBuySpend: 520,
      marketValue: null,
      totalReturn: null,
    });
    expect(overview.quality.status).toBe("partial");

    const calendar = buildIncomeCalendar(
      entries,
      [price("601398", "2026-07-27", 5)],
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      {
        factAsOfDate: "2026-07-28",
        valuationCutoff: "2026-07-27",
      },
    );
    const tradeDay = calendar.days.find(
      (day) => day.date === "2026-07-28",
    );
    expect(tradeDay).toMatchObject({
      isPartial: true,
      hasMarketData: false,
      totalPnl: null,
    });
    expect(tradeDay?.events).toHaveLength(1);
  });

  it("多标的估值要求每个当前持仓都具有截止日精确收盘价", () => {
    const entries = [
      entry("buy-a", "buy", "2026-07-01", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("buy-b", "buy", "2026-07-01", {
        symbol: "510300",
        securityType: "etf",
        price: 4,
        quantity: 100,
      }),
    ];
    const overview = buildPositionsOverview(
      entries,
      [
        price("601398", "2026-07-01", 5),
        price("601398", "2026-07-28", 5.5),
        price("510300", "2026-07-01", 4),
        price("510300", "2026-07-27", 4.2),
      ],
      stocks,
      {
        factAsOfDate: "2026-07-28",
        valuationCutoff: "2026-07-28",
      },
    );

    expect(
      overview.positions.find((position) => position.symbol === "601398"),
    ).toMatchObject({
      lastPrice: 5.5,
      marketValue: 550,
    });
    expect(
      overview.positions.find((position) => position.symbol === "510300"),
    ).toMatchObject({
      lastPrice: null,
      marketValue: null,
      totalReturn: null,
    });
    expect(overview.metrics.marketValue).toBeNull();
    expect(overview.metrics.totalReturn).toBeNull();
    expect(overview.quality.status).toBe("partial");
    expect(overview.quality.missingSymbols).toContain("510300");
    expect(overview.quality.missingDates).toContain("2026-07-28");
  });

  it("历史已清仓标的的较新行情不能替代当前持仓的截止日估值", () => {
    const entries = [
      entry("old-buy", "buy", "2026-01-05", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("old-sell", "sell", "2026-02-05", {
        symbol: "601398",
        price: 5.2,
        quantity: 100,
      }),
      entry("current-buy", "buy", "2026-07-01", {
        symbol: "510300",
        securityType: "etf",
        price: 4,
        quantity: 100,
      }),
    ];
    const overview = buildPositionsOverview(
      entries,
      [
        price("601398", "2026-01-05", 5),
        price("601398", "2026-02-05", 5.2),
        price("601398", "2026-07-28", 5.6),
        price("510300", "2026-07-01", 4),
        price("510300", "2026-07-27", 4.2),
      ],
      stocks,
      {
        factAsOfDate: "2026-07-28",
        valuationCutoff: "2026-07-28",
      },
    );

    expect(overview.positions).toHaveLength(1);
    expect(overview.positions[0]).toMatchObject({
      symbol: "510300",
      lastPrice: null,
      marketValue: null,
      totalReturn: null,
    });
    expect(overview.quality.status).toBe("partial");
    expect(overview.quality.missingSymbols).toEqual(["510300"]);
    expect(overview.quality.missingDates).toContain("2026-07-28");
  });

  it("收益日历不因买入前缓存行情生成大量零收益日期", () => {
    const entries = [
      entry("new-buy", "buy", "2026-07-10", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ];
    const view = buildIncomeCalendar(
      entries,
      [
        price("601398", "2026-07-01", 4.8),
        price("601398", "2026-07-09", 4.9),
        price("601398", "2026-07-10", 5),
        price("601398", "2026-07-13", 5.1),
      ],
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      {
        factAsOfDate: "2026-07-13",
        valuationCutoff: "2026-07-13",
      },
    );
    expect(view.days.map((day) => day.date)).toEqual([
      "2026-07-10",
      "2026-07-13",
    ]);
  });

  it("全部清仓后按当前持仓查询收益日历返回空状态", () => {
    const entries = [
      entry("buy", "buy", "2026-06-01", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("sell", "sell", "2026-06-30", {
        symbol: "601398",
        price: 5.2,
        quantity: 100,
      }),
    ];
    const view = buildIncomeCalendar(
      entries,
      [
        price("601398", "2026-06-01", 5),
        price("601398", "2026-06-30", 5.2),
      ],
      stocks,
      { month: "2026-06", scope: "current" },
      [],
      {
        factAsOfDate: "2026-07-01",
        valuationCutoff: "2026-06-30",
      },
    );
    expect(view.days).toEqual([]);
    expect(view.quality.status).toBe("empty");
    expect(view.metrics.month.amount).toBeNull();
  });

  it("收益日历只包含市场价格、分红和交易影响三项归因", () => {
    const entries = [
      entry("buy", "buy", "2026-07-01", {
        symbol: "601398",
        price: 5,
        quantity: 100,
        fee: 5,
      }),
      entry("dividend", "dividend", "2026-07-02", {
        symbol: "601398",
        amount: 20,
      }),
    ];
    const view = buildIncomeCalendar(
      entries,
      [
        price("601398", "2026-06-30", 5),
        price("601398", "2026-07-01", 5.2),
        price("601398", "2026-07-02", 5.3),
      ],
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      {
        factAsOfDate: "2026-07-02",
        valuationCutoff: "2026-07-02",
      },
    );
    const buyDay = view.days.find((day) => day.date === "2026-07-01")!;
    expect(buyDay.marketPricePnl).toBe(0);
    expect(buyDay.tradingCostPnl).toBe(15);
    expect(buyDay.totalPnl).toBe(15);
    const dividendDay = view.days.find((day) => day.date === "2026-07-02")!;
    expect(dividendDay.marketPricePnl).toBe(10);
    expect(dividendDay.dividendPnl).toBe(20);
    expect(dividendDay.totalPnl).toBe(30);
    // 当前月份仅截止 7 月 2 日，距市场当前日过久，应明确标记过期；
    // 归因值本身仍按已有正式收盘价计算。
    expect(view.quality.status).toBe("stale");
  });

  it("同日分红再投入不重复增加收益率资本基数", () => {
    const entries = [
      entry("opening", "buy", "2026-06-30", {
        symbol: "601398",
        price: 10,
        quantity: 100,
      }),
      entry("dividend", "dividend", "2026-07-01", {
        symbol: "601398",
        amount: 100,
        linkedGroupId: "reinvest-1",
      }),
      entry("reinvest", "buy", "2026-07-01", {
        symbol: "601398",
        price: 10,
        quantity: 10,
        linkedGroupId: "reinvest-1",
      }),
    ];
    const day = dailyAttribution(
      entries,
      [
        price("601398", "2026-06-30", 10),
        price("601398", "2026-07-01", 10),
      ],
      "2026-07-01",
    ).at(-1)!;
    expect(day.capitalBase).toBe(1_000);
    expect(day.returnRate).toBe(0.1);
  });

  it("分红次日再投入仍识别为内部资金循环", () => {
    const entries = [
      entry("opening", "buy", "2026-06-30", {
        symbol: "601398",
        price: 10,
        quantity: 100,
      }),
      entry("dividend", "dividend", "2026-07-01", {
        symbol: "601398",
        amount: 100,
        linkedGroupId: "reinvest-next-day",
      }),
      entry("reinvest", "buy", "2026-07-02", {
        symbol: "601398",
        price: 10,
        quantity: 10,
        linkedGroupId: "reinvest-next-day",
      }),
    ];
    const day = dailyAttribution(
      entries,
      [
        price("601398", "2026-06-30", 10),
        price("601398", "2026-07-01", 10),
        price("601398", "2026-07-02", 10),
      ],
      "2026-07-02",
    ).at(-1)!;
    expect(day.date).toBe("2026-07-02");
    expect(day.capitalBase).toBe(1_000);
  });

  it("再投入支出超过分红时只把补足零钱计入外部投入", () => {
    const entries = [
      entry("opening", "buy", "2026-06-30", {
        symbol: "601398",
        price: 10,
        quantity: 100,
      }),
      entry("dividend", "dividend", "2026-07-01", {
        symbol: "601398",
        amount: 100,
        linkedGroupId: "reinvest-extra",
      }),
      entry("reinvest", "buy", "2026-07-01", {
        symbol: "601398",
        price: 10,
        quantity: 12,
        linkedGroupId: "reinvest-extra",
      }),
    ];
    const day = dailyAttribution(
      entries,
      [
        price("601398", "2026-06-30", 10),
        price("601398", "2026-07-01", 10),
      ],
      "2026-07-01",
    ).at(-1)!;
    expect(day.capitalBase).toBe(1_020);
  });

  it("普通独立买入仍全部计入外部投入", () => {
    const entries = [
      entry("opening", "buy", "2026-06-30", {
        symbol: "601398",
        price: 10,
        quantity: 100,
      }),
      entry("ordinary-buy", "buy", "2026-07-01", {
        symbol: "601398",
        price: 10,
        quantity: 10,
      }),
    ];
    const day = dailyAttribution(
      entries,
      [
        price("601398", "2026-06-30", 10),
        price("601398", "2026-07-01", 10),
      ],
      "2026-07-01",
    ).at(-1)!;
    expect(day.capitalBase).toBe(1_100);
  });

  it("冲正或修正关联事实后按当前有效版本重算内部再投入", () => {
    const base = [
      entry("opening", "buy", "2026-06-30", {
        symbol: "601398",
        price: 10,
        quantity: 100,
      }),
      entry("dividend", "dividend", "2026-07-01", {
        symbol: "601398",
        amount: 100,
        linkedGroupId: "reinvest-audit",
      }),
      entry("old-buy", "buy", "2026-07-01", {
        symbol: "601398",
        price: 10,
        quantity: 10,
        linkedGroupId: "reinvest-audit",
      }),
    ];
    const prices = [
      price("601398", "2026-06-30", 10),
      price("601398", "2026-07-01", 10),
    ];
    const reversedDividend = dailyAttribution(
      [
        ...base,
        entry("reverse-dividend", "adjustment", "2026-07-01", {
          reversesEntryId: "dividend",
          recordedAt: "2026-07-02T01:00:00Z",
        }),
      ],
      prices,
      "2026-07-02",
    ).find((day) => day.date === "2026-07-01")!;
    expect(reversedDividend.capitalBase).toBe(1_100);

    const correctedBuy = dailyAttribution(
      [
        ...base,
        entry("reverse-buy", "adjustment", "2026-07-01", {
          reversesEntryId: "old-buy",
          recordedAt: "2026-07-02T01:00:00Z",
        }),
        entry("new-buy", "buy", "2026-07-01", {
          correctsEntryId: "old-buy",
          recordedAt: "2026-07-02T01:00:01Z",
          symbol: "601398",
          price: 10,
          quantity: 12,
          linkedGroupId: "reinvest-audit",
        }),
      ],
      prices,
      "2026-07-02",
    ).find((day) => day.date === "2026-07-01")!;
    expect(correctedBuy.capitalBase).toBe(1_020);
  });

  it("第二个月的本月归因只与本月收益相等，不冒充累计收益等式", () => {
    const entries = [
      entry("buy", "buy", "2026-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ];
    const view = buildIncomeCalendar(
      entries,
      [
        price("601398", "2026-01-02", 5),
        price("601398", "2026-01-30", 6),
        price("601398", "2026-02-27", 7),
      ],
      stocks,
      { month: "2026-02", scope: "all" },
      [],
      {
        factAsOfDate: "2026-02-28",
        valuationCutoff: "2026-02-27",
      },
    );
    expect(view.metrics.month.amount).toBe(100);
    expect(view.metrics.marketPrice.amount).toBe(100);
    expect(view.metrics.dividend.amount).toBe(0);
    expect(view.metrics.tradingCost.amount).toBe(0);
    expect(view.metrics.cumulative.amount).toBe(200);
  });

  it("单标的区间表现按自身首次敞口判断，不把十天收益标成一年收益", () => {
    const entries = [
      entry("old-buy", "buy", "2025-07-28", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("new-etf-buy", "buy", "2026-07-18", {
        symbol: "510300",
        instrumentName: "沪深300ETF",
        securityType: "etf",
        price: 4,
        quantity: 100,
      }),
    ];
    const overview = buildPositionsOverview(
      entries,
      [
        price("601398", "2025-07-28", 5),
        price("601398", "2026-07-18", 5.8),
        price("601398", "2026-07-28", 6),
        price("510300", "2026-07-18", 4),
        price("510300", "2026-07-28", 4.2),
      ],
      stocks,
      {
        factAsOfDate: "2026-07-28",
        valuationCutoff: "2026-07-28",
      },
    );
    const oldStock = overview.positions.find(
      (position) => position.symbol === "601398",
    )!;
    const newEtf = overview.positions.find(
      (position) => position.symbol === "510300",
    )!;
    expect(overview.portfolioPerformance.year).not.toBeNull();
    expect(oldStock.periodPerformance.year).not.toBeNull();
    expect(newEtf.periodPerformance.week).not.toBeNull();
    expect(newEtf.periodPerformance.month).toBeNull();
    expect(newEtf.periodPerformance.year).toBeNull();
  });

  it("XIRR 返回不可计算的真实原因", () => {
    const shortSample = buildPositionsOverview(
      [
        entry("buy", "buy", "2026-07-01", {
          symbol: "601398",
          price: 5,
          quantity: 100,
        }),
      ],
      [
        price("601398", "2026-07-01", 5),
        price("601398", "2026-07-20", 5.2),
      ],
      stocks,
      {
        factAsOfDate: "2026-07-20",
        valuationCutoff: "2026-07-20",
      },
    );
    expect(shortSample.metrics.xirr).toBeNull();
    expect(shortSample.metrics.xirrStatus).toBe("short_sample");

    const missingValuation = buildPositionsOverview(
      [
        entry("buy", "buy", "2026-01-02", {
          symbol: "601398",
          price: 5,
          quantity: 100,
        }),
      ],
      [],
      stocks,
      {
        factAsOfDate: "2026-07-20",
        valuationCutoff: "2026-07-18",
      },
    );
    expect(missingValuation.metrics.xirrStatus).toBe("missing_valuation");
  });

  it("已结束历史月份不会仅因距今天久而标记 stale", () => {
    const entries = [
      entry("buy", "buy", "2024-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ];
    const view = buildIncomeCalendar(
      entries,
      [
        {
          ...price("601398", "2024-01-02", 5),
          fetchedAt: "2024-02-01T00:00:00Z",
        },
        {
          ...price("601398", "2024-01-31", 5.2),
          fetchedAt: "2024-02-01T00:00:00Z",
        },
      ],
      stocks,
      { month: "2024-01", scope: "all" },
      [],
      {
        factAsOfDate: "2024-01-31",
        valuationCutoff: "2024-01-31",
      },
    );
    expect(view.quality.status).toBe("ready");
  });

  it("历史重述会把修正后的成交价投影回原买入日收益归因", () => {
    const entries = [
      entry("old", "buy", "2024-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("adjustment", "adjustment", "2024-01-02", {
        recordedAt: "2026-07-20T01:00:00Z",
        correctedAt: "2026-07-20T01:00:00Z",
        reversesEntryId: "old",
      }),
      entry("replacement", "buy", "2024-01-02", {
        recordedAt: "2026-07-20T01:00:01Z",
        correctedAt: "2026-07-20T01:00:00Z",
        correctsEntryId: "old",
        symbol: "601398",
        price: 4,
        quantity: 100,
      }),
    ];
    const view = buildIncomeCalendar(
      entries,
      [
        price("601398", "2024-01-01", 4),
        price("601398", "2024-01-02", 5),
      ],
      stocks,
      { month: "2024-01", scope: "all" },
      [],
      {
        factAsOfDate: "2024-01-31",
        valuationCutoff: "2024-01-31",
      },
    );
    expect(
      view.days.find((day) => day.date === "2024-01-02")?.tradingCostPnl,
    ).toBe(100);
  });

  it("流水统计使用买入支出、卖出净收入、分红与净投入", () => {
    const result = queryLedgerRecords(
      [
        entry("buy", "buy", "2026-07-01", {
          symbol: "601398",
          price: 5,
          quantity: 100,
          fee: 5,
        }),
        entry("sell", "sell", "2026-07-02", {
          symbol: "601398",
          price: 6,
          quantity: 40,
          fee: 2,
        }),
        entry("dividend", "dividend", "2026-07-03", {
          symbol: "601398",
          amount: 20,
        }),
      ],
      stocks,
      { page: 1, pageSize: 20 },
    );
    expect(result.metrics).toEqual({
      recordCount: 3,
      effectiveCount: 3,
      reversedCount: 0,
      cumulativeBuySpend: 505,
      cumulativeSellNetIncome: 238,
      cumulativeDividend: 20,
      netInvestment: 247,
    });
  });

  it("证券目录优先，否则使用最新录入的有效名称和资产类型", () => {
    const older = entry("older", "buy", "2026-07-10", {
      symbol: "510300",
      instrumentName: "旧名称",
      securityType: "stock",
      price: 4,
      quantity: 100,
      recordedAt: "2026-07-20T01:00:00Z",
    });
    const newer = entry("newer", "buy", "2026-07-01", {
      symbol: "510300",
      instrumentName: "沪深300ETF（用户确认）",
      securityType: "etf",
      price: 4,
      quantity: 100,
      recordedAt: "2026-07-21T01:00:00Z",
    });
    const withoutDirectory = queryLedgerRecords(
      [older, newer],
      [],
      { page: 1, pageSize: 20 },
      null,
    );
    expect(withoutDirectory.rows[0]).toMatchObject({
      name: "沪深300ETF（用户确认）",
      securityType: "etf",
    });

    const withDirectory = queryLedgerRecords(
      [older, newer],
      [{ symbol: "510300", name: "沪深300ETF" }],
      { page: 1, pageSize: 20 },
      null,
    );
    expect(withDirectory.rows[0].name).toBe("沪深300ETF");
  });

  it("分红并再投入只展示业务关联，不暴露内部关联分组编号", () => {
    const rows = queryLedgerRecords(
      [
        entry("dividend-linked", "dividend", "2026-07-10", {
          symbol: "601398",
          amount: 300,
          linkedGroupId: "internal-uuid",
        }),
        entry("buy-linked", "buy", "2026-07-13", {
          symbol: "601398",
          price: 5,
          quantity: 60,
          linkedGroupId: "internal-uuid",
        }),
      ],
      stocks,
      { page: 1, pageSize: 20 },
    ).rows;
    expect(rows[0]).toMatchObject({
      linkedOperation: "dividend_reinvestment",
      linkedRecords: [
        {
          id: "dividend-linked",
          type: "dividend",
          businessDate: "2026-07-10",
        },
      ],
    });
    expect("linkedGroupId" in rows[0]).toBe(false);
  });
});
