import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  EntryType,
  LedgerEntry,
  StockInfo,
  StoredMarketCoverage,
  StoredMarketPrice,
} from "../../shared/contracts";
import {
  buildDailyAttribution,
  mergeImpairments,
  rowsBySymbol,
  type CoverageImpairment,
} from "./dailyAttribution";
import { buildIncomeCalendar } from "./incomeCalendar";
import { queryLedgerRecords } from "./ledgerQuery";
import { activeLedgerEntries } from "./ledgerReducer";
import { buildPositionsOverview } from "./positionsView";

const stocks: StockInfo[] = [
  { symbol: "601398", name: "工商银行", securityType: "stock" },
  { symbol: "510300", name: "沪深300ETF", securityType: "etf" },
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
    ...(type === "adjustment" ? {} : { securityType: "stock" as const }),
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
  // 视图构建依赖"当前市场日"（currentMarketDate）判断 stale 与当前月份；
  // 注入固定日期使断言不受真实时钟漂移影响（2026-07 被视为当前月）。
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T08:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("收盘前录入独立分红时保留账本累计值，但正式估值、XIRR 和收益进入 partial", () => {
    const entries = [
      entry("buy", "buy", "2026-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("dividend-today", "dividend", "2026-07-28", {
        symbol: "601398",
        amount: 100,
      }),
    ];
    const prices = [
      price("601398", "2026-01-02", 5),
      price("601398", "2026-07-27", 6),
    ];
    const boundary = {
      factAsOfDate: "2026-07-28",
      valuationCutoff: "2026-07-27",
    };
    const overview = buildPositionsOverview(
      entries,
      prices,
      stocks,
      boundary,
    );

    expect(overview.metrics).toMatchObject({
      cumulativeBuySpend: 500,
      cumulativeDividend: 100,
      netInvestment: 400,
      marketValue: null,
      totalReturn: null,
      xirr: null,
      xirrStatus: "missing_valuation",
    });
    expect(overview.positions[0]).toMatchObject({
      cumulativeDividend: 100,
      netInvestment: 400,
      marketValue: null,
      totalReturn: null,
      xirr: null,
      xirrStatus: "missing_valuation",
    });
    expect(Object.values(overview.portfolioPerformance)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(overview.quality.status).toBe("partial");
    expect(overview.quality.issues.join("；")).toContain(
      "存在估值截止日后的投资事实",
    );

    const calendar = buildIncomeCalendar(
      entries,
      prices,
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      boundary,
    );
    expect(
      calendar.days.find((day) => day.date === "2026-07-28"),
    ).toMatchObject({
      dividendPnl: 100,
      totalPnl: null,
      returnRate: null,
      isPartial: true,
    });
    expect(calendar.metrics.month).toEqual({ amount: null, rate: null });
    expect(calendar.quality.status).toBe("partial");
    expect(calendar.quality.issues.join("；")).toContain(
      "存在估值截止日后的投资事实",
    );
  });

  it("收盘前录入分红时保留账本累计值，但正式估值与 XIRR 暂不可计算", () => {
    const overview = buildPositionsOverview(
      [
        entry("buy", "buy", "2026-01-02", {
          symbol: "601398",
          price: 5,
          quantity: 100,
        }),
        entry("dividend-today", "dividend", "2026-07-28", {
          symbol: "601398",
          amount: 100,
        }),
      ],
      [
        price("601398", "2026-01-02", 5),
        price("601398", "2026-07-27", 6),
      ],
      stocks,
      {
        factAsOfDate: "2026-07-28",
        valuationCutoff: "2026-07-27",
      },
    );

    expect(overview.metrics).toMatchObject({
      cumulativeDividend: 100,
      netInvestment: 400,
      marketValue: null,
      totalReturn: null,
      xirr: null,
      xirrStatus: "missing_valuation",
    });
    expect(overview.quality.status).toBe("partial");
  });

  it("周末录入分红且估值截止为上周五时不生成周末正式收益", () => {
    const entries = [
      entry("buy", "buy", "2026-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("weekend-dividend", "dividend", "2026-07-26", {
        symbol: "601398",
        amount: 80,
      }),
    ];
    const prices = [
      price("601398", "2026-01-02", 5),
      price("601398", "2026-07-24", 6),
    ];
    const boundary = {
      factAsOfDate: "2026-07-26",
      valuationCutoff: "2026-07-24",
    };
    const overview = buildPositionsOverview(
      entries,
      prices,
      stocks,
      boundary,
    );
    const calendar = buildIncomeCalendar(
      entries,
      prices,
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      boundary,
    );

    expect(overview.metrics.cumulativeDividend).toBe(80);
    expect(overview.metrics.marketValue).toBeNull();
    expect(overview.metrics.xirr).toBeNull();
    expect(overview.quality.status).toBe("partial");
    expect(
      calendar.days.find((day) => day.date === "2026-07-26"),
    ).toMatchObject({
      dividendPnl: 80,
      totalPnl: null,
      isPartial: true,
    });
  });

  it("分红日期等于估值截止日时正常进入正式估值和收益", () => {
    const entries = [
      entry("buy", "buy", "2026-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("dividend-at-cutoff", "dividend", "2026-07-27", {
        symbol: "601398",
        amount: 100,
      }),
    ];
    const prices = [
      price("601398", "2026-01-02", 5),
      price("601398", "2026-07-27", 6),
    ];
    const boundary = {
      factAsOfDate: "2026-07-27",
      valuationCutoff: "2026-07-27",
    };
    const overview = buildPositionsOverview(
      entries,
      prices,
      stocks,
      boundary,
    );
    const calendar = buildIncomeCalendar(
      entries,
      prices,
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      boundary,
    );

    expect(overview.metrics).toMatchObject({
      cumulativeDividend: 100,
      marketValue: 600,
      totalReturn: 200,
    });
    expect(overview.metrics.xirr).not.toBeNull();
    expect(overview.quality.status).toBe("ready");
    expect(
      calendar.days.find((day) => day.date === "2026-07-27"),
    ).toMatchObject({
      dividendPnl: 100,
      totalPnl: 200,
      isPartial: false,
    });
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

  it("同日分红后买入全部计入外部资本基数", () => {
    const entries = [
      entry("opening", "buy", "2026-06-30", {
        symbol: "601398",
        price: 10,
        quantity: 100,
      }),
      entry("dividend", "dividend", "2026-07-01", {
        symbol: "601398",
        amount: 100,
      }),
      entry("reinvest", "buy", "2026-07-01", {
        symbol: "601398",
        price: 10,
        quantity: 10,
        originDividendEntryId: "dividend",
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
    expect(day.returnRate).toBeCloseTo(100 / 1_100, 12);
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
      [{ symbol: "510300", name: "沪深300ETF", securityType: "etf" }],
      { page: 1, pageSize: 20 },
      null,
    );
    expect(withDirectory.rows[0].name).toBe("沪深300ETF");
  });
});

describe("覆盖损伤合并", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T08:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mergeImpairments 合并同一证券两条不相邻 partial 覆盖的日期、区间与描述", () => {
    const impairments: CoverageImpairment[] = [
      {
        symbol: "601398",
        impairedDates: new Set(["2025-03-15"]),
        impairedRanges: [],
        descriptions: ["2025-03-15 行情缺失"],
      },
      {
        symbol: "601398",
        impairedDates: new Set(["2026-07-15"]),
        impairedRanges: [],
        descriptions: ["2026-07-15 行情缺失"],
      },
    ];
    const merged = mergeImpairments(impairments);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.symbol).toBe("601398");
    expect(merged[0]!.impairedDates).toEqual(
      new Set(["2025-03-15", "2026-07-15"]),
    );
    expect(merged[0]!.descriptions).toEqual([
      "2025-03-15 行情缺失",
      "2026-07-15 行情缺失",
    ]);
  });

  it("mergeImpairments 去重相同描述", () => {
    const impairments: CoverageImpairment[] = [
      {
        symbol: "601398",
        impairedDates: new Set(["2025-03-15"]),
        impairedRanges: [{ from: "2025-03-01", through: "2025-03-31" }],
        descriptions: ["区间内存在非法 OHLCV"],
      },
      {
        symbol: "601398",
        impairedDates: new Set(["2026-07-15"]),
        impairedRanges: [{ from: "2026-07-01", through: "2026-07-31" }],
        descriptions: ["区间内存在非法 OHLCV"],
      },
    ];
    const merged = mergeImpairments(impairments);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.impairedDates).toEqual(
      new Set(["2025-03-15", "2026-07-15"]),
    );
    expect(merged[0]!.impairedRanges).toEqual([
      { from: "2025-03-01", through: "2025-03-31" },
      { from: "2026-07-01", through: "2026-07-31" },
    ]);
    // 相同描述只保留一条
    expect(merged[0]!.descriptions).toEqual(["区间内存在非法 OHLCV"]);
  });

  it("同一证券两个不相邻 partial 覆盖在收益日历中全部生效", () => {
    const entries = [
      entry("buy", "buy", "2025-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ];
    const prices = [
      price("601398", "2025-01-02", 5),
      price("601398", "2025-03-14", 5.1),
      price("601398", "2025-03-16", 5.2),
      price("601398", "2026-07-14", 6),
      price("601398", "2026-07-16", 6.1),
      price("601398", "2026-07-31", 6.2),
    ];
    const coverage: StoredMarketCoverage[] = [
      {
        coverageId: 1,
        symbol: "601398",
        requestedFrom: "2025-03-01",
        requestedThrough: "2025-03-31",
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2025-04-01T08:00:00Z",
        dataCutoff: "2025-03-31",
        adjustment: "none",
        resultStatus: "partial",
        issues: [
          {
            date: "2025-03-15",
            type: "gap",
            severity: "error",
            message: "行情缺失",
          },
        ],
      },
      {
        coverageId: 2,
        symbol: "601398",
        requestedFrom: "2026-07-01",
        requestedThrough: "2026-07-31",
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2026-08-01T08:00:00Z",
        dataCutoff: "2026-07-31",
        adjustment: "none",
        resultStatus: "partial",
        issues: [
          {
            date: "2026-07-15",
            type: "gap",
            severity: "error",
            message: "行情缺失",
          },
        ],
      },
    ];
    const boundary = {
      factAsOfDate: "2026-07-31",
      valuationCutoff: "2026-07-31",
    };
    const view = buildIncomeCalendar(
      entries,
      prices,
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      boundary,
      coverage,
    );

    // 两条损伤都应进入质量说明
    const issuesText = view.quality.issues.join("；");
    expect(issuesText).toContain("2025-03-15");
    expect(issuesText).toContain("2026-07-15");

    // 本月收益因 2026-07-15 受损而不可计算
    expect(view.metrics.month.amount).toBeNull();
    expect(view.metrics.month.rate).toBeNull();

    // 年内收益因 2026-07-15 受损而不可计算
    expect(view.metrics.yearToDate.amount).toBeNull();
    expect(view.metrics.yearToDate.rate).toBeNull();

    // 累计收益因 2025-03-15 受损而不可计算（历史 partial 也影响累计）
    expect(view.metrics.cumulative.amount).toBeNull();
    expect(view.metrics.cumulative.rate).toBeNull();

    // 2026-07-15 在日历中标记为 partial
    const impairedJulyDay = view.days.find(
      (day) => day.date === "2026-07-15",
    );
    expect(impairedJulyDay).toMatchObject({
      isPartial: true,
      totalPnl: null,
      returnRate: null,
    });

    expect(view.quality.status).toBe("partial");
  });

  it("历史 partial 不影响本月和年内收益，但影响累计收益", () => {
    const entries = [
      entry("buy", "buy", "2025-01-02", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ];
    const prices = [
      price("601398", "2025-01-02", 5),
      price("601398", "2025-03-14", 5.1),
      price("601398", "2025-03-16", 5.2),
      // 2026-07 行情完整
      price("601398", "2026-07-10", 6),
      price("601398", "2026-07-31", 6.2),
    ];
    const coverage: StoredMarketCoverage[] = [
      {
        coverageId: 1,
        symbol: "601398",
        requestedFrom: "2025-03-01",
        requestedThrough: "2025-03-31",
        source: "tencent",
        primarySource: "tencent",
        fallbackUsed: false,
        fetchedAt: "2025-04-01T08:00:00Z",
        dataCutoff: "2025-03-31",
        adjustment: "none",
        resultStatus: "partial",
        issues: [
          {
            date: "2025-03-15",
            type: "gap",
            severity: "error",
            message: "行情缺失",
          },
        ],
      },
    ];
    const boundary = {
      factAsOfDate: "2026-07-31",
      valuationCutoff: "2026-07-31",
    };
    const view = buildIncomeCalendar(
      entries,
      prices,
      stocks,
      { month: "2026-07", scope: "all" },
      [],
      boundary,
      coverage,
    );

    // 本月和年内行情完整，收益可计算
    expect(view.metrics.month.amount).not.toBeNull();
    expect(view.metrics.yearToDate.amount).not.toBeNull();
    // 累计收益因 2025-03-15 受损而不可计算
    expect(view.metrics.cumulative.amount).toBeNull();
    expect(view.metrics.cumulative.rate).toBeNull();
    expect(view.quality.status).toBe("partial");
  });
});
