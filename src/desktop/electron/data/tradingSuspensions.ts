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
const EASTMONEY_REPORT_NAME = "RPT_CUSTOM_SUSPEND_DATA_INTERFACE";
const EASTMONEY_PAGE_SIZE = 500;
const EASTMONEY_EMPTY_RESULT_CODE = 9201;
const BAIDU_URL =
  "https://finance.pae.baidu.com/sapi/v1/financecalendar";
const BAIDU_PAGE_SIZE = 100;
const BAIDU_CHUNK_DAYS = 31;
const BAIDU_CHUNK_THROTTLE_MS = 100;
const REQUEST_TIMEOUT_MS = 20_000;

export const EASTMONEY_SUSPEND_SOURCE =
  "eastmoney_datacenter_RPT_CUSTOM_SUSPEND_DATA_INTERFACE";
export const BAIDU_SUSPEND_SOURCE =
  "baidu_financecalendar_notify_suspend";
export const BAIDU_SUSPEND_COVERAGE_START = "2023-01-01";
export const AUTOMATIC_SUSPEND_SOURCES = [
  EASTMONEY_SUSPEND_SOURCE,
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

function firstValue(
  row: Record<string, unknown>,
  fields: readonly string[],
): string {
  for (const field of fields) {
    const value = textValue(row[field]);
    if (value && value !== "-") return value;
  }
  return "";
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

/**
 * 解析东方财富新停复牌报表的一行。
 *
 * 新报表的 SUSPEND_END_TIME 是最后停牌日，PREDICT_RESUME_DATE 是复牌日；
 * 对当前仍开放的区间，仅在调用方提供已观察截止日时保存到该日，不凭空推断
 * 最终复牌日。
 */
export function parseSuspensionRow(
  row: Record<string, unknown>,
  symbol: string,
  fetchedAt: string,
  observedThroughDate?: string,
): SecurityTradingInterruption | null {
  const startDate = dateValue(
    firstValue(row, [
      "SUSPEND_START_DATE",
      "SUSPEND_START_TIME",
      "SUSPEND_DATE",
    ]),
  );
  if (!startDate) return null;

  const explicitEndDate = dateValue(
    firstValue(row, [
      "SUSPEND_END_TIME",
      "SUSPEND_END_DATE",
      "SUSPEND_EXPIRE",
    ]),
  );
  const resumeDate = dateValue(
    firstValue(row, ["RESUME_DATE", "PREDICT_RESUME_DATE"]),
  );
  const endDate =
    explicitEndDate ||
    (resumeDate ? addDays(resumeDate, -1) : observedThroughDate ?? "");
  if (!endDate || endDate < startDate) return null;

  const sourceId =
    firstValue(row, ["NOTICE_DATE", "ANNOUNCE_DATE"]) ||
    [
      firstValue(row, ["SECUCODE", "SECURITY_CODE"]) || symbol,
      startDate,
      explicitEndDate || resumeDate || `observed-through-${endDate}`,
    ].join(":");

  return {
    symbol,
    startDate,
    endDate,
    reason: "suspension",
    source: EASTMONEY_SUSPEND_SOURCE,
    sourceId,
    fetchedAt,
  };
}

export function parseTradingSuspensions(
  rawRows: Array<Record<string, unknown>>,
  symbol: string,
  fetchedAt: string,
  observedThroughDate?: string,
): SecurityTradingInterruption[] {
  const interruptions = rawRows
    .map((row) =>
      parseSuspensionRow(row, symbol, fetchedAt, observedThroughDate),
    )
    .filter((row): row is SecurityTradingInterruption => row !== null);
  if (rawRows.length > 0 && interruptions.length === 0) {
    throw new Error(
      `停复牌响应存在 ${rawRows.length} 行数据，但未识别到有效日期字段（可能字段命名已变化）`,
    );
  }
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
  queryDate: string,
  pageNumber: number,
): Promise<EastmoneyPage> {
  const url = new URL(EASTMONEY_URL);
  const parameters: Record<string, string> = {
    sortColumns: "SUSPEND_START_DATE",
    sortTypes: "-1",
    pageSize: String(EASTMONEY_PAGE_SIZE),
    pageNumber: String(pageNumber),
    reportName: EASTMONEY_REPORT_NAME,
    columns: "ALL",
    source: "WEB",
    client: "WEB",
    filter: `(MARKET="全部")(DATETIME='${queryDate}')`,
  };
  Object.entries(parameters).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "东方财富停复牌",
    headers: { Referer: "https://data.eastmoney.com/tfpxx/" },
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
      source: "东方财富停复牌信息（新市场级报表）",
      sourceKey: EASTMONEY_SUSPEND_SOURCE,
      fetchedAt,
      coverageStart: startDate,
      coverageEnd: endDate,
      partialCoverage: false,
      unresolvedOpenIntervals: 0,
    };
  }

  const firstPage = await fetchEastmoneyPage(startDate, 1);
  const rawRows = [...firstPage.rows];
  for (let page = 2; page <= firstPage.pages; page += 1) {
    await sleep(DATA_SOURCE_THROTTLE_MS);
    const nextPage = await fetchEastmoneyPage(startDate, page);
    if (
      nextPage.pages !== firstPage.pages ||
      nextPage.count !== firstPage.count
    ) {
      throw new Error("东方财富停复牌分页期间总页数或总数发生变化");
    }
    rawRows.push(...nextPage.rows);
  }
  if (rawRows.length !== firstPage.count) {
    throw new Error(
      `东方财富停复牌分页不完整：期望 ${firstPage.count} 行，实际 ${rawRows.length} 行`,
    );
  }

  const symbolSet = new Set(normalizedSymbols);
  const relevantRows = rawRows.filter((row) => {
    const symbol = textValue(row["SECURITY_CODE"]);
    const rowStart = dateValue(
      firstValue(row, [
        "SUSPEND_START_DATE",
        "SUSPEND_START_TIME",
        "SUSPEND_DATE",
      ]),
    );
    return symbolSet.has(symbol) && (!rowStart || rowStart <= endDate);
  });
  const observedOpenIntervals = relevantRows.filter(
    (row) =>
      !dateValue(firstValue(row, ["SUSPEND_END_TIME", "SUSPEND_END_DATE"])) &&
      !dateValue(firstValue(row, ["RESUME_DATE", "PREDICT_RESUME_DATE"])),
  ).length;
  const parsedRows = normalizedSymbols.flatMap((symbol) =>
    parseTradingSuspensions(
      relevantRows.filter(
        (row) => textValue(row["SECURITY_CODE"]) === symbol,
      ),
      symbol,
      fetchedAt,
      endDate,
    ).filter(
      (row) => row.startDate <= endDate && row.endDate >= startDate,
    ),
  );

  return {
    rows: deduplicateInterruptions(parsedRows),
    source: "东方财富停复牌信息（新市场级报表）",
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
      return {
        ...(await fetchBaiduTradingSuspensions(
          symbols,
          startDate,
          endDate,
          options,
        )),
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
