import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BacktestRequest, LedgerEntry } from "../../shared/contracts";
import {
  simulateBacktest,
  simulateBacktestDetail,
  simulateBacktestSimple,
} from "./analysis";
import { xirr } from "./finance";
import { rebuildAccount } from "./ledger";

const request: BacktestRequest = {
  symbols: ["601398"],
  startDate: "2024-01-01",
  endDate: "2024-03-01",
  monthlyAmount: 1_000,
  buyDay: 1,
};

describe("simulateBacktest", () => {
  it("允许零碎股，并把现金分红全额回购原标的", () => {
    const result = simulateBacktest(
      request,
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 9 },
        { date: "2024-01-03", close: 9.2 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-02-02", close: 10 },
        { date: "2024-03-01", close: 8 },
      ],
      [
        {
          date: "2024-02-02",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );

    expect(result.actualStartDate).toBe("2024-01-02");
    const buys = result.transactions.filter(
      (row) => row.type === "buy" || row.type === "dividend_reinvest",
    );
    expect(buys.some((row) => !Number.isInteger(row.quantity))).toBe(true);
    expect(
      result.transactions.filter((row) => row.type === "dividend_reinvest"),
    ).toHaveLength(1);
    expect(result.metrics.totalContribution).toBe(3_000);
    expect(result.metrics.totalDividend).toBeCloseTo(111.11, 2);
    expect(result.metrics.endingCash).toBe(0);
    expect(result.metrics.endingAsset).toBeCloseTo(2_777.78, 2);
  });

  it("送股和转增按每 10 股比例在除权日增加持股", () => {
    const result = simulateBacktest(
      {
        ...request,
        startDate: "2024-01-01",
        endDate: "2024-02-01",
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 0,
          transferRatio: 1,
          bonusRatio: 1,
          status: "实施",
        },
      ],
      [],
    );
    const adjustment = result.transactions.find(
      (row) => row.type === "share_adjustment",
    );
    expect(adjustment?.quantity).toBe(20);
    expect(adjustment?.shareRatio).toBe(2);
    const totalShares = result.transactions
      .filter((row) => row.type === "buy" || row.type === "share_adjustment")
      .reduce((sum, row) => sum + row.quantity, 0);
    expect(totalShares).toBe(220);
  });
});

describe("finance and ledger", () => {
  it("可计算不规则日期现金流的年化收益率", () => {
    const value = xirr([
      { date: "2023-01-01", amount: -1_000 },
      { date: "2024-01-01", amount: 1_100 },
    ]);
    expect(value).not.toBeNull();
    expect(value!).toBeCloseTo(0.1, 3);
  });

  it("从有效流水重建现金、持仓和逆回购资产", () => {
    const base = {
      recordedAt: "2024-01-01T00:00:00Z",
      currency: "CNY" as const,
      source: "user" as const,
    };
    const entries: LedgerEntry[] = [
      {
        ...base,
        id: "in",
        type: "transfer_in",
        businessDate: "2024-01-01",
        amount: 10_000,
      },
      {
        ...base,
        id: "buy",
        type: "buy",
        businessDate: "2024-01-02",
        symbol: "601398",
        price: 10,
        quantity: 100,
        fee: 5,
      },
      {
        ...base,
        id: "dividend",
        type: "dividend",
        businessDate: "2024-02-01",
        symbol: "601398",
        amount: 100,
      },
      {
        ...base,
        id: "repo",
        type: "reverse_repo",
        businessDate: "2024-02-02",
        amount: 1_000,
        maturityAmount: 1_010,
        maturityDate: "2024-12-31",
      },
    ];
    const result = rebuildAccount(entries, { "601398": 12 }, "2024-03-01");
    expect(result.availableCash).toBe(8_095);
    expect(result.reverseRepoAsset).toBe(1_010);
    expect(result.marketValue).toBe(1_200);
    expect(result.totalAsset).toBe(10_305);
    expect(result.positions[0].quantity).toBe(100);
  });

  it("冲正通过追加记录排除原流水", () => {
    const entries: LedgerEntry[] = [
      {
        id: "in",
        type: "transfer_in",
        businessDate: "2024-01-01",
        recordedAt: "2024-01-01T00:00:00Z",
        currency: "CNY",
        source: "user",
        amount: 1_000,
      },
      {
        id: "reverse",
        type: "adjustment",
        businessDate: "2024-01-02",
        recordedAt: "2024-01-02T00:00:00Z",
        currency: "CNY",
        source: "user",
        reversesEntryId: "in",
      },
    ];
    expect(rebuildAccount(entries, {}, "2024-01-02").availableCash).toBe(0);
  });
});

// P0-2：最大回撤基于标的总收益净值（nav），而非每日账户总资产。
// 外部每月投入会不断抬高总资产序列，掩盖真实跌幅；nav 剔除外部现金流。
describe("P0-2 最大回撤口径（基于 nav）", () => {
  it("nav 剔除外部投入，回撤反映标的真实跌幅", () => {
    // 价格序列：10 → 11 → 9，分红 1 元在 2024-02-01（除权日）
    // nav：1 → 1.1 → 1.1*(9+1)/11 = 1.0
    // 最大回撤 = 1.0/1.1 - 1 ≈ -0.0909
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-01-03", close: 11 },
        { date: "2024-02-01", close: 9 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );
    expect(result.equityCurve[0].nav).toBe(1);
    expect(result.equityCurve[1].nav).toBeCloseTo(1.1, 6);
    expect(result.equityCurve[2].nav).toBeCloseTo(1.0, 6);
    // 最大回撤基于 nav：1.0/1.1 - 1
    expect(result.metrics.maxDrawdown).toBeCloseTo(1.0 / 1.1 - 1, 4);
  });

  it("外部投入抬高总资产但不影响 nav 与回撤", () => {
    // 即使每月投入 100 万，nav 仍由价格+分红决定，回撤不被外部现金掩盖
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 1_000_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-01-03", close: 11 },
        { date: "2024-02-01", close: 9 },
      ],
      [],
      [],
    );
    // nav 累乘：1 * (11/10) * (9/11) = 0.9；最大回撤 = 0.9/1.1 - 1
    expect(result.equityCurve[2].nav).toBeCloseTo(0.9, 6);
    expect(result.metrics.maxDrawdown).toBeCloseTo(0.9 / 1.1 - 1, 4);
  });
});

// P1-1：当月计划买入日早于回测开始日期时，跳过本月，下月再投入。
describe("P1-1 起始月份处理", () => {
  it("当月计划日早于开始日则跳过本月", () => {
    // startDate=2024-01-15, buyDay=1 → 2024-01-01 已过去 → 第一次投入在 2 月
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-15",
        endDate: "2024-03-15",
        monthlyAmount: 2_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-16", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [],
      [],
    );
    // 1 月不投入，2 月和 3 月各投入一次
    expect(result.metrics.totalContribution).toBe(4_000);
    const buyDates = result.transactions
      .filter((row) => row.type === "buy")
      .map((row) => row.date);
    expect(buyDates).toEqual(["2024-02-01", "2024-03-01"]);
  });

  it("当月计划日等于开始日则在当月投入", () => {
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [],
      [],
    );
    expect(result.metrics.totalContribution).toBe(3_000);
  });
});

// P1-2：非交易日跨月顺延到下一个交易日，而非跳过本月。
describe("P1-2 非交易日跨月顺延", () => {
  it("月末无交易日时顺延到下月第一个交易日", () => {
    // buyDay=28，1 月 28 日无交易日（提供 1/15、2/5、3/1）
    // 1 月计划日 2024-01-28 无匹配 → 顺延到 2024-02-05
    // 2 月已被 1 月顺延占用 → 跳过（避免双倍）
    // 3 月计划日 2024-03-28 无匹配 → 无后续交易日 → warning
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-03-15",
        monthlyAmount: 2_000,
        buyDay: 28,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-15", close: 10 },
        { date: "2024-02-05", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [],
      [],
    );
    // 仅 2024-02-05 投入一次（1 月顺延占用，2 月跳过，3 月无后续）
    expect(result.metrics.totalContribution).toBe(2_000);
    const buyDates = result.transactions
      .filter((row) => row.type === "buy")
      .map((row) => row.date);
    expect(buyDates).toEqual(["2024-02-05"]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("R1 分红回购", () => {
  it("再小的现金分红也能买入零碎股，分红不会长期留在期末现金", () => {
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 0.1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );
    const reinvest = result.transactions.find(
      (row) => row.type === "dividend_reinvest",
    );
    expect(result.metrics.totalDividend).toBe(10);
    expect(reinvest?.amount).toBe(10);
    expect(reinvest?.quantity).toBe(1);
    expect(result.metrics.endingCash).toBe(0);
  });

  it("同日定投不参与此前登记日对应的分红资格", () => {
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );
    expect(result.metrics.totalDividend).toBe(100);
  });
});

// P0-3：产品域接收研究端验收数据作为口径基准 fixture。
// 本测试加载 tests/fixtures/research-verification.json（从 research 域复制的快照），
// 验证关键字段完整。完整逐笔一致性对比需要离线数据快照（R2 接入）。
describe("P0-3 研究端验收 fixture", () => {
  it("加载 research-verification.json 并核对银行股基准指标", () => {
    const fixturePath = join(
      __dirname,
      "..",
      "..",
      "tests",
      "fixtures",
      "research-verification.json",
    );
    const raw = readFileSync(fixturePath, "utf-8");
    const fixture = JSON.parse(raw) as {
      _meta: { source: string; caliber_version: string };
      status: string;
      checks: Array<{
        asset: string;
        symbol?: string;
        price_rows: number;
        dividend_events: number | string;
        total_return_xirr_pct: number;
      }>;
    };
    expect(fixture._meta.source).toContain("research/bank-dca");
    expect(fixture._meta.caliber_version).toBe("bank-dca-v1");
    expect(fixture.status).toBe("passed");
    const icbc = fixture.checks.find((row) => row.asset === "工商银行");
    expect(icbc).toBeDefined();
    expect(icbc!.symbol).toBe("601398");
    expect(icbc!.dividend_events).toBe(22);
    // 研究端工商银行 2020-01 至 2026-07 全收益 XIRR ≈ 17.24%
    expect(icbc!.total_return_xirr_pct).toBeCloseTo(17.24, 1);
  });

  it("产品端 nav 口径与研究端 build_total_return_history 一致", () => {
    // 研究端：daily_total_return = (close + cash_dividend_per_share) / prev_close - 1
    // 产品端 nav 构建逻辑完全对齐，确保 P0-3 口径可对比。
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-02",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-01-03", close: 11 },
        { date: "2024-02-01", close: 9 },
        { date: "2024-02-02", close: 9.5 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );
    // nav 序列：1, 11/10=1.1, 1.1*(9+1)/11=1.0, 1.0*9.5/9≈1.0556
    expect(result.equityCurve[0].nav).toBe(1);
    expect(result.equityCurve[1].nav).toBeCloseTo(1.1, 6);
    expect(result.equityCurve[2].nav).toBeCloseTo(1.0, 6);
    expect(result.equityCurve[3].nav).toBeCloseTo(1.0 * 9.5 / 9, 6);
  });
});

// 回测明细列表（同条件比较视图）：零碎股 + 分红再投资 + 后复权总收益口径。
describe("simulateBacktestDetail 回测明细列表", () => {
  it("零碎股月度买入 + 分红再投资，输出明细行与累计指标", () => {
    const result = simulateBacktestDetail(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );

    // 4 行明细：1 月买入 + 2 月分红再投资 + 2 月买入 + 3 月买入
    expect(result.rows).toHaveLength(4);

    // 1 月买入：1000/10=100 股
    expect(result.rows[0].event).toBe("monthly_buy");
    expect(result.rows[0].shares).toBe(100);
    expect(result.rows[0].cumulativeShares).toBe(100);
    expect(result.rows[0].cumulativeCost).toBe(1_000);
    expect(result.rows[0].price).toBe(10);
    expect(result.rows[0].marketValue).toBe(1_000);
    expect(result.rows[0].cumulativePnl).toBe(0);

    // 2 月分红再投资：100 股 * 1 元 = 100 元，100/10=10 股
    expect(result.rows[1].event).toBe("dividend_reinvest");
    expect(result.rows[1].shares).toBe(10);
    expect(result.rows[1].cumulativeShares).toBe(110);
    expect(result.rows[1].cumulativeCost).toBe(1_000); // 分红再投资不计入外部投入
    expect(result.rows[1].dividendAmount).toBe(100);
    expect(result.rows[1].dividendPerShare).toBe(1);
    expect(result.rows[1].marketValue).toBe(1_100);
    expect(result.rows[1].cumulativePnl).toBe(100);

    // 2 月买入：1000/10=100 股，累计 210
    expect(result.rows[2].event).toBe("monthly_buy");
    expect(result.rows[2].shares).toBe(100);
    expect(result.rows[2].cumulativeShares).toBe(210);
    expect(result.rows[2].cumulativeCost).toBe(2_000);

    // 3 月买入：累计 310
    expect(result.rows[3].cumulativeShares).toBe(310);
    expect(result.rows[3].cumulativeCost).toBe(3_000);

    // 期末指标
    expect(result.endingShares).toBe(310);
    expect(result.endingCost).toBe(3_000);
    expect(result.endingMarketValue).toBe(3_100);
    expect(result.endingPnl).toBe(100);
    expect(result.totalDividendShares).toBe(10);
    expect(result.totalDividendAmount).toBe(100);
    // 总收益率 = 3100/3000 - 1 ≈ 3.33%
    expect(result.totalReturn).toBeCloseTo(3_100 / 3_000 - 1, 6);
  });

  it("零碎股内部保留 6 位精度（价格非整除）", () => {
    const result = simulateBacktestDetail(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-01-02",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [{ date: "2024-01-02", close: 7.5 }],
      [],
    );
    expect(result.rows[0].shares).toBeCloseTo(133.333333, 6);
    expect(result.endingShares).toBeCloseTo(133.333333, 6);
  });

  it("分红日用除权前持仓计算，再投资按除权后价格买入", () => {
    // 除权前持仓 100 股 @10，每股分红 1 元，除权后价格 9 元
    // 分红金额 = 100 * 1 = 100 元，再投资买入 100/9 ≈ 11.11 股
    const result = simulateBacktestDetail(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 9 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );
    const divRow = result.rows.find((r) => r.event === "dividend_reinvest")!;
    expect(divRow.shares).toBeCloseTo(100 / 9, 6);
    expect(divRow.dividendAmount).toBe(100);
    expect(divRow.cumulativeShares).toBeCloseTo(100 + 100 / 9, 6);
    // 市值 = 111.11 * 9 ≈ 1000（分红再投资等价于后复权，市值连续）
    expect(divRow.marketValue).toBeCloseTo(1_000, 1);
  });

  it("起始月份跳过 + 非交易日跨月顺延（复用 P1-1/P1-2 逻辑）", () => {
    const result = simulateBacktestDetail(
      {
        symbols: ["601398"],
        startDate: "2024-01-15",
        endDate: "2024-03-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-16", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [],
    );
    // 1 月跳过（计划日 1 号 < 开始日 15 号），仅 2 月和 3 月买入
    expect(result.rows).toHaveLength(2);
    expect(result.endingCost).toBe(2_000);
    expect(result.rows[0].date).toBe("2024-02-01");
  });

  it("后复权总收益等价性：分红再投资后市值连续，收益率 = 期末市值/累计投入 - 1", () => {
    // 价格翻倍 + 分红再投资，验证总收益口径
    const result = simulateBacktestDetail(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 20 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 2,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );
    // 1 月：1000/10=100 股
    // 2 月除权：分红 100*2=200 元，除权后价 20 元，再投资 200/20=10 股 → 累计 110 股
    // 2 月买入：1000/20=50 股 → 累计 160 股
    // 期末市值 = 160 * 20 = 3200，累计投入 = 2000，收益率 = 60%
    expect(result.endingShares).toBe(160);
    expect(result.endingCost).toBe(2_000);
    expect(result.endingMarketValue).toBe(3_200);
    expect(result.totalReturn).toBeCloseTo(0.6, 6);
  });
});

// Drawer 审计明细直接复用主回测流水，不再维护第二套计算口径。
describe("simulateBacktestSimple R1 回测明细", () => {
  it("基础月度买入：3 个月无分红，仅生成 buy 行，费用统一为 0", () => {
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-03-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [],
    );

    // 仅 3 行 buy 事件
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row) => row.event === "buy")).toBe(true);

    // 1 月买入：期初现金=1000（投入），买入 100 股，期末现金=0
    const jan = result.rows[0];
    expect(jan.date).toBe("2024-01-02");
    expect(jan.openingCash).toBe(1_000);
    expect(jan.price).toBe(10);
    expect(jan.shares).toBe(100);
    expect(jan.cumulativeShares).toBe(100);
    expect(jan.externalContribution).toBe(1_000);
    expect(jan.cumulativeContribution).toBe(1_000);
    expect(jan.tradeAmount).toBe(1_000);
    expect(jan.cumulativeInvestment).toBe(1_000);
    expect(jan.cumulativeDividend).toBe(0);
    expect(jan.endingCash).toBe(0);
    // 盈亏率 = (10*100 + 0) / 1000 - 1 = 0
    expect(jan.returnRate).toBe(0);

    // 2 月买入：累计 200 股，累计投入 2000
    const feb = result.rows[1];
    expect(feb.openingCash).toBe(1_000);
    expect(feb.shares).toBe(100);
    expect(feb.cumulativeShares).toBe(200);
    expect(feb.cumulativeContribution).toBe(2_000);
    expect(feb.cumulativeInvestment).toBe(2_000);
    expect(feb.endingCash).toBe(0);

    // 3 月买入：累计 300 股，累计投入 3000
    const mar = result.rows[2];
    expect(mar.cumulativeShares).toBe(300);
    expect(mar.cumulativeContribution).toBe(3_000);
    expect(mar.cumulativeInvestment).toBe(3_000);

    // 期末指标
    expect(result.endingShares).toBe(300);
    expect(result.endingCost).toBe(3_000);
    expect(result.endingInvestment).toBe(3_000);
    expect(result.endingMarketValue).toBe(3_000);
    expect(result.endingCash).toBe(0);
    expect(result.totalDividendAmount).toBe(0);
    expect(result.returnRate).toBe(0);
  });

  it("contribution 与 buy 合并为一行，不单独产生 contribution 行", () => {
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-01-02",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [{ date: "2024-01-02", close: 10 }],
      [],
    );
    // 简化视图不存在 contribution 类型事件
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].event).toBe("buy");
    expect(result.rows[0].externalContribution).toBe(1_000);
    expect(result.rows[0].tradeAmount).toBe(1_000);
  });

  it("分红到账后先回购，再执行同日定投买入", () => {
    // 1 月买入 100 股 @10；2 月除权日：每股分红 5 元，价格除权至 5 元
    // 同日仍执行 2 月定投买入
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 5 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 5,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );

    // 4 行：1 月 buy + 2 月 dividend + dividend_reinvest + buy
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => row.event)).toEqual([
      "buy",
      "dividend",
      "dividend_reinvest",
      "buy",
    ]);

    // 1 月买入：100 股，累计投入 1000，期末现金 0
    const jan = result.rows[0];
    expect(jan.shares).toBe(100);
    expect(jan.cumulativeShares).toBe(100);
    expect(jan.cumulativeContribution).toBe(1_000);
    expect(jan.endingCash).toBe(0);

    // 2 月 dividend 行：分红 100*5=500 元到账。
    const div = result.rows[1];
    expect(div.openingCash).toBe(0);
    expect(div.price).toBe(5);
    expect(div.shares).toBe(0);
    expect(div.cumulativeShares).toBe(100);
    expect(div.cumulativeContribution).toBe(1_000);
    expect(div.dividendAmount).toBe(500);
    expect(div.cumulativeDividend).toBe(500);
    expect(div.endingCash).toBe(500);
    expect(div.dividendPerShare).toBe(5);
    expect(div.returnRate).toBe(0);

    const reinvest = result.rows[2];
    expect(reinvest.openingCash).toBe(500);
    expect(reinvest.shares).toBe(100);
    expect(reinvest.cumulativeShares).toBe(200);
    expect(reinvest.tradeAmount).toBe(500);
    expect(reinvest.cumulativeInvestment).toBe(1_500);
    expect(reinvest.cumulativeDividend).toBe(500);
    expect(reinvest.endingCash).toBe(0);

    // 2 月定投再买入 200 股。
    const feb = result.rows[3];
    expect(feb.openingCash).toBe(1_000);
    expect(feb.price).toBe(5);
    expect(feb.shares).toBe(200);
    expect(feb.cumulativeShares).toBe(400);
    expect(feb.cumulativeContribution).toBe(2_000);
    expect(feb.tradeAmount).toBe(1_000);
    expect(feb.cumulativeInvestment).toBe(2_500);
    expect(feb.cumulativeDividend).toBe(500);
    expect(feb.endingCash).toBe(0);
    expect(feb.returnRate).toBe(0);

    // 期末指标
    expect(result.endingShares).toBe(400);
    expect(result.endingCost).toBe(2_000);
    expect(result.endingInvestment).toBe(2_500);
    expect(result.endingMarketValue).toBe(2_000);
    expect(result.endingCash).toBe(0);
    expect(result.totalDividendAmount).toBe(500);
    expect(result.returnRate).toBe(0);
  });

  it("送股/转增行改变累计股数，但不增加买入金额", () => {
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 0,
          transferRatio: 1,
          bonusRatio: 1,
          status: "实施",
        },
      ],
    );
    const adjustment = result.rows.find(
      (row) => row.event === "share_adjustment",
    )!;
    expect(adjustment.shares).toBe(20);
    expect(adjustment.cumulativeShares).toBe(120);
    expect(adjustment.shareRatio).toBe(2);
    expect(adjustment.cumulativeInvestment).toBe(1_000);
    expect(result.endingShares).toBe(220);
    expect(result.endingInvestment).toBe(2_000);
  });

  it("零碎股内部保留 6 位精度（价格非整除）", () => {
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-01-02",
        monthlyAmount: 1_000,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [{ date: "2024-01-02", close: 7.5 }],
      [],
    );
    expect(result.rows[0].shares).toBeCloseTo(133.333333, 6);
    expect(result.rows[0].cumulativeShares).toBeCloseTo(133.333333, 6);
    expect(result.endingShares).toBeCloseTo(133.333333, 6);
  });

  it("起始月份跳过 + 非交易日跨月顺延（复用 P1-1/P1-2 逻辑）", () => {
    // startDate=2024-01-15, buyDay=1 → 2024-01-01 已过去 → 第一次投入在 2 月
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-15",
        endDate: "2024-03-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-16", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
      ],
      [],
    );
    // 1 月跳过，仅 2 月和 3 月买入
    expect(result.rows).toHaveLength(2);
    expect(result.endingCost).toBe(2_000);
    expect(result.rows[0].date).toBe("2024-02-01");
    expect(result.rows[1].date).toBe("2024-03-01");
  });

  it("期末盈亏率与最后一行 buy 的盈亏率一致（无后续价格变动）", () => {
    // 最后一个交易日即最后买入日，价格不再变化
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 20 },
      ],
      [],
    );
    // 1 月：1000/10=100 股
    // 2 月：1000/20=50 股 → 累计 150 股 @20 = 3000
    // 累计投入 = 2000，期末现金 = 0
    // 盈亏率 = 3000/2000 - 1 = 0.5
    const lastRow = result.rows.at(-1)!;
    expect(result.returnRate).toBe(lastRow.returnRate);
    expect(result.returnRate).toBeCloseTo(0.5, 6);
  });

  it("分红到账后自动回购，下一笔定投金额不被分红重复放大", () => {
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-01",
        monthlyAmount: 1_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );
    // 4 行：1 月 buy + 2 月 dividend + dividend_reinvest + buy
    expect(result.rows).toHaveLength(4);
    const div = result.rows.find((r) => r.event === "dividend")!;
    expect(div.dividendAmount).toBe(100);
    expect(div.endingCash).toBe(100);
    const reinvest = result.rows.find(
      (r) => r.event === "dividend_reinvest",
    )!;
    expect(reinvest.tradeAmount).toBe(100);
    expect(reinvest.shares).toBe(10);
    expect(reinvest.endingCash).toBe(0);
    const feb = result.rows.find(
      (r) => r.event === "buy" && r.date === "2024-02-01",
    )!;
    expect(feb.openingCash).toBe(1_000);
    expect(feb.shares).toBe(100);
    expect(feb.cumulativeShares).toBe(210);
    expect(feb.cumulativeInvestment).toBe(2_100);
    expect(feb.endingCash).toBe(0);
  });

  it("paymentDate 模式：在到账日分红并立即回购", () => {
    // 除权日 2024-02-01，paymentDate=2024-02-05
    // 2 月 5 日再产生 dividend 行
    // buyDay=10 避免除权日同日买入，便于独立验证 paymentDate 行
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-10",
        monthlyAmount: 1_000,
        buyDay: 10,
        dividendTiming: "payment_date",
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-10", close: 10 },
        { date: "2024-02-01", close: 9 },
        { date: "2024-02-05", close: 9 },
        { date: "2024-02-10", close: 9 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: "2024-02-05",
          perShare: 1,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );
    // 1 月 buy + 2 月 5 日 dividend/reinvest + 2 月 10 日 buy
    expect(result.rows.map((r) => r.event)).toEqual([
      "buy",
      "dividend",
      "dividend_reinvest",
      "buy",
    ]);
    const div = result.rows.find((r) => r.event === "dividend")!;
    expect(div.date).toBe("2024-02-05");
    expect(div.dividendAmount).toBe(100);
    const reinvest = result.rows.find(
      (r) => r.event === "dividend_reinvest",
    )!;
    expect(reinvest.date).toBe("2024-02-05");
    expect(reinvest.endingCash).toBe(0);
    const febBuy = result.rows.find(
      (r) => r.event === "buy" && r.date === "2024-02-10",
    )!;
    expect(febBuy.openingCash).toBe(1_000);
    expect(febBuy.endingCash).toBe(0);
  });

  it("多次分红均只回购一次，不重复计入后续定投资金", () => {
    // 工商银行 5 个月回测，2 月分红 0.3 元/股，4 月分红 0.4 元/股
    // 1 月买入 3000/10=300 股，2 月分红 300*0.3=90 元
    // 3 月买入 3000/10=300 股 → 累计 600 股
    // 4 月除权时累计 900 股（3 月买入后），4 月分红 900*0.4=360 元
    // 5 月买入 3000/10=300 股 → 累计 1200 股
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-05-15",
        monthlyAmount: 3_000,
        buyDay: 1,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-02-01", close: 10 },
        { date: "2024-03-01", close: 10 },
        { date: "2024-04-01", close: 10 },
        { date: "2024-05-01", close: 10 },
      ],
      [
        {
          date: "2024-02-01",
          recordDate: "2024-01-31",
          paymentDate: null,
          perShare: 0.3,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
        {
          date: "2024-04-01",
          recordDate: "2024-03-31",
          paymentDate: null,
          perShare: 0.4,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );

    const buys = result.rows.filter((r) => r.event === "buy");
    expect(buys).toHaveLength(5);
    // 每次定投期初现金都应为月度投入 3000（不含分红）
    for (const buy of buys) {
      expect(buy.openingCash).toBe(3_000);
    }
    for (const buy of buys) {
      expect(buy.endingCash).toBe(0);
    }
    expect(result.totalDividendAmount).toBeCloseTo(453.6, 2);
    expect(result.endingCash).toBe(0);
    expect(result.endingShares).toBeCloseTo(1_545.36, 6);
    expect(result.endingCost).toBe(15_000);
    expect(result.endingInvestment).toBeCloseTo(15_453.6, 2);
    expect(result.endingMarketValue).toBeCloseTo(15_453.6, 2);
  });

  it("不同分红金额与定投周期下期初现金始终为月度投入", () => {
    // 月度投入 5000，分红 2 元/股，验证期初现金始终为 5000
    const result = simulateBacktestSimple(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-03-31",
        monthlyAmount: 5_000,
        buyDay: 15,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-15", close: 8 },
        { date: "2024-02-15", close: 8 },
        { date: "2024-03-15", close: 8 },
      ],
      [
        {
          date: "2024-02-15",
          recordDate: "2024-02-14",
          paymentDate: null,
          perShare: 2,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
    );
    const buys = result.rows.filter((r) => r.event === "buy");
    expect(buys).toHaveLength(3);
    // 1 月买入 5000/8=625 股，2 月分红 625*2=1250 元
    // 所有 buy 期初现金 = 5000（月度投入）
    expect(buys[0].openingCash).toBe(5_000);
    expect(buys[1].openingCash).toBe(5_000);
    expect(buys[2].openingCash).toBe(5_000);
    expect(buys[0].endingCash).toBe(0);
    expect(buys[1].endingCash).toBe(0);
    expect(buys[2].endingCash).toBe(0);
    expect(result.totalDividendAmount).toBe(1_250);
    expect(result.endingInvestment).toBe(16_250);
  });
});
