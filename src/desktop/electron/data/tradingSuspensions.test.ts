import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAIDU_SUSPEND_SOURCE,
  EASTMONEY_SUSPEND_SOURCE,
  fetchBaiduTradingSuspensions,
  fetchTradingSuspensions,
  parseBaiduTradingSuspensions,
  parseSuspensionRow,
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
  it("东方财富开放区间只延伸到本次已观察截止日", () => {
    const row = parseSuspensionRow(
      {
        SECURITY_CODE: "300246",
        SECUCODE: "300246.SZ",
        SUSPEND_START_DATE: "2026-08-03 00:00:00",
        SUSPEND_END_TIME: null,
        PREDICT_RESUME_DATE: null,
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
});
