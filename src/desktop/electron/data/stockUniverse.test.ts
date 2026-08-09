import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ETF_UNIVERSE_MIN_SIZE,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import {
  fetchAStockUniverse,
  fetchDomesticEtfUniverse,
  mergeAStockUniverse,
  parseBeijingStockPage,
  parseSinaDomesticEtfs,
  parseShanghaiEtfs,
  parseShanghaiStocks,
  parseShenzhenEtfs,
  parseShenzhenStocks,
} from "./stockUniverse";

afterEach(() => {
  vi.restoreAllMocks();
});

async function shenzhenFixture(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("A股列表");
  worksheet.addRow(["板块", "A股代码", "A股简称"]);
  worksheet.addRow(["主板", 1, "平安银行"]);
  return workbook.xlsx.writeBuffer();
}

async function shenzhenEtfFixture(
  rows: ReadonlyArray<[string, string]>,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("ETF列表");
  worksheet.addRow(["证券代码", "证券简称", "拟合指数"]);
  for (const [symbol, name] of rows) worksheet.addRow([symbol, name, "示例指数"]);
  return workbook.xlsx.writeBuffer();
}

describe("A 股与 ETF 证券代码目录", () => {
  it("解析上交所 JSON、深交所工作簿和北交所分页响应", async () => {
    expect(
      parseShanghaiStocks({
        result: [
          { A_STOCK_CODE: "600000", SEC_NAME_CN: "浦发银行" },
          { A_STOCK_CODE: "-", SEC_NAME_CN: "-" },
        ],
      }),
    ).toEqual([
      { symbol: "600000", name: "浦发银行", securityType: "stock" },
    ]);

    await expect(parseShenzhenStocks(await shenzhenFixture())).resolves.toEqual([
      { symbol: "000001", name: "平安银行", securityType: "stock" },
    ]);

    expect(
      parseBeijingStockPage(
        `callback(${JSON.stringify([
          {
            totalPages: 1,
            content: [{ xxzqdm: "920001", xxzqjc: "北交所示例" }],
          },
        ])})`,
      ),
    ).toEqual({
      totalPages: 1,
      rows: [
        { symbol: "920001", name: "北交所示例", securityType: "stock" },
      ],
    });
  });

  it("解析新浪 ETF 目录 JSONP 并忽略非法行", () => {
    expect(
      parseSinaDomesticEtfs(
        `IO.XSRV2.CallbackList['test']([["sh510300","沪深300ETF"],["sz159915","创业板ETF"],["bad","-"]]);`,
      ),
    ).toEqual([
      { symbol: "159915", name: "创业板ETF", securityType: "etf" },
      { symbol: "510300", name: "沪深300ETF", securityType: "etf" },
    ]);
  });

  it("严格解析沪深交易所官方 ETF 目录", async () => {
    expect(
      parseShanghaiEtfs({
        result: [
          {
            fundCode: "510300",
            secNameFull: "华泰柏瑞沪深300交易型开放式指数证券投资基金",
            listingDate: "20120528",
          },
        ],
        pageHelp: { total: 1 },
      }),
    ).toEqual([
      {
        symbol: "510300",
        name: "华泰柏瑞沪深300交易型开放式指数证券投资基金",
        securityType: "etf",
        listingDate: "2012-05-28",
      },
    ]);
    await expect(
      parseShenzhenEtfs(
        await shenzhenEtfFixture([["159915", "创业板ETF"]]),
      ),
    ).resolves.toEqual([
      { symbol: "159915", name: "创业板ETF", securityType: "etf" },
    ]);
    expect(() =>
      parseShanghaiEtfs({ result: [], pageHelp: { total: 1 } }),
    ).toThrow("分页不完整");
  });

  it("以新浪为主目录，并用沪深交易所官方目录校验和补全", async () => {
    const shCount = Math.ceil(ETF_UNIVERSE_MIN_SIZE / 2);
    const shRows = Array.from({ length: shCount }, (_, index) => ({
      fundCode: String(510000 + index),
      secNameFull: `沪市官方ETF${index}`,
      listingDate: "2020-01-01",
    }));
    const szRows = Array.from(
      { length: ETF_UNIVERSE_MIN_SIZE - shCount },
      (_, index): [string, string] => [
        String(159000 + index),
        `深市官方ETF${index}`,
      ],
    );
    const etfs = [
      ...shRows.map((row, index) => [
        `sh${row.fundCode}`,
        `新浪沪市ETF${index}`,
      ]),
      ...szRows.map(([symbol], index) => [
        `sz${symbol}`,
        `新浪深市ETF${index}`,
      ]),
    ];
    const shenzhenEtfs = await shenzhenEtfFixture(szRows);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "vip.stock.finance.sina.com.cn") {
        return new Response(`callback(${JSON.stringify(etfs)});`);
      }
      if (url.hostname === "query.sse.com.cn") {
        return new Response(
          JSON.stringify({
            result: shRows,
            pageHelp: { total: shRows.length },
          }),
        );
      }
      if (url.hostname === "www.szse.cn") {
        return new Response(shenzhenEtfs);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await fetchDomesticEtfUniverse();

    expect(result.rows).toHaveLength(ETF_UNIVERSE_MIN_SIZE);
    expect(result.rows[0]).toMatchObject({ securityType: "etf" });
    expect(result).toMatchObject({
      source: expect.stringContaining("沪深交易所官方目录校验并补全"),
      primarySource: "sina",
      fallbackUsed: false,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("新浪目录失败时整段切换沪深交易所官方目录", async () => {
    const shRows = Array.from(
      { length: ETF_UNIVERSE_MIN_SIZE },
      (_, index) => ({
        fundCode: String(510000 + index),
        secNameFull: `沪市官方ETF${index}`,
      }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "vip.stock.finance.sina.com.cn") {
        return new Response("upstream unavailable", { status: 503 });
      }
      if (url.hostname === "query.sse.com.cn") {
        return new Response(
          JSON.stringify({ result: shRows, pageHelp: { total: shRows.length } }),
        );
      }
      if (url.hostname === "www.szse.cn") {
        return new Response(await shenzhenEtfFixture([]));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const result = await fetchDomesticEtfUniverse();
    expect(result).toMatchObject({
      primarySource: "sina",
      fallbackUsed: true,
      fallbackReason: expect.stringContaining("HTTP 503"),
      source: expect.stringContaining("官方 ETF 代码表"),
    });
  });

  it("拒绝把少量标的误当成全 A 股目录", () => {
    expect(() =>
      mergeAStockUniverse([
        [
          { symbol: "601398", name: "工商银行", securityType: "stock" },
          { symbol: "601288", name: "农业银行", securityType: "stock" },
        ],
      ]),
    ).toThrow("A 股代码表不完整");
  });

  it("合并沪深京三家交易所的完整 A 股列表", async () => {
    const shenzhen = await shenzhenFixture();
    const shMain = Array.from({ length: STOCK_UNIVERSE_MIN_SIZE }, (_, index) => ({
      A_STOCK_CODE: String(600000 + index),
      SEC_NAME_CN: `沪市股票${index}`,
    }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname === "query.sse.com.cn") {
          const isStar = url.searchParams.get("STOCK_TYPE") === "8";
          return new Response(
            JSON.stringify({
              result: isStar
                ? [{ A_STOCK_CODE: "688001", SEC_NAME_CN: "科创示例" }]
                : shMain,
            }),
          );
        }
        if (url.hostname === "www.szse.cn") {
          return new Response(shenzhen);
        }
        if (url.hostname === "www.bse.cn") {
          const headers = new Headers(init?.headers);
          if (!headers.has("Cookie")) {
            return new Response("", {
              status: 307,
              headers: {
                Location: String(url),
                "Set-Cookie": "C3VK=test-cookie; Max-Age=300; Path=/",
              },
            });
          }
          return new Response(
            `callback(${JSON.stringify([
              {
                totalPages: 1,
                content: [{ xxzqdm: "920001", xxzqjc: "北交所示例" }],
              },
            ])})`,
          );
        }
        throw new Error(`unexpected request: ${url}`);
      });

    const result = await fetchAStockUniverse();

    expect(result.rows).toHaveLength(STOCK_UNIVERSE_MIN_SIZE + 3);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { symbol: "000001", name: "平安银行", securityType: "stock" },
        { symbol: "600000", name: "沪市股票0", securityType: "stock" },
        { symbol: "688001", name: "科创示例", securityType: "stock" },
        { symbol: "920001", name: "北交所示例", securityType: "stock" },
      ]),
    );
    expect(result.source).toContain("上交所、深交所、北交所");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
