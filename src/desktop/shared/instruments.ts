import type { SecurityType, StockInfo } from "./contracts";

export function securityTypeForInstrument(
  instrument: Pick<StockInfo, "symbol" | "name" | "securityType">,
): SecurityType {
  return instrument.securityType;
}
