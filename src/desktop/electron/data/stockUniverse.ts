import ExcelJS from "exceljs";
import type {
  DirectoryProvenance,
  StockInfo,
} from "../../shared/contracts";
import {
  ETF_UNIVERSE_MIN_SIZE,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import { fetchWithTimeout } from "./_internal/httpClient";

const SSE_STOCK_LIST_URL =
  "https://query.sse.com.cn/sseQuery/commonQuery.do";
const SZSE_STOCK_LIST_URL = "https://www.szse.cn/api/report/ShowReport";
const BSE_STOCK_LIST_URL =
  "https://www.bse.cn/nqxxController/nqxxCnzq.do";
const SINA_ETF_LIST_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/jsonp.php/IO.XSRV2.CallbackList['da_yPT46_Ll7K6WD']/Market_Center.getHQNodeDataSimple";
const REQUEST_TIMEOUT_MS = 20_000;

interface ShanghaiStockListResponse {
  result?: Array<{
    A_STOCK_CODE?: string | number;
    SEC_NAME_CN?: string;
    LISTING_DATE?: string;
  }>;
}

interface BeijingStockListPage {
  totalPages?: number | string;
  content?: Array<
    | unknown[]
    | {
        xxzqdm?: string | number;
        xxzqjc?: string;
      }
  >;
}

function normalizeStockCode(value: string | number | undefined): string {
  const raw = String(value ?? "")
    .trim()
    .replace(/\.0+$/, "");
  return /^\d{1,6}$/.test(raw) ? raw.padStart(6, "0") : raw;
}

/**
 * 将交易所目录接口返回的上市日期归一化为 YYYY-MM-DD。
 *
 * 上交所返回 "2025-06-01" 或 "20250601"；深交所 Excel 单元格可能是
 * Date 对象或字符串。空字符串/非法值统一返回 undefined，
 * 让上游按"无上市日证据"处理（不阻断新上市股票回测）。
 */
function parseListingDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Handle YYYYMMDD format
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Handle other date formats by parsing
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return undefined;
}

function isAStock(stock: StockInfo): boolean {
  return (
    /^\d{6}$/.test(stock.symbol) &&
    stock.name.length > 0 &&
    stock.name !== "-"
  );
}

async function request(
  url: URL | string,
  label: string,
  init?: RequestInit,
  acceptedRedirectStatus?: number,
): Promise<Response> {
  const response = await fetchWithTimeout(url, {
    ...init,
    timeoutMs: REQUEST_TIMEOUT_MS,
    label,
  });
  if (!response.ok && response.status !== acceptedRedirectStatus) {
    throw new Error(`${label}请求失败：HTTP ${response.status}`);
  }
  return response;
}

export function parseShanghaiStocks(payload: unknown): StockInfo[] {
  const result = (payload as ShanghaiStockListResponse | null)?.result;
  if (!Array.isArray(result)) {
    throw new Error("上交所 A 股代码表响应格式已变化");
  }
  return result
    .map((row) => {
      const listingDate = parseListingDate(row.LISTING_DATE);
      return {
        symbol: normalizeStockCode(row.A_STOCK_CODE),
        name: String(row.SEC_NAME_CN ?? "").trim(),
        securityType: "stock" as const,
        ...(listingDate ? { listingDate } : {}),
      };
    })
    .filter(isAStock);
}

export async function parseShenzhenStocks(
  payload: ArrayBuffer,
): Promise<StockInfo[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(payload);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("深交所 A 股代码表工作簿为空");

  let headerRow = 0;
  let codeColumn = 0;
  let nameColumn = 0;
  let listingDateColumn = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (headerRow) return;
    row.eachCell((cell, columnNumber) => {
      const value = cell.text.trim();
      if (value === "A股代码") codeColumn = columnNumber;
      if (value === "A股简称") nameColumn = columnNumber;
      // 深交所 Excel 表头可能写作"A股上市日期"或"上市日期"
      if (value === "A股上市日期" || value === "上市日期") {
        listingDateColumn = columnNumber;
      }
    });
    if (codeColumn && nameColumn) headerRow = rowNumber;
  });
  if (!headerRow || !codeColumn || !nameColumn) {
    throw new Error("深交所 A 股代码表缺少代码或简称列");
  }

  const stocks: StockInfo[] = [];
  for (
    let rowNumber = headerRow + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const symbol = normalizeStockCode(
      worksheet.getCell(rowNumber, codeColumn).text,
    );
    const name = worksheet.getCell(rowNumber, nameColumn).text.trim();
    // 深交所单元格可能是 Date 对象或字符串；优先用 text，否则回退到 value
    const listingDateCell = listingDateColumn
      ? worksheet.getCell(rowNumber, listingDateColumn)
      : null;
    const listingDateRaw = listingDateCell
      ? listingDateCell.text ||
        (listingDateCell.value instanceof Date
          ? listingDateCell.value.toISOString().slice(0, 10)
          : String(listingDateCell.value ?? ""))
      : "";
    const listingDate = parseListingDate(listingDateRaw);
    const stock: StockInfo = {
      symbol,
      name,
      securityType: "stock",
      ...(listingDate ? { listingDate } : {}),
    };
    if (isAStock(stock)) stocks.push(stock);
  }
  return stocks;
}

export function parseBeijingStockPage(payload: string): {
  totalPages: number;
  rows: StockInfo[];
} {
  const start = payload.indexOf("[");
  const end = payload.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("北交所 A 股代码表响应格式已变化");
  }
  const pages = JSON.parse(
    payload.slice(start, end + 1),
  ) as BeijingStockListPage[];
  const page = pages[0];
  const totalPages = Number(page?.totalPages);
  if (!page || !Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error("北交所 A 股代码表缺少分页信息");
  }
  const rows = (Array.isArray(page.content) ? page.content : [])
    .map((row) => {
      const symbol = Array.isArray(row) ? row[38] : row.xxzqdm;
      const name = Array.isArray(row) ? row[40] : row.xxzqjc;
      return {
        symbol: normalizeStockCode(symbol as string | number | undefined),
        name: String(name ?? "").trim(),
        securityType: "stock" as const,
      };
    })
    .filter(isAStock);
  return { totalPages, rows };
}

export function mergeAStockUniverse(
  groups: readonly StockInfo[][],
): StockInfo[] {
  const unique = new Map<string, StockInfo>();
  for (const stock of groups.flat()) {
    if (!isAStock(stock)) continue;
    const existing = unique.get(stock.symbol);
    // 同一标的在多个来源出现时，优先保留带 listingDate 的版本
    // （例如沪市科创板在上交所主表与科创板表都出现）。
    if (!existing || (!existing.listingDate && stock.listingDate)) {
      unique.set(stock.symbol, stock);
    }
  }
  const rows = [...unique.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
  if (rows.length < STOCK_UNIVERSE_MIN_SIZE) {
    throw new Error(
      `A 股代码表不完整：仅返回 ${rows.length} 个标的，拒绝覆盖本地完整快照`,
    );
  }
  return rows;
}

export function parseSinaDomesticEtfs(payload: string): StockInfo[] {
  const start = payload.indexOf("([");
  const end = payload.lastIndexOf("])");
  if (start < 0 || end <= start) {
    throw new Error("新浪境内 ETF 代码表响应格式已变化");
  }
  let rows: unknown;
  try {
    rows = JSON.parse(payload.slice(start + 1, end + 1));
  } catch {
    throw new Error("新浪境内 ETF 代码表响应不是合法 JSONP");
  }
  if (!Array.isArray(rows)) {
    throw new Error("新浪境内 ETF 代码表缺少数据数组");
  }
  const unique = new Map<string, StockInfo>();
  for (const row of rows) {
    const record =
      row && typeof row === "object" && !Array.isArray(row)
        ? (row as Record<string, unknown>)
        : null;
    const marketCode = String(
      Array.isArray(row) ? row[0] : record?.["symbol"] ?? "",
    )
      .trim()
      .toLowerCase();
    const symbol = normalizeStockCode(
      record?.["code"] as string | number | undefined ??
        marketCode.replace(/^(sh|sz)/, ""),
    );
    const name = String(
      Array.isArray(row) ? row[1] : record?.["name"] ?? "",
    ).trim();
    if (
      !/^(sh|sz)\d{6}$/.test(marketCode) ||
      !/^\d{6}$/.test(symbol) ||
      !name ||
      name === "-"
    ) {
      continue;
    }
    unique.set(symbol, { symbol, name, securityType: "etf" });
  }
  return [...unique.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

async function fetchShanghaiStocks(stockType: "1" | "8"): Promise<StockInfo[]> {
  const url = new URL(SSE_STOCK_LIST_URL);
  const parameters: Record<string, string> = {
    STOCK_TYPE: stockType,
    REG_PROVINCE: "",
    CSRC_CODE: "",
    STOCK_CODE: "",
    sqlId: "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L",
    COMPANY_STATUS: "2,4,5,7,8",
    type: "inParams",
    isPagination: "true",
    "pageHelp.cacheSize": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.pageSize": "10000",
    "pageHelp.pageNo": "1",
    "pageHelp.endPage": "1",
  };
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await request(url, "上交所 A 股代码表", {
    headers: {
      Referer: "https://www.sse.com.cn/assortment/stock/list/share/",
    },
  });
  return parseShanghaiStocks(await response.json());
}

async function fetchShenzhenStocks(): Promise<StockInfo[]> {
  const url = new URL(SZSE_STOCK_LIST_URL);
  url.searchParams.set("SHOWTYPE", "xlsx");
  url.searchParams.set("CATALOGID", "1110");
  url.searchParams.set("TABKEY", "tab1");
  url.searchParams.set("random", String(Math.random()));
  const response = await request(url, "深交所 A 股代码表");
  return parseShenzhenStocks(await response.arrayBuffer());
}

function beijingRequestBody(page: number): URLSearchParams {
  return new URLSearchParams({
    page: String(page),
    typejb: "T",
    "xxfcbj[]": "2",
    xxzqdm: "",
    sortfield: "xxzqdm",
    sorttype: "asc",
  });
}

async function fetchBeijingPage(
  page: number,
  challengeCookie?: string,
): Promise<{
  totalPages: number;
  rows: StockInfo[];
  challengeCookie?: string;
}> {
  const send = (cookie?: string) =>
    request(
      BSE_STOCK_LIST_URL,
      "北交所 A 股代码表",
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: beijingRequestBody(page),
      },
      307,
    );
  let response = await send(challengeCookie);
  let nextCookie = challengeCookie;
  if (response.status === 307) {
    nextCookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (!nextCookie) {
      throw new Error("北交所 A 股代码表挑战响应缺少 Cookie");
    }
    response = await send(nextCookie);
  }
  if (!response.ok) {
    throw new Error(`北交所 A 股代码表请求失败：HTTP ${response.status}`);
  }
  return {
    ...parseBeijingStockPage(await response.text()),
    challengeCookie: nextCookie,
  };
}

async function fetchBeijingStocks(): Promise<StockInfo[]> {
  const firstPage = await fetchBeijingPage(0);
  const rows = [...firstPage.rows];
  let challengeCookie = firstPage.challengeCookie;
  for (let page = 1; page < firstPage.totalPages; page += 1) {
    const nextPage = await fetchBeijingPage(page, challengeCookie);
    challengeCookie = nextPage.challengeCookie ?? challengeCookie;
    rows.push(...nextPage.rows);
  }
  return rows;
}

async function fetchSinaDomesticEtfs(): Promise<StockInfo[]> {
  const url = new URL(SINA_ETF_LIST_URL);
  url.searchParams.set("page", "1");
  url.searchParams.set("num", "5000");
  url.searchParams.set("sort", "symbol");
  url.searchParams.set("asc", "0");
  url.searchParams.set("node", "etf_hq_fund");
  const response = await request(url, "新浪境内 ETF 代码表", {
    headers: {
      Referer: "https://vip.stock.finance.sina.com.cn/fund_center/",
    },
  });
  const rows = parseSinaDomesticEtfs(await response.text());
  if (rows.length < ETF_UNIVERSE_MIN_SIZE) {
    throw new Error(
      `新浪境内 ETF 代码表不完整：仅返回 ${rows.length} 个标的`,
    );
  }
  return rows;
}

export async function fetchDomesticEtfUniverse(): Promise<
  { rows: StockInfo[] } & DirectoryProvenance
> {
  return {
    rows: await fetchSinaDomesticEtfs(),
    source: "新浪财经境内交易所 ETF 代码表",
    primarySource: "sina",
    fallbackUsed: false,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 获取沪深京交易所的全 A 股代码、名称与可用上市日期。
 *
 * 产品端保持纯 Node.js，直接调用三家交易所公开接口，不执行 Python 或
 * AKShare。只有三地合并后的目录通过完整性校验，服务层才会覆盖 SQLite
 * 成功快照。
 */
export async function fetchAStockUniverse(): Promise<{
  rows: StockInfo[];
} & DirectoryProvenance> {
  const [shMain, shStar, shenzhen, beijing] = await Promise.all([
    fetchShanghaiStocks("1"),
    fetchShanghaiStocks("8"),
    fetchShenzhenStocks(),
    fetchBeijingStocks(),
  ]);
  return {
    rows: mergeAStockUniverse([shMain, shStar, shenzhen, beijing]),
    fetchedAt: new Date().toISOString(),
    source: "上交所、深交所、北交所 A 股代码表（产品域独立适配）",
    primarySource: "official-exchanges",
    fallbackUsed: false,
  };
}
