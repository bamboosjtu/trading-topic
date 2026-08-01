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
const EASTMONEY_ETF_LIST_URL =
  "https://push2.eastmoney.com/api/qt/clist/get";
const SINA_ETF_LIST_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/jsonp.php/IO.XSRV2.CallbackList['da_yPT46_Ll7K6WD']/Market_Center.getHQNodeDataSimple";
const REQUEST_TIMEOUT_MS = 20_000;

interface ShanghaiStockListResponse {
  result?: Array<{
    A_STOCK_CODE?: string | number;
    SEC_NAME_CN?: string;
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

interface EastmoneyEtfListResponse {
  rc?: number;
  data?: {
    total?: number | string;
    diff?: Array<{ f12?: string | number; f14?: string }> | Record<
      string,
      { f12?: string | number; f14?: string }
    >;
  } | null;
}

function normalizeStockCode(value: string | number | undefined): string {
  const raw = String(value ?? "")
    .trim()
    .replace(/\.0+$/, "");
  return /^\d{1,6}$/.test(raw) ? raw.padStart(6, "0") : raw;
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
    .map((row) => ({
      symbol: normalizeStockCode(row.A_STOCK_CODE),
      name: String(row.SEC_NAME_CN ?? "").trim(),
      securityType: "stock" as const,
    }))
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
  worksheet.eachRow((row, rowNumber) => {
    if (headerRow) return;
    row.eachCell((cell, columnNumber) => {
      const value = cell.text.trim();
      if (value === "A股代码") codeColumn = columnNumber;
      if (value === "A股简称") nameColumn = columnNumber;
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
    const stock = { symbol, name, securityType: "stock" as const };
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
    if (isAStock(stock)) unique.set(stock.symbol, stock);
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

export function parseDomesticEtfs(payload: unknown): StockInfo[] {
  const diff = (payload as EastmoneyEtfListResponse | null)?.data?.diff;
  if (!Array.isArray(diff) && (!diff || typeof diff !== "object")) {
    throw new Error("境内 ETF 代码表响应格式已变化");
  }
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  const unique = new Map<string, StockInfo>();
  for (const row of items) {
    const symbol = normalizeStockCode(row.f12);
    const name = String(row.f14 ?? "").trim();
    if (!/^\d{6}$/.test(symbol) || !name || name === "-") continue;
    unique.set(symbol, { symbol, name, securityType: "etf" });
  }
  return [...unique.values()].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
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

async function fetchEastmoneyDomesticEtfs(): Promise<StockInfo[]> {
  const pageSize = 100;
  const fetchPage = async (page: number): Promise<{
    rows: StockInfo[];
    total: number;
  }> => {
    const url = new URL(EASTMONEY_ETF_LIST_URL);
    const parameters: Record<string, string> = {
      pn: String(page),
      pz: String(pageSize),
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f12",
      fs: "b:MK0021,b:MK0022,b:MK0023,b:MK0024",
      fields: "f12,f14",
    };
    Object.entries(parameters).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    const response = await request(url, `境内 ETF 代码表第 ${page} 页`, {
      headers: {
        Referer: "https://quote.eastmoney.com/center/gridlist.html",
      },
    });
    const payload = (await response.json()) as EastmoneyEtfListResponse;
    const total = Number(payload.data?.total);
    if (
      payload.rc !== 0 ||
      !Number.isInteger(total) ||
      total < ETF_UNIVERSE_MIN_SIZE
    ) {
      throw new Error("境内 ETF 代码表缺少有效总数或返回错误状态");
    }
    return { rows: parseDomesticEtfs(payload), total };
  };

  const first = await fetchPage(1);
  const groups = [first.rows];
  const totalPages = Math.ceil(first.total / pageSize);
  // 接口单页上限为 100；分批并发以兼顾启动速度和数据源限流风险。
  for (let start = 2; start <= totalPages; start += 4) {
    groups.push(
      ...(await Promise.all(
        Array.from(
          { length: Math.min(4, totalPages - start + 1) },
          (_, index) => fetchPage(start + index).then((page) => page.rows),
        ),
      )),
    );
  }
  const rows = parseDomesticEtfs({
    data: {
      diff: groups.flat().map(({ symbol, name }) => ({
        f12: symbol,
        f14: name,
      })),
    },
  });
  if (rows.length < ETF_UNIVERSE_MIN_SIZE) {
    throw new Error(
      `境内 ETF 代码表不完整：仅返回 ${rows.length} 个标的，拒绝覆盖本地完整快照`,
    );
  }
  if (rows.length !== first.total) {
    throw new Error(
      `境内 ETF 代码表分页不完整：期望 ${first.total} 个，实际 ${rows.length} 个`,
    );
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
  try {
    return {
      rows: await fetchEastmoneyDomesticEtfs(),
      source: "东方财富境内交易所 ETF 代码表",
      primarySource: "eastmoney",
      fallbackUsed: false,
      fetchedAt: new Date().toISOString(),
    };
  } catch (primaryError) {
    const primaryMessage =
      primaryError instanceof Error ? primaryError.message : String(primaryError);
    try {
      return {
        rows: await fetchSinaDomesticEtfs(),
        source: "新浪财经境内交易所 ETF 代码表",
        primarySource: "eastmoney",
        fallbackUsed: true,
        fallbackReason: primaryMessage,
        fetchedAt: new Date().toISOString(),
      };
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new Error(
        `东方财富 ETF 目录失败（${primaryMessage}）；新浪 ETF 目录兜底失败（${fallbackMessage}）`,
      );
    }
  }
}

/**
 * 获取与 AkShare `stock_info_a_code_name()` 相同范围的沪深京 A 股代码/名称目录。
 *
 * 产品端保持纯 Node.js，直接调用三家交易所公开接口，不执行 Python/AkShare。
 * 只有三地合并后的目录通过完整性校验，服务层才会覆盖 SQLite 成功快照。
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


