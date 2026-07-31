import { describe, expect, it } from "vitest";
import type {
  LedgerEntry,
  StoredMarketPrice,
} from "../../shared/contracts";
import { xirr } from "./finance";
import { projectInvestmentCash } from "./investmentCashProjection";
import { reduceLedger } from "./ledgerReducer";
import { buildPositionsOverview } from "./positionsView";

function fact(
  id: string,
  type: LedgerEntry["type"],
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

function linkedFacts(
  dividendAmount = 100,
  buySpend = 100,
): LedgerEntry[] {
  return [
    fact("opening", "buy", "2026-06-30", {
      symbol: "601398",
      price: 10,
      quantity: 100,
      fee: 0,
    }),
    fact("dividend", "dividend", "2026-07-01", {
      symbol: "601398",
      amount: dividendAmount,
      linkedGroupId: "reinvestment",
    }),
    fact("reinvestment", "buy", "2026-07-02", {
      symbol: "601398",
      price: 10,
      quantity: buySpend / 10,
      fee: 0,
      linkedGroupId: "reinvestment",
    }),
  ];
}

function quote(date: string, close: number): StoredMarketPrice {
  return {
    symbol: "601398",
    date,
    close,
    source: "tencent",
    primarySource: "tencent",
    fallbackUsed: false,
    fetchedAt: "2026-08-10T08:00:00Z",
    dataCutoff: date,
    adjustment: "none",
  };
}

describe("证券投资现金流投影", () => {
  it("分红未再投入时保持外部净投入，并把待再投入现金加入期末 XIRR 资产", () => {
    const entries = linkedFacts().slice(0, 2);
    const state = reduceLedger(entries, "2026-08-10");
    expect(state.netInvestment).toBe(1_000);
    expect(state.pendingReinvestmentCash).toBe(100);

    const overview = buildPositionsOverview(
      entries,
      [quote("2026-06-30", 10), quote("2026-08-10", 10)],
      [{ symbol: "601398", name: "工商银行", securityType: "stock" }],
      { factAsOfDate: "2026-08-10", valuationCutoff: "2026-08-10" },
    );
    expect(overview.metrics.pendingReinvestmentCash).toBe(100);
    expect(overview.metrics.netInvestment).toBe(1_000);
    expect(overview.positions[0].pendingReinvestmentCash).toBe(100);
    expect(overview.metrics.xirr).toBeCloseTo(
      xirr([
        { date: "2026-06-30", amount: -1_000 },
        { date: "2026-08-10", amount: 1_100 },
      ])!,
      12,
    );
  });

  it.each([
    {
      name: "跨日全额再投入",
      buySpend: 100,
      netInvestment: 1_000,
      pending: 0,
      externalFlows: [-1_000],
    },
    {
      name: "部分再投入并保留余额",
      buySpend: 60,
      netInvestment: 1_000,
      pending: 40,
      externalFlows: [-1_000],
    },
    {
      name: "再投入超过分红只计算补足零钱",
      buySpend: 120,
      netInvestment: 1_020,
      pending: 0,
      externalFlows: [-1_000, -20],
    },
  ])(
    "$name时净投入、待再投入余额与外部现金流一致",
    ({ buySpend, netInvestment, pending, externalFlows }) => {
      const entries = linkedFacts(100, buySpend);
      const projection = projectInvestmentCash(entries);
      const state = reduceLedger(entries, "2026-08-10");
      expect(projection.externalCashflows.map((flow) => flow.amount)).toEqual(
        externalFlows,
      );
      expect(state.netInvestment).toBe(netInvestment);
      expect(state.pendingReinvestmentCash).toBe(pending);
    },
  );

  it("冲正关联分红或买入后从当前有效事实重新投影", () => {
    const base = linkedFacts();
    const reverseDividend = fact(
      "reverse-dividend",
      "adjustment",
      "2026-07-03",
      { reversesEntryId: "dividend" },
    );
    const withoutDividend = reduceLedger(
      [...base, reverseDividend],
      "2026-08-10",
    );
    expect(withoutDividend.netInvestment).toBe(1_100);
    expect(withoutDividend.pendingReinvestmentCash).toBe(0);

    const reverseBuy = fact(
      "reverse-buy",
      "adjustment",
      "2026-07-03",
      { reversesEntryId: "reinvestment" },
    );
    const withoutBuy = reduceLedger([...base, reverseBuy], "2026-08-10");
    expect(withoutBuy.netInvestment).toBe(1_000);
    expect(withoutBuy.pendingReinvestmentCash).toBe(100);
  });
});
