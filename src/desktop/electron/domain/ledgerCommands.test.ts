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

describe("投资事实命令", () => {
  it("领域层返回买入对持仓、累计买入和净投入的影响", () => {
    const preview = previewLedgerMutation(
      [],
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
      holdingQuantity: 0,
      holdingCost: 0,
      netInvestment: 0,
    });
    expect(preview.after).toMatchObject({
      holdingQuantity: 1_000,
      holdingCost: 5_005,
      cumulativeBuySpend: 5_005,
      netInvestment: 5_005,
    });
  });

  it("追加修正按历史重述替换原事实且不修改输入数组", () => {
    const rows = [
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
        price: 4,
        quantity: 100,
        fee: 1,
      },
      "buy",
      "2026-07-28",
    );
    expect(preview.before.holdingQuantity).toBe(1_000);
    expect(preview.after.holdingQuantity).toBe(100);
    expect(preview.after.holdingCost).toBe(401);
    expect(rows).toHaveLength(1);
  });

  it("拒绝会造成历史卖空的录入和冲正", () => {
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

  it("普通录入只允许买入、卖出、分红，且拒绝未来业务日期", () => {
    expect(
      normalizeLedgerInput(
        {
          type: "sell",
          businessDate: "2026-07-27",
          symbol: "601398",
          price: 5,
          quantity: 37,
        },
        "2026-07-28",
      ).quantity,
    ).toBe(37);
    expect(() =>
      normalizeLedgerInput(
        {
          type: "buy",
          businessDate: "2026-07-29",
          symbol: "601398",
          price: 5,
          quantity: 100,
        },
        "2026-07-28",
      ),
    ).toThrow("不能晚于当前 A 股市场日期");
    expect(() =>
      normalizeLedgerInput(
        {
          type: "adjustment",
          businessDate: "2026-07-28",
        },
        "2026-07-28",
      ),
    ).toThrow("只能从原流水详情发起");
  });
});
