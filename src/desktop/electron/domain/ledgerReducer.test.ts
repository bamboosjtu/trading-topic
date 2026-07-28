import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../../shared/contracts";
import {
  activeLedgerEntries,
  canonicalLedgerOrder,
  reduceLedger,
} from "./ledgerReducer";

function row(
  id: string,
  type: LedgerEntry["type"],
  businessDate: string,
  recordedAt: string,
  fields: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id,
    type,
    businessDate,
    recordedAt,
    currency: "CNY",
    source: "user",
    ...fields,
  };
}

describe("投资事实归约", () => {
  it("同日按录入时间升序归约，所有消费者取得相同有效顺序", () => {
    const entries = [
      row("sell", "sell", "2026-07-02", "2026-07-02T10:00:00Z", {
        symbol: "601398",
        price: 5.1,
        quantity: 37,
      }),
      row("buy", "buy", "2026-07-02", "2026-07-02T09:00:00Z", {
        symbol: "601398",
        price: 5,
        quantity: 37,
      }),
    ];
    expect(activeLedgerEntries(entries, "2026-07-02").effective.map((item) => item.id))
      .toEqual(["buy", "sell"]);
    expect([...entries].sort(canonicalLedgerOrder).map((item) => item.id))
      .toEqual(["buy", "sell"]);
    expect(reduceLedger(entries, "2026-07-02").positions.get("601398")?.quantity)
      .toBe(0);
  });

  it("仅凭买入、卖出和分红即可计算净投入", () => {
    const entries = [
      row("buy", "buy", "2026-07-01", "2026-07-01T01:00:00Z", {
        symbol: "601398",
        price: 5,
        quantity: 100,
        fee: 5,
      }),
      row("dividend", "dividend", "2026-07-02", "2026-07-02T01:00:00Z", {
        symbol: "601398",
        amount: 20,
      }),
      row("sell", "sell", "2026-07-03", "2026-07-03T01:00:00Z", {
        symbol: "601398",
        price: 6,
        quantity: 40,
        fee: 2,
      }),
    ];
    const state = reduceLedger(entries, "2026-07-03");
    expect(state).toMatchObject({
      cumulativeBuySpend: 505,
      cumulativeSellNetIncome: 238,
      cumulativeDividend: 20,
      netInvestment: 247,
    });
    expect(state.positions.get("601398")).toMatchObject({
      quantity: 60,
      cost: 303,
      realizedPnl: 36,
    });
  });

  it("修正采用历史重述：历史月份和当前累计使用相同有效版本", () => {
    const entries = [
      row("old", "buy", "2026-01-02", "2026-01-02T01:00:00Z", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
      row("adjust", "adjustment", "2026-01-02", "2026-07-10T01:00:00Z", {
        correctedAt: "2026-07-10T01:00:00Z",
        reversesEntryId: "old",
      }),
      row("replacement", "buy", "2026-01-02", "2026-07-10T01:00:01Z", {
        correctedAt: "2026-07-10T01:00:00Z",
        correctsEntryId: "old",
        symbol: "601398",
        price: 4,
        quantity: 100,
      }),
    ];
    expect(reduceLedger(entries, "2026-01-31").cumulativeBuySpend).toBe(400);
    expect(reduceLedger(entries, "2026-07-31").cumulativeBuySpend).toBe(400);
  });

  it("截止日只过滤有效投资事实，不让未来买入污染当前持仓", () => {
    const entries = [
      row("future", "buy", "2026-08-01", "2026-07-28T01:00:00Z", {
        symbol: "601398",
        price: 5,
        quantity: 100,
      }),
    ];
    expect(reduceLedger(entries, "2026-07-28").positions.size).toBe(0);
  });
});
