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

describe("唯一账本归约规则", () => {
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
    const active = activeLedgerEntries(entries, "2026-07-02");
    expect(active.effective.map((entry) => entry.id)).toEqual(["buy", "sell"]);
    expect([...entries].sort(canonicalLedgerOrder).map((entry) => entry.id))
      .toEqual(["buy", "sell"]);
    expect(reduceLedger(entries, "2026-07-02").positions.get("601398")?.quantity)
      .toBe(0);
  });

  it("截止日过滤未来事实，逆回购未到期只确认本金，到期才确认收益", () => {
    const entries = [
      row("cash", "transfer_in", "2026-07-01", "2026-07-01T01:00:00Z", {
        amount: 2_000,
      }),
      row("repo", "reverse_repo", "2026-07-02", "2026-07-02T01:00:00Z", {
        amount: 1_000,
        maturityDate: "2026-07-10",
        maturityAmount: 1_010,
      }),
      row("future", "transfer_out", "2026-07-20", "2026-07-02T02:00:00Z", {
        amount: 500,
      }),
    ];

    expect(reduceLedger(entries, "2026-07-05")).toMatchObject({
      cash: 1_000,
      reverseRepoAsset: 1_000,
      reverseRepoIncome: 0,
      transferOut: 0,
    });
    expect(reduceLedger(entries, "2026-07-10")).toMatchObject({
      cash: 2_010,
      reverseRepoAsset: 0,
      reverseRepoIncome: 10,
      transferOut: 0,
    });
  });

  it("历史修正只在修正业务日生效，不会在此前时点重复应用替代记录", () => {
    const entries = [
      row("old", "transfer_in", "2026-07-01", "2026-07-01T01:00:00Z", {
        amount: 1_000,
      }),
      row("replacement", "transfer_in", "2026-07-01", "2026-07-10T01:00:01Z", {
        amount: 2_000,
        correctsEntryId: "old",
      }),
      row("adjust", "adjustment", "2026-07-10", "2026-07-10T01:00:00Z", {
        reversesEntryId: "old",
      }),
    ];
    expect(reduceLedger(entries, "2026-07-09").cash).toBe(1_000);
    expect(reduceLedger(entries, "2026-07-10").cash).toBe(2_000);
  });
});
