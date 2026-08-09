import type {
  DataProvenance,
  DividendEvent,
  ReportedCorporateAction,
  SecurityType,
} from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import { fetchWithTimeout } from "./_internal/httpClient";
import {
  fetchCorporateActions as fetchEastmoneyStockCorporateActions,
  marketSymbol,
} from "./tencent";

const THS_BONUS_URL = "https://basic.10jqka.com.cn";
const SINA_ADJUSTMENT_URL = "https://finance.sina.com.cn/realstock/company";
const EASTMONEY_FUND_F10_URL = "https://fundf10.eastmoney.com";
const REQUEST_TIMEOUT_MS = 20_000;

interface ReviewedDifferentiatedDividend {
  symbol: string;
  date: string;
  recordDate: string;
  paymentDate: string;
  eastmoneyPerShare: number;
  thsPerShare: number;
  secondaryMarketPerShare: number;
  transferRatio: number;
  bonusRatio: number;
  officialSource: string;
  officialDocumentId: string;
}

// 差异化分红不能用全体股份加权金额替代二级市场持有人实际权益。
// 每条校准都必须绑定正式公告和两源结构化指纹；未知冲突继续由严格门禁阻断。
const REVIEWED_DIFFERENTIATED_DIVIDENDS: readonly ReviewedDifferentiatedDividend[] = [
  {
    symbol: "600900",
    date: "2016-07-19",
    recordDate: "2016-07-18",
    paymentDate: "2016-07-19",
    eastmoneyPerShare: 0.12946,
    thsPerShare: 0.4,
    secondaryMarketPerShare: 0.4,
    transferRatio: 0,
    bonusRatio: 0,
    officialSource:
      "https://static.cninfo.com.cn/finalpage/2016-07-13/1202468389.PDF",
    officialDocumentId: "1202468389",
  },
] as const;

export interface CorporateActionResult {
  rows: DividendEvent[];
  reportedActions: ReportedCorporateAction[];
  provenance: DataProvenance;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function htmlText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tableCells(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
    htmlText(match[1]),
  );
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function rounded(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function mergeSameDateDividends(rows: readonly DividendEvent[]): DividendEvent[] {
  const merged = new Map<string, DividendEvent>();
  for (const row of rows) {
    const existing = merged.get(row.date);
    if (!existing) {
      merged.set(row.date, { ...row });
      continue;
    }
    existing.perShare = rounded(existing.perShare + row.perShare);
    existing.transferRatio = rounded(
      existing.transferRatio + row.transferRatio,
    );
    existing.bonusRatio = rounded(existing.bonusRatio + row.bonusRatio);
    existing.recordDate = [existing.recordDate, row.recordDate].sort().at(-1)!;
    existing.paymentDate = [existing.paymentDate, row.paymentDate]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  }
  return [...merged.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function planNumber(plan: string, pattern: RegExp): number {
  const match = pattern.exec(plan.replace(/\s+/g, ""));
  return match ? Number(match[1]) : 0;
}

export function parseThsCorporateActions(
  html: string,
  symbol: string,
  startDate: string,
  endDate: string,
): Pick<CorporateActionResult, "rows" | "reportedActions"> {
  const bonusStart = html.indexOf('id="bonus_table"');
  if (bonusStart < 0) throw new Error("同花顺公司行动页缺少 bonus_table");
  const bonusEnd = html.indexOf("</table>", bonusStart);
  if (bonusEnd < 0) throw new Error("同花顺公司行动分红表未闭合");
  const bonusTable = html.slice(bonusStart, bonusEnd + 8);
  const rows: DividendEvent[] = [];
  for (const match of bonusTable.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = tableCells(match[1]);
    if (cells.length !== 11) continue;
    const plan = cells[4];
    const status = cells[8];
    if (!status.includes("实施")) continue;
    const date = cells[6];
    const recordDate = cells[5];
    if (!validDate(date) || !validDate(recordDate)) {
      throw new Error(`同花顺 ${symbol} 已实施分红方案缺少有效登记日或除权日`);
    }
    const perShare =
      planNumber(plan, /10(?:股)?派(?:现金)?([\d.]+)元/) / 10;
    const transferRatio = planNumber(plan, /10(?:股)?转(?:增)?([\d.]+)股?/);
    const bonusRatio = planNumber(plan, /10(?:股)?送([\d.]+)股?/);
    if (perShare === 0 && transferRatio === 0 && bonusRatio === 0) {
      if (/不分配|不转增/.test(plan)) continue;
      throw new Error(`同花顺 ${symbol} 已实施分红方案无法解析：${plan}`);
    }
    if (date < startDate || date > endDate) continue;
    rows.push({
      date,
      recordDate,
      paymentDate: null,
      perShare: rounded(perShare),
      transferRatio: rounded(transferRatio),
      bonusRatio: rounded(bonusRatio),
      status,
    });
  }

  const rightsStart = html.indexOf('id="stockallotdata"');
  if (rightsStart < 0) throw new Error("同花顺公司行动页缺少 stockallotdata");
  const rightsSection = html.slice(rightsStart);
  const reportedActions: ReportedCorporateAction[] = [];
  for (const match of rightsSection.matchAll(
    /<table\b[^>]*class="[^"]*\bpggk\b[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
  )) {
    const text = htmlText(match[1]);
    if (!text.includes("已实施")) continue;
    const sourceId = /配股代码：\s*(\d{6})/.exec(text)?.[1];
    const ratio = /实际配股比例：\s*10\s*配\s*([\d.]+)\s*股/.exec(text)?.[1];
    const listingDate = /配股上市日：\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    const price = /每股配股价格.*?：\s*([\d.]+)\s*元/.exec(text)?.[1];
    const payment = /缴款起止日：\s*(\d{4}-\d{2}-\d{2})\s*到\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    const exDate = /除权日：\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    const recordDate = /股权登记日：\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    if (!ratio || !price || !exDate || !recordDate) {
      throw new Error(`同花顺 ${symbol} 已实施配股方案字段不完整`);
    }
    if (exDate < startDate || exDate > endDate) continue;
    reportedActions.push({
      type: "rights_issue",
      sourceId: sourceId ?? `ths:${symbol}:${exDate}`,
      exDate,
      recordDate,
      paymentStartDate: payment?.[1] ?? null,
      paymentEndDate: payment?.[2] ?? null,
      listingDate: listingDate ?? null,
      ratioPer10: Number(ratio),
      subscriptionPrice: Number(price),
    });
  }
  return {
    rows: mergeSameDateDividends(rows),
    reportedActions: reportedActions.sort((left, right) =>
      left.exDate.localeCompare(right.exDate),
    ),
  };
}

async function fetchThsStockCorporateActions(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<CorporateActionResult> {
  const url = `${THS_BONUS_URL}/${symbol}/bonus.html`;
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "同花顺公司行动",
    headers: {
      Referer: `${THS_BONUS_URL}/${symbol}/`,
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    throw new Error(`同花顺公司行动请求失败：HTTP ${response.status}`);
  }
  const html = new TextDecoder("gb18030").decode(
    await response.arrayBuffer(),
  );
  const parsed = parseThsCorporateActions(html, symbol, startDate, endDate);
  const dates = [
    ...parsed.rows.map((row) => row.date),
    ...parsed.reportedActions.map((row) => row.exDate),
  ].sort();
  return {
    ...parsed,
    provenance: {
      source: "同花顺 F10 分红与配股页（产品域独立适配）",
      primarySource: "ths",
      fallbackUsed: false,
      fetchedAt: new Date().toISOString(),
      dataCutoff: dates.at(-1) ?? endDate,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

interface SinaFactorRow {
  d?: unknown;
  date?: unknown;
  u?: unknown;
}

export function parseSinaEtfDividends(
  payload: string,
  startDate: string,
  endDate: string,
): DividendEvent[] {
  const separator = payload.indexOf("=");
  if (separator < 0) throw new Error("新浪 ETF 累计分红响应格式已变化");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(separator + 1).split("/*", 1)[0].trim());
  } catch {
    throw new Error("新浪 ETF 累计分红响应不是合法 JSON");
  }
  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) {
    throw new Error("新浪 ETF 累计分红响应缺少 data 数组");
  }
  const factors = (data as SinaFactorRow[])
    .map((row) => ({
      date: String(row.d ?? row.date ?? ""),
      cumulative: Number(row.u),
    }))
    .filter((row) => row.date !== "1900-01-01")
    .sort((left, right) => left.date.localeCompare(right.date));
  if (
    factors.some(
      (row) => !validDate(row.date) || !Number.isFinite(row.cumulative) || row.cumulative < 0,
    )
  ) {
    throw new Error("新浪 ETF 累计分红包含无效日期或数值");
  }
  const rows: DividendEvent[] = [];
  let previous = 0;
  for (const factor of factors) {
    const perShare = rounded(factor.cumulative - previous);
    if (perShare < 0) throw new Error("新浪 ETF 累计分红出现倒退");
    previous = factor.cumulative;
    if (perShare === 0 || factor.date < startDate || factor.date > endDate) {
      continue;
    }
    rows.push({
      date: factor.date,
      recordDate: factor.date,
      paymentDate: null,
      perShare,
      transferRatio: 0,
      bonusRatio: 0,
      status: "实施",
    });
  }
  return rows;
}

export function parseEastmoneyEtfDividends(
  html: string,
  startDate: string,
  endDate: string,
): DividendEvent[] {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map((match) => match[0])
    .find((candidate) =>
      ["权益登记日", "除息日", "每10份分红", "分红发放日"].every((label) =>
        candidate.includes(label),
      ),
    );
  if (!table) throw new Error("东方财富 ETF 分红页缺少分红表");
  const rows: DividendEvent[] = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = tableCells(match[1]);
    if (cells.length !== 5 || !validDate(cells[2])) continue;
    const cash = /每10份派现金([\d.]+)元/.exec(cells[3].replace(/\s+/g, ""));
    if (!cash || !validDate(cells[1]) || !validDate(cells[4])) {
      throw new Error("东方财富 ETF 分红页包含无法解析的实施记录");
    }
    if (cells[2] < startDate || cells[2] > endDate) continue;
    rows.push({
      date: cells[2],
      recordDate: cells[1],
      paymentDate: cells[4],
      perShare: rounded(Number(cash[1]) / 10),
      transferRatio: 0,
      bonusRatio: 0,
      status: "实施",
    });
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

async function fetchSinaEtfCorporateActions(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<CorporateActionResult> {
  const code = marketSymbol(symbol);
  const response = await fetchWithTimeout(
    `${SINA_ADJUSTMENT_URL}/${code}/hfq.js`,
    {
      timeoutMs: REQUEST_TIMEOUT_MS,
      label: "新浪 ETF 累计分红",
      headers: {
        Referer: `https://finance.sina.com.cn/fund/quotes/${symbol}/bc.shtml`,
        "User-Agent": "Mozilla/5.0",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`新浪 ETF 累计分红请求失败：HTTP ${response.status}`);
  }
  const rows = parseSinaEtfDividends(await response.text(), startDate, endDate);
  return {
    rows,
    reportedActions: [],
    provenance: {
      source: "新浪财经 ETF 累计分红（产品域独立适配）",
      primarySource: "sina",
      fallbackUsed: false,
      fetchedAt: new Date().toISOString(),
      dataCutoff: rows.at(-1)?.date ?? endDate,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

async function fetchEastmoneyEtfCorporateActions(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<CorporateActionResult> {
  const url = `${EASTMONEY_FUND_F10_URL}/fhsp_${symbol}.html`;
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: "东方财富 ETF 分红",
    headers: { Referer: `${EASTMONEY_FUND_F10_URL}/`, "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`东方财富 ETF 分红请求失败：HTTP ${response.status}`);
  }
  const rows = parseEastmoneyEtfDividends(
    await response.text(),
    startDate,
    endDate,
  );
  return {
    rows,
    reportedActions: [],
    provenance: {
      source: "东方财富基金 F10 分红送配页（产品域独立适配）",
      primarySource: "eastmoney-fund-f10",
      fallbackUsed: false,
      fetchedAt: new Date().toISOString(),
      dataCutoff: rows.at(-1)?.date ?? endDate,
      adjustment: "none",
      caliberVersion: BACKTEST_CALIBER_VERSION,
    },
  };
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-5;
}

function assertDividendAgreement(
  label: string,
  left: DividendEvent,
  right: DividendEvent,
  compareRecordDate = true,
): void {
  if (
    !closeEnough(left.perShare, right.perShare) ||
    !closeEnough(left.transferRatio, right.transferRatio) ||
    !closeEnough(left.bonusRatio, right.bonusRatio) ||
    (compareRecordDate && left.recordDate !== right.recordDate)
  ) {
    throw new Error(
      `${label}在 ${left.date} 的双源证据不一致：主源=${JSON.stringify(left)}；校验源=${JSON.stringify(right)}`,
    );
  }
}

interface EvidenceMerge<T> {
  rows: T[];
  matched: number;
  primaryOnly: number;
  backupOnly: number;
}

interface DividendEvidenceMerge extends EvidenceMerge<DividendEvent> {
  officialReviews: string[];
}

function reviewedDividendLabel(
  calibration: ReviewedDifferentiatedDividend,
): string {
  return `官方差异化分红校准 ${calibration.symbol}:${calibration.date}（巨潮资讯公告 ${calibration.officialDocumentId}）`;
}

function matchesReviewedNumber(left: number, right: number): boolean {
  return rounded(left) === rounded(right);
}

function matchesReviewedDividendBase(
  row: DividendEvent,
  calibration: ReviewedDifferentiatedDividend,
): boolean {
  return (
    row.date === calibration.date &&
    row.recordDate === calibration.recordDate &&
    (row.paymentDate === null || row.paymentDate === calibration.paymentDate) &&
    matchesReviewedNumber(row.transferRatio, calibration.transferRatio) &&
    matchesReviewedNumber(row.bonusRatio, calibration.bonusRatio) &&
    row.status.includes("实施")
  );
}

function matchesReviewedDividendSource(
  row: DividendEvent,
  calibration: ReviewedDifferentiatedDividend,
  source: "eastmoney" | "ths" | "resolved",
): boolean {
  if (!matchesReviewedDividendBase(row, calibration)) return false;
  let expectedPerShare = calibration.secondaryMarketPerShare;
  if (source === "eastmoney") {
    expectedPerShare = calibration.eastmoneyPerShare;
  } else if (source === "ths") {
    expectedPerShare = calibration.thsPerShare;
  }
  return matchesReviewedNumber(row.perShare, expectedPerShare);
}

function resolvedReviewedDividend(
  row: DividendEvent,
  calibration: ReviewedDifferentiatedDividend,
): DividendEvent {
  return {
    ...row,
    date: calibration.date,
    recordDate: calibration.recordDate,
    paymentDate: calibration.paymentDate,
    perShare: calibration.secondaryMarketPerShare,
    transferRatio: calibration.transferRatio,
    bonusRatio: calibration.bonusRatio,
  };
}

function resolveReviewedDividendConflict(
  symbol: string,
  primary: DividendEvent,
  backup: DividendEvent,
): { row: DividendEvent; label: string } | null {
  const calibration = REVIEWED_DIFFERENTIATED_DIVIDENDS.find(
    (candidate) =>
      candidate.symbol === symbol && candidate.date === primary.date,
  );
  if (
    !calibration ||
    !matchesReviewedDividendSource(primary, calibration, "eastmoney") ||
    !matchesReviewedDividendSource(backup, calibration, "ths")
  ) {
    return null;
  }
  return {
    row: resolvedReviewedDividend(backup, calibration),
    label: reviewedDividendLabel(calibration),
  };
}

function enforceReviewedStockDividends(
  symbol: string,
  startDate: string,
  endDate: string,
  result: CorporateActionResult,
): CorporateActionResult {
  const calibrations = REVIEWED_DIFFERENTIATED_DIVIDENDS.filter(
    (candidate) =>
      candidate.symbol === symbol &&
      candidate.date >= startDate &&
      candidate.date <= endDate,
  );
  if (calibrations.length === 0) return result;

  const rows = [...result.rows];
  const labels: string[] = [];
  for (const calibration of calibrations) {
    const index = rows.findIndex((row) => row.date === calibration.date);
    if (index < 0) {
      throw new Error(
        `股票 ${symbol} 在 ${calibration.date} 缺少已由官方公告复核的差异化分红事件（${calibration.officialSource}）`,
      );
    }
    const row = rows[index]!;
    if (
      !matchesReviewedDividendSource(row, calibration, "eastmoney") &&
      !matchesReviewedDividendSource(row, calibration, "ths") &&
      !matchesReviewedDividendSource(row, calibration, "resolved")
    ) {
      throw new Error(
        `股票 ${symbol} 在 ${calibration.date} 的来源记录与官方差异化分红指纹不一致：来源=${JSON.stringify(row)}；官方=${calibration.officialSource}`,
      );
    }
    rows[index] = resolvedReviewedDividend(row, calibration);
    labels.push(reviewedDividendLabel(calibration));
  }

  const suffix = [...new Set(labels)].join("；");
  return {
    ...result,
    rows,
    provenance: {
      ...result.provenance,
      source: result.provenance.source.includes(suffix)
        ? result.provenance.source
        : `${result.provenance.source}；${suffix}`,
    },
  };
}

function assertNoNearDateMismatch<T>(
  label: string,
  primaryOnly: readonly T[],
  backupOnly: readonly T[],
  dateOf: (row: T) => string,
): void {
  for (const primaryRow of primaryOnly) {
    for (const backupRow of backupOnly) {
      const dayDistance = Math.abs(
        (Date.parse(`${dateOf(primaryRow)}T00:00:00Z`) -
          Date.parse(`${dateOf(backupRow)}T00:00:00Z`)) /
          86_400_000,
      );
      if (dayDistance <= 7) {
        throw new Error(
          `${label}疑似同一事件的日期不一致：主源=${JSON.stringify(primaryRow)}；校验源=${JSON.stringify(backupRow)}`,
        );
      }
    }
  }
}

function mergeDividendEvidence(
  label: string,
  symbol: string,
  primary: readonly DividendEvent[],
  backup: readonly DividendEvent[],
  options: {
    compareRecordDate: boolean;
    preferBackupDetails: boolean;
    allowReviewedDifferentiatedDividend?: boolean;
  },
): DividendEvidenceMerge {
  const primaryByDate = new Map(primary.map((row) => [row.date, row]));
  const backupByDate = new Map(backup.map((row) => [row.date, row]));
  const primaryOnlyRows = primary.filter((row) => !backupByDate.has(row.date));
  const backupOnlyRows = backup.filter((row) => !primaryByDate.has(row.date));
  assertNoNearDateMismatch(
    label,
    primaryOnlyRows,
    backupOnlyRows,
    (row) => row.date,
  );
  const dates = [...new Set([...primaryByDate.keys(), ...backupByDate.keys()])]
    .sort();
  let matched = 0;
  let primaryOnly = 0;
  let backupOnly = 0;
  const officialReviews: string[] = [];
  const rows = dates.map((date) => {
    const primaryRow = primaryByDate.get(date);
    const backupRow = backupByDate.get(date);
    if (primaryRow && backupRow) {
      const reviewed = options.allowReviewedDifferentiatedDividend
        ? resolveReviewedDividendConflict(symbol, primaryRow, backupRow)
        : null;
      if (reviewed) {
        matched += 1;
        officialReviews.push(reviewed.label);
        return reviewed.row;
      }
      assertDividendAgreement(
        label,
        primaryRow,
        backupRow,
        options.compareRecordDate,
      );
      matched += 1;
      return options.preferBackupDetails ? backupRow : primaryRow;
    }
    if (primaryRow) {
      primaryOnly += 1;
      return primaryRow;
    }
    backupOnly += 1;
    return backupRow!;
  });
  return {
    rows,
    matched,
    primaryOnly,
    backupOnly,
    officialReviews: [...new Set(officialReviews)],
  };
}

function mergeRightsEvidence(
  label: string,
  primary: readonly ReportedCorporateAction[],
  backup: readonly ReportedCorporateAction[],
): EvidenceMerge<ReportedCorporateAction> {
  const primaryByDate = new Map(primary.map((row) => [row.exDate, row]));
  const backupByDate = new Map(backup.map((row) => [row.exDate, row]));
  const primaryOnlyRows = primary.filter(
    (row) => !backupByDate.has(row.exDate),
  );
  const backupOnlyRows = backup.filter(
    (row) => !primaryByDate.has(row.exDate),
  );
  assertNoNearDateMismatch(
    label,
    primaryOnlyRows,
    backupOnlyRows,
    (row) => row.exDate,
  );
  const dates = [...new Set([...primaryByDate.keys(), ...backupByDate.keys()])]
    .sort();
  let matched = 0;
  let primaryOnly = 0;
  let backupOnly = 0;
  const rows: ReportedCorporateAction[] = [];
  for (const date of dates) {
    const left = primaryByDate.get(date);
    const right = backupByDate.get(date);
    if (left && !right) {
      primaryOnly += 1;
      rows.push(left);
      continue;
    }
    if (!left && right) {
      backupOnly += 1;
      rows.push(right);
      continue;
    }
    if (
      left!.recordDate !== right!.recordDate ||
      !closeEnough(left!.ratioPer10, right!.ratioPer10) ||
      !closeEnough(left!.subscriptionPrice, right!.subscriptionPrice)
    ) {
      throw new Error(
        `${label}在 ${date} 的双源证据不一致：主源=${JSON.stringify(left ?? null)}；校验源=${JSON.stringify(right ?? null)}`,
      );
    }
    matched += 1;
    rows.push(left!);
  }
  return { rows, matched, primaryOnly, backupOnly };
}

interface CombinedEvidence {
  rows: DividendEvent[];
  reportedActions: ReportedCorporateAction[];
  summary: string;
}

async function resolvePrimaryAndBackup(
  label: string,
  primaryName: string,
  backupName: string,
  primaryPromise: Promise<CorporateActionResult>,
  backupPromise: Promise<CorporateActionResult>,
  combine: (
    primary: CorporateActionResult,
    backup: CorporateActionResult,
  ) => CombinedEvidence,
): Promise<CorporateActionResult> {
  const [primary, backup] = await Promise.allSettled([
    primaryPromise,
    backupPromise,
  ]);
  if (primary.status === "fulfilled" && backup.status === "fulfilled") {
    const combined = combine(primary.value, backup.value);
    const dates = [
      ...combined.rows.map((row) => row.date),
      ...combined.reportedActions.map((row) => row.exDate),
    ].sort();
    return {
      ...primary.value,
      rows: combined.rows,
      reportedActions: combined.reportedActions,
      provenance: {
        ...primary.value.provenance,
        source: `${primaryName} + ${backupName} 实施记录合并；${combined.summary}`,
        dataCutoff: dates.at(-1) ?? primary.value.provenance.dataCutoff,
      },
    };
  }
  if (primary.status === "fulfilled" && backup.status === "rejected") {
    return {
      ...primary.value,
      provenance: {
        ...primary.value.provenance,
        fallbackReason: `${backupName}校验源失败：${errorMessage(backup.reason)}`,
      },
    };
  }
  if (primary.status === "rejected" && backup.status === "fulfilled") {
    return {
      ...backup.value,
      provenance: {
        ...backup.value.provenance,
        primarySource: primaryName,
        fallbackUsed: true,
        fallbackReason: errorMessage(primary.reason),
        source: `${backupName}（${primaryName}失败后的整段备用）`,
      },
    };
  }
  if (primary.status === "rejected" && backup.status === "rejected") {
    throw new Error(
      `${label}主源失败（${errorMessage(primary.reason)}）；备用源失败（${errorMessage(backup.reason)}）`,
    );
  }
  throw new Error(`${label}数据源状态异常`);
}

export async function fetchVerifiedCorporateActions(
  symbol: string,
  securityType: SecurityType,
  startDate: string,
  endDate: string,
): Promise<CorporateActionResult> {
  if (securityType === "etf") {
    return resolvePrimaryAndBackup(
      "ETF 分红",
      "新浪 ETF 累计分红",
      "东方财富基金 F10",
      fetchSinaEtfCorporateActions(symbol, startDate, endDate),
      fetchEastmoneyEtfCorporateActions(symbol, startDate, endDate),
      (primary, backup) => {
        const dividends = mergeDividendEvidence(
          `ETF ${symbol} 分红`,
          symbol,
          primary.rows,
          backup.rows,
          { compareRecordDate: false, preferBackupDetails: true },
        );
        return {
          rows: dividends.rows,
          reportedActions: [],
          summary: `重合 ${dividends.matched} 条，新浪独有 ${dividends.primaryOnly} 条，东财独有 ${dividends.backupOnly} 条`,
        };
      },
    );
  }
  const result = await resolvePrimaryAndBackup(
    `股票 ${symbol} 公司行动`,
    "东方财富公司行动",
    "同花顺 F10",
    fetchEastmoneyStockCorporateActions(symbol, startDate, endDate),
    fetchThsStockCorporateActions(symbol, startDate, endDate),
    (primary, backup) => {
      const dividends = mergeDividendEvidence(
        `股票 ${symbol} 分红送转`,
        symbol,
        primary.rows,
        backup.rows,
        {
          compareRecordDate: true,
          preferBackupDetails: false,
          allowReviewedDifferentiatedDividend: true,
        },
      );
      const rights = mergeRightsEvidence(
        `股票 ${symbol} 配股`,
        primary.reportedActions,
        backup.reportedActions,
      );
      return {
        rows: dividends.rows,
        reportedActions: rights.rows,
        summary: `分红重合 ${dividends.matched} 条、东财独有 ${dividends.primaryOnly} 条、同花顺独有 ${dividends.backupOnly} 条${dividends.officialReviews.length ? `；${dividends.officialReviews.join("；")}` : ""}；配股重合 ${rights.matched} 条、东财独有 ${rights.primaryOnly} 条、同花顺独有 ${rights.backupOnly} 条`,
      };
    },
  );
  return enforceReviewedStockDividends(symbol, startDate, endDate, result);
}
