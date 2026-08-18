import type { SecurityTradingInterruption } from "../../shared/contracts";
import { DATA_SOURCE_THROTTLE_MS } from "../../shared/constants";
import {
  addDays,
  currentMarketDate,
  daysBetween,
  validDate,
} from "../domain/dateUtils";
import { fetchWithTimeout } from "./_internal/httpClient";

const EASTMONEY_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";
const EASTMONEY_REPORT_NAME = "RPT_STOCKCALENDAR";
const EASTMONEY_SUSPEND_EVENT_TYPE = "023";
const EASTMONEY_PAGE_SIZE = 500;
const EASTMONEY_EMPTY_RESULT_CODE = 9201;
const EASTMONEY_FUND_ANNOUNCEMENT_LIST_URL =
  "http://api.fund.eastmoney.com/f10/JJGG";
const EASTMONEY_FUND_ANNOUNCEMENT_CONTENT_URL =
  "https://np-cnotice-fund.eastmoney.com/api/content/ann";
const EASTMONEY_FUND_ANNOUNCEMENT_PAGE_SIZE = 20;
const EASTMONEY_FUND_ANNOUNCEMENT_MAX_PAGES = 30;
const BAIDU_URL =
  "https://finance.pae.baidu.com/sapi/v1/financecalendar";
const BAIDU_PAGE_SIZE = 100;
const BAIDU_CHUNK_DAYS = 31;
const BAIDU_CHUNK_THROTTLE_MS = 100;
const REQUEST_TIMEOUT_MS = 20_000;

export const LEGACY_EASTMONEY_SUSPEND_SOURCE =
  "eastmoney_datacenter_RPT_CUSTOM_SUSPEND_DATA_INTERFACE";
export const EASTMONEY_SUSPEND_SOURCE =
  "eastmoney_datacenter_RPT_STOCKCALENDAR_event_023";
export const EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE =
  "eastmoney_fund_announcement_suspend";
export const BAIDU_SUSPEND_SOURCE =
  "baidu_financecalendar_notify_suspend";
export const BAIDU_SUSPEND_COVERAGE_START = "2023-01-01";
export const AUTOMATIC_SUSPEND_SOURCES = [
  LEGACY_EASTMONEY_SUSPEND_SOURCE,
  EASTMONEY_SUSPEND_SOURCE,
  EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
  BAIDU_SUSPEND_SOURCE,
] as const;

interface FetchOptions {
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface TradingSuspensionSourceResult {
  rows: SecurityTradingInterruption[];
  source: string;
  sourceKey: string;
  fetchedAt: string;
  coverageStart: string;
  coverageEnd: string;
  partialCoverage: boolean;
  unresolvedOpenIntervals: number;
  observedOpenIntervals?: number;
}

export interface TradingSuspensionFetchResult
  extends TradingSuspensionSourceResult {
  primarySource: typeof EASTMONEY_SUSPEND_SOURCE;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

interface EastmoneyPage {
  rows: Array<Record<string, unknown>>;
  pages: number;
  count: number;
}

interface BaiduCalendarDay {
  date: string;
  total: number;
  rows: Array<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function dateValue(value: unknown): string {
  const valueText = textValue(value).slice(0, 10);
  return validDate(valueText) ? valueText : "";
}

function normalizedClock(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /[\r\n]+/g,
    " ",
  );
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  const normalized = [...new Set(symbols.map((symbol) => symbol.trim()))];
  if (normalized.some((symbol) => !/^\d{6}$/.test(symbol))) {
    throw new Error("停复牌查询证券代码必须是 6 位数字");
  }
  return normalized.sort();
}

function validateRange(startDate: string, endDate: string, now: Date): void {
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new Error("停复牌查询日期必须使用 YYYY-MM-DD 格式");
  }
  if (startDate > endDate) {
    throw new Error("停复牌查询起始日不能晚于结束日");
  }
  const today = currentMarketDate(now);
  if (endDate > today) {
    throw new Error(`停复牌查询截止日不能晚于当前市场日期 ${today}`);
  }
}

function stableRowFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function deduplicateInterruptions(
  rows: readonly SecurityTradingInterruption[],
): SecurityTradingInterruption[] {
  const unique = new Map<string, SecurityTradingInterruption>();
  for (const row of rows) {
    const key = [
      row.symbol,
      row.startDate,
      row.endDate,
      row.reason,
      row.source,
    ].join("|");
    unique.set(key, row);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.symbol.localeCompare(right.symbol) ||
      left.startDate.localeCompare(right.startDate) ||
      left.endDate.localeCompare(right.endDate),
  );
}

interface ParsedStockCalendarInterval {
  recognized: boolean;
  open: boolean;
  startDate?: string;
  endDate?: string;
}

function calendarDate(
  year: string,
  month: string,
  day: string,
): string {
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return validDate(result) ? result : "";
}

/** 解析东财个股日历 `停牌日期` 事件中的显式全天区间或未闭合起点。 */
function parseStockCalendarInterval(
  content: string,
  observedThroughDate?: string,
): ParsedStockCalendarInterval {
  const range = content.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2}(?::\d{2})?)?\s*-\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2}(?::\d{2})?)?\s*停牌/,
  );
  if (range) {
    let startDate = calendarDate(range[1], range[2], range[3]);
    let endDate = calendarDate(range[5], range[6], range[7]);
    if (!startDate || !endDate) {
      return { recognized: false, open: false };
    }
    const startClock = normalizedClock(range[4]);
    const endClock = normalizedClock(range[8]);
    const hasFullDayWording = /全天|停牌一天|连续停牌/.test(content);
    if ((!startClock || !endClock) && !hasFullDayWording) {
      return { recognized: false, open: false };
    }
    if (startClock && startClock > "09:30:00" && startClock <= "15:00:00") {
      startDate = addDays(startDate, 1);
    }
    if (endClock && endClock >= "09:30:00" && endClock < "15:00:00") {
      endDate = addDays(endDate, -1);
    }
    return endDate < startDate
      ? { recognized: true, open: false }
      : { recognized: true, open: false, startDate, endDate };
  }

  const open = content.match(
    /(?:从|自)\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:开始|起)停牌/,
  );
  if (!open) return { recognized: false, open: false };
  let startDate = calendarDate(open[1], open[2], open[3]);
  if (!startDate) return { recognized: false, open: true };
  const startClock = normalizedClock(open[4]);
  if (startClock && startClock > "09:30:00" && startClock <= "15:00:00") {
    startDate = addDays(startDate, 1);
  }
  if (!observedThroughDate || observedThroughDate < startDate) {
    return { recognized: true, open: true, startDate };
  }
  return {
    recognized: true,
    open: true,
    startDate,
    endDate: observedThroughDate,
  };
}

/**
 * 解析东方财富个股日历的一条 `停牌日期` 事件。
 *
 * 事件正文包含证券级停牌的明确起止日期与日内时段；盘中停牌不会被压成
 * 整日证据。仍开放的事件只保存到本次已观察截止日，不宣称最终复牌日。
 */
export function parseSuspensionRow(
  row: Record<string, unknown>,
  symbol: string,
  fetchedAt: string,
  observedThroughDate?: string,
): SecurityTradingInterruption | null {
  if (
    textValue(row["SECURITY_CODE"]) !== symbol ||
    textValue(row["EVENT_TYPE_CODE"]) !== EASTMONEY_SUSPEND_EVENT_TYPE
  ) {
    return null;
  }
  const interval = parseStockCalendarInterval(
    textValue(row["LEVEL1_CONTENT"]),
    observedThroughDate,
  );
  if (!interval.startDate || !interval.endDate) return null;
  const noticeDate = dateValue(row["NOTICE_DATE"]);

  return {
    symbol,
    startDate: interval.startDate,
    endDate: interval.endDate,
    reason: "suspension",
    source: EASTMONEY_SUSPEND_SOURCE,
    sourceId: `https://data.eastmoney.com/stockcalendar/${symbol}.html${noticeDate ? `?date=${noticeDate}` : ""}`,
    fetchedAt,
  };
}

export function parseTradingSuspensions(
  rawRows: Array<Record<string, unknown>>,
  symbol: string,
  fetchedAt: string,
  observedThroughDate?: string,
): SecurityTradingInterruption[] {
  const unrecognizedRows = rawRows.filter((row) => {
    if (
      textValue(row["SECURITY_CODE"]) !== symbol ||
      textValue(row["EVENT_TYPE_CODE"]) !== EASTMONEY_SUSPEND_EVENT_TYPE
    ) {
      return true;
    }
    return !parseStockCalendarInterval(
      textValue(row["LEVEL1_CONTENT"]),
      observedThroughDate,
    ).recognized;
  });
  if (unrecognizedRows.length > 0) {
    throw new Error(
      `停复牌响应存在 ${rawRows.length} 行数据，但有 ${unrecognizedRows.length} 行未识别到有效个股日历区间（可能正文结构已变化）`,
    );
  }
  const interruptions = rawRows
    .map((row) =>
      parseSuspensionRow(row, symbol, fetchedAt, observedThroughDate),
    )
    .filter((row): row is SecurityTradingInterruption => row !== null);
  return deduplicateInterruptions(interruptions);
}

function parseEastmoneyPage(payload: unknown): EastmoneyPage {
  if (!isRecord(payload)) {
    throw new Error(`东方财富 ${EASTMONEY_REPORT_NAME} 响应不是对象`);
  }
  const code = Number(payload["code"]);
  const success = payload["success"];
  const message = textValue(payload["message"]);
  if (
    success === false &&
    code === EASTMONEY_EMPTY_RESULT_CODE &&
    message.includes("数据为空")
  ) {
    return { rows: [], pages: 0, count: 0 };
  }
  if (success !== true || code !== 0) {
    throw new Error(
      `东方财富 ${EASTMONEY_REPORT_NAME} 请求失败：${message || `code=${String(payload["code"])}`}`,
    );
  }
  const result = payload["result"];
  if (!isRecord(result) || !Array.isArray(result["data"])) {
    throw new Error(
      `东方财富 ${EASTMONEY_REPORT_NAME} 响应结构已变化：缺少 result.data`,
    );
  }
  if (!result["data"].every(isRecord)) {
    throw new Error(
      `东方财富 ${EASTMONEY_REPORT_NAME} 响应结构已变化：data 行不是对象`,
    );
  }
  const pages = Number(result["pages"]);
  const count = Number(result["count"]);
  if (
    !Number.isInteger(pages) ||
    pages < 0 ||
    !Number.isInteger(count) ||
    count < 0 ||
    (count > 0 && pages < 1)
  ) {
    throw new Error(
      `东方财富 ${EASTMONEY_REPORT_NAME} 响应缺少有效分页信息`,
    );
  }
  return {
    rows: result["data"],
    pages,
    count,
  };
}

async function fetchEastmoneyPage(
  symbol: string,
  pageNumber: number,
): Promise<EastmoneyPage> {
  const url = new URL(EASTMONEY_URL);
  const parameters: Record<string, string> = {
    sortColumns: "NOTICE_DATE",
    sortTypes: "-1",
    pageSize: String(EASTMONEY_PAGE_SIZE),
    pageNumber: String(pageNumber),
    reportName: EASTMONEY_REPORT_NAME,
    columns: "ALL",
    source: "WEB",
    client: "WEB",
    filter: `(SECURITY_CODE="${symbol}")(EVENT_TYPE_CODE="${EASTMONEY_SUSPEND_EVENT_TYPE}")`,
  };
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "东方财富停复牌",
    headers: {
      Referer: `https://data.eastmoney.com/stockcalendar/${symbol}.html`,
    },
  });
  if (!response.ok) {
    throw new Error(`东方财富停复牌请求失败：HTTP ${response.status}`);
  }
  return parseEastmoneyPage(await response.json());
}

export async function fetchEastmoneyTradingSuspensions(
  symbols: readonly string[],
  startDate: string,
  endDate: string,
  options: FetchOptions = {},
): Promise<TradingSuspensionSourceResult> {
  const now = options.now?.() ?? new Date();
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const normalizedSymbols = normalizeSymbols(symbols);
  validateRange(startDate, endDate, now);
  const fetchedAt = now.toISOString();
  if (!normalizedSymbols.length) {
    return {
      rows: [],
      source: "东方财富个股日历（历史停牌事件）",
      sourceKey: EASTMONEY_SUSPEND_SOURCE,
      fetchedAt,
      coverageStart: startDate,
      coverageEnd: endDate,
      partialCoverage: false,
      unresolvedOpenIntervals: 0,
    };
  }

  const parsedRows: SecurityTradingInterruption[] = [];
  let observedOpenIntervals = 0;
  let requestCount = 0;
  const requestPage = async (symbol: string, page: number) => {
    if (requestCount > 0) await sleep(DATA_SOURCE_THROTTLE_MS);
    requestCount += 1;
    return fetchEastmoneyPage(symbol, page);
  };
  for (const symbol of normalizedSymbols) {
    const firstPage = await requestPage(symbol, 1);
    const rawRows = [...firstPage.rows];
    for (let page = 2; page <= firstPage.pages; page += 1) {
      const nextPage = await requestPage(symbol, page);
      if (
        nextPage.pages !== firstPage.pages ||
        nextPage.count !== firstPage.count
      ) {
        throw new Error(
          `东方财富停复牌 ${symbol} 分页期间总页数或总数发生变化`,
        );
      }
      rawRows.push(...nextPage.rows);
    }
    if (rawRows.length !== firstPage.count) {
      throw new Error(
        `东方财富停复牌 ${symbol} 分页不完整：期望 ${firstPage.count} 行，实际 ${rawRows.length} 行`,
      );
    }
    observedOpenIntervals += rawRows.filter((row) => {
      const interval = parseStockCalendarInterval(
        textValue(row["LEVEL1_CONTENT"]),
        endDate,
      );
      return Boolean(
        interval.open &&
          interval.startDate &&
          interval.startDate <= endDate &&
          (interval.endDate ?? endDate) >= startDate,
      );
    }).length;
    parsedRows.push(
      ...parseTradingSuspensions(rawRows, symbol, fetchedAt, endDate).filter(
        (row) => row.startDate <= endDate && row.endDate >= startDate,
      ),
    );
  }

  return {
    rows: deduplicateInterruptions(parsedRows),
    source: "东方财富个股日历（历史停牌事件）",
    sourceKey: EASTMONEY_SUSPEND_SOURCE,
    fetchedAt,
    coverageStart: startDate,
    coverageEnd: endDate,
    partialCoverage: false,
    unresolvedOpenIntervals: 0,
    ...(observedOpenIntervals
      ? { observedOpenIntervals }
      : {}),
  };
}

function parseBaiduCalendarPage(
  payload: unknown,
  startDate: string,
  endDate: string,
): BaiduCalendarDay[] {
  if (!isRecord(payload)) {
    throw new Error("百度停复牌响应不是对象");
  }
  if (String(payload["ResultCode"]) !== "0") {
    throw new Error(
      `百度停复牌请求失败：${textValue(payload["ResultMsg"]) || `ResultCode=${String(payload["ResultCode"])}`}`,
    );
  }
  const result = payload["Result"];
  if (!isRecord(result) || !Array.isArray(result["calendarInfo"])) {
    throw new Error("百度停复牌响应结构已变化：缺少 Result.calendarInfo");
  }
  const days: BaiduCalendarDay[] = result["calendarInfo"].map((item) => {
    if (!isRecord(item)) {
      throw new Error("百度停复牌 calendarInfo 行不是对象");
    }
    const date = dateValue(item["date"]);
    const total = Number(item["total"]);
    const sourceRows = item["list"];
    const rows = sourceRows === null ? [] : sourceRows;
    if (
      !date ||
      !Number.isInteger(total) ||
      total < 0 ||
      !Array.isArray(rows) ||
      !rows.every(isRecord)
    ) {
      throw new Error("百度停复牌 calendarInfo 缺少有效日期、总数或数据数组");
    }
    return { date, total, rows };
  });

  const expectedDates = new Set<string>();
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    expectedDates.add(date);
  }
  const actualDates = new Set(days.map((day) => day.date));
  if (
    actualDates.size !== expectedDates.size ||
    [...expectedDates].some((date) => !actualDates.has(date))
  ) {
    throw new Error(
      `百度停复牌日期覆盖不完整：期望 ${expectedDates.size} 天，实际 ${actualDates.size} 天`,
    );
  }
  return days;
}

async function fetchBaiduCalendarPage(
  startDate: string,
  endDate: string,
  pageNumber: number,
): Promise<BaiduCalendarDay[]> {
  const url = new URL(BAIDU_URL);
  const parameters: Record<string, string> = {
    start_date: startDate,
    end_date: endDate,
    pn: String(pageNumber),
    rn: String(BAIDU_PAGE_SIZE),
    cate: "notify_suspend",
    finClientType: "pc",
  };
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "百度停复牌",
    headers: {
      Accept: "application/vnd.finance-web.v1+json",
      Origin: "https://finance.baidu.com",
      Referer: "https://finance.baidu.com/",
    },
  });
  if (!response.ok) {
    throw new Error(`百度停复牌请求失败：HTTP ${response.status}`);
  }
  return parseBaiduCalendarPage(await response.json(), startDate, endDate);
}

async function fetchBaiduCalendarChunk(
  startDate: string,
  endDate: string,
): Promise<Array<Record<string, unknown>>> {
  const firstPage = await fetchBaiduCalendarPage(startDate, endDate, 0);
  const totals = new Map(firstPage.map((day) => [day.date, day.total]));
  const rowsByDate = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();
  const append = (days: readonly BaiduCalendarDay[]): void => {
    for (const day of days) {
      if (totals.get(day.date) !== day.total) {
        throw new Error("百度停复牌分页期间日期总数发生变化");
      }
      const rows = rowsByDate.get(day.date) ?? new Map();
      for (const row of day.rows) rows.set(stableRowFingerprint(row), row);
      rowsByDate.set(day.date, rows);
    }
  };
  append(firstPage);
  const pageCount = Math.max(
    1,
    ...firstPage.map((day) => Math.ceil(day.total / BAIDU_PAGE_SIZE)),
  );
  for (let page = 1; page < pageCount; page += 1) {
    append(await fetchBaiduCalendarPage(startDate, endDate, page));
  }
  for (const [date, total] of totals) {
    const actual = rowsByDate.get(date)?.size ?? 0;
    if (actual !== total) {
      throw new Error(
        `百度停复牌 ${date} 分页不完整：期望 ${total} 行，实际 ${actual} 行`,
      );
    }
  }
  return [...rowsByDate.values()].flatMap((rows) => [...rows.values()]);
}

export function parseBaiduTradingSuspensions(
  rawRows: Array<Record<string, unknown>>,
  symbols: readonly string[],
  fetchedAt: string,
  startDate: string,
  endDate: string,
): {
  rows: SecurityTradingInterruption[];
  unresolvedOpenIntervals: number;
} {
  const symbolSet = new Set(normalizeSymbols(symbols));
  const interruptions: SecurityTradingInterruption[] = [];
  let unresolvedOpenIntervals = 0;
  for (const row of rawRows) {
    const symbol = textValue(row["code"]);
    if (!symbolSet.has(symbol)) continue;
    if (
      textValue(row["market"]).toLowerCase() !== "ab" ||
      !["SH", "SZ", "BJ"].includes(textValue(row["exchange"]).toUpperCase())
    ) {
      continue;
    }
    const rowStart = dateValue(row["start"]);
    if (!rowStart) {
      throw new Error(`百度停复牌 ${symbol} 缺少有效停牌开始日`);
    }
    const rawResume = textValue(row["end"]);
    if (!rawResume || rawResume === "-") {
      if (rowStart <= endDate) unresolvedOpenIntervals += 1;
      continue;
    }
    const resumeDate = dateValue(rawResume);
    if (!resumeDate) {
      throw new Error(`百度停复牌 ${symbol} 含无效复牌日`);
    }
    const rowEnd = addDays(resumeDate, -1);
    // 同日复牌属于盘中临停，日线通常仍存在，不作为整日行情缺口证据。
    if (rowEnd < rowStart) continue;
    if (rowStart > endDate || rowEnd < startDate) continue;
    const announcementDate = dateValue(row["date"]) || rowStart;
    interruptions.push({
      symbol,
      startDate: rowStart,
      endDate: rowEnd,
      reason: "suspension",
      source: BAIDU_SUSPEND_SOURCE,
      sourceId: `${announcementDate}:${textValue(row["exchange"])}:${symbol}`,
      fetchedAt,
    });
  }
  return {
    rows: deduplicateInterruptions(interruptions),
    unresolvedOpenIntervals,
  };
}

export async function fetchBaiduTradingSuspensions(
  symbols: readonly string[],
  startDate: string,
  endDate: string,
  options: FetchOptions = {},
): Promise<TradingSuspensionSourceResult> {
  const now = options.now?.() ?? new Date();
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const normalizedSymbols = normalizeSymbols(symbols);
  validateRange(startDate, endDate, now);
  if (endDate < BAIDU_SUSPEND_COVERAGE_START) {
    throw new Error(
      `百度停复牌备用源的可验证结构化历史始于 ${BAIDU_SUSPEND_COVERAGE_START}`,
    );
  }
  const coverageStart =
    startDate < BAIDU_SUSPEND_COVERAGE_START
      ? BAIDU_SUSPEND_COVERAGE_START
      : startDate;
  const fetchedAt = now.toISOString();
  if (!normalizedSymbols.length) {
    return {
      rows: [],
      source: "百度股市通交易提醒（停复牌）",
      sourceKey: BAIDU_SUSPEND_SOURCE,
      fetchedAt,
      coverageStart,
      coverageEnd: endDate,
      partialCoverage: coverageStart !== startDate,
      unresolvedOpenIntervals: 0,
    };
  }

  const rawRows: Array<Record<string, unknown>> = [];
  let chunkStart = coverageStart;
  while (chunkStart <= endDate) {
    const remainingDays = daysBetween(chunkStart, endDate) + 1;
    const chunkDays = Math.min(BAIDU_CHUNK_DAYS, remainingDays);
    const chunkEnd = addDays(chunkStart, chunkDays - 1);
    rawRows.push(...(await fetchBaiduCalendarChunk(chunkStart, chunkEnd)));
    if (chunkEnd < endDate) await sleep(BAIDU_CHUNK_THROTTLE_MS);
    chunkStart = addDays(chunkEnd, 1);
  }
  const parsed = parseBaiduTradingSuspensions(
    rawRows,
    normalizedSymbols,
    fetchedAt,
    coverageStart,
    endDate,
  );
  return {
    ...parsed,
    source: "百度股市通交易提醒（停复牌）",
    sourceKey: BAIDU_SUSPEND_SOURCE,
    fetchedAt,
    coverageStart,
    coverageEnd: endDate,
    partialCoverage: coverageStart !== startDate,
  };
}

/** 固定主备路由：东方财富新报表失败后，整段切换到独立的百度股市通源。 */
export async function fetchTradingSuspensions(
  symbols: readonly string[],
  startDate: string,
  endDate: string,
  options: FetchOptions = {},
): Promise<TradingSuspensionFetchResult> {
  try {
    return {
      ...(await fetchEastmoneyTradingSuspensions(
        symbols,
        startDate,
        endDate,
        options,
      )),
      primarySource: EASTMONEY_SUSPEND_SOURCE,
      fallbackUsed: false,
    };
  } catch (primaryError) {
    const primaryMessage = errorMessage(primaryError);
    try {
      const fallback = await fetchBaiduTradingSuspensions(
        symbols,
        startDate,
        endDate,
        options,
      );
      if (fallback.partialCoverage) {
        throw new Error(
          `请求区间 ${startDate}..${endDate} 早于百度可验证覆盖起点 ${fallback.coverageStart}`,
        );
      }
      if (fallback.unresolvedOpenIntervals > 0) {
        throw new Error(
          `存在 ${fallback.unresolvedOpenIntervals} 条未闭合记录，不能证明最终复牌日`,
        );
      }
      return {
        ...fallback,
        primarySource: EASTMONEY_SUSPEND_SOURCE,
        fallbackUsed: true,
        fallbackReason: primaryMessage,
      };
    } catch (fallbackError) {
      throw new Error(
        `东方财富停复牌主源失败（${primaryMessage}）；百度停复牌备用源失败（${errorMessage(fallbackError)}）`,
      );
    }
  }
}

/**
 * 识别境内交易所 ETF 代码。
 *
 * 深市 ETF 以 159 开头；沪市 ETF 覆盖 510-518、520、561-563、588 等前缀。
 * 500/501/502 是封闭式基金或分级/LOF，不属于 ETF，不在列表中。
 *
 * 用于停牌证据路由：股票走东财个股日历主源+百度备用，
 * ETF 走东财基金公告源（RPT_STOCKCALENDAR 不收录 ETF 事件）。
 */
const ETF_CODE_PREFIXES = [
  "159", // 深市 ETF
  "510", "511", "512", "513", "514", "515", "516", "517", "518", // 沪市 ETF
  "520", "561", "562", "563", "588",
] as const;

export function isEtfSymbol(symbol: string): boolean {
  return (
    /^\d{6}$/.test(symbol) &&
    ETF_CODE_PREFIXES.some((prefix) => symbol.startsWith(prefix))
  );
}

interface FundAnnouncementListItem {
  fundCode: string;
  title: string;
  publishDate: string;
  announcementId: string;
}

interface FundAnnouncementListPage {
  rows: FundAnnouncementListItem[];
  totalCount: number;
}

/**
 * 去掉 JSONP 回调包装，解析内部 JSON。
 *
 * 东财基金公告列表 API 返回 `cb({...})` 格式，需剥掉 `cb(` 前缀和 `)` 后缀。
 */
function parseJsonpResponse(payload: string, label: string): unknown {
  const match = payload.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) {
    throw new Error(`${label}响应不是合法的 JSONP 格式`);
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error(`${label}响应 JSONP 内部 JSON 解析失败`);
  }
}

function parseFundAnnouncementListPage(
  payload: unknown,
): FundAnnouncementListPage {
  if (!isRecord(payload)) {
    throw new Error("东方财富基金公告列表响应不是对象");
  }
  const errCode = payload["ErrCode"];
  if (errCode !== undefined && Number(errCode) !== 0) {
    throw new Error(
      `东方财富基金公告列表请求失败：${textValue(payload["ErrMsg"]) || `ErrCode=${String(errCode)}`}`,
    );
  }
  const data = payload["Data"];
  if (!Array.isArray(data)) {
    throw new Error("东方财富基金公告列表响应结构已变化：缺少 Data 数组");
  }
  const rows: FundAnnouncementListItem[] = [];
  for (const item of data) {
    if (!isRecord(item)) {
      throw new Error("东方财富基金公告列表 Data 行不是对象");
    }
    const fundCode = textValue(item["FUNDCODE"]);
    const title = textValue(item["TITLE"]);
    const publishDate = textValue(item["PUBLISHDATE"]).slice(0, 10);
    const announcementId = textValue(item["ID"]);
    if (!fundCode || !title || !publishDate || !announcementId) {
      throw new Error(
        "东方财富基金公告列表行缺少 FUNDCODE/TITLE/PUBLISHDATE/ID",
      );
    }
    if (!validDate(publishDate)) {
      throw new Error(
        `东方财富基金公告列表行 PUBLISHDATE 不是合法日期：${publishDate}`,
      );
    }
    rows.push({ fundCode, title, publishDate, announcementId });
  }
  const totalCount = Number(payload["TotalCount"]);
  if (!Number.isInteger(totalCount) || totalCount < 0) {
    throw new Error("东方财富基金公告列表响应缺少有效 TotalCount");
  }
  return { rows, totalCount };
}

async function fetchFundAnnouncementListPage(
  fundCode: string,
  pageIndex: number,
): Promise<FundAnnouncementListPage> {
  const url = new URL(EASTMONEY_FUND_ANNOUNCEMENT_LIST_URL);
  url.searchParams.set("callback", "cb");
  url.searchParams.set("fundcode", fundCode);
  url.searchParams.set("pageIndex", String(pageIndex));
  url.searchParams.set(
    "pageSize",
    String(EASTMONEY_FUND_ANNOUNCEMENT_PAGE_SIZE),
  );
  url.searchParams.set("type", "0");
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "东方财富基金公告列表",
    headers: {
      Referer: `http://fundf10.eastmoney.com/jjgg_${fundCode}.html`,
    },
  });
  if (!response.ok) {
    throw new Error(`东方财富基金公告列表请求失败：HTTP ${response.status}`);
  }
  return parseFundAnnouncementListPage(
    parseJsonpResponse(await response.text(), "东方财富基金公告列表"),
  );
}

interface FundAnnouncementContent {
  title: string;
  content: string;
}

function parseFundAnnouncementContent(
  payload: unknown,
): FundAnnouncementContent {
  if (!isRecord(payload)) {
    throw new Error("东方财富基金公告正文响应不是对象");
  }
  if (Number(payload["success"]) !== 1 || !isRecord(payload["data"])) {
    throw new Error(
      `东方财富基金公告正文请求失败：success=${String(payload["success"])}`,
    );
  }
  const title = textValue(payload["data"]["notice_title"]);
  const content = textValue(payload["data"]["notice_content"]);
  if (!title || !content) {
    throw new Error(
      "东方财富基金公告正文缺少 notice_title/notice_content",
    );
  }
  return { title, content };
}

async function fetchFundAnnouncementContent(
  announcementId: string,
): Promise<FundAnnouncementContent> {
  const url = new URL(EASTMONEY_FUND_ANNOUNCEMENT_CONTENT_URL);
  url.searchParams.set("client_source", "web_fund");
  url.searchParams.set("show_all", "1");
  url.searchParams.set("art_code", announcementId);
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "东方财富基金公告正文",
    headers: {
      Referer: `http://fund.eastmoney.com/gonggao/${announcementId}.html`,
    },
  });
  if (!response.ok) {
    throw new Error(`东方财富基金公告正文请求失败：HTTP ${response.status}`);
  }
  return parseFundAnnouncementContent(await response.json());
}

interface ParsedFundSuspensionInterval {
  startDate: string;
  endDate: string;
}

/**
 * 从基金公告正文解析"已于...停牌...自...起复牌"的完整停牌区间。
 *
 * 复牌日不在停牌区间内（endDate = 复牌日 - 1），与百度备用源和
 * 东财个股日历的区间语义一致：盘中复牌当日有行情，不作为整日停牌。
 */
export function parseFundAnnouncementSuspensionInterval(
  content: string,
): ParsedFundSuspensionInterval | null {
  const fullRange = content.match(
    /已于\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^。]*?停牌[^。]*?自\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^。]*?起?复牌/,
  );
  if (!fullRange) return null;
  const startDate = calendarDate(fullRange[1], fullRange[2], fullRange[3]);
  const resumeDate = calendarDate(fullRange[4], fullRange[5], fullRange[6]);
  if (!startDate || !resumeDate) return null;
  const endDate = addDays(resumeDate, -1);
  if (endDate < startDate) return null;
  return { startDate, endDate };
}

/**
 * 从"开始停牌"提示性公告正文提取停牌开始日。
 *
 * 这类公告通常含"YYYY年M月D日...开市起...停牌"表述，但无法确定最终复牌日，
 * 调用方应将 endDate 设为 startDate（单日停牌假设）；多日停牌需等待后续
 * "会议情况"或"复牌"公告补证。少算会触发行情缺失错误，可由用户手工补证。
 */
export function parseFundAnnouncementSuspensionStart(
  content: string,
): string | null {
  const start = content.match(
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^。]*?开市起[^。]*?停牌/,
  );
  if (!start) return null;
  return calendarDate(start[1], start[2], start[3]) || null;
}

/**
 * 判断公告标题是否与 ETF 自身停牌相关。
 *
 * "长期停牌股票估值方法"等公告是基金持仓股票的停牌估值，与 ETF 自身停牌无关，
 * 需排除。仅保留含"停牌"且不含"估值"和"停牌股票"的标题。
 */
function isFundSelfSuspensionTitle(title: string): boolean {
  if (!title.includes("停牌")) return false;
  if (title.includes("估值")) return false;
  if (title.includes("停牌股票")) return false;
  return true;
}

/**
 * 东方财富基金公告 ETF 停牌证据适配器。
 *
 * 东财个股日历 RPT_STOCKCALENDAR 不收录 ETF 停牌事件（对 ETF 返回
 * code=9201 数据为空），ETF 停牌证据从基金公告 API 获取。
 *
 * 流程：
 * 1. 按 ETF 代码分页获取基金公告列表（最多 30 页 = 600 条）；
 * 2. 筛选标题含"停牌"且与 ETF 自身停牌相关的公告；
 * 3. 获取筛选公告的正文，从正文解析停牌起止区间；
 * 4. 优先采用含完整"停牌...复牌"表述的正文，回退到"开始停牌"公告的单日假设。
 *
 * 与股票停牌主备路由独立：fetchTradingSuspensions 只处理股票，
 * appService 按 isEtfSymbol 分流后调用本函数。
 */
export async function fetchEastmoneyFundAnnouncementSuspensions(
  symbols: readonly string[],
  startDate: string,
  endDate: string,
  options: FetchOptions = {},
): Promise<TradingSuspensionSourceResult> {
  const now = options.now?.() ?? new Date();
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const normalizedSymbols = normalizeSymbols(symbols);
  validateRange(startDate, endDate, now);
  const fetchedAt = now.toISOString();
  if (!normalizedSymbols.length) {
    return {
      rows: [],
      source: "东方财富基金公告（ETF 停牌事件）",
      sourceKey: EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
      fetchedAt,
      coverageStart: startDate,
      coverageEnd: endDate,
      partialCoverage: false,
      unresolvedOpenIntervals: 0,
    };
  }

  const parsedRows: SecurityTradingInterruption[] = [];
  let requestCount = 0;
  for (const symbol of normalizedSymbols) {
    const allListRows: FundAnnouncementListItem[] = [];
    let pageIndex = 1;
    for (;;) {
      if (requestCount > 0) await sleep(DATA_SOURCE_THROTTLE_MS);
      requestCount += 1;
      const page = await fetchFundAnnouncementListPage(symbol, pageIndex);
      allListRows.push(...page.rows);
      if (
        allListRows.length >= page.totalCount ||
        page.rows.length < EASTMONEY_FUND_ANNOUNCEMENT_PAGE_SIZE ||
        pageIndex >= EASTMONEY_FUND_ANNOUNCEMENT_MAX_PAGES
      ) {
        break;
      }
      pageIndex += 1;
    }

    const suspensionAnnouncements = allListRows.filter((row) =>
      isFundSelfSuspensionTitle(row.title),
    );
    if (!suspensionAnnouncements.length) continue;

    const symbolInterruptions: SecurityTradingInterruption[] = [];
    let hasUnparsedAnnouncement = false;
    for (const announcement of suspensionAnnouncements) {
      if (requestCount > 0) await sleep(DATA_SOURCE_THROTTLE_MS);
      requestCount += 1;
      const detail = await fetchFundAnnouncementContent(
        announcement.announcementId,
      );
      const fullInterval = parseFundAnnouncementSuspensionInterval(
        detail.content,
      );
      if (fullInterval) {
        symbolInterruptions.push({
          symbol,
          startDate: fullInterval.startDate,
          endDate: fullInterval.endDate,
          reason: "suspension",
          source: EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
          sourceId: `http://fund.eastmoney.com/gonggao/${symbol},${announcement.announcementId}.html`,
          fetchedAt,
        });
        continue;
      }
      const startOnly = parseFundAnnouncementSuspensionStart(detail.content);
      if (startOnly) {
        symbolInterruptions.push({
          symbol,
          startDate: startOnly,
          endDate: startOnly,
          reason: "suspension",
          source: EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
          sourceId: `http://fund.eastmoney.com/gonggao/${symbol},${announcement.announcementId}.html`,
          fetchedAt,
        });
        continue;
      }
      hasUnparsedAnnouncement = true;
    }

    if (hasUnparsedAnnouncement && !symbolInterruptions.length) {
      throw new Error(
        `东方财富基金公告 ${symbol} 存在停牌公告但正文无法解析停牌区间（公告正文结构可能已变化）`,
      );
    }
    parsedRows.push(
      ...symbolInterruptions.filter(
        (row) => row.startDate <= endDate && row.endDate >= startDate,
      ),
    );
  }

  return {
    rows: deduplicateInterruptions(parsedRows),
    source: "东方财富基金公告（ETF 停牌事件）",
    sourceKey: EASTMONEY_FUND_ANNOUNCEMENT_SUSPEND_SOURCE,
    fetchedAt,
    coverageStart: startDate,
    coverageEnd: endDate,
    partialCoverage: false,
    unresolvedOpenIntervals: 0,
  };
}
