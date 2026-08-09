import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchVerifiedCorporateActions,
  parseEastmoneyEtfDividends,
  parseSinaEtfDividends,
  parseThsCorporateActions,
} from "./corporateActions";

afterEach(() => {
  vi.unstubAllGlobals();
});

const THS_HTML = `
<table class="m_table m_hl mt15" id="bonus_table"><thead><tr><th>报告期</th></tr></thead><tbody>
<tr class="J_pageritem"><td>2025三季报</td><td>2025-11-06</td><td>2025-11-29</td><td>2025-12-11</td><td>10派239.57元(含税)</td><td>2025-12-18</td><td>2025-12-19</td><td>300亿</td><td>实施方案</td><td>46%</td><td>1%</td></tr>
<tr class="J_pageritem"><td>2025中报</td><td>2025-08-13</td><td>--</td><td>--</td><td>不分配不转增</td><td>--</td><td>--</td><td>--</td><td>董事会预案</td><td>--</td><td>--</td></tr>
</tbody></table>
<div id="stockallot"><div id="stockallotdata"><table class="m_table pggk mt10"><caption>方案进度：<strong>已实施</strong> 配股代码：760916</caption><tbody><tr><td>实际配股比例：<strong>10 配 3 股</strong></td><td>配股上市日：<strong>2023-07-06</strong></td></tr><tr><td>每股配股价格：<strong>2.02 元</strong></td><td>缴款起止日：2023-06-15 到 2023-06-21</td></tr><tr><td>除权日：2023-06-27</td><td>股权登记日：2023-06-14</td></tr></tbody></table></div></div>`;

const SINA_ETF_PAYLOAD = `var sh510050hfq={"total":3,"data":[{"d":"1900-01-01","u":"0"},{"d":"2024-12-02","u":"0.055"},{"d":"2025-12-17","u":"0.135"}]}`;
const EASTMONEY_ETF_HTML = `<table><thead><tr><th>年份</th><th>权益登记日</th><th>除息日</th><th>每10份分红</th><th>分红发放日</th></tr></thead><tbody><tr><td>2025年</td><td>2025-12-16</td><td>2025-12-17</td><td>每10份派现金0.8000元</td><td>2025-12-22</td></tr><tr><td>2024年</td><td>2024-11-29</td><td>2024-12-02</td><td>每10份派现金0.5500元</td><td>2024-12-05</td></tr></tbody></table>`;
const CHANGJIANG_THS_HTML = `<table id="bonus_table"><tbody><tr><td>2015年报</td><td>2016-04-28</td><td>2016-05-20</td><td>2016-07-12</td><td>10派4元(含税)</td><td>2016-07-18</td><td>2016-07-19</td><td>220亿</td><td>实施方案</td><td>--</td><td>--</td></tr></tbody></table><div id="stockallotdata"></div>`;
const CHANGJIANG_EASTMONEY_ROW = {
  SECURITY_CODE: "600900",
  SECURITY_NAME_ABBR: "长江电力",
  REPORT_DATE: "2015-12-31",
  PLAN_NOTICE_DATE: "2016-04-29",
  NOTICE_DATE: "2016-07-13",
  PUBLISH_DATE: "2016-04-29",
  ASSIGN_PROGRESS: "实施分配",
  EX_DIVIDEND_DATE: "2016-07-19",
  EQUITY_RECORD_DATE: "2016-07-18",
  PRETAX_BONUS_RMB: 1.2946,
  IT_RATIO: 0,
  BONUS_RATIO: 0,
  IMPL_PLAN_PROFILE: "10派1.2946元(含税,扣税后1.16514元)",
};

function asciiHtml(value: string): string {
  return [...value]
    .map((character) =>
      character.codePointAt(0)! > 127
        ? `&#${character.codePointAt(0)};`
        : character,
    )
    .join("");
}

function stubChangjiangSources(
  eastmoneyRow: Record<string, unknown> = CHANGJIANG_EASTMONEY_ROW,
  thsStatus = 200,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "basic.10jqka.com.cn") {
        return new Response(
          thsStatus === 200 ? asciiHtml(CHANGJIANG_THS_HTML) : "unavailable",
          { status: thsStatus },
        );
      }
      if (url.hostname === "datacenter-web.eastmoney.com") {
        const data = url.searchParams.get("reportName") === "RPT_SHAREBONUS_DET"
          ? [eastmoneyRow]
          : [];
        return Response.json({ code: 0, success: true, result: { data } });
      }
      throw new Error(`unexpected request: ${url}`);
    }),
  );
}

describe("同花顺股票公司行动备用适配器", () => {
  it("解析已实施分红与配股，并跳过未实施方案", () => {
    const result = parseThsCorporateActions(
      THS_HTML,
      "601916",
      "2023-01-01",
      "2025-12-31",
    );
    expect(result.rows).toEqual([
      {
        date: "2025-12-19",
        recordDate: "2025-12-18",
        paymentDate: null,
        perShare: 23.957,
        transferRatio: 0,
        bonusRatio: 0,
        status: "实施方案",
      },
    ]);
    expect(result.reportedActions).toEqual([
      {
        type: "rights_issue",
        sourceId: "760916",
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

  it("已实施行字段漂移时失败而不是解释为空", () => {
    expect(() =>
      parseThsCorporateActions(
        THS_HTML.replace("2025-12-19", "--"),
        "601916",
        "2023-01-01",
        "2025-12-31",
      ),
    ).toThrow("缺少有效登记日或除权日");
  });
});

describe("ETF 分红双源适配器", () => {
  it("从新浪累计值计算单次分红，并与东方财富每十份口径对齐", () => {
    expect(
      parseSinaEtfDividends(
        SINA_ETF_PAYLOAD,
        "2024-01-01",
        "2025-12-31",
      ).map(({ date, perShare }) => ({ date, perShare })),
    ).toEqual([
      { date: "2024-12-02", perShare: 0.055 },
      { date: "2025-12-17", perShare: 0.08 },
    ]);
    expect(
      parseEastmoneyEtfDividends(
        EASTMONEY_ETF_HTML,
        "2024-01-01",
        "2025-12-31",
      ),
    ).toEqual([
      expect.objectContaining({ date: "2024-12-02", perShare: 0.055 }),
      expect.objectContaining({ date: "2025-12-17", perShare: 0.08 }),
    ]);
  });

  it("双源一致时返回校验通过的 ETF 分红证据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "finance.sina.com.cn") {
          return new Response(SINA_ETF_PAYLOAD);
        }
        if (url.hostname === "fundf10.eastmoney.com") {
          return new Response(EASTMONEY_ETF_HTML);
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const result = await fetchVerifiedCorporateActions(
      "510050",
      "etf",
      "2024-01-01",
      "2025-12-31",
    );
    expect(result.rows[1]).toMatchObject({
      date: "2025-12-17",
      recordDate: "2025-12-16",
      paymentDate: "2025-12-22",
      perShare: 0.08,
    });
    expect(result.provenance.source).toContain("重合 2 条");
  });

  it("双源金额冲突时阻断，新浪失败时可整段切换东方财富", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "finance.sina.com.cn") {
        return new Response(SINA_ETF_PAYLOAD.replace('"0.135"', '"0.145"'));
      }
      return new Response(EASTMONEY_ETF_HTML);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchVerifiedCorporateActions(
        "510050",
        "etf",
        "2024-01-01",
        "2025-12-31",
      ),
    ).rejects.toThrow("双源证据不一致");

    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "finance.sina.com.cn") {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(EASTMONEY_ETF_HTML);
    });
    const fallback = await fetchVerifiedCorporateActions(
      "510050",
      "etf",
      "2024-01-01",
      "2025-12-31",
    );
    expect(fallback.provenance).toMatchObject({
      fallbackUsed: true,
      fallbackReason: expect.stringContaining("503"),
    });
  });

  it("一方漏项时合并已实施记录并显式报告覆盖差异", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "finance.sina.com.cn") {
          return new Response(SINA_ETF_PAYLOAD);
        }
        if (url.hostname === "fundf10.eastmoney.com") {
          return new Response(
            EASTMONEY_ETF_HTML.replace(
              /<tr><td>2024年[\s\S]*?<\/tr>/,
              "",
            ),
          );
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const result = await fetchVerifiedCorporateActions(
      "510050",
      "etf",
      "2024-01-01",
      "2025-12-31",
    );
    expect(result.rows.map((row) => row.date)).toEqual([
      "2024-12-02",
      "2025-12-17",
    ]);
    expect(result.provenance.source).toContain("新浪独有 1 条");
  });

  it("两源疑似同一事件但除息日相邻时阻断，避免重复分红", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "finance.sina.com.cn") {
          return new Response(SINA_ETF_PAYLOAD);
        }
        if (url.hostname === "fundf10.eastmoney.com") {
          return new Response(
            EASTMONEY_ETF_HTML.replaceAll("2025-12-17", "2025-12-18"),
          );
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    await expect(
      fetchVerifiedCorporateActions(
        "510050",
        "etf",
        "2024-01-01",
        "2025-12-31",
      ),
    ).rejects.toThrow("疑似同一事件的日期不一致");
  });
});

describe("股票公司行动双源合并", () => {
  it("保留同花顺独有的已实施分红和配股，不让东财漏项静默消失", async () => {
    const thsWithSpecialDividend = THS_HTML.replace(
      "<tr class=\"J_pageritem\"><td>2025中报</td>",
      '<tr class="J_pageritem"><td>2023三季报</td><td>2023-11-20</td><td>2023-11-29</td><td>2023-12-13</td><td>10派191.06元(含税)</td><td>2023-12-19</td><td>2023-12-20</td><td>240亿</td><td>实施方案</td><td>50%</td><td>1%</td></tr><tr class="J_pageritem"><td>2025中报</td>',
    );
    const asciiThs = asciiHtml(thsWithSpecialDividend);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "basic.10jqka.com.cn") {
          return new Response(asciiThs);
        }
        if (url.hostname === "datacenter-web.eastmoney.com") {
          const reportName = url.searchParams.get("reportName");
          const data = reportName === "RPT_SHAREBONUS_DET"
            ? [{
                SECURITY_CODE: "600519",
                REPORT_DATE: "2025-09-30",
                ASSIGN_PROGRESS: "实施分配",
                EX_DIVIDEND_DATE: "2025-12-19",
                EQUITY_RECORD_DATE: "2025-12-18",
                PRETAX_BONUS_RMB: 239.57,
                IT_RATIO: 0,
                BONUS_RATIO: 0,
              }]
            : [];
          return Response.json({ code: 0, success: true, result: { data } });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );
    const result = await fetchVerifiedCorporateActions(
      "600519",
      "stock",
      "2023-01-01",
      "2025-12-31",
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ date: "2023-12-20", perShare: 19.106 }),
      expect.objectContaining({ date: "2025-12-19", perShare: 23.957 }),
    ]);
    expect(result.reportedActions).toEqual([
      expect.objectContaining({ exDate: "2023-06-27", ratioPer10: 3 }),
    ]);
    expect(result.provenance.source).toContain("同花顺独有 1 条");
  });

  it("按官方公告将长江电力差异化分红校准为二级市场普通股权益", async () => {
    stubChangjiangSources();
    const result = await fetchVerifiedCorporateActions(
      "600900",
      "stock",
      "2016-01-01",
      "2016-12-31",
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        date: "2016-07-19",
        recordDate: "2016-07-18",
        paymentDate: "2016-07-19",
        perShare: 0.4,
        transferRatio: 0,
        bonusRatio: 0,
      }),
    ]);
    expect(result.provenance.source).toContain(
      "官方差异化分红校准 600900:2016-07-19",
    );
    expect(result.provenance.source).toContain("1202468389");
  });

  it("同花顺临时不可用时仍用官方指纹校准东财记录", async () => {
    stubChangjiangSources(CHANGJIANG_EASTMONEY_ROW, 503);
    const result = await fetchVerifiedCorporateActions(
      "600900",
      "stock",
      "2016-01-01",
      "2016-12-31",
    );
    expect(result.rows[0]).toMatchObject({
      date: "2016-07-19",
      paymentDate: "2016-07-19",
      perShare: 0.4,
    });
    expect(result.provenance.fallbackReason).toContain("503");
    expect(result.provenance.source).toContain("1202468389");
  });

  it("官方校准指纹近似但不相等时仍阻断并报告证券代码", async () => {
    stubChangjiangSources({
      ...CHANGJIANG_EASTMONEY_ROW,
      PRETAX_BONUS_RMB: 1.294,
      IMPL_PLAN_PROFILE: "10派1.294元(含税)",
    });
    await expect(
      fetchVerifiedCorporateActions(
        "600900",
        "stock",
        "2016-01-01",
        "2016-12-31",
      ),
    ).rejects.toThrow("股票 600900 分红送转在 2016-07-19 的双源证据不一致");
  });

  it("官方校准不接受东财每股金额的六位小数偏差", async () => {
    stubChangjiangSources({
      ...CHANGJIANG_EASTMONEY_ROW,
      PRETAX_BONUS_RMB: 1.29451,
      IMPL_PLAN_PROFILE: "10派1.29451元(含税)",
    });
    await expect(
      fetchVerifiedCorporateActions(
        "600900",
        "stock",
        "2016-01-01",
        "2016-12-31",
      ),
    ).rejects.toThrow("股票 600900 分红送转在 2016-07-19 的双源证据不一致");
  });
});
