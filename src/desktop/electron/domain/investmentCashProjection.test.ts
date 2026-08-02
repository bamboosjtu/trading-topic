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

/**
 * 分红与买入通过 originDividendEntryId 进行非财务关联（仅用于 UI 跳转和审计）。
 * 二者在财务口径上各自独立：分红是外部现金流入，买入是外部现金流出。
 */
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
    }),
    fact("reinvestment", "buy", "2026-07-02", {
      symbol: "601398",
      price: 10,
      quantity: buySpend / 10,
      fee: 0,
      originDividendEntryId: "dividend",
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
  it("分红未再投入时保持外部净投入，分红作为外部现金流入进入 XIRR", () => {
    const entries = linkedFacts().slice(0, 2);
    const state = reduceLedger(entries, "2026-08-10");
    expect(state.netInvestment).toBe(900);
    expect(state.cumulativeDividend).toBe(100);

    const overview = buildPositionsOverview(
      entries,
      [quote("2026-06-30", 10), quote("2026-08-10", 10)],
      [{ symbol: "601398", name: "工商银行", securityType: "stock" }],
      { factAsOfDate: "2026-08-10", valuationCutoff: "2026-08-10" },
    );
    expect(overview.metrics.netInvestment).toBe(900);
    expect(overview.metrics.cumulativeDividend).toBe(100);
    expect(overview.metrics.xirr).toBeCloseTo(
      xirr([
        { date: "2026-06-30", amount: -1_000 },
        { date: "2026-07-01", amount: 100 },
        { date: "2026-08-10", amount: 1_000 },
      ])!,
      12,
    );
  });

  it.each([
    {
      name: "全额再投入（买入仍为外部投入）",
      buySpend: 100,
      netInvestment: 1_000,
      externalFlows: [-1_000, 100, -100],
    },
    {
      name: "部分再投入（买入仍为外部投入）",
      buySpend: 60,
      netInvestment: 960,
      externalFlows: [-1_000, 100, -60],
    },
    {
      name: "再投入超过分红全部为外部投入",
      buySpend: 120,
      netInvestment: 1_020,
      externalFlows: [-1_000, 100, -120],
    },
  ])(
    "$name时净投入与外部现金流一致",
    ({ buySpend, netInvestment, externalFlows }) => {
      const entries = linkedFacts(100, buySpend);
      const projection = projectInvestmentCash(entries);
      const state = reduceLedger(entries, "2026-08-10");
      expect(projection.externalCashflows.map((flow) => flow.amount)).toEqual(
        externalFlows,
      );
      expect(state.netInvestment).toBe(netInvestment);
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
    expect(withoutDividend.cumulativeDividend).toBe(0);

    const reverseBuy = fact(
      "reverse-buy",
      "adjustment",
      "2026-07-03",
      { reversesEntryId: "reinvestment" },
    );
    const withoutBuy = reduceLedger([...base, reverseBuy], "2026-08-10");
    expect(withoutBuy.netInvestment).toBe(900);
    expect(withoutBuy.cumulativeDividend).toBe(100);
  });
});
