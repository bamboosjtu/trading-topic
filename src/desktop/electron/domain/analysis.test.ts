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
  it("顺延到月内交易日并始终按 100 股整数倍买入", () => {
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
    expect(
      result.transactions
        .filter((row) => row.type === "buy" || row.type === "dividend_reinvest")
        .every((row) => row.quantity % 100 === 0),
    ).toBe(true);
    expect(result.metrics.totalContribution).toBe(3_000);
    expect(result.metrics.totalDividend).toBe(100);
    expect(result.metrics.endingCash).toBe(385);
    expect(result.metrics.endingAsset).toBe(2_785);
  });

  it("遇到非现金公司行动时阻断计算", () => {
    expect(() =>
      simulateBacktest(
        request,
        "601398",
        "工商银行",
        [{ date: "2024-01-02", close: 9 }],
        [
          {
            date: "2024-01-02",
            recordDate: "2024-01-01",
            paymentDate: null,
            perShare: 0,
            transferRatio: 1,
            bonusRatio: 0,
            status: "实施",
          },
        ],
        [],
      ),
    ).toThrow(/不支持/);
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

// P1-4：分红日不应动用全部剩余现金，只使用分红池。剩余定投资金滚动至下一次计划投资日。
describe("P1-4 分红现金隔离", () => {
  it("分红再投资只用分红池，不动用定投剩余资金", () => {
    // 定投 2000，买 1 手 @10=1005，dcaCash 剩 995
    // 分红 100 股 * 10 元 = 1000，dividendCash=1000，不足 1 手（1005），不买
    // 旧逻辑：cash=995+1000=1995，凑够买 1 手，shares=200
    // 新逻辑：dividendCash=1000 不足 1 手，不买，shares=100，定投剩余 995 保留
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 2_000,
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
          perShare: 10,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );
    // 分红再投资未发生（dividendCash 不足 1 手，且不借用定投剩余）
    const reinvest = result.transactions.filter(
      (row) => row.type === "dividend_reinvest",
    );
    expect(reinvest).toHaveLength(0);
    expect(result.metrics.totalDividend).toBe(1_000);
    // shares 仍为定投买入的 100 股
    const buyTx = result.transactions.filter((row) => row.type === "buy");
    expect(buyTx.reduce((sum, row) => sum + row.quantity, 0)).toBe(100);
    // dcaCash=995 + dividendCash=1000 = 1995
    expect(result.metrics.endingCash).toBe(1_995);
    expect(result.metrics.endingAsset).toBe(100 * 10 + 1_995);
  });

  it("分红池足以买入时只使用分红池", () => {
    // 分红 100 股 * 20 元 = 2000，dividendCash=2000，可买 1 手（1005）
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-02-01",
        monthlyAmount: 2_000,
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
          perShare: 20,
          transferRatio: 0,
          bonusRatio: 0,
          status: "实施",
        },
      ],
      [],
    );
    const reinvest = result.transactions.filter(
      (row) => row.type === "dividend_reinvest",
    );
    expect(reinvest).toHaveLength(1);
    expect(reinvest[0].quantity).toBe(100);
    // 分红池 2000 - 1005 = 995；定投池 995；合计 1990
    expect(result.metrics.endingCash).toBe(1_990);
    expect(result.metrics.endingAsset).toBe(200 * 10 + 1_990);
  });
});

// P1-5：闲置现金参与国债逆回购，按实际日历天数计息。
describe("P1-5 逆回购计息", () => {
  it("repoRate=0 时不计息（默认行为，向后兼容）", () => {
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-01-03",
        monthlyAmount: 1_100,
        buyDay: 2,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-01-03", close: 10 },
      ],
      [],
      [],
    );
    expect(result.metrics.totalRepoInterest).toBe(0);
    // 无 repo_interest 交易
    expect(
      result.transactions.filter((row) => row.type === "repo_interest"),
    ).toHaveLength(0);
    // dcaCash=1100-1005=95
    expect(result.metrics.endingCash).toBe(95);
  });

  it("repoRate>0 时对闲置现金按日历日计息", () => {
    // 定投 1100，买 1 手 @10=1005，dcaCash 剩 95
    // repoRate=1.0（100%，放大以便测试可见），1 个日历日
    // 利息 = 95 * 1.0 * 1 / 365 ≈ 0.26
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-02",
        endDate: "2024-01-03",
        monthlyAmount: 1_100,
        buyDay: 2,
        repoRate: 1.0,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-02", close: 10 },
        { date: "2024-01-03", close: 10 },
      ],
      [],
      [],
    );
    const expectedInterest = Math.round((95 * 1.0 * 1) / 365 * 100) / 100;
    expect(result.metrics.totalRepoInterest).toBeCloseTo(expectedInterest, 2);
    expect(result.metrics.totalRepoInterest).toBeGreaterThan(0);
    // dcaCash = 95 + 利息
    expect(result.metrics.endingCash).toBeCloseTo(95 + expectedInterest, 2);
    // 产生 repo_interest 交易
    const repoTx = result.transactions.filter(
      (row) => row.type === "repo_interest",
    );
    expect(repoTx.length).toBeGreaterThanOrEqual(1);
    expect(result.equityCurve.at(-1)!.asset).toBeGreaterThan(100 * 10 + 95);
  });

  it("周末跨日历日按实际天数计息（周五→周一=3 天）", () => {
    // 2024-01-05 周五 → 2024-01-08 周一，日历日 3 天
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-05",
        endDate: "2024-01-08",
        monthlyAmount: 1_100,
        buyDay: 5,
        repoRate: 1.0,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-05", close: 10 },
        { date: "2024-01-08", close: 10 },
      ],
      [],
      [],
    );
    // dcaCash 剩 95，3 天利息 = 95 * 1.0 * 3 / 365 ≈ 0.78
    const expectedInterest = Math.round((95 * 1.0 * 3) / 365 * 100) / 100;
    expect(result.metrics.totalRepoInterest).toBeCloseTo(expectedInterest, 2);
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

  it("零碎股保留 2 位小数（价格非整除）", () => {
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
    // 1000 / 7.5 = 133.333... → 133.33
    expect(result.rows[0].shares).toBe(133.33);
    expect(result.endingShares).toBe(133.33);
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
    expect(divRow.shares).toBe(Math.round((100 / 9) * 100) / 100);
    expect(divRow.dividendAmount).toBe(100);
    // 分红再投资后累计股数 = 100 + 11.11 = 111.11
    expect(divRow.cumulativeShares).toBe(
      Math.round((100 + 100 / 9) * 100) / 100,
    );
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

// 简化交易成本回测（drawer 展示视图）：费用0 + contribution/buy 合并行 +
// 分红/除权独立行 + 零碎股 + 分红到账不再投资。
describe("simulateBacktestSimple 简化交易成本回测", () => {
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
    expect(jan.cumulativeCost).toBe(1_000);
    expect(jan.endingCash).toBe(0);
    // 盈亏率 = (10*100 + 0) / 1000 - 1 = 0
    expect(jan.returnRate).toBe(0);

    // 2 月买入：累计 200 股，累计投入 2000
    const feb = result.rows[1];
    expect(feb.openingCash).toBe(1_000);
    expect(feb.shares).toBe(100);
    expect(feb.cumulativeShares).toBe(200);
    expect(feb.cumulativeCost).toBe(2_000);
    expect(feb.endingCash).toBe(0);

    // 3 月买入：累计 300 股，累计投入 3000
    const mar = result.rows[2];
    expect(mar.cumulativeShares).toBe(300);
    expect(mar.cumulativeCost).toBe(3_000);

    // 期末指标
    expect(result.endingShares).toBe(300);
    expect(result.endingCost).toBe(3_000);
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
    // amount 字段即本期投入金额（合并展示）
    expect(result.rows[0].amount).toBe(1_000);
  });

  it("分红日生成 ex_right + dividend + buy 三行（同日按序），费用为 0", () => {
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

    // 4 行：1 月 buy + 2 月 ex_right + 2 月 dividend + 2 月 buy
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => row.event)).toEqual([
      "buy",
      "ex_right",
      "dividend",
      "buy",
    ]);

    // 1 月买入：100 股，累计投入 1000，期末现金 0
    const jan = result.rows[0];
    expect(jan.shares).toBe(100);
    expect(jan.cumulativeShares).toBe(100);
    expect(jan.cumulativeCost).toBe(1_000);
    expect(jan.endingCash).toBe(0);

    // 2 月 ex_right 行：信息行，不改股数/现金；记录除权前价格
    const ex = result.rows[1];
    expect(ex.openingCash).toBe(0);
    expect(ex.price).toBe(5);
    expect(ex.shares).toBe(0);
    expect(ex.cumulativeShares).toBe(100);
    expect(ex.cumulativeCost).toBe(1_000);
    expect(ex.endingCash).toBe(0);
    expect(ex.prevClose).toBe(10);
    expect(ex.dividendPerShare).toBe(5);
    // 盈亏率 = (5*100 + 0) / 1000 - 1 = -0.5
    expect(ex.returnRate).toBe(-0.5);

    // 2 月 dividend 行：分红 100*5=500 元到账，不再投资
    const div = result.rows[2];
    expect(div.openingCash).toBe(0);
    expect(div.price).toBe(5);
    expect(div.shares).toBe(0);
    expect(div.cumulativeShares).toBe(100);
    expect(div.cumulativeCost).toBe(1_000);
    expect(div.amount).toBe(500);
    expect(div.endingCash).toBe(500);
    expect(div.dividendPerShare).toBe(5);
    // 盈亏率 = (5*100 + 500) / 1000 - 1 = 0
    expect(div.returnRate).toBe(0);

    // 2 月 buy 行：期初现金 = 0（定投池）+ 1000（本期投入）= 1000
    //   （分红现金隔离，不混入定投期初现金）
    //   买入 1000/5=200 股，累计 300 股，期末现金 = 0（定投池）+ 500（分红池）= 500
    const feb = result.rows[3];
    expect(feb.openingCash).toBe(1_000);
    expect(feb.price).toBe(5);
    expect(feb.shares).toBe(200);
    expect(feb.cumulativeShares).toBe(300);
    expect(feb.cumulativeCost).toBe(2_000);
    expect(feb.amount).toBe(1_000);
    expect(feb.endingCash).toBe(500);
    // 盈亏率 = (5*300 + 500) / 2000 - 1 = 0
    expect(feb.returnRate).toBe(0);

    // 期末指标
    expect(result.endingShares).toBe(300);
    expect(result.endingCost).toBe(2_000);
    expect(result.endingMarketValue).toBe(1_500);
    expect(result.endingCash).toBe(500);
    expect(result.totalDividendAmount).toBe(500);
    expect(result.returnRate).toBe(0);
  });

  it("零碎股保留 2 位小数（价格非整除）", () => {
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
    // 1000 / 7.5 = 133.333... → 133.33
    expect(result.rows[0].shares).toBe(133.33);
    expect(result.rows[0].cumulativeShares).toBe(133.33);
    expect(result.endingShares).toBe(133.33);
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

  it("分红到账不再投资：分红现金隔离，不混入定投期初现金", () => {
    // 1 月买入 100 股 @10，2 月分红 100*1=100 元
    // 2 月买入期初现金 = 0（定投池）+ 1000（本期投入）= 1000（不含分红）
    // 2 月买入 1000/10=100 股，期末现金 = 0（定投池）+ 100（分红池）= 100
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
    // 4 行：1 月 buy + 2 月 ex_right + 2 月 dividend + 2 月 buy
    expect(result.rows).toHaveLength(4);
    const div = result.rows.find((r) => r.event === "dividend")!;
    expect(div.amount).toBe(100);
    expect(div.endingCash).toBe(100);
    const feb = result.rows.find(
      (r) => r.event === "buy" && r.date === "2024-02-01",
    )!;
    // 期初现金 = 0（定投池）+ 1000（本期投入）= 1000
    // （分红现金 100 隔离在 dividendCash 池，不混入定投期初现金）
    expect(feb.openingCash).toBe(1_000);
    expect(feb.shares).toBe(100);
    expect(feb.cumulativeShares).toBe(200);
    // 期末现金 = 0（定投池）+ 100（分红池）= 100
    expect(feb.endingCash).toBe(100);
  });

  it("paymentDate 模式：分红在到账日记入现金，除权日仅记录信息行", () => {
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
    // 1 月 buy + 2 月 ex_right + 2 月 5 日 dividend + 2 月 10 日 buy
    expect(result.rows.map((r) => r.event)).toEqual([
      "buy",
      "ex_right",
      "dividend",
      "buy",
    ]);
    const ex = result.rows.find((r) => r.event === "ex_right")!;
    expect(ex.date).toBe("2024-02-01");
    expect(ex.endingCash).toBe(0); // 除权日不改现金
    const div = result.rows.find((r) => r.event === "dividend")!;
    expect(div.date).toBe("2024-02-05");
    // 1 月买入 100 股，分红金额 = 100 * 1 = 100
    expect(div.amount).toBe(100);
    // 2 月 10 日 buy 的期初现金 = 0（定投池）+ 1000（本期投入）= 1000（不含分红）
    const febBuy = result.rows.find(
      (r) => r.event === "buy" && r.date === "2024-02-10",
    )!;
    expect(febBuy.openingCash).toBe(1_000);
    // 期末现金 = 0（定投池）+ 100（分红池）= 100
    expect(febBuy.endingCash).toBe(100);
  });

  // 专项回归：修复分红金额被错误重复计入后续每笔定投期初现金的 bug。
  // 旧实现将分红累加到单一 prevEndingCash 池，导致分红后每次定投的期初现金
  // = 月度投入 + 累积分红（如 3000 + 2148.11 = 5148.11），违反"分红到账不再
  // 投资"的口径。新实现将 dcaCash 与 dividendCash 隔离，buy 行期初现金仅含
  // dcaCash + 月度投入，分红现金仅累加到 dividendCash 并展示在期末现金中。
  it("分红后多次定投期初现金稳定为月度投入（修复重复计入 bug）", () => {
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
    // 1 月 buy：无分红，期末现金 = 0
    expect(buys[0].endingCash).toBe(0);
    // 2 月 buy：当日先除权+分红 90，再买入，期末现金 = 0 + 90 = 90
    expect(buys[1].endingCash).toBe(90);
    // 3 月 buy：期末现金 = 0 + 90 = 90
    expect(buys[2].endingCash).toBe(90);
    // 4 月 buy：当日先除权+分红 360（按 900 股计），再买入
    //   期末现金 = 0 + 90 + 360 = 450
    expect(buys[3].endingCash).toBe(450);
    // 5 月 buy：期末现金 = 0 + 450 = 450
    expect(buys[4].endingCash).toBe(450);

    // 累计分红 = 90 + 360 = 450
    expect(result.totalDividendAmount).toBe(450);
    expect(result.endingCash).toBe(450);
    // 期末累计股数 = 5 * 300 = 1500 股，市值 = 15000，累计投入 = 15000
    // 盈亏率 = (15000 + 450) / 15000 - 1 = 0.03
    expect(result.endingShares).toBe(1_500);
    expect(result.endingCost).toBe(15_000);
    expect(result.endingMarketValue).toBe(15_000);
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
    // 1 月期末现金 = 0
    expect(buys[0].endingCash).toBe(0);
    // 2 月期末现金 = 0 + 1250 = 1250
    expect(buys[1].endingCash).toBe(1_250);
    // 3 月期末现金 = 0 + 1250 = 1250
    expect(buys[2].endingCash).toBe(1_250);
    expect(result.totalDividendAmount).toBe(1_250);
  });
});
