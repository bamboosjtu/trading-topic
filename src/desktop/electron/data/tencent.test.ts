import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCorporateActions } from "./tencent";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCorporateActions", () => {
  it("把每 10 股派息换算为每股，并保留每 10 股送转比例", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          data: [
            {
              SECURITY_CODE: "601398",
              EX_DIVIDEND_DATE: "2024-07-15",
              EQUITY_RECORD_DATE: "2024-07-12",
              DIVIDEND_ARRIVAL_DATE: "2024-07-15",
              PRETAX_BONUS_RMB: 2.933,
              TRANSFER_RATIO: 1,
              BONUS_RATIO: 0.5,
              ASSIGN_PROGRESS: "实施",
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCorporateActions(
      "601398",
      "2024-01-01",
      "2024-12-31",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      date: "2024-07-15",
      recordDate: "2024-07-12",
      paymentDate: "2024-07-15",
      transferRatio: 1,
      bonusRatio: 0.5,
    });
    expect(result.rows[0].perShare).toBeCloseTo(0.2933, 6);
  });

  it("同一除权日合并现金方案，并使用最新事件日作为截止日", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            data: [
              {
                EX_DIVIDEND_DATE: "2024-06-01",
                EQUITY_RECORD_DATE: "2024-05-31",
                PRETAX_BONUS_RMB: 1,
                TRANSFER_RATIO: "-",
                BONUS_RATIO: null,
                ASSIGN_PROGRESS: "实施",
              },
              {
                EX_DIVIDEND_DATE: "2024-06-01",
                EQUITY_RECORD_DATE: "2024-05-31",
                PRETAX_BONUS_RMB: 2,
                TRANSFER_RATIO: 0,
                BONUS_RATIO: 0,
                ASSIGN_PROGRESS: "实施",
              },
              {
                EX_DIVIDEND_DATE: "2024-09-01",
                EQUITY_RECORD_DATE: "2024-08-30",
                PRETAX_BONUS_RMB: 3,
                TRANSFER_RATIO: 0,
                BONUS_RATIO: 0,
                ASSIGN_PROGRESS: "实施",
              },
            ],
          },
        }),
      }),
    );

    const result = await fetchCorporateActions(
      "601398",
      "2024-01-01",
      "2024-12-31",
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].perShare).toBeCloseTo(0.3, 6);
    expect(result.rows[0].transferRatio).toBe(0);
    expect(result.provenance.dataCutoff).toBe("2024-09-01");
    expect(result.provenance.caliberVersion).toBe(
      "bank-dca-r1-node-v3",
    );
  });
});
