import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAIDU_SUSPEND_SOURCE,
  EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
  EASTMONEY_SUSPEND_SOURCE,
  fetchBaiduTradingSuspensions,
  fetchEastmoneyFundAnnouncementSuspensions,
  fetchTradingSuspensions,
  isEtfSymbol,
  parseBaiduTradingSuspensions,
  parseFundAnnouncementSuspensionInterval,
  parseFundAnnouncementSuspensionStart,
  parseSuspensionRow,
  parseTradingSuspensions,
} from "./tradingSuspensions";

const NOW = new Date("2026-08-08T05:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function baiduPayload(
  startDate: string,
  endDate: string,
  rowsByDate: Record<string, Array<Record<string, unknown>>>,
): unknown {
  return {
    ResultCode: 0,
    Result: {
      calendarInfo: datesBetween(startDate, endDate).map((date) => ({
        date,
        total: rowsByDate[date]?.length ?? 0,
        list: rowsByDate[date] ?? null,
      })),
    },
  };
}

describe("停复牌主备适配器", () => {
  it("东方财富个股日历开放区间只延伸到本次已观察截止日", () => {
    const row = parseSuspensionRow(
      {
        SECURITY_CODE: "300246",
        NOTICE_DATE: "2026-08-03 00:00:00",
        EVENT_TYPE_CODE: "023",
        LEVEL1_CONTENT:
          "因刊登重要公告连续停牌，从2026年08月03日  9:30开始停牌",
      },
      "300246",
      NOW.toISOString(),
      "2026-08-08",
    );

    expect(row).toMatchObject({
      symbol: "300246",
      startDate: "2026-08-03",
      endDate: "2026-08-08",
      source: EASTMONEY_SUSPEND_SOURCE,
    });
  });

  it("东方财富个股日历盘中停牌不伪装成整日行情缺口证据", () => {
    const raw = {
      SECURITY_CODE: "601857",
      NOTICE_DATE: "2013-09-09 00:00:00",
      EVENT_TYPE_CODE: "023",
      LEVEL1_CONTENT:
        "因刊登重要公告停牌半天，2013年09月09日  9:30-2013年09月09日  11:30停牌",
    };
    const row = parseSuspensionRow(
      raw,
      "601857",
      NOW.toISOString(),
    );

    expect(row).toBeNull();
    expect(
      parseTradingSuspensions([raw], "601857", NOW.toISOString()),
    ).toEqual([]);
  });

  it("解析本次15年回测暴露的五条历史全天停牌证据", () => {
    const fixtures = [
      {
        symbol: "601398",
        date: "2011-11-29",
        content:
          "因召开股东大会停牌一天，2011年11月29日  9:30-2011年11月29日  15:00停牌",
      },
      {
        symbol: "601398",
        date: "2012-02-23",
        content:
          "因召开股东大会停牌一天，2012年02月23日  9:30-2012年02月23日  15:00停牌",
      },
      {
        symbol: "601857",
        date: "2011-10-20",
        content:
          "因召开股东大会停牌一天，2011年10月20日  9:30-2011年10月20日  15:00停牌",
      },
      {
        symbol: "601857",
        date: "2012-05-23",
        content:
          "因召开股东大会停牌一天，2012年05月23日  9:30-2012年05月23日  15:00停牌",
      },
      {
        symbol: "601857",
        date: "2013-08-27",
        content:
          "因重要事项未公告停牌一天，2013年08月27日  9:30-2013年08月27日  15:00停牌",
      },
    ];

    expect(
      fixtures.map(({ symbol, date, content }) =>
        parseSuspensionRow(
          {
            SECURITY_CODE: symbol,
            NOTICE_DATE: `${date} 00:00:00`,
            EVENT_TYPE_CODE: "023",
            LEVEL1_CONTENT: content,
          },
          symbol,
          NOW.toISOString(),
        ),
      ),
    ).toEqual(
      fixtures.map(({ symbol, date }) =>
        expect.objectContaining({
          symbol,
          startDate: date,
          endDate: date,
          source: EASTMONEY_SUSPEND_SOURCE,
        }),
      ),
    );
  });

  it("百度把复牌日换算成最后停牌日，并跳过未闭合区间", () => {
    const result = parseBaiduTradingSuspensions(
      [
        {
          code: "603221",
          exchange: "SH",
          market: "ab",
          start: "2026-08-03",
          end: "2026-08-06",
          date: "2026-08-03",
        },
        {
          code: "300246",
          exchange: "SZ",
          market: "ab",
          start: "2026-08-03",
          end: null,
          date: "2026-08-03",
        },
        {
          code: "00318",
          exchange: "HK",
          market: "hk",
          start: "2026-08-03",
          end: null,
          date: "2026-08-03",
        },
      ],
      ["603221", "300246"],
      NOW.toISOString(),
      "2026-08-03",
      "2026-08-06",
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        symbol: "603221",
        startDate: "2026-08-03",
        endDate: "2026-08-05",
        source: BAIDU_SUSPEND_SOURCE,
      }),
    ]);
    expect(result.unresolvedOpenIntervals).toBe(1);
  });

  it("百度备用源校验日期覆盖并返回稳定 A 股样本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            baiduPayload("2026-08-03", "2026-08-06", {
              "2026-08-03": [
                {
                  code: "603221",
                  name: "爱丽家居",
                  exchange: "SH",
                  market: "ab",
                  start: "2026-08-03",
                  end: "2026-08-06",
                  date: "2026-08-03",
                },
              ],
            }),
          ),
        ),
      ),
    );

    const result = await fetchBaiduTradingSuspensions(
      ["603221"],
      "2026-08-03",
      "2026-08-06",
      { now: () => NOW, sleep: vi.fn() },
    );

    expect(result.rows).toHaveLength(1);
    expect(result).toMatchObject({
      sourceKey: BAIDU_SUSPEND_SOURCE,
      coverageStart: "2026-08-03",
      coverageEnd: "2026-08-06",
      partialCoverage: false,
    });
  });

  it("东方财富主源失败后整段切换到不同域名的百度备用源", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "datacenter-web.eastmoney.com") {
          return new Response("", { status: 503 });
        }
        if (url.hostname === "finance.pae.baidu.com") {
          return new Response(
            JSON.stringify(
              baiduPayload("2026-08-03", "2026-08-06", {
                "2026-08-03": [
                  {
                    code: "603221",
                    exchange: "SH",
                    market: "ab",
                    start: "2026-08-03",
                    end: "2026-08-06",
                    date: "2026-08-03",
                  },
                ],
              }),
            ),
          );
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    const result = await fetchTradingSuspensions(
      ["603221"],
      "2026-08-03",
      "2026-08-06",
      { now: () => NOW, sleep: vi.fn() },
    );

    expect(result.rows).toHaveLength(1);
    expect(result).toMatchObject({
      sourceKey: BAIDU_SUSPEND_SOURCE,
      primarySource: EASTMONEY_SUSPEND_SOURCE,
      fallbackUsed: true,
      fallbackReason: expect.stringContaining("503"),
    });
  });

  it("百度早期历史只声明从 2023 年起的部分覆盖", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            baiduPayload("2023-01-01", "2023-01-02", {}),
          ),
        ),
      ),
    );

    const result = await fetchBaiduTradingSuspensions(
      ["603221"],
      "2022-12-30",
      "2023-01-02",
      { now: () => NOW, sleep: vi.fn() },
    );

    expect(result).toMatchObject({
      rows: [],
      coverageStart: "2023-01-01",
      coverageEnd: "2023-01-02",
      partialCoverage: true,
    });
  });

  it("主源失败时拒绝把百度 2023 年前部分覆盖当成完整备用证据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "datacenter-web.eastmoney.com") {
          return new Response("", { status: 503 });
        }
        return new Response(
          JSON.stringify(baiduPayload("2023-01-01", "2023-01-02", {})),
        );
      }),
    );
    await expect(
      fetchTradingSuspensions(
        ["603221"],
        "2022-12-30",
        "2023-01-02",
        { now: () => NOW, sleep: vi.fn() },
      ),
    ).rejects.toThrow("早于百度可验证覆盖起点");
  });

  it("主源失败时拒绝用百度未闭合记录推断最终复牌日", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "datacenter-web.eastmoney.com") {
          return new Response("", { status: 503 });
        }
        return new Response(
          JSON.stringify(
            baiduPayload("2026-08-03", "2026-08-06", {
              "2026-08-03": [
                {
                  code: "603221",
                  exchange: "SH",
                  market: "ab",
                  start: "2026-08-03",
                  end: null,
                  date: "2026-08-03",
                },
              ],
            }),
          ),
        );
      }),
    );
    await expect(
      fetchTradingSuspensions(
        ["603221"],
        "2026-08-03",
        "2026-08-06",
        { now: () => NOW, sleep: vi.fn() },
      ),
    ).rejects.toThrow("不能证明最终复牌日");
  });
});

describe("ETF 基金公告停牌适配器", () => {
  function fundAnnouncementListPayload(
    rows: Array<Record<string, unknown>>,
    totalCount?: number,
  ): string {
    return `cb({"Data":${JSON.stringify(rows)},"TotalCount":${totalCount ?? rows.length},"ErrCode":0})`;
  }

  function fundAnnouncementContentPayload(
    title: string,
    content: string,
  ): string {
    return JSON.stringify({
      success: 1,
      data: { notice_title: title, notice_content: content },
    });
  }

  it.each([
    ["159211", true],
    ["510300", true],
    ["588000", true],
    ["562500", true],
    ["600519", false],
    ["000001", false],
    ["300750", false],
    ["688981", false],
    ["500001", false],
    ["501001", false],
  ] as const)("isEtfSymbol(%s) === %s", (symbol, expected) => {
    expect(isEtfSymbol(symbol)).toBe(expected);
  });

  it("从会议情况公告正文解析完整停牌区间（复牌日不在区间内）", () => {
    const content =
      "二、重要提示\n\n  1、本基金已于 2026 年 8 月 3 日开市起停牌，并将自 2026 年 8 月 4 日 10:30 起复牌。\n\n  2、基金管理人将就本次会议情况报中国证券监督管理委员会备案。";
    expect(parseFundAnnouncementSuspensionInterval(content)).toEqual({
      startDate: "2026-08-03",
      endDate: "2026-08-03",
    });
  });

  it("无法从不含复牌表述的正文解析完整区间", () => {
    const content =
      "为保护基金份额持有人利益，本基金自 2026 年 8 月 3 日开市起至决议生效公告日 10:30 停牌。";
    expect(parseFundAnnouncementSuspensionInterval(content)).toBeNull();
  });

  it("从开始停牌提示性公告正文提取停牌开始日", () => {
    const content =
      "为保护基金份额持有人利益，本基金（自 2026 年 8 月 3 日）开市起至基金份额持有人大会决议生效公告日 10:30 停牌（如决议生效公告日为非交易日，则公告日后首个交易日开市起复牌）。";
    expect(parseFundAnnouncementSuspensionStart(content)).toBe("2026-08-03");
  });

  it("从含完整停牌复牌表述的公告解析精确区间", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.fund.eastmoney.com") {
        return new Response(
          fundAnnouncementListPayload([
            {
              FUNDCODE: "159211",
              TITLE:
                "富国深证100交易型开放式指数证券投资基金停牌及复牌公告",
              PUBLISHDATE: "2026-08-04T00:00:00",
              ID: "AN202608031827589392",
            },
          ]),
        );
      }
      if (url.hostname === "np-cnotice-fund.eastmoney.com") {
        return new Response(
          fundAnnouncementContentPayload(
            "停牌及复牌公告",
            "二、重要提示\n\n  1、本基金已于 2026 年 8 月 3 日开市起停牌，并将自 2026 年 8 月 4 日 10:30 起复牌。",
          ),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEastmoneyFundAnnouncementSuspensions(
      ["159211"],
      "2026-08-01",
      "2026-08-06",
      { now: () => NOW, sleep: vi.fn() },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "159211",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      reason: "suspension",
      source: EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
    });
    expect(result.sourceKey).toBe(
      EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
    );
    expect(result.coverageStart).toBe("2026-08-01");
    expect(result.coverageEnd).toBe("2026-08-06");
  });

  it("从开始停牌提示性公告回退单日假设并排除估值类公告", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.fund.eastmoney.com") {
        return new Response(
          fundAnnouncementListPayload([
            {
              FUNDCODE: "159211",
              TITLE:
                "富国基金管理有限公司关于富国深证100交易型开放式指数证券投资基金基金份额持有人大会计票日开始停牌的提示性公告",
              PUBLISHDATE: "2026-08-03T00:00:00",
              ID: "AN202608021827568724",
            },
            {
              FUNDCODE: "159211",
              TITLE:
                "富国基金管理有限公司关于调整旗下基金长期停牌股票估值方法的公告",
              PUBLISHDATE: "2026-08-03T00:00:00",
              ID: "AN202608021827568725",
            },
          ]),
        );
      }
      if (url.hostname === "np-cnotice-fund.eastmoney.com") {
        return new Response(
          fundAnnouncementContentPayload(
            "开始停牌提示性公告",
            "为保护基金份额持有人利益，本基金（自 2026 年 8 月 3 日）开市起至基金份额持有人大会决议生效公告日 10:30 停牌。",
          ),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEastmoneyFundAnnouncementSuspensions(
      ["159211"],
      "2026-08-03",
      "2026-08-06",
      { now: () => NOW, sleep: vi.fn() },
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      symbol: "159211",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      source: EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
    });
    // 估值类公告被排除，只获取"开始停牌提示性公告"的正文
    const contentCalls = fetchMock.mock.calls.filter((call) => {
      const url = new URL(String(call[0]));
      return url.hostname === "np-cnotice-fund.eastmoney.com";
    });
    expect(contentCalls).toHaveLength(1);
  });

  it("无停牌公告时返回空结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.fund.eastmoney.com") {
          return new Response(fundAnnouncementListPayload([]));
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    const result = await fetchEastmoneyFundAnnouncementSuspensions(
      ["159211"],
      "2026-08-03",
      "2026-08-06",
      { now: () => NOW, sleep: vi.fn() },
    );

    expect(result.rows).toEqual([]);
    expect(result.sourceKey).toBe(
      EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
    );
  });

  it("JSONP 解析失败时抛结构错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not a valid jsonp")),
    );

    await expect(
      fetchEastmoneyFundAnnouncementSuspensions(
        ["159211"],
        "2026-08-03",
        "2026-08-06",
        { now: () => NOW, sleep: vi.fn() },
      ),
    ).rejects.toThrow("JSONP");
  });
});
