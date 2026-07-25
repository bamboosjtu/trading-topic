import { describe, expect, it } from "vitest";
import type { BacktestRequest, LedgerEntry } from "../../shared/contracts";
import { simulateBacktest } from "./analysis";
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
