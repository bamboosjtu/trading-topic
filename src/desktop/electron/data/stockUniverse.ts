import type { StockInfo } from "../../shared/contracts";

const EASTMONEY_A_SHARE_LIST_URL =
  "https://82.push2.eastmoney.com/api/qt/clist/get";
const EASTMONEY_A_SHARE_MARKETS =
  "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const EASTMONEY_FIELDS = "f12,f14";

interface EastmoneyStockListResponse {
  data?: {
    diff?: Array<{
      f12?: string | number;
      f14?: string;
    }>;
  };
}

function isAStockCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function parseAStockUniverse(payload: unknown): StockInfo[] {
  const diff = (payload as EastmoneyStockListResponse | null)?.data?.diff;
  if (!Array.isArray(diff)) {
    throw new Error("东方财富 A 股代码表响应格式已变化");
  }
  const stocks = diff
    .map((row) => ({
      symbol: String(row.f12 ?? "").trim(),
      name: String(row.f14 ?? "").trim(),
    }))
    .filter(
      (stock) =>
        isAStockCode(stock.symbol) &&
        stock.name.length > 0 &&
        stock.name !== "-",
    );
  const unique = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const result = [...unique.values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
  if (!result.length) throw new Error("东方财富 A 股代码表为空");
  return result;
}

/**
 * 获取与 AkShare `stock_info_a_code_name()` 等价的 A 股代码/名称目录。
 *
 * 产品端保持纯 Node.js，不执行 Python/AkShare；直接调用其底层公开数据接口，
 * 并由 SQLite 缓存目录，网络异常时由服务层回退到上次成功快照。
 */
export async function fetchAStockUniverse(): Promise<{
  rows: StockInfo[];
  fetchedAt: string;
  source: string;
}> {
  const url = new URL(EASTMONEY_A_SHARE_LIST_URL);
  url.searchParams.set("pn", "1");
  url.searchParams.set("pz", "50000");
  url.searchParams.set("po", "1");
  url.searchParams.set("np", "1");
  url.searchParams.set("ut", "bd1d9ddb04089700cf9c27f6f7426281");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fid", "f3");
  url.searchParams.set("fs", EASTMONEY_A_SHARE_MARKETS);
  url.searchParams.set("fields", EASTMONEY_FIELDS);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://quote.eastmoney.com/",
      },
    });
    if (!response.ok) {
      throw new Error(`东方财富 A 股代码表请求失败：HTTP ${response.status}`);
    }
    return {
      rows: parseAStockUniverse(await response.json()),
      fetchedAt: new Date().toISOString(),
      source: "东方财富 push2 A 股代码表（产品域独立适配）",
    };
  } finally {
    clearTimeout(timeout);
  }
}
