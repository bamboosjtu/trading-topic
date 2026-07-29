import type { SecurityType, StockInfo } from "./contracts";

/**
 * 目录项优先使用数据源明确给出的资产类型。旧快照和手工事实没有类型时，
 * 再按境内 ETF 常见代码段与名称做保守回退。
 */
export function securityTypeForInstrument(
  instrument: Pick<StockInfo, "symbol" | "name" | "securityType">,
): SecurityType {
  if (instrument.securityType) return instrument.securityType;
  if (
    instrument.name.toUpperCase().includes("ETF") ||
    /^(15|16|50|51|52|56|58)/.test(instrument.symbol)
  ) {
    return "etf";
  }
  return "stock";
}
