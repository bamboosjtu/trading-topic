import type {
  AdjustedBar,
  DataProvenance,
  DividendEvent,
  PricePoint,
} from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";

const TENCENT_URL =
  "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get";
const EASTMONEY_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";

export function marketSymbol(symbol: string): string {
  if (symbol.startsWith("6")) return `sh${symbol}`;
  if (/^[489]/.test(symbol)) return `bj${symbol}`;
  return `sz${symbol}`;
}

function nonnegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function dateValue(value: unknown): string {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function stableRowFingerprint(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function firstValue(
  row: Record<string, unknown>,
  fields: readonly string[],
): string {
  for (const field of fields) {
    const value = textValue(row[field]);
    if (value) return value;
  }
  return "";
}

function sourceSchemeKey(row: Record<string, unknown>): string {
  const symbol = textValue(row["SECURITY_CODE"]);
  const sourceId = firstValue(row, [
    "ASSIGN_PLAN_ID",
    "DIVIDEND_PLAN_ID",
    "PLAN_ID",
    "PLAN_CODE",
    "SCHEME_ID",
  ]);
  if (sourceId) return `id:${symbol}:${sourceId}`;

  const reportDate = dateValue(row["REPORT_DATE"]);
  if (reportDate) return `report:${symbol}:${reportDate}`;

  const planNoticeDate = dateValue(row["PLAN_NOTICE_DATE"]);
  if (planNoticeDate) return `plan:${symbol}:${planNoticeDate}`;

  // 无方案 ID、报告期或预案日期时，无法证明同一除权日的多行属于不同
  // 方案。保守地视为同一方案并选最终版本，避免重复派息。
  return `ex-date:${symbol}:${dateValue(row["EX_DIVIDEND_DATE"])}`;
}

function sourceVersionDate(row: Record<string, unknown>): string {
  return [
    "UPDATE_DATE",
    "NOTICE_DATE",
    "PUBLISH_DATE",
    "PLAN_NOTICE_DATE",
  ]
    .map((field) => dateValue(row[field]))
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
}

function transferRatio(row: Record<string, unknown>): number {
  const direct = firstValue(row, ["IT_RATIO", "TRANSFER_RATIO"]);
  if (direct) return nonnegativeNumber(direct);

  // 部分历史响应只给 BONUS_IT_RATIO（送转合计），此时扣除送股比例得到
  // 转增比例。真实新响应通常同时给 IT_RATIO。
  return Math.max(
    0,
    nonnegativeNumber(row["BONUS_IT_RATIO"]) -
      nonnegativeNumber(row["BONUS_RATIO"]),
  );
}

interface CorporateActionCandidate {
  event: DividendEvent;
  schemeKey: string;
  versionDate: string;
  completeness: number;
  fingerprint: string;
}

function candidateFromRow(
  row: Record<string, unknown>,
): CorporateActionCandidate | null {
  const date = dateValue(row["EX_DIVIDEND_DATE"]);
  const status = textValue(row["ASSIGN_PROGRESS"]);
  if (!date || !status.includes("实施")) return null;

  const event: DividendEvent = {
    date,
    recordDate:
      dateValue(row["EQUITY_RECORD_DATE"]) || date,
    paymentDate:
      dateValue(
        firstValue(row, ["DIVIDEND_ARRIVAL_DATE", "PAYMENT_DATE"]),
      ) || null,
    // PRETAX_BONUS_RMB 是每 10 股税前派息金额。
    perShare: nonnegativeNumber(row["PRETAX_BONUS_RMB"]) / 10,
    transferRatio: transferRatio(row),
    bonusRatio: nonnegativeNumber(row["BONUS_RATIO"]),
    status,
  };
  if (
    event.perShare === 0 &&
    event.transferRatio === 0 &&
    event.bonusRatio === 0
  ) {
    return null;
  }

  const relevantFields = [
    "REPORT_DATE",
    "PLAN_NOTICE_DATE",
    "NOTICE_DATE",
    "PUBLISH_DATE",
    "EQUITY_RECORD_DATE",
    "EX_DIVIDEND_DATE",
    "PRETAX_BONUS_RMB",
    "IT_RATIO",
    "TRANSFER_RATIO",
    "BONUS_RATIO",
    "BONUS_IT_RATIO",
    "IMPL_PLAN_PROFILE",
  ];
  return {
    event,
    schemeKey: sourceSchemeKey(row),
    versionDate: sourceVersionDate(row),
    completeness: relevantFields.filter(
      (field) => textValue(row[field]) !== "",
    ).length,
    fingerprint: stableRowFingerprint(row),
  };
}

function laterCandidate(
  left: CorporateActionCandidate,
  right: CorporateActionCandidate,
): CorporateActionCandidate {
  if (left.versionDate !== right.versionDate) {
    return left.versionDate > right.versionDate ? left : right;
  }
  if (left.completeness !== right.completeness) {
    return left.completeness > right.completeness ? left : right;
  }
  return left.fingerprint > right.fingerprint ? left : right;
}

export function parseCorporateActions(
  sourceRows: Array<Record<string, unknown>>,
  startDate: string,
  endDate: string,
): DividendEvent[] {
  // 第一步：完整行去重，消除接口分页、重试或缓存造成的完全重复记录。
  const uniqueRows = new Map<string, Record<string, unknown>>();
  for (const row of sourceRows) {
    uniqueRows.set(stableRowFingerprint(row), row);
  }

  // 第二步：按源方案 ID / 报告期 / 方案公告日识别同一方案；同一方案的
  // 多个实施版本仅保留公告日期最新、字段最完整的一条。
  const finalByScheme = new Map<string, CorporateActionCandidate>();
  for (const row of uniqueRows.values()) {
    const candidate = candidateFromRow(row);
    if (
      !candidate ||
      candidate.event.date < startDate ||
      candidate.event.date > endDate
    ) {
      continue;
    }
    const existing = finalByScheme.get(candidate.schemeKey);
    finalByScheme.set(
      candidate.schemeKey,
      existing ? laterCandidate(existing, candidate) : candidate,
    );
  }

  // 第三步：只有已被识别为不同方案、但恰好同一除权日实施时才累加。
  const mergedByDate = new Map<string, DividendEvent>();
  for (const { event } of finalByScheme.values()) {
    const existing = mergedByDate.get(event.date);
    if (!existing) {
      mergedByDate.set(event.date, { ...event });
      continue;
    }
    existing.perShare =
      Math.round((existing.perShare + event.perShare) * 1e6) / 1e6;
    existing.transferRatio =
      Math.round((existing.transferRatio + event.transferRatio) * 1e6) /
      1e6;
    existing.bonusRatio =
      Math.round((existing.bonusRatio + event.bonusRatio) * 1e6) / 1e6;
    existing.recordDate =
      [existing.recordDate, event.recordDate].filter(Boolean).sort().at(-1) ??
      event.date;
    existing.paymentDate =
      [existing.paymentDate, event.paymentDate]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
  }

  return [...mergedByDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
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

async function fetchTencentDailyRows(
  symbol: string,
  startDate: string,
  endDate: string,
  adjustment: "none" | "qfq",
): Promise<Array<Array<string | number>>> {
  const code = marketSymbol(symbol);
  const rows = new Map<string, Array<string | number>>();
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    const url = new URL(TENCENT_URL);
    const variable = `kline_${adjustment}_day${year}`;
    url.searchParams.set("_var", variable);
    url.searchParams.set(
      "param",
      `${code},day,${year}-01-01,${year}-12-31,640,${
        adjustment === "qfq" ? "qfq" : ""
      }`,
    );
    url.searchParams.set("r", String(Date.now()));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: `https://gu.qq.com/${code}`,
        },
      });
      if (!response.ok) {
        throw new Error(`腾讯行情请求失败：HTTP ${response.status}`);
      }
      const text = await response.text();
      const jsonStart = text.indexOf("={");
      if (jsonStart < 0) throw new Error("腾讯行情响应格式已变化");
      const payload = JSON.parse(text.slice(jsonStart + 1)) as {
        data?: Record<
          string,
          {
            day?: Array<Array<string | number>>;
            qfqday?: Array<Array<string | number>>;
          }
        >;
      };
      const series =
        adjustment === "qfq"
          ? payload.data?.[code]?.qfqday
          : payload.data?.[code]?.day;
      for (const item of series ?? []) {
        const date = String(item[0]);
        if (date >= startDate && date <= endDate) rows.set(date, item);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return [...rows.values()].sort((left, right) =>
    String(left[0]).localeCompare(String(right[0])),
  );
}

export async function fetchUnadjustedPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{ rows: PricePoint[]; provenance: DataProvenance }> {
  const rows = (await fetchTencentDailyRows(
    symbol,
    startDate,
    endDate,
    "none",
  ))
    .map((item) => ({ date: String(item[0]), close: Number(item[2]) }))
    .filter((row) => Number.isFinite(row.close) && row.close > 0);
  if (!rows.length) throw new Error(`${symbol} 未取得腾讯不复权日线`);
  const fetchedAt = new Date().toISOString();
  return {
    rows,
    provenance: {
      source: "腾讯财经 newfqkline（产品域独立适配）",
      fetchedAt,
      dataCutoff: rows.at(-1)!.date,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

export async function fetchAdjustedBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{ rows: AdjustedBar[]; provenance: DataProvenance }> {
  const rows = (await fetchTencentDailyRows(
    symbol,
    startDate,
    endDate,
    "qfq",
  ))
    .map(
      (item): AdjustedBar => ({
        date: String(item[0]),
        open: Number(item[1]),
        close: Number(item[2]),
        high: Number(item[3]),
        low: Number(item[4]),
        volume: Number(item[5]),
        adjustment: "qfq",
      }),
    )
    .filter(
      (row) =>
        [row.open, row.high, row.low, row.close, row.volume].every(
          Number.isFinite,
        ) &&
        row.open > 0 &&
        row.high >= Math.max(row.open, row.close) &&
        row.low > 0 &&
        row.low <= Math.min(row.open, row.close) &&
        row.volume >= 0,
    );
  if (!rows.length) throw new Error(`${symbol} 未取得腾讯前复权 OHLCV 日线`);
  return {
    rows,
    provenance: {
      source: "腾讯财经 newfqkline 前复权 OHLCV（产品域独立适配）",
      fetchedAt: new Date().toISOString(),
      dataCutoff: rows.at(-1)!.date,
      adjustment: "qfq",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

export async function fetchCorporateActions(
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
  const rows = parseCorporateActions(
    payload.result?.data ?? [],
    startDate,
    endDate,
  );
  return {
    rows,
    provenance: {
      source: "东方财富 RPT_SHAREBONUS_DET（产品域独立适配）",
      fetchedAt: new Date().toISOString(),
      dataCutoff: rows.at(-1)?.date ?? endDate,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}
