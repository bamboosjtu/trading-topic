import { describe, expect, it } from "vitest";
import type {
  BacktestRequest,
  DividendEvent,
  PricePoint,
} from "../../shared/contracts";
import {
  assertBacktestRequest,
  backtestResultToSimpleResult,
  simulateBacktest,
} from "./analysis";
import { xirr } from "./finance";

/**
 * 测试辅助：直接驱动 production 实现 simulateBacktest + backtestResultToSimpleResult，
 * 不再依赖只属于测试的包装函数。AGENTS.md 要求“目标域测试必须驱动本域实现”。
 */
function runSimpleBacktest(
  input: BacktestRequest,
  symbol: string,
  name: string,
  priceRows: PricePoint[],
  dividendRows: DividendEvent[],
) {
  const prices = priceRows
    .filter((row) => row.date >= input.startDate && row.date <= input.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  return backtestResultToSimpleResult(
    simulateBacktest(input, symbol, name, prices, dividendRows, []),
  );
}

const request: BacktestRequest = {
  symbols: ["601398"],
  startDate: "2024-01-01",
  endDate: "2024-03-01",
  monthlyAmount: 1_000,
  buyDay: 1,
};

describe("simulateBacktest", () => {
  it("允许最多 10 个 A 股标的，并拒绝第 11 个", () => {
    const symbols = Array.from({ length: 10 }, (_, index) =>
      String(600000 + index),
    );
    expect(() =>
      simulateBacktest(
        { ...request, symbols },
        symbols[0],
        "测试股票",
        [{ date: "2024-01-02", close: 10 }],
        [],
        [],
      ),
    ).not.toThrow();
    expect(() =>
      simulateBacktest(
        { ...request, symbols: [...symbols, "600010"] },
        symbols[0],
        "测试股票",
        [{ date: "2024-01-02", close: 10 }],
        [],
        [],
      ),
    ).toThrow("R1 支持 1 至 10 个标的同条件并排");
  });

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
    expect(result.priceSeries).toEqual([
      { date: "2024-01-02", close: 9 },
      { date: "2024-01-03", close: 9.2 },
      { date: "2024-02-01", close: 10 },
      { date: "2024-02-02", close: 10 },
      { date: "2024-03-01", close: 8 },
    ]);
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

describe("finance", () => {
  it("可计算不规则日期现金流的年化收益率", () => {
    const value = xirr([
      { date: "2023-01-01", amount: -1_000 },
      { date: "2024-01-01", amount: 1_100 },
    ]);
    expect(value).not.toBeNull();
    expect(value!).toBeCloseTo(0.1, 3);
  });

});

// 最大回撤基于剔除后续投入影响的标的总收益净值（nav）。
// 外部每月投入会不断抬高总资产序列，掩盖真实跌幅；nav 剔除外部现金流。
describe("最大回撤口径（基于 nav）", () => {
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
describe("起始月份处理", () => {
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

describe("上市前月度计划处理", () => {
  it("不累计首个可用行情月份之前的计划，并从首个可用月份投入一次", () => {
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2021-01-01",
        endDate: "2024-03-31",
        monthlyAmount: 3_000,
        buyDay: 10,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-20", close: 10 },
        { date: "2024-02-15", close: 10 },
        { date: "2024-03-11", close: 10 },
      ],
      [],
      [],
    );

    expect(result.metrics.totalContribution).toBe(9_000);
    expect(
      result.transactions
        .filter((row) => row.type === "buy")
        .map((row) => row.date),
    ).toEqual(["2024-01-20", "2024-02-15", "2024-03-11"]);
  });
});

// P1-2：非交易日跨月顺延到下一个交易日，而非跳过本月。
describe("非交易日跨月顺延", () => {
  it("月末无交易日时顺延到下月且不占用下月投入", () => {
    // buyDay=28，1 月 28 日无交易日（提供 1/15、2/5、3/1）
    // 1 月计划日 2024-01-28 无匹配 → 顺延到 2024-02-05
    // 2 月计划日 2024-02-28 无匹配 → 独立顺延到 2024-03-01
    // 3 月计划日 2024-03-28 无后续交易日 → warning
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
    expect(result.metrics.totalContribution).toBe(4_000);
    const buyDates = result.transactions
      .filter((row) => row.type === "buy")
      .map((row) => row.date);
    expect(buyDates).toEqual(["2024-02-05", "2024-03-01"]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("两个月计划落在同一交易日时合并投入但不丢失月份", () => {
    const result = simulateBacktest(
      {
        symbols: ["601398"],
        startDate: "2024-01-01",
        endDate: "2024-02-20",
        monthlyAmount: 2_000,
        buyDay: 10,
      },
      "601398",
      "工商银行",
      [
        { date: "2024-01-05", close: 10 },
        { date: "2024-02-15", close: 10 },
      ],
      [],
      [],
    );

    expect(result.metrics.totalContribution).toBe(4_000);
    expect(
      result.transactions.find(
        (row) => row.type === "contribution" && row.date === "2024-02-15",
      )?.amount,
    ).toBe(4_000);
  });
});

describe("回测请求领域校验", () => {
  it("在领域入口拒绝重复标的", () => {
    expect(() =>
      simulateBacktest(
        {
          symbols: ["601398", "601398"],
          startDate: "2024-01-01",
          endDate: "2024-02-01",
          monthlyAmount: 1_000,
          buyDay: 1,
        },
        "601398",
        "工商银行",
        [{ date: "2024-01-02", close: 10 }],
        [],
        [],
      ),
    ).toThrow("回测标的不能重复");
  });

  it("拒绝非法日期和非有限金额", () => {
    expect(() =>
      assertBacktestRequest({
        ...request,
        startDate: "2024-02-30",
      }),
    ).toThrow("回测日期必须是合法的 YYYY-MM-DD");
    expect(() =>
      assertBacktestRequest({
        ...request,
        endDate: "2024/03/01",
      }),
    ).toThrow("回测日期必须是合法的 YYYY-MM-DD");
    expect(() =>
      assertBacktestRequest({
        ...request,
        monthlyAmount: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("每月金额必须是大于 0 的有限数字");
  });

  it("拒绝非字符串股票代码", () => {
    expect(() =>
      assertBacktestRequest({
        ...request,
        symbols: [601398],
      } as unknown as BacktestRequest),
    ).toThrow("仅支持 6 位 A 股股票代码");
  });

  it("拒绝未支持的快捷区间和分红处理枚举", () => {
    expect(() =>
      assertBacktestRequest({
        ...request,
        rangeYears: 7,
      } as unknown as BacktestRequest),
    ).toThrow("快捷区间仅支持 3、5、10、15 年");
    expect(() =>
      assertBacktestRequest({
        ...request,
        dividendTiming: "reinvest_later",
      } as unknown as BacktestRequest),
    ).toThrow("分红处理方式仅支持除权日或到账日");
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

describe("产品端总收益净值口径", () => {
  it("现金分红与不复权收盘价组合后保持总收益连续", () => {
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

// 模态框审计明细直接复用主回测流水，不再维护第二套计算口径。
describe("backtestResultToSimpleResult R1 回测明细", () => {
  it("基础月度买入：3 个月无分红，仅生成 buy 行，费用统一为 0", () => {
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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

  it("起始月份跳过并在非交易日跨月顺延", () => {
    // startDate=2024-01-15, buyDay=1 → 2024-01-01 已过去 → 第一次投入在 2 月
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
    const result = runSimpleBacktest(
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
