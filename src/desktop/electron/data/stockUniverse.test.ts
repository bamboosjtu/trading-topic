import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ETF_UNIVERSE_MIN_SIZE,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import {
  fetchAStockUniverse,
  fetchDomesticEtfUniverse,
  fetchInstrumentUniverse,
  mergeAStockUniverse,
  parseBeijingStockPage,
  parseDomesticEtfs,
  parseSinaDomesticEtfs,
  parseShanghaiStocks,
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

describe("A 股代码表", () => {
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

  it("解析境内 ETF 目录并显式标记资产类型", () => {
    expect(
      parseDomesticEtfs({
        data: {
          diff: {
            0: { f12: "510300", f14: "沪深300ETF" },
            1: { f12: "159915", f14: "创业板ETF" },
          },
        },
      }),
    ).toEqual([
      { symbol: "159915", name: "创业板ETF", securityType: "etf" },
      { symbol: "510300", name: "沪深300ETF", securityType: "etf" },
    ]);
  });

  it("解析新浪 ETF 目录 JSONP 兜底并忽略非法行", () => {
    expect(
      parseSinaDomesticEtfs(
        `IO.XSRV2.CallbackList['test']([["sh510300","沪深300ETF"],["sz159915","创业板ETF"],["bad","-"]]);`,
      ),
    ).toEqual([
      { symbol: "159915", name: "创业板ETF", securityType: "etf" },
      { symbol: "510300", name: "沪深300ETF", securityType: "etf" },
    ]);
  });

  it("东方财富目录失败时由新浪返回完整 ETF 目录", async () => {
    const etfs = Array.from(
      { length: ETF_UNIVERSE_MIN_SIZE },
      (_, index) => [
        `${index % 2 ? "sz" : "sh"}${String(510000 + index)}`,
        `ETF示例${index}`,
      ],
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "push2.eastmoney.com") {
        return new Response("", { status: 503 });
      }
      if (url.hostname === "vip.stock.finance.sina.com.cn") {
        return new Response(`callback(${JSON.stringify(etfs)});`);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await fetchDomesticEtfUniverse();

    expect(result).toHaveLength(ETF_UNIVERSE_MIN_SIZE);
    expect(result[0]).toMatchObject({ securityType: "etf" });
  });

  it("拒绝把少量标的误当成全 A 股目录", () => {
    expect(() =>
      mergeAStockUniverse([
        [
          { symbol: "601398", name: "工商银行" },
          { symbol: "601288", name: "农业银行" },
        ],
      ]),
    ).toThrow("A 股代码表不完整");
  });

  it("按 AkShare 当前口径合并沪深京三家交易所的 A 股列表", async () => {
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

  it("证券目录同时包含完整 A 股和境内 ETF", async () => {
    const shenzhen = await shenzhenFixture();
    const shMain = Array.from({ length: STOCK_UNIVERSE_MIN_SIZE }, (_, index) => ({
      A_STOCK_CODE: String(600000 + index),
      SEC_NAME_CN: `沪市股票${index}`,
    }));
    const etfs = Array.from({ length: ETF_UNIVERSE_MIN_SIZE }, (_, index) => ({
      f12: String(510000 + index),
      f14: `ETF示例${index}`,
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "query.sse.com.cn") {
        return new Response(
          JSON.stringify({
            result:
              url.searchParams.get("STOCK_TYPE") === "8"
                ? [{ A_STOCK_CODE: "688001", SEC_NAME_CN: "科创示例" }]
                : shMain,
          }),
        );
      }
      if (url.hostname === "www.szse.cn") return new Response(shenzhen);
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
      if (url.hostname === "push2.eastmoney.com") {
        const page = Number(url.searchParams.get("pn"));
        const pageSize = Number(url.searchParams.get("pz"));
        return new Response(
          JSON.stringify({
            rc: 0,
            data: {
              total: ETF_UNIVERSE_MIN_SIZE,
              diff: etfs.slice((page - 1) * pageSize, page * pageSize),
            },
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await fetchInstrumentUniverse();
    expect(
      result.rows.filter((row) => row.securityType === "etf"),
    ).toHaveLength(ETF_UNIVERSE_MIN_SIZE);
    expect(result.rows).toContainEqual({
      symbol: "510000",
      name: "ETF示例0",
      securityType: "etf",
    });
  });
});
