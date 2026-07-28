import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import icbcFixture from "../../tests/fixtures/eastmoney-sharebonus-601398.json";
import catlFixture from "../../tests/fixtures/eastmoney-sharebonus-300750.json";
import allotmentFixture from "../../tests/fixtures/eastmoney-allotment-601916.json";
import {
  fetchAdjustedBars,
  fetchCorporateActions,
  fetchUnadjustedPrices,
  marketSymbol,
  parseCorporateActions,
  parseReportedCorporateActions,
} from "./tencent";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("marketSymbol", () => {
  it("正确映射沪深京股票与境内交易所 ETF", () => {
    expect(marketSymbol("600519")).toBe("sh600519");
    expect(marketSymbol("510300")).toBe("sh510300");
    expect(marketSymbol("159915")).toBe("sz159915");
    expect(marketSymbol("000001")).toBe("sz000001");
    expect(marketSymbol("920002")).toBe("bj920002");
  });
});

describe("fetchCorporateActions", () => {
  it("把每 10 股派息换算为每股，并保留每 10 股送转比例", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          code: 0,
          message: "ok",
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          code: 9201,
          message: "返回数据为空",
          result: null,
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

  it("完全重复行先去重，同方案只保留最终实施版本，不同方案才累加", async () => {
    const repeatedVersion = {
      SECURITY_CODE: "601398",
      REPORT_DATE: "2023-12-31",
      PLAN_NOTICE_DATE: "2024-03-28",
      NOTICE_DATE: "2024-05-20",
      EX_DIVIDEND_DATE: "2024-06-01",
      EQUITY_RECORD_DATE: "2024-05-31",
      PRETAX_BONUS_RMB: 1,
      IT_RATIO: 1,
      BONUS_RATIO: 0,
      ASSIGN_PROGRESS: "实施分配",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            code: 0,
            message: "ok",
            result: {
              data: [
              repeatedVersion,
              { ...repeatedVersion },
              {
                ...repeatedVersion,
                NOTICE_DATE: "2024-05-25",
                PRETAX_BONUS_RMB: 2,
                IT_RATIO: 2,
              },
              {
                SECURITY_CODE: "601398",
                REPORT_DATE: "2024-06-30",
                PLAN_NOTICE_DATE: "2024-08-01",
                NOTICE_DATE: "2024-08-20",
                EX_DIVIDEND_DATE: "2024-06-01",
                EQUITY_RECORD_DATE: "2024-05-31",
                PRETAX_BONUS_RMB: 3,
                IT_RATIO: 1,
                BONUS_RATIO: 0,
                ASSIGN_PROGRESS: "实施分配",
              },
              {
                SECURITY_CODE: "601398",
                REPORT_DATE: "2024-12-31",
                EX_DIVIDEND_DATE: "2024-09-01",
                EQUITY_RECORD_DATE: "2024-08-30",
                PRETAX_BONUS_RMB: 3,
                IT_RATIO: 0,
                BONUS_RATIO: 0,
                ASSIGN_PROGRESS: "实施分配",
              },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: false,
            code: 9201,
            message: "返回数据为空",
            result: null,
          }),
        }),
    );

    const result = await fetchCorporateActions(
      "601398",
      "2024-01-01",
      "2024-12-31",
    );

    expect(result.rows).toHaveLength(2);
    // 2023 年报方案的旧版 0.1 元不会与最终版 0.2 元相加；
    // 2024 中报被明确识别为另一方案，因此同日实施时再累加 0.3 元。
    expect(result.rows[0].perShare).toBeCloseTo(0.5, 6);
    expect(result.rows[0].transferRatio).toBe(3);
    expect(result.provenance.dataCutoff).toBe("2024-09-01");
    expect(result.provenance.caliberVersion).toBe(BACKTEST_CALIBER_VERSION);
  });

  it("解析真实东方财富现金分红与转增响应 fixture", () => {
    const icbc = parseCorporateActions(
      icbcFixture.result.data,
      "2024-01-01",
      "2025-12-31",
    );
    const catl = parseCorporateActions(
      catlFixture.result.data,
      "2023-01-01",
      "2023-12-31",
    );

    expect(icbc).toHaveLength(3);
    expect(icbc[1]).toMatchObject({
      date: "2025-07-14",
      recordDate: "2025-07-11",
      perShare: 0.1646,
    });
    expect(catl).toEqual([
      expect.objectContaining({
        date: "2023-04-26",
        perShare: 2.52,
        transferRatio: 8,
        bonusRatio: 0,
      }),
    ]);
  });

  it("跳过占位符并读取后续可解析的转增比例", () => {
    const rows = parseCorporateActions(
      [
        {
          SECURITY_CODE: "300750",
          REPORT_DATE: "2023-12-31",
          EX_DIVIDEND_DATE: "2024-06-01",
          EQUITY_RECORD_DATE: "2024-05-31",
          PRETAX_BONUS_RMB: 0,
          IT_RATIO: "-",
          TRANSFER_RATIO: "2.5",
          BONUS_RATIO: 0,
          ASSIGN_PROGRESS: "实施分配",
        },
      ],
      "2024-01-01",
      "2024-12-31",
    );

    expect(rows[0].transferRatio).toBe(2.5);
  });

  it("解析真实东方财富配股响应并报告用户不参与的公司行动", () => {
    expect(
      parseReportedCorporateActions(
        allotmentFixture.result.data,
        "2023-01-01",
        "2023-12-31",
      ),
    ).toEqual([
      {
        type: "rights_issue",
        sourceId: "42784",
        exDate: "2023-06-27",
        recordDate: "2023-06-14",
        paymentStartDate: "2023-06-15",
        paymentEndDate: "2023-06-21",
        listingDate: "2023-07-06",
        ratioPer10: 3,
        subscriptionPrice: 2.02,
      },
    ]);
  });

  it("把东方财富明确的空结果识别为合法无公司行动", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          code: 9201,
          message: "返回数据为空",
          result: null,
        }),
      }),
    );

    const result = await fetchCorporateActions(
      "601398",
      "2024-01-01",
      "2024-12-31",
    );
    expect(result.rows).toEqual([]);
    expect(result.reportedActions).toEqual([]);
  });

  it("东方财富限流或响应结构损坏时终止而不是伪装成无数据", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: false,
            code: 429,
            message: "访问过于频繁",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            code: 0,
            message: "ok",
            result: {},
          }),
        }),
    );

    await expect(
      fetchCorporateActions("601398", "2024-01-01", "2024-12-31"),
    ).rejects.toThrow("访问过于频繁");

    vi.mocked(fetch).mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        code: 0,
        message: "ok",
        result: {},
      }),
    }) as Response);
    await expect(
      fetchCorporateActions("601398", "2024-01-01", "2024-12-31"),
    ).rejects.toThrow("缺少 result.data");
  });
});

describe("fetchAdjustedBars", () => {
  it("保留腾讯前复权日线的真实 OHLCV，而不是从收盘价推导", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        'kline_qfq_day2024={"code":0,"msg":"","data":{"sh601398":{"qfqday":[["2024-01-02","4.31","4.38","4.42","4.27","123456.5"],["2024-01-03","4.39","4.35","4.41","4.32","98765"]]}}}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdjustedBars(
      "601398",
      "2024-01-01",
      "2024-12-31",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "sh601398%2Cday%2C2024-01-01%2C2024-12-31%2C640%2Cqfq",
    );
    expect(result.rows).toEqual([
      {
        date: "2024-01-02",
        open: 4.31,
        high: 4.42,
        low: 4.27,
        close: 4.38,
        volume: 123456.5,
        adjustment: "qfq",
      },
      {
        date: "2024-01-03",
        open: 4.39,
        high: 4.41,
        low: 4.32,
        close: 4.35,
        volume: 98765,
        adjustment: "qfq",
      },
    ]);
    expect(result.provenance.adjustment).toBe("qfq");
  });

  it("缺少 qfqday 字段时明确失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          'kline_qfq_day2024={"code":0,"msg":"","data":{"sh601398":{}}}',
      }),
    );

    await expect(
      fetchAdjustedBars("601398", "2024-01-01", "2024-12-31"),
    ).rejects.toThrow("缺少 qfqday");
  });
});

describe("fetchUnadjustedPrices", () => {
  it("上市前年份的明确空数组是合法空数据", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            'kline_none_day2023={"code":0,"msg":"","data":{"sz300750":{"day":[]}}}',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            'kline_none_day2024={"code":0,"msg":"","data":{"sz300750":{"day":[["2024-01-02","10","10.2","10.3","9.9","1000"]]}}}',
        }),
    );

    const result = await fetchUnadjustedPrices(
      "300750",
      "2023-01-01",
      "2024-12-31",
    );
    expect(result.rows).toEqual([{ date: "2024-01-02", close: 10.2 }]);
  });

  it("已存在前后行情但中间整年为空时识别为异常缺口", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            'kline_none_day2022={"code":0,"msg":"","data":{"sh601398":{"day":[["2022-12-30","4","4.1","4.2","3.9","1000"]]}}}',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            'kline_none_day2023={"code":0,"msg":"","data":{"sh601398":{"day":[]}}}',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            'kline_none_day2024={"code":0,"msg":"","data":{"sh601398":{"day":[["2024-01-02","4","4.1","4.2","3.9","1000"]]}}}',
        }),
    );

    await expect(
      fetchUnadjustedPrices("601398", "2022-01-01", "2024-12-31"),
    ).rejects.toThrow("2023 年存在异常缺口");
  });
});
