import type {
  LedgerEntry,
  LedgerEntryInput,
  LedgerImpactPreview,
  LedgerImpactState,
} from "../../shared/contracts";
import { roundMoney } from "./finance";
import { currentMarketDate, validDate } from "./dateUtils";
import { reduceLedger } from "./ledgerReducer";
import {
  tradeDateStatus,
  type TradeDateContext,
} from "./marketCalendar";

const DIRECT_ENTRY_TYPES = new Set<LedgerEntryInput["type"]>([
  "buy",
  "sell",
  "dividend",
]);

function requireFinite(
  value: number | undefined,
  label: string,
  options: { positive?: boolean; integer?: boolean; decimals?: number } = {},
): number {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有限数字`);
  const number = value!;
  if (options.positive ? number <= 0 : number < 0) {
    throw new Error(`${label}${options.positive ? "必须大于 0" : "不能小于 0"}`);
  }
  if (options.integer && !Number.isInteger(number)) {
    throw new Error(`${label}必须是整数`);
  }
  if (
    options.decimals !== undefined &&
    Math.abs(
      number * 10 ** options.decimals -
        Math.round(number * 10 ** options.decimals),
    ) > 1e-7
  ) {
    throw new Error(`${label}最多保留 ${options.decimals} 位小数`);
  }
  return number;
}

function optionalFinite(
  value: number | undefined,
  label: string,
  decimals: number,
): number | undefined {
  if (value === undefined) return undefined;
  return requireFinite(value, label, { decimals });
}

function cleanText(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

export function normalizeLedgerInput(
  input: LedgerEntryInput,
  marketDate = currentMarketDate(),
  tradeDateContext?: TradeDateContext,
): LedgerEntryInput {
  if (!DIRECT_ENTRY_TYPES.has(input.type)) {
    throw new Error("冲正或修正只能从原流水详情发起");
  }
  if (!validDate(input.businessDate)) {
    throw new Error("业务日期必须使用合法的 YYYY-MM-DD");
  }
  if (input.businessDate > marketDate) {
    throw new Error(`业务日期不能晚于当前 A 股市场日期 ${marketDate}`);
  }
  if (!input.symbol || !/^\d{6}$/.test(input.symbol)) {
    throw new Error("请输入有效的 6 位证券代码");
  }
  if (
    input.securityType !== undefined &&
    !["stock", "etf"].includes(input.securityType)
  ) {
    throw new Error("资产类型只支持股票或 ETF");
  }
  const normalized: LedgerEntryInput = {
    type: input.type,
    businessDate: input.businessDate,
    symbol: input.symbol,
    instrumentName: cleanText(input.instrumentName),
    securityType: input.securityType ?? "stock",
    note: cleanText(input.note),
    linkedGroupId: cleanText(input.linkedGroupId),
  };

  if (input.type === "buy" || input.type === "sell") {
    if (
      tradeDateStatus(input.businessDate, tradeDateContext) === "closed"
    ) {
      throw new Error("买入和卖出必须发生在该标的的有效交易日");
    }
    normalized.price = requireFinite(input.price, "成交价格", {
      positive: true,
      decimals: 4,
    });
    normalized.quantity = requireFinite(input.quantity, "交易数量", {
      positive: true,
      integer: true,
    });
    normalized.fee = optionalFinite(input.fee, "交易费用", 2) ?? 0;
  }

  if (input.type === "dividend") {
    normalized.amount = requireFinite(input.amount, "分红到账金额", {
      positive: true,
      decimals: 2,
    });
    normalized.perShare = optionalFinite(input.perShare, "每股分红", 6);
    if (input.recordDate && !validDate(input.recordDate)) {
      throw new Error("登记日必须使用合法的 YYYY-MM-DD");
    }
    if (input.recordDate && input.businessDate < input.recordDate) {
      throw new Error("分红到账日不能早于登记日");
    }
    if (input.recordDate && input.recordDate > marketDate) {
      throw new Error("已到账分红的登记日不能晚于当前市场日期");
    }
    normalized.recordDate = input.recordDate;
  }

  return normalized;
}

function previewEntry(input: LedgerEntryInput): LedgerEntry {
  return {
    ...input,
    id: "__preview__",
    recordedAt: "9999-12-31T23:59:59.999Z",
    currency: "CNY",
    source: "system",
  };
}

function reversalEntry(
  entryId: string,
  correctedAt: string,
): LedgerEntry {
  return {
    id: `__reversal__${entryId}`,
    type: "adjustment",
    businessDate: currentMarketDate(new Date(correctedAt)),
    recordedAt: correctedAt,
    correctedAt,
    currency: "CNY",
    source: "system",
    reversesEntryId: entryId,
  };
}

function impactState(
  entries: readonly LedgerEntry[],
  symbol: string | undefined,
  asOf: string,
): LedgerImpactState {
  const state = reduceLedger(entries, asOf);
  const position = symbol ? state.positions.get(symbol) : undefined;
  return {
    holdingQuantity: position?.quantity ?? 0,
    holdingCost: position?.cost ?? 0,
    cumulativeBuySpend: state.cumulativeBuySpend,
    cumulativeSellNetIncome: state.cumulativeSellNetIncome,
    cumulativeDividend: state.cumulativeDividend,
    netInvestment: state.netInvestment,
  };
}

export function previewLedgerMutation(
  entries: readonly LedgerEntry[],
  input: LedgerEntryInput,
  replacingEntryId?: string,
  asOf = currentMarketDate(),
  tradeDateContext?: TradeDateContext,
): LedgerImpactPreview {
  const normalizedInput = normalizeLedgerInput(
    input,
    asOf,
    tradeDateContext,
  );
  const target = replacingEntryId
    ? entries.find((entry) => entry.id === replacingEntryId)
    : undefined;
  if (replacingEntryId && !target) throw new Error("找不到需要修正的原流水");
  if (target?.type === "adjustment") throw new Error("冲正/修正记录不能再次修正");
  if (
    replacingEntryId &&
    entries.some((entry) => entry.reversesEntryId === replacingEntryId)
  ) {
    throw new Error("该流水已经被冲正或修正");
  }

  const correctedAt = new Date().toISOString();
  const afterEntries = replacingEntryId
    ? [
        ...entries,
        reversalEntry(replacingEntryId, correctedAt),
        {
          ...previewEntry(normalizedInput),
          correctedAt,
          correctsEntryId: replacingEntryId,
        },
      ]
    : [...entries, previewEntry(normalizedInput)];
  const before = impactState(entries, normalizedInput.symbol, asOf);
  const after = impactState(afterEntries, normalizedInput.symbol, asOf);
  const tradeAmount =
    normalizedInput.type === "buy" || normalizedInput.type === "sell"
      ? roundMoney(
          (normalizedInput.price ?? 0) * (normalizedInput.quantity ?? 0),
        )
      : normalizedInput.amount ?? 0;
  return {
    normalizedInput,
    symbol: normalizedInput.symbol ?? null,
    tradeAmount,
    before,
    after,
    warnings:
      (normalizedInput.type === "buy" || normalizedInput.type === "sell") &&
      tradeDateStatus(normalizedInput.businessDate, tradeDateContext) ===
        "unknown"
        ? [
            "该标的当日无本地行情，可能停牌或行情缺失；如有真实成交凭证可继续保存，系统会将该日标记为待补齐行情。",
          ]
        : [],
  };
}

export function assertLedgerReversal(
  entries: readonly LedgerEntry[],
  entryId: string,
  asOf = currentMarketDate(),
): void {
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) throw new Error("找不到需要冲正的原流水");
  if (target.type === "adjustment") throw new Error("冲正/修正记录不能再次冲正");
  if (entries.some((entry) => entry.reversesEntryId === entryId)) {
    throw new Error("该流水已经被冲正或修正");
  }
  reduceLedger(
    [...entries, reversalEntry(entryId, new Date().toISOString())],
    asOf,
  );
}
