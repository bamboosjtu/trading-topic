import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../../shared/contracts";
import {
  assertLedgerReversal,
  normalizeLedgerInput,
  previewLedgerMutation,
} from "./ledgerCommands";

function entry(
  id: string,
  input: Partial<LedgerEntry> & Pick<LedgerEntry, "type" | "businessDate">,
): LedgerEntry {
  return {
    id,
    recordedAt: `${input.businessDate}T09:30:00.000Z`,
    currency: "CNY",
    source: "user",
    ...input,
  };
}

describe("实盘流水命令", () => {
  it("由领域层返回买入对现金、持仓数量和成本的影响", () => {
    const preview = previewLedgerMutation(
      [
        entry("cash", {
          type: "transfer_in",
          businessDate: "2026-01-01",
          amount: 10_000,
        }),
      ],
      {
        type: "buy",
        businessDate: "2026-01-02",
        symbol: "601398",
        instrumentName: "工商银行",
        securityType: "stock",
        price: 5,
        quantity: 1_000,
        fee: 5,
      },
      undefined,
      "2026-01-02",
    );

    expect(preview.tradeAmount).toBe(5_000);
    expect(preview.before).toMatchObject({
      availableCash: 10_000,
      holdingQuantity: 0,
      holdingCost: 0,
    });
    expect(preview.after).toMatchObject({
      availableCash: 4_995,
      holdingQuantity: 1_000,
      holdingCost: 5_005,
    });
  });

  it("追加修正按撤销原记录再加入新记录计算，不覆盖原事实", () => {
    const rows = [
      entry("cash", {
        type: "transfer_in",
        businessDate: "2026-01-01",
        amount: 10_000,
      }),
      entry("buy", {
        type: "buy",
        businessDate: "2026-01-02",
        symbol: "601398",
        price: 5,
        quantity: 1_000,
        fee: 5,
      }),
    ];
    const preview = previewLedgerMutation(
      rows,
      {
        type: "buy",
        businessDate: "2026-01-02",
        symbol: "601398",
        instrumentName: "工商银行",
        securityType: "stock",
        price: 4,
        quantity: 100,
        fee: 1,
      },
      "buy",
      "2026-01-02",
    );

    expect(preview.before.holdingQuantity).toBe(1_000);
    expect(preview.after.holdingQuantity).toBe(100);
    expect(preview.after.holdingCost).toBe(401);
    expect(rows).toHaveLength(2);
  });

  it("拒绝会造成历史时点卖空的录入和冲正", () => {
    const rows = [
      entry("buy", {
        type: "buy",
        businessDate: "2026-01-02",
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      entry("sell", {
        type: "sell",
        businessDate: "2026-01-03",
        symbol: "601398",
        price: 5.1,
        quantity: 100,
      }),
    ];

    expect(() =>
      previewLedgerMutation(rows, {
        type: "sell",
        businessDate: "2026-01-03",
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ).toThrow("卖出数量超过有效持仓");
    expect(() => assertLedgerReversal(rows, "buy", "2026-01-03")).toThrow(
      "卖出数量超过有效持仓",
    );
  });

  it("逆回购按本金、收益率、期限与费用补齐到期事实", () => {
    const normalized = normalizeLedgerInput({
      type: "reverse_repo",
      businessDate: "2026-07-27",
      repoCode: "204001",
      amount: 100_000,
      annualRate: 0.02,
      termDays: 1,
      fee: 1,
    });

    expect(normalized.maturityDate).toBe("2026-07-28");
    expect(normalized.maturityAmount).toBe(100_004.48);
  });
});
