import type {
  DataProvenance,
  DividendEvent,
  PricePoint,
} from "../../shared/contracts";

const TENCENT_URL =
  "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get";
const EASTMONEY_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";

const STOCK_NAMES: Record<string, string> = {
  "600016": "民生银行",
  "600036": "招商银行",
  "601166": "兴业银行",
  "601288": "农业银行",
  "601398": "工商银行",
  "601939": "建设银行",
  "601988": "中国银行",
};

function marketSymbol(symbol: string): string {
  if (symbol.startsWith("6")) return `sh${symbol}`;
  if (symbol.startsWith("8")) return `bj${symbol}`;
  return `sz${symbol}`;
}

async function fetchJson(url: URL, timeoutMs = 15_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://gu.qq.com/",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchUnadjustedPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{ rows: PricePoint[]; provenance: DataProvenance }> {
  const code = marketSymbol(symbol);
  const rows = new Map<string, PricePoint>();
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    const url = new URL(TENCENT_URL);
    const variable = `kline_day${year}`;
    url.searchParams.set("_var", variable);
    url.searchParams.set(
      "param",
      `${code},day,${year}-01-01,${year + 1}-12-31,640,`,
    );
    url.searchParams.set("r", "0.8205512681390605");
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: `https://gu.qq.com/${code}`,
      },
    });
    if (!response.ok) throw new Error(`腾讯行情请求失败：HTTP ${response.status}`);
    const text = await response.text();
    const jsonStart = text.indexOf("={");
    if (jsonStart < 0) throw new Error("腾讯行情响应格式已变化");
    const payload = JSON.parse(text.slice(jsonStart + 1)) as {
      data?: Record<string, { day?: Array<Array<string | number>> }>;
    };
    const day = payload.data?.[code]?.day ?? [];
    for (const item of day) {
      const date = String(item[0]);
      const close = Number(item[2]);
      if (date >= startDate && date <= endDate && Number.isFinite(close)) {
        rows.set(date, { date, close });
      }
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) throw new Error(`${symbol} 未取得腾讯不复权日线`);
  const fetchedAt = new Date().toISOString();
  return {
    rows: sorted,
    provenance: {
      source: "腾讯财经 stock_zh_a_hist_tx（产品域独立适配）",
      fetchedAt,
      dataCutoff: sorted.at(-1)!.date,
      adjustment: "none",
      caliberVersion: "bank-dca-r1-node-v1",
    },
  };
}

export async function fetchCashDividends(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{ rows: DividendEvent[]; provenance: DataProvenance }> {
  const url = new URL(EASTMONEY_URL);
  const params: Record<string, string> = {
    reportName: "RPT_SHAREBONUS_DET",
    columns: "ALL",
    filter: `(SECURITY_CODE="${symbol}")`,
    pageNumber: "1",
    pageSize: "100",
    sortColumns: "EX_DIVIDEND_DATE",
    sortTypes: "-1",
    source: "WEB",
    client: "WEB",
  };
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const payload = (await fetchJson(url)) as {
    result?: { data?: Array<Record<string, unknown>> };
  };
  // P0-1：东方财富 PRETAX_BONUS_RMB 字段单位为"每10股派息（税前）"，
  // 研究端 normalize_dividends 明确执行 cash_per_10 / 10.0 得到每股分红。
  // 产品端此前直接赋给 perShare，导致分红被放大 10 倍，并经分红再投资形成
  // 指数式错误复利。此处统一换算为每股口径。
  //
  // P0-4：东方财富可能返回修订记录、重复方案或同日多行；研究端按 ex_date
  // groupby 后对 cash_dividend_per_share 求和。产品端此前把每一行都转换为
  // 分红事件，会重复派息。此处按 date（除权除息日）合并：perShare 求和，
  // recordDate/paymentDate 取该日第一条非空记录，transferRatio/bonusRatio
  // 取最大值（非现金公司行动已在 simulateBacktest 中阻断）。
  const rawEvents = (payload.result?.data ?? [])
    .map((row): DividendEvent => ({
      date: String(row["EX_DIVIDEND_DATE"] ?? "").slice(0, 10),
      recordDate: String(
        row["EQUITY_RECORD_DATE"] ?? row["EX_DIVIDEND_DATE"] ?? "",
      ).slice(0, 10),
      paymentDate: row["DIVIDEND_ARRIVAL_DATE"]
        ? String(row["DIVIDEND_ARRIVAL_DATE"]).slice(0, 10)
        : null,
      perShare: Number(row["PRETAX_BONUS_RMB"] ?? 0) / 10,
      transferRatio: Number(row["TRANSFER_RATIO"] ?? 0),
      bonusRatio: Number(row["BONUS_RATIO"] ?? 0),
      status: String(row["ASSIGN_PROGRESS"] ?? ""),
    }))
    .filter(
      (row) =>
        row.date >= startDate &&
        row.date <= endDate &&
        row.status.includes("实施") &&
        Number.isFinite(row.perShare) &&
        row.perShare >= 0 &&
        row.date.length === 10,
    );

  const mergedByDate = new Map<string, DividendEvent>();
  for (const event of rawEvents) {
    const existing = mergedByDate.get(event.date);
    if (!existing) {
      mergedByDate.set(event.date, { ...event });
      continue;
    }
    existing.perShare = Math.round((existing.perShare + event.perShare) * 1e6) / 1e6;
    if (!existing.recordDate && event.recordDate) {
      existing.recordDate = event.recordDate;
    }
    if (!existing.paymentDate && event.paymentDate) {
      existing.paymentDate = event.paymentDate;
    }
    existing.transferRatio = Math.max(existing.transferRatio, event.transferRatio);
    existing.bonusRatio = Math.max(existing.bonusRatio, event.bonusRatio);
  }
  const rows = [...mergedByDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return {
    rows,
    provenance: {
      source: "东方财富 RPT_SHAREBONUS_DET（产品域独立适配）",
      fetchedAt: new Date().toISOString(),
      dataCutoff: rows[0]?.date ?? endDate,
      adjustment: "none",
      // 口径版本升级：每股分红 + 按除权日合并，对齐 research/bank-dca v1
      caliberVersion: "bank-dca-r1-node-v2",
    },
  };
}

export function stockName(symbol: string): string {
  return STOCK_NAMES[symbol] ?? symbol;
}
