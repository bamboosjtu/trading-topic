import type {
  AdjustedBar,
  PricePoint,
} from "../../shared/contracts";
import { marketSymbol } from "./tencent";
import {
  addDays,
  currentMarketDate,
  daysBetween,
} from "../domain/dateUtils";
import {
  decodeSinaKlc,
  type DecodedSinaBar,
} from "./sinaKlcDecoder";
import { fetchWithTimeout } from "./_internal/httpClient";
import { isValidOhlcv } from "./_internal/validateBars";

const SINA_HISTORY_URL = (symbol: string) =>
  `https://finance.sina.com.cn/realstock/company/${symbol}/hisdata_klc2/klc_kl.js`;
const SINA_QFQ_FACTOR_URL = (symbol: string) =>
  `https://finance.sina.com.cn/realstock/company/${symbol}/qfq.js`;
const SINA_RECENT_KLINE_URL =
  "https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData";
const REQUEST_TIMEOUT_MS = 20_000;
const SINA_RECENT_LIMIT = 1_970;
const SINA_MIN_REQUEST_INTERVAL_MS = 300;

interface NormalizedSinaBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SinaFactorPayload {
  data?: unknown;
}

const historyCache = new Map<string, Promise<NormalizedSinaBar[]>>();
const qfqFactorCache = new Map<string, Promise<Array<[string, number]>>>();
let sinaRequestQueue: Promise<void> = Promise.resolve();
let lastSinaRequestAt = 0;

class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function normalizedDate(value: unknown): string {
  if (typeof value === "string") {
    const direct = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  }
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDecodedBar(row: DecodedSinaBar): NormalizedSinaBar | null {
  const date = normalizedDate(row.date);
  const open = finiteNumber(row.open);
  const high = finiteNumber(row.high);
  const low = finiteNumber(row.low);
  const close = finiteNumber(row.close);
  const volume = finiteNumber(row.volume);
  if (
    !date ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    !isValidOhlcv({ open, high, low, close, volume })
  ) {
    return null;
  }
  return { date, open, high, low, close, volume };
}

async function executeTextRequest(
  url: string,
  label: string,
): Promise<string> {
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label,
    headers: { Referer: "https://finance.sina.com.cn/" },
  });
  if (!response.ok) {
    throw new HttpStatusError(
      `${label}请求失败：HTTP ${response.status}`,
      response.status,
    );
  }
  return await response.text();
}

function fetchText(url: string, label: string): Promise<string> {
  const task = sinaRequestQueue.then(async () => {
    const waitFor = Math.max(
      0,
      SINA_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastSinaRequestAt),
    );
    if (waitFor) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitFor));
    }
    lastSinaRequestAt = Date.now();
    return executeTextRequest(url, label);
  });
  sinaRequestQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function parseRecentKlinePayload(payload: unknown): NormalizedSinaBar[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("新浪短日线响应不是对象");
  }
  const result = (payload as Record<string, unknown>)["result"];
  if (!result || typeof result !== "object") {
    throw new Error("新浪短日线响应缺少 result");
  }
  const resultObject = result as Record<string, unknown>;
  const status = resultObject["status"];
  if (
    status &&
    typeof status === "object" &&
    Number((status as Record<string, unknown>)["code"] ?? 0) !== 0
  ) {
    throw new Error(
      `新浪短日线返回错误码 ${
        (status as Record<string, unknown>)["code"]
      }`,
    );
  }
  const data = resultObject["data"];
  if (data === null) return [];
  if (!Array.isArray(data)) {
    throw new Error("新浪短日线响应缺少 result.data");
  }
  return data
    .map((item) =>
      item && typeof item === "object"
        ? normalizeDecodedBar({
            date:
              (item as Record<string, unknown>)["day"] ??
              (item as Record<string, unknown>)["date"],
            open: (item as Record<string, unknown>)["open"],
            high: (item as Record<string, unknown>)["high"],
            low: (item as Record<string, unknown>)["low"],
            close: (item as Record<string, unknown>)["close"],
            volume: (item as Record<string, unknown>)["volume"],
          })
        : null,
    )
    .filter((row): row is NormalizedSinaBar => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function recentKline(
  symbol: string,
  startDate: string,
  endDate: string,
  adjustment: "none" | "qfq",
): Promise<NormalizedSinaBar[]> {
  let rows: NormalizedSinaBar[] = [];
  let effectiveLimit = SINA_RECENT_LIMIT;
  const emptyResponses: string[] = [];
  for (const limit of [SINA_RECENT_LIMIT, 1_023, 1_023]) {
    const url = new URL(SINA_RECENT_KLINE_URL);
    url.searchParams.set("symbol", marketSymbol(symbol));
    url.searchParams.set("scale", "240");
    url.searchParams.set("ma", "no");
    url.searchParams.set("datalen", String(limit));
    if (adjustment === "qfq") url.searchParams.set("fq", "1");
    const text = await fetchText(url.toString(), "新浪短日线");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("新浪短日线响应不是合法 JSON");
    }
    rows = parseRecentKlinePayload(payload);
    if (!rows.length) {
      const result =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)["result"]
          : payload;
      emptyResponses.push(
        `${limit}:${JSON.stringify(result).slice(0, 160)}`,
      );
    }
    effectiveLimit = limit;
    if (rows.length) break;
  }
  if (!rows.length) {
    throw new Error(
      `${symbol} 新浪短日线连续返回空数据（${emptyResponses.join("；")}）`,
    );
  }
  if (
    rows.length === effectiveLimit &&
    rows[0]!.date > startDate
  ) {
    throw new Error(
      `${symbol} 新浪短日线只能覆盖至 ${rows[0]!.date}，无法完整兜底请求区间`,
    );
  }
  return inRequestedRange(rows, startDate, endDate);
}

export function extractSinaKlcPayload(text: string): string {
  const match = text.match(/=\s*"([A-Za-z0-9+/$_.-]+)"\s*;?/);
  if (!match?.[1]) {
    throw new Error("新浪全量日线响应结构已变化");
  }
  return match[1];
}

export function parseSinaFactorPayload(
  text: string,
): Array<[string, number]> {
  const equals = text.indexOf("=");
  if (equals < 0) throw new Error("新浪前复权因子响应缺少赋值符");
  const raw = text
    .slice(equals + 1)
    .trim()
    .replace(/\/\*[\s\S]*?\*\/\s*$/, "")
    .trim()
    .replace(/;\s*$/, "");
  let payload: SinaFactorPayload;
  try {
    payload = JSON.parse(raw) as SinaFactorPayload;
  } catch {
    throw new Error("新浪前复权因子响应不是合法 JSON");
  }
  if (!Array.isArray(payload.data)) {
    throw new Error("新浪前复权因子响应缺少 data");
  }
  const rows: Array<[string, number]> = [];
  for (const item of payload.data) {
    if (
      !Array.isArray(item) &&
      (!item || typeof item !== "object")
    ) {
      throw new Error("新浪前复权因子包含非法记录");
    }
    const date = normalizedDate(
      Array.isArray(item)
        ? item[0]
        : (item as Record<string, unknown>)["d"],
    );
    const factor = finiteNumber(
      Array.isArray(item)
        ? item[1]
        : (item as Record<string, unknown>)["f"],
    );
    if (!date || factor === null || factor <= 0) {
      throw new Error("新浪前复权因子包含非法日期或数值");
    }
    rows.push([date, factor]);
  }
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

async function fullHistory(symbol: string): Promise<NormalizedSinaBar[]> {
  const marketCode = marketSymbol(symbol);
  let pending = historyCache.get(marketCode);
  if (!pending) {
    pending = (async () => {
      const text = await fetchText(
        SINA_HISTORY_URL(marketCode),
        "新浪全量日线",
      );
      const decoded = decodeSinaKlc(extractSinaKlcPayload(text));
      const rows = decoded
        .map(normalizeDecodedBar)
        .filter((row): row is NormalizedSinaBar => row !== null)
        .sort((left, right) => left.date.localeCompare(right.date));
      if (!rows.length) {
        throw new Error(`${symbol} 新浪全量日线为空或无法解码`);
      }
      return rows;
    })();
    historyCache.set(marketCode, pending);
    pending.catch(() => historyCache.delete(marketCode));
  }
  return pending;
}

async function qfqFactors(symbol: string): Promise<Array<[string, number]>> {
  const marketCode = marketSymbol(symbol);
  let pending = qfqFactorCache.get(marketCode);
  if (!pending) {
    pending = (async () => {
      const text = await fetchText(
        SINA_QFQ_FACTOR_URL(marketCode),
        "新浪前复权因子",
      );
      const rows = parseSinaFactorPayload(text);
      if (!rows.length) {
        throw new Error(`${symbol} 新浪前复权因子为空`);
      }
      return rows;
    })();
    qfqFactorCache.set(marketCode, pending);
    pending.catch(() => qfqFactorCache.delete(marketCode));
  }
  return pending;
}

function inRequestedRange(
  rows: readonly NormalizedSinaBar[],
  startDate: string,
  endDate: string,
): NormalizedSinaBar[] {
  return rows.filter(
    (row) => row.date >= startDate && row.date <= endDate,
  );
}

function canUseRecentEndpoint(
  startDate: string,
  endDate: string,
): boolean {
  const today = currentMarketDate();
  return (
    endDate >= addDays(today, -7) &&
    daysBetween(startDate, endDate) <= 1_800
  );
}

export async function fetchSinaUnadjustedPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<PricePoint[]> {
  if (canUseRecentEndpoint(startDate, endDate)) {
    return (await recentKline(symbol, startDate, endDate, "none")).map(
      ({ date, close }) => ({ date, close }),
    );
  }
  let rows: NormalizedSinaBar[];
  try {
    rows = inRequestedRange(
      await fullHistory(symbol),
      startDate,
      endDate,
    );
  } catch (error) {
    if (!(error instanceof HttpStatusError) || error.status !== 404) {
      throw error;
    }
    rows = await recentKline(symbol, startDate, endDate, "none");
  }
  return rows.map(({ date, close }) => ({ date, close }));
}

export async function fetchSinaAdjustedBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<AdjustedBar[]> {
  if (canUseRecentEndpoint(startDate, endDate)) {
    return (await recentKline(symbol, startDate, endDate, "qfq")).map(
      (row) => ({ ...row, adjustment: "qfq" }),
    );
  }
  let history: NormalizedSinaBar[];
  let factors: Array<[string, number]>;
  try {
    [history, factors] = await Promise.all([
      fullHistory(symbol),
      qfqFactors(symbol),
    ]);
  } catch (error) {
    if (!(error instanceof HttpStatusError) || error.status !== 404) {
      throw error;
    }
    return (await recentKline(symbol, startDate, endDate, "qfq")).map(
      (row) => ({ ...row, adjustment: "qfq" }),
    );
  }
  let factorIndex = 0;
  let factor: number | null = null;
  const adjusted: NormalizedSinaBar[] = [];
  for (const row of history) {
    while (
      factorIndex < factors.length &&
      factors[factorIndex]![0] <= row.date
    ) {
      factor = factors[factorIndex]![1];
      factorIndex += 1;
    }
    if (factor === null) continue;
    adjusted.push({
      ...row,
      open: row.open / factor,
      high: row.high / factor,
      low: row.low / factor,
      close: row.close / factor,
    });
  }
  return inRequestedRange(adjusted, startDate, endDate).map((row) => ({
    ...row,
    adjustment: "qfq",
  }));
}
