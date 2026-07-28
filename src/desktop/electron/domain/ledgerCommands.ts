import type {
  LedgerEntry,
  LedgerEntryInput,
  LedgerImpactPreview,
  LedgerImpactState,
} from "../../shared/contracts";
import { rebuildAccount } from "./ledger";
import { roundMoney } from "./finance";
import { currentMarketDate, validDate } from "./dateUtils";
import { activeLedgerEntries } from "./ledgerReducer";

const DIRECT_ENTRY_TYPES = new Set<LedgerEntryInput["type"]>([
  "transfer_in",
  "buy",
  "sell",
  "dividend",
  "reverse_repo",
  "transfer_out",
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
    Math.abs(number * 10 ** options.decimals -
      Math.round(number * 10 ** options.decimals)) > 1e-7
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
  if (
    input.securityType !== undefined &&
    !["stock", "etf"].includes(input.securityType)
  ) {
    throw new Error("资产类型只支持股票或 ETF");
  }
  const fee = optionalFinite(input.fee, "交易费用", 2) ?? 0;
  const normalized: LedgerEntryInput = {
    type: input.type,
    businessDate: input.businessDate,
    note: cleanText(input.note),
  };

  if (["buy", "sell", "dividend"].includes(input.type)) {
    if (!input.symbol || !/^\d{6}$/.test(input.symbol)) {
      throw new Error("请输入有效的 6 位证券代码");
    }
    normalized.symbol = input.symbol;
    normalized.instrumentName = cleanText(input.instrumentName);
    normalized.securityType = input.securityType ?? "stock";
  }

  if (input.type === "buy" || input.type === "sell") {
    const price = requireFinite(input.price, "成交价格", {
      positive: true,
      decimals: 4,
    });
    const quantity = requireFinite(input.quantity, "交易数量", {
      positive: true,
      integer: true,
    });
    normalized.price = price;
    normalized.quantity = quantity;
    normalized.fee = fee;
  }

  if (["transfer_in", "transfer_out", "dividend"].includes(input.type)) {
    normalized.amount = requireFinite(input.amount, "金额", {
      positive: true,
      decimals: 2,
    });
  }

  if (input.type === "dividend") {
    normalized.perShare = optionalFinite(input.perShare, "每股分红", 6);
    if (input.recordDate && !validDate(input.recordDate)) {
      throw new Error("登记日必须使用合法的 YYYY-MM-DD");
    }
    if (input.paymentDate && !validDate(input.paymentDate)) {
      throw new Error("到账日必须使用合法的 YYYY-MM-DD");
    }
    if (
      input.recordDate &&
      input.paymentDate &&
      input.paymentDate < input.recordDate
    ) {
      throw new Error("到账日不能早于登记日");
    }
    if (
      (input.recordDate && input.recordDate > marketDate) ||
      (input.paymentDate && input.paymentDate > marketDate)
    ) {
      throw new Error("已到账分红的登记日和到账日不能晚于当前市场日期");
    }
    normalized.recordDate = input.recordDate;
    normalized.paymentDate = input.paymentDate;
  }

  if (input.type === "reverse_repo") {
    const amount = requireFinite(input.amount, "逆回购本金", {
      positive: true,
      decimals: 2,
    });
    const annualRate = optionalFinite(
      input.annualRate,
      "成交年化收益率",
      6,
    );
    const termDays =
      input.termDays === undefined
        ? undefined
        : requireFinite(input.termDays, "名义期限", {
            positive: true,
            integer: true,
          });
    const repoCode = cleanText(input.repoCode);
    if (!repoCode) throw new Error("逆回购代码或品种不能为空");
    if (!input.maturityDate || !validDate(input.maturityDate)) {
      throw new Error("逆回购到期日必须使用合法的 YYYY-MM-DD");
    }
    const maturityDate = input.maturityDate;
    if (maturityDate < input.businessDate) {
      throw new Error("逆回购到期日不能早于成交日");
    }
    const maturityAmount = requireFinite(input.maturityAmount, "实际到期金额", {
      positive: true,
      decimals: 2,
    });
    normalized.repoCode = repoCode;
    normalized.amount = amount;
    normalized.annualRate = annualRate;
    normalized.termDays = termDays;
    normalized.fee = fee;
    normalized.maturityDate = maturityDate;
    normalized.maturityAmount = maturityAmount;
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
  businessDate: string,
): LedgerEntry {
  return {
    id: `__reversal__${entryId}`,
    type: "adjustment",
    businessDate,
    recordedAt: "9999-12-31T23:59:59.998Z",
    currency: "CNY",
    source: "system",
    reversesEntryId: entryId,
  };
}

function totalDividend(
  entries: readonly LedgerEntry[],
  asOf: string,
): number {
  return roundMoney(
    activeLedgerEntries(entries, asOf).effective
      .filter((entry) => entry.type === "dividend")
      .reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
  );
}

function impactState(
  entries: readonly LedgerEntry[],
  symbol: string | undefined,
  asOf: string,
): LedgerImpactState {
  const summary = rebuildAccount([...entries], {}, asOf);
  const position = symbol
    ? summary.positions.find((item) => item.symbol === symbol)
    : undefined;
  return {
    availableCash: summary.availableCash,
    holdingQuantity: position?.quantity ?? 0,
    holdingCost: position?.cost ?? 0,
    cumulativeDividend: totalDividend(entries, asOf),
    pendingReverseRepoAsset: summary.reverseRepoAsset,
  };
}

export function previewLedgerMutation(
  entries: readonly LedgerEntry[],
  input: LedgerEntryInput,
  replacingEntryId?: string,
  asOf = currentMarketDate(),
): LedgerImpactPreview {
  const normalizedInput = normalizeLedgerInput(input, asOf);
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

  const afterEntries = replacingEntryId
    ? [
        ...entries,
        reversalEntry(replacingEntryId, asOf),
        {
          ...previewEntry(normalizedInput),
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
  const warnings: string[] = [];
  if (after.availableCash < 0) {
    warnings.push("本次记录后可用现金为负，请确认是否遗漏资金转入流水。");
  }
  return {
    normalizedInput,
    symbol: normalizedInput.symbol ?? null,
    tradeAmount,
    before,
    after,
    warnings,
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
  rebuildAccount([...entries, reversalEntry(entryId, asOf)], {}, asOf);
}
