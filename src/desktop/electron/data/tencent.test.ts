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
import {
  EASTMONEY_SUSPEND_SOURCE,
  fetchEastmoneyTradingSuspensions,
  parseSuspensionRow,
  parseTradingSuspensions,
} from "./tradingSuspensions";

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

describe("parseSuspensionRow / parseTradingSuspensions", () => {
  const FETCHED_AT = "2025-08-20T00:00:00Z";

  it("解析东方财富真实字段 SUSPEND_START_DATE + SUSPEND_END_TIME", () => {
    // 取自东方财富新市场级停复牌报表的真实字段命名
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_START_DATE: "2025-08-04 00:00:00",
      SUSPEND_END_TIME: "2025-08-15 15:00:00",
      PREDICT_RESUME_DATE: "2025-08-18 00:00:00",
      SUSPEND_EXPIRE: "2025-08-15",
      SUSPEND_REASON: "重大事项",
      NOTICE_DATE: "2025-08-01",
    };
    const interruption = parseSuspensionRow(row, "601088", FETCHED_AT);
    expect(interruption).toEqual({
      symbol: "601088",
      startDate: "2025-08-04",
      // 优先使用 SUSPEND_END_TIME，不依赖复牌日前一天推导
      endDate: "2025-08-15",
      reason: "suspension",
      source: EASTMONEY_SUSPEND_SOURCE,
      sourceId: "2025-08-01",
      fetchedAt: FETCHED_AT,
    });
  });

  it("仅有 SUSPEND_START_DATE + RESUME_DATE 时按复牌日前一天推导 endDate", () => {
    // 历史字段命名或简化响应：复牌日 2025-08-18 → endDate 2025-08-17
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_START_DATE: "2025-08-04",
      RESUME_DATE: "2025-08-18",
    };
    const interruption = parseSuspensionRow(row, "601088", FETCHED_AT);
    expect(interruption?.startDate).toBe("2025-08-04");
    expect(interruption?.endDate).toBe("2025-08-17");
  });

  it("仅有 PREDICT_RESUME_DATE 时按预计复牌日前一天推导 endDate", () => {
    // 尚未实际复牌、仅有预计复牌日：证据等级较低但仍可用
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_START_DATE: "2025-08-04",
      PREDICT_RESUME_DATE: "2025-08-18",
    };
    const interruption = parseSuspensionRow(row, "601088", FETCHED_AT);
    expect(interruption?.endDate).toBe("2025-08-17");
  });

  it("兼容历史字段命名 SUSPEND_DATE + RESUME_DATE", () => {
    // 旧字段命名兼容
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_DATE: "2025-08-04",
      RESUME_DATE: "2025-08-18",
    };
    const interruption = parseSuspensionRow(row, "601088", FETCHED_AT);
    expect(interruption?.startDate).toBe("2025-08-04");
    expect(interruption?.endDate).toBe("2025-08-17");
  });

  it("无任何截止/复牌日时返回 null，不自行延伸到今天", () => {
    // P1 边界修复：历史记录字段缺失时不能假设从开始日一直停牌到现在
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_START_DATE: "2025-08-04",
      SUSPEND_REASON: "重大事项",
    };
    const interruption = parseSuspensionRow(row, "601088", FETCHED_AT);
    expect(interruption).toBeNull();
  });

  it("SUSPEND_EXPIRE 作为明确截止日候选", () => {
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_START_DATE: "2025-08-04",
      SUSPEND_EXPIRE: "2025-08-15",
    };
    const interruption = parseSuspensionRow(row, "601088", FETCHED_AT);
    expect(interruption?.startDate).toBe("2025-08-04");
    expect(interruption?.endDate).toBe("2025-08-15");
  });

  it("缺少有效开始日时返回 null", () => {
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_END_TIME: "2025-08-15",
    };
    expect(parseSuspensionRow(row, "601088", FETCHED_AT)).toBeNull();
  });

  it("endDate 早于 startDate 时返回 null", () => {
    const row = {
      SECURITY_CODE: "601088",
      SUSPEND_START_DATE: "2025-08-20",
      SUSPEND_END_TIME: "2025-08-15",
    };
    expect(parseSuspensionRow(row, "601088", FETCHED_AT)).toBeNull();
  });

  it("parseTradingSuspensions 解析多行并按 startDate 升序返回", () => {
    const rawRows = [
      {
        SECURITY_CODE: "601088",
        SUSPEND_START_DATE: "2025-09-01",
        SUSPEND_END_TIME: "2025-09-05",
      },
      {
        SECURITY_CODE: "601088",
        SUSPEND_START_DATE: "2025-08-04",
        SUSPEND_END_TIME: "2025-08-15",
      },
    ];
    const interruptions = parseTradingSuspensions(
      rawRows,
      "601088",
      FETCHED_AT,
    );
    expect(interruptions).toHaveLength(2);
    expect(interruptions[0].startDate).toBe("2025-08-04");
    expect(interruptions[1].startDate).toBe("2025-09-01");
  });

  it("parseTradingSuspensions 原始行非空但全部无法解析时抛结构错误", () => {
    // 字段命名已变化：接口返回了若干行，但没有一行能识别有效日期
    const rawRows = [
      {
        SECURITY_CODE: "601088",
        NEW_SUSPEND_FIELD: "2025-08-04",
        NEW_RESUME_FIELD: "2025-08-18",
      },
    ];
    expect(() =>
      parseTradingSuspensions(rawRows, "601088", FETCHED_AT),
    ).toThrow("未识别到有效日期字段");
  });

  it("parseTradingSuspensions 空行数组返回空数组（合法无停牌记录）", () => {
    expect(parseTradingSuspensions([], "601088", FETCHED_AT)).toEqual([]);
  });

  it("新东方财富停复牌接口明确空结果返回空数组", async () => {
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
    const result = await fetchEastmoneyTradingSuspensions(
      ["601088"],
      "2025-08-01",
      "2025-08-31",
      { now: () => new Date("2025-09-01T00:00:00Z") },
    );
    expect(result.rows).toEqual([]);
  });

  it("新东方财富停复牌接口返回行但字段无法解析时抛错", async () => {
    // 接口字段已变化但响应非空，应抛错而不是返回空数组
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          code: 0,
          message: "ok",
          result: {
            pages: 1,
            count: 1,
            data: [
              {
                SECURITY_CODE: "601088",
                UNKNOWN_NEW_FIELD: "2025-08-04",
              },
            ],
          },
        }),
      }),
    );
    await expect(
      fetchEastmoneyTradingSuspensions(
        ["601088"],
        "2025-08-01",
        "2025-08-31",
        { now: () => new Date("2025-09-01T00:00:00Z") },
      ),
    ).rejects.toThrow("未识别到有效日期字段");
  });

  it("新东方财富停复牌接口成功解析真实字段并写入来源", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          code: 0,
          message: "ok",
          result: {
            pages: 1,
            count: 1,
            data: [
              {
                SECURITY_CODE: "601088",
                SUSPEND_START_DATE: "2025-08-04 00:00:00",
                SUSPEND_END_TIME: "2025-08-15 15:00:00",
                PREDICT_RESUME_DATE: "2025-08-18 00:00:00",
                SUSPEND_REASON: "重大事项",
                NOTICE_DATE: "2025-08-01",
              },
            ],
          },
        }),
      }),
    );
    const result = await fetchEastmoneyTradingSuspensions(
      ["601088"],
      "2025-08-01",
      "2025-08-31",
      { now: () => new Date("2025-09-01T00:00:00Z") },
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "601088",
      startDate: "2025-08-04",
      endDate: "2025-08-15",
      reason: "suspension",
      source: EASTMONEY_SUSPEND_SOURCE,
    });
  });
});
