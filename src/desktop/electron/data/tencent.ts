import type {
  AdjustedBar,
  DataProvenance,
  DividendEvent,
  PricePoint,
  ReportedCorporateAction,
} from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import { fetchWithTimeout } from "./_internal/httpClient";

const TENCENT_URL =
  "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get";
const EASTMONEY_URL =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";
const EASTMONEY_EMPTY_RESULT_CODE = 9201;

export function marketSymbol(symbol: string): string {
  if (/^[56]/.test(symbol)) return `sh${symbol}`;
  if (/^[489]/.test(symbol)) return `bj${symbol}`;
  return `sz${symbol}`;
}

function nonnegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function firstNonnegativeNumber(
  row: Record<string, unknown>,
  fields: readonly string[],
): number | undefined {
  for (const field of fields) {
    const value = row[field];
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim())
    ) {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
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
    if (value && value !== "-") return value;
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
  const direct = firstNonnegativeNumber(row, [
    "IT_RATIO",
    "TRANSFER_RATIO",
  ]);
  if (direct !== undefined) return direct;

  // 部分历史响应只给 BONUS_IT_RATIO（送转合计），此时扣除送股比例得到
  // 转增比例。真实新响应通常同时给 IT_RATIO。
  const combined = firstNonnegativeNumber(row, ["BONUS_IT_RATIO"]) ?? 0;
  const bonus = firstNonnegativeNumber(row, ["BONUS_RATIO"]) ?? 0;
  return Math.max(
    0,
    combined - bonus,
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

export function parseReportedCorporateActions(
  sourceRows: Array<Record<string, unknown>>,
  startDate: string,
  endDate: string,
): ReportedCorporateAction[] {
  const actions = new Map<string, ReportedCorporateAction>();
  for (const row of sourceRows) {
    const exDate = dateValue(row["EX_DIVIDEND_DATE"]);
    if (!exDate) {
      throw new Error("东方财富配股响应缺少有效的除权日");
    }
    if (exDate < startDate || exDate > endDate) continue;
    const ratioPer10 = firstNonnegativeNumber(row, ["PLACING_RATIO"]);
    const subscriptionPrice = firstNonnegativeNumber(row, ["ISSUE_PRICE"]);
    if (ratioPer10 === undefined || subscriptionPrice === undefined) {
      throw new Error(`东方财富配股响应 ${exDate} 含无效数值字段`);
    }
    const sourceId =
      firstValue(row, ["FINANCE_CODE", "CORRECODE"]) ||
      stableRowFingerprint(row);
    actions.set(sourceId, {
      type: "rights_issue",
      sourceId,
      exDate,
      recordDate: dateValue(row["EQUITY_RECORD_DATE"]) || exDate,
      paymentStartDate: dateValue(row["PAY_START_DATE"]) || null,
      paymentEndDate: dateValue(row["PAY_END_DATE"]) || null,
      listingDate: dateValue(row["LISTING_DATE"]) || null,
      ratioPer10,
      subscriptionPrice,
    });
  }
  return [...actions.values()].sort((left, right) =>
    left.exDate.localeCompare(right.exDate),
  );
}

async function fetchJson(url: URL, timeoutMs = 15_000): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    timeoutMs,
    label: "东方财富",
    headers: { Referer: "https://data.eastmoney.com/" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEastmoneyRows(
  payload: unknown,
  reportName: string,
): Array<Record<string, unknown>> {
  if (!isRecord(payload)) {
    throw new Error(`东方财富 ${reportName} 响应不是对象`);
  }
  const code = Number(payload["code"]);
  const success = payload["success"];
  const message = textValue(payload["message"]);
  if (
    success === false &&
    code === EASTMONEY_EMPTY_RESULT_CODE &&
    message.includes("数据为空")
  ) {
    return [];
  }
  if (success !== true || code !== 0) {
    throw new Error(
      `东方财富 ${reportName} 请求失败：${message || `code=${String(payload["code"])}`}`,
    );
  }
  const result = payload["result"];
  if (!isRecord(result) || !Array.isArray(result["data"])) {
    throw new Error(`东方财富 ${reportName} 响应结构已变化：缺少 result.data`);
  }
  if (!result["data"].every(isRecord)) {
    throw new Error(`东方财富 ${reportName} 响应结构已变化：data 行不是对象`);
  }
  return result["data"];
}

async function fetchEastmoneyReport(
  reportName: string,
  symbol: string,
  sortColumn: string,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(EASTMONEY_URL);
  const params: Record<string, string> = {
    reportName,
    columns: "ALL",
    filter: `(SECURITY_CODE="${symbol}")`,
    pageNumber: "1",
    pageSize: "100",
    sortColumns: sortColumn,
    sortTypes: "-1",
    source: "WEB",
    client: "WEB",
  };
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return parseEastmoneyRows(await fetchJson(url), reportName);
}

function parseTencentSeries(
  text: string,
  code: string,
  adjustment: "none" | "qfq",
  year: number,
): Array<Array<string | number>> {
  const separator = text.indexOf("=");
  if (separator < 0) throw new Error(`腾讯行情 ${year} 年响应格式已变化`);
  let payload: unknown;
  try {
    payload = JSON.parse(text.slice(separator + 1));
  } catch {
    throw new Error(`腾讯行情 ${year} 年响应不是有效 JSON`);
  }
  if (!isRecord(payload) || Number(payload["code"]) !== 0) {
    const message = isRecord(payload) ? textValue(payload["msg"]) : "";
    throw new Error(
      `腾讯行情 ${year} 年请求失败${message ? `：${message}` : ""}`,
    );
  }
  const data = payload["data"];
  const security = isRecord(data) ? data[code] : undefined;
  if (!isRecord(security)) {
    throw new Error(`腾讯行情 ${year} 年响应结构已变化：缺少 ${code}`);
  }
  const field = adjustment === "qfq" ? "qfqday" : "day";
  const series = security[field];
  if (!Array.isArray(series)) {
    const available = Object.keys(security).join(", ") || "无";
    throw new Error(
      `腾讯行情 ${year} 年响应结构已变化：缺少 ${field}（现有字段：${available}）`,
    );
  }
  for (const item of series) {
    if (
      !Array.isArray(item) ||
      item.length < 6 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(item[0]))
    ) {
      throw new Error(`腾讯行情 ${year} 年包含无效日线行`);
    }
    const [open, close, high, low, volume] = item
      .slice(1, 6)
      .map(Number);
    if (
      ![open, close, high, low, volume].every(Number.isFinite) ||
      open <= 0 ||
      close <= 0 ||
      high < Math.max(open, close) ||
      low <= 0 ||
      low > Math.min(open, close) ||
      volume < 0
    ) {
      throw new Error(`腾讯行情 ${year} 年包含无效 OHLCV 数值`);
    }
  }
  return series as Array<Array<string | number>>;
}

async function fetchTencentDailyRows(
  symbol: string,
  startDate: string,
  endDate: string,
  adjustment: "none" | "qfq",
): Promise<Array<Array<string | number>>> {
  const code = marketSymbol(symbol);
  const rows = new Map<string, Array<string | number>>();
  const rowCountsByYear = new Map<number, number>();
  const firstYear = Number(startDate.slice(0, 4));
  const lastYear = Number(endDate.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    const url = new URL(TENCENT_URL);
    // The proxy can cache by `_var`; include the security and adjustment so a
    // preceding unadjusted/other-symbol request cannot poison this response.
    const variable = `kline_${code}_${adjustment}_day${year}`;
    url.searchParams.set("_var", variable);
    url.searchParams.set(
      "param",
      `${code},day,${year}-01-01,${year}-12-31,640,${
        adjustment === "qfq" ? "qfq" : ""
      }`,
    );
    url.searchParams.set("r", String(Date.now()));
    const response = await fetchWithTimeout(url, {
      timeoutMs: 15_000,
      label: "腾讯行情",
      headers: { Referer: `https://gu.qq.com/${code}` },
    });
    if (!response.ok) {
      throw new Error(`腾讯行情请求失败：HTTP ${response.status}`);
    }
    const text = await response.text();
    const series = parseTencentSeries(text, code, adjustment, year);
    let acceptedRows = 0;
    for (const item of series) {
      const date = String(item[0]);
      if (date >= startDate && date <= endDate) {
        rows.set(date, item);
        acceptedRows += 1;
      }
    }
    rowCountsByYear.set(year, acceptedRows);
  }
  if (rows.size) {
    const dates = [...rows.keys()].sort();
    const firstDataYear = Number(dates[0].slice(0, 4));
    const lastDataYear = Number(dates.at(-1)!.slice(0, 4));
    for (let year = firstDataYear + 1; year < lastDataYear; year += 1) {
      if ((rowCountsByYear.get(year) ?? 0) === 0) {
        throw new Error(`腾讯行情请求区间在 ${year} 年存在异常缺口`);
      }
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
  )).map((item) => ({ date: String(item[0]), close: Number(item[2]) }));
  const fetchedAt = new Date().toISOString();
  return {
    rows,
    provenance: {
      source: "腾讯财经 newfqkline（产品域独立适配）",
      fetchedAt,
      dataCutoff: rows.at(-1)?.date ?? endDate,
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
    );
  return {
    rows,
    provenance: {
      source: "腾讯财经 newfqkline 前复权 OHLCV（产品域独立适配）",
      fetchedAt: new Date().toISOString(),
      dataCutoff: rows.at(-1)?.date ?? endDate,
      adjustment: "qfq",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

export async function fetchCorporateActions(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<{
  rows: DividendEvent[];
  reportedActions: ReportedCorporateAction[];
  provenance: DataProvenance;
}> {
  const dividendSourceRows = await fetchEastmoneyReport(
    "RPT_SHAREBONUS_DET",
    symbol,
    "EX_DIVIDEND_DATE",
  );
  const rightsSourceRows = await fetchEastmoneyReport(
    "RPT_IPO_ALLOTMENT",
    symbol,
    "EQUITY_RECORD_DATE",
  );
  const rows = parseCorporateActions(
    dividendSourceRows,
    startDate,
    endDate,
  );
  const reportedActions = parseReportedCorporateActions(
    rightsSourceRows,
    startDate,
    endDate,
  );
  const eventDates = [
    ...rows.map((row) => row.date),
    ...reportedActions.map((row) => row.exDate),
  ].sort();
  return {
    rows,
    reportedActions,
    provenance: {
      source:
        "东方财富 RPT_SHAREBONUS_DET + RPT_IPO_ALLOTMENT（产品域独立适配）",
      fetchedAt: new Date().toISOString(),
      dataCutoff: eventDates.at(-1) ?? endDate,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}
