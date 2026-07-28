import type {
  AdjustedBar,
  PricePoint,
} from "../../shared/contracts";
import { marketSymbol } from "./tencent";

const SINA_KLINE_URL =
  "https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData";

interface SinaKlineRow {
  day?: unknown;
  date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

export function parseSinaKlinePayload(payload: unknown): SinaKlineRow[] {
  if (Array.isArray(payload)) return payload as SinaKlineRow[];
  if (!payload || typeof payload !== "object") {
    throw new Error("新浪行情响应不是对象");
  }
  const root = payload as Record<string, unknown>;
  const result = root["result"];
  if (result && typeof result === "object") {
    const resultObject = result as Record<string, unknown>;
    const status = resultObject["status"];
    if (
      status &&
      typeof status === "object" &&
      Number((status as Record<string, unknown>)["code"] ?? 0) !== 0
    ) {
      throw new Error(
        `新浪行情返回错误码 ${(status as Record<string, unknown>)["code"]}`,
      );
    }
    if (Array.isArray(resultObject["data"])) {
      return resultObject["data"] as SinaKlineRow[];
    }
  }
  if (Array.isArray(root["data"])) return root["data"] as SinaKlineRow[];
  throw new Error("新浪行情响应缺少 result.data");
}

export function parseSinaJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("(");
    const end = trimmed.lastIndexOf(")");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start + 1, end));
    }
    throw new Error("新浪行情响应不是合法 JSON/JSONP");
  }
}

async function fetchSinaRows(
  symbol: string,
  startDate: string,
  endDate: string,
  adjustment: "none" | "qfq",
): Promise<SinaKlineRow[]> {
  const url = new URL(SINA_KLINE_URL);
  url.searchParams.set("symbol", marketSymbol(symbol));
  url.searchParams.set("scale", "240");
  url.searchParams.set("ma", "no");
  url.searchParams.set("datalen", "10000");
  if (adjustment === "qfq") url.searchParams.set("fq", "1");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://finance.sina.com.cn/",
      },
    });
    if (!response.ok) {
      throw new Error(`新浪行情请求失败：HTTP ${response.status}`);
    }
    return parseSinaKlinePayload(
      parseSinaJson(await response.text()),
    ).filter((row) => {
      const date = String(row.day ?? row.date ?? "").slice(0, 10);
      return date >= startDate && date <= endDate;
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSinaUnadjustedPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<PricePoint[]> {
  return (await fetchSinaRows(symbol, startDate, endDate, "none")).map(
    (row) => ({
      date: String(row.day ?? row.date ?? "").slice(0, 10),
      close: Number(row.close),
    }),
  );
}

export async function fetchSinaAdjustedBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<AdjustedBar[]> {
  return (await fetchSinaRows(symbol, startDate, endDate, "qfq")).map(
    (row) => ({
      date: String(row.day ?? row.date ?? "").slice(0, 10),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      adjustment: "qfq",
    }),
  );
}
