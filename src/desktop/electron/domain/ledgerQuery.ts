import type {
  LedgerEntry,
  LedgerQuery,
  LedgerQueryResult,
  LedgerRecordView,
  LiveDataQuality,
  StockInfo,
} from "../../shared/contracts";
import { validDate } from "./dateUtils";
import { roundMoney } from "./finance";
import {
  activeLedgerEntries,
  canonicalLedgerOrderDescending,
} from "./ledgerReducer";
import {
  namesMap,
  requiredSecurityType,
  securityTypesMap,
  toLedgerRecord,
} from "./liveViewSupport";

function toLedgerRecords(
  entries: readonly LedgerEntry[],
  stocks: readonly StockInfo[],
): LedgerRecordView[] {
  const names = namesMap(stocks, entries);
  const securityTypes = securityTypesMap(stocks, entries);
  const { effective, reversedIds } = activeLedgerEntries(entries);
  // 非财务关联：buy → originDividendEntryId → dividend
  // 反向索引：dividend id → 指向它的 buy entries
  const buysByOriginDividend = new Map<string, LedgerEntry[]>();
  for (const entry of effective) {
    if (entry.type !== "buy" || !entry.originDividendEntryId) continue;
    const current = buysByOriginDividend.get(entry.originDividendEntryId) ?? [];
    current.push(entry);
    buysByOriginDividend.set(entry.originDividendEntryId, current);
  }
  return [...entries].sort(canonicalLedgerOrderDescending).map((entry) => {
    const row = toLedgerRecord(entry, names, securityTypes, reversedIds);
    // 关联展示只指向当前有效事实；被历史重述替换的旧版本仍在审计列表中，
    // 但不会与修正后的事实同时作为可跳转的业务关联出现。
    const linked: LedgerEntry[] = [];
    if (entry.type === "buy" && entry.originDividendEntryId) {
      const origin = effective.find(
        (candidate) => candidate.id === entry.originDividendEntryId,
      );
      if (origin) linked.push(origin);
    }
    if (entry.type === "dividend") {
      linked.push(...(buysByOriginDividend.get(entry.id) ?? []));
    }
    const linkedRecords = linked
      .filter(
        (candidate): candidate is LedgerEntry & {
          type: "buy" | "dividend";
        } =>
          candidate.id !== entry.id &&
          (candidate.type === "buy" || candidate.type === "dividend"),
      )
      .sort(canonicalLedgerOrderDescending)
      .map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        businessDate: candidate.businessDate,
      }));
    return {
      ...row,
      linkedRecords,
    };
  });
}

function matchesQuery(
  row: LedgerRecordView,
  query: LedgerQuery,
): boolean {
  if (query.startDate && row.businessDate < query.startDate) return false;
  if (query.endDate && row.businessDate > query.endDate) return false;
  if (query.entryTypes?.length && !query.entryTypes.includes(row.type)) {
    return false;
  }
  if (query.securityType && row.securityType !== query.securityType) {
    return false;
  }
  if (query.symbol && row.symbol !== query.symbol) return false;
  if (query.keyword) {
    const keyword = query.keyword.trim().toLowerCase();
    if (
      keyword &&
      ![row.symbol, row.name, row.note]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword))
    ) {
      return false;
    }
  }
  return true;
}

function assertLedgerQuery(query: LedgerQuery): void {
  if (![20, 50, 100].includes(query.pageSize)) {
    throw new Error("流水分页大小只支持 20、50 或 100");
  }
  if (
    (query.startDate && !validDate(query.startDate)) ||
    (query.endDate && !validDate(query.endDate))
  ) {
    throw new Error("流水日期筛选必须使用合法的 YYYY-MM-DD");
  }
  if (
    query.startDate &&
    query.endDate &&
    query.startDate > query.endDate
  ) {
    throw new Error("流水开始日期不能晚于结束日期");
  }
}

interface LedgerQueryComputation {
  allRows: LedgerRecordView[];
  quality: LiveDataQuality;
  metrics: LedgerQueryResult["metrics"];
  symbolOptions: LedgerQueryResult["symbolOptions"];
}

function computeLedgerQuery(
  entries: readonly LedgerEntry[],
  stocks: readonly StockInfo[],
  query: LedgerQuery,
  integrityError: string | null,
): LedgerQueryComputation {
  const { effective } = activeLedgerEntries(entries);
  const allRows = toLedgerRecords(entries, stocks)
    .filter((row) => matchesQuery(row, query));
  const names = namesMap(stocks, entries);
  const securityTypes = securityTypesMap(stocks, entries);
  const effectiveIds = new Set(effective.map((entry) => entry.id));
  const aggregateRows = allRows.filter(
    (row) => effectiveIds.has(row.id) && row.type !== "adjustment",
  );
  const aggregateIds = new Set(aggregateRows.map((row) => row.id));
  const selectedEffectiveEntries = effective.filter((entry) =>
    aggregateIds.has(entry.id),
  );
  const selectedBuySpend = roundMoney(
    selectedEffectiveEntries
      .filter((entry) => entry.type === "buy")
      .reduce(
        (sum, entry) =>
          sum +
          (entry.amount ?? (entry.price ?? 0) * (entry.quantity ?? 0)) +
          (entry.fee ?? 0),
        0,
      ),
  );
  const selectedSellIncome = roundMoney(
    selectedEffectiveEntries
      .filter((entry) => entry.type === "sell")
      .reduce(
        (sum, entry) =>
          sum +
          (entry.amount ?? (entry.price ?? 0) * (entry.quantity ?? 0)) -
          (entry.fee ?? 0),
        0,
      ),
  );
  const selectedExternalDividend = roundMoney(
    selectedEffectiveEntries
      .filter((entry) => entry.type === "dividend")
      .reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
  );
  const symbols = [...new Set(entries.flatMap((entry) => entry.symbol ?? []))];
  const quality: LiveDataQuality = {
    status: entries.length ? (integrityError ? "partial" : "ready") : "empty",
    dataCutoff: null,
    updatedAt:
      entries.map((entry) => entry.recordedAt).sort().at(-1) ?? null,
    issues: integrityError ? [`投资事实完整性校验失败：${integrityError}`] : [],
    missingSymbols: [],
    missingDates: [],
  };
  const reversedCount = allRows.filter((row) => row.isReversed).length;
  const effectiveCount = aggregateRows.length;
  return {
    allRows,
    quality,
    metrics: {
      recordCount: allRows.length,
      effectiveCount,
      reversedCount,
      cumulativeBuySpend: roundMoney(
        aggregateRows
          .filter((row) => row.type === "buy")
          .reduce((sum, row) => sum + (row.amount ?? 0) + row.fee, 0),
      ),
      cumulativeSellNetIncome: roundMoney(
        aggregateRows
          .filter((row) => row.type === "sell")
          .reduce((sum, row) => sum + (row.amount ?? 0) - row.fee, 0),
      ),
      cumulativeDividend: roundMoney(
        aggregateRows
          .filter((row) => row.type === "dividend")
          .reduce((sum, row) => sum + (row.amount ?? 0), 0),
      ),
      netInvestment: roundMoney(
        selectedBuySpend - selectedSellIncome - selectedExternalDividend,
      ),
    },
    symbolOptions: symbols
      .sort()
      .map((symbol) => ({
        symbol,
        name: names.get(symbol) ?? symbol,
        securityType: requiredSecurityType(symbol, securityTypes),
      })),
  };
}

export function queryLedgerRecords(
  entries: readonly LedgerEntry[],
  stocks: readonly StockInfo[],
  query: LedgerQuery,
  integrityError: string | null = null,
): LedgerQueryResult {
  assertLedgerQuery(query);
  const page = Math.max(1, Math.floor(query.page));
  const pageSize = query.pageSize;
  const offset = (page - 1) * pageSize;
  const computation = computeLedgerQuery(
    entries,
    stocks,
    query,
    integrityError,
  );
  return {
    quality: computation.quality,
    integrityError,
    metrics: computation.metrics,
    rows: computation.allRows.slice(offset, offset + pageSize),
    total: computation.allRows.length,
    page,
    pageSize,
    symbolOptions: computation.symbolOptions,
  };
}

/**
 * 导出场景下的全量流水查询：与 `queryLedgerRecords` 共享同一份计算逻辑，
 * 但不做分页切片，避免逐页调用导致 `listLedger` + 完整性校验 + 指标
 * 计算被重复执行 N 次。
 *
 * 返回的 `rows` 为全量匹配记录；`page`/`pageSize` 仅用于填充契约结构，
 * 调用方不应据此做分页解释。
 */
export function exportLedgerRecords(
  entries: readonly LedgerEntry[],
  stocks: readonly StockInfo[],
  query: LedgerQuery,
  integrityError: string | null = null,
): LedgerQueryResult {
  assertLedgerQuery(query);
  const computation = computeLedgerQuery(
    entries,
    stocks,
    query,
    integrityError,
  );
  return {
    quality: computation.quality,
    integrityError,
    metrics: computation.metrics,
    rows: computation.allRows,
    total: computation.allRows.length,
    page: 1,
    pageSize: query.pageSize,
    symbolOptions: computation.symbolOptions,
  };
}

export function getLedgerRecordById(
  entries: readonly LedgerEntry[],
  stocks: readonly StockInfo[],
  entryId: string,
): LedgerRecordView | null {
  return toLedgerRecords(entries, stocks).find((row) => row.id === entryId) ?? null;
}
