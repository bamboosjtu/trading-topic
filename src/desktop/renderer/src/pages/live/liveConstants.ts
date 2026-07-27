import type { EntryType } from "../../api/client";

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  transfer_in: "资金转入",
  buy: "买入",
  sell: "卖出",
  dividend: "现金分红",
  reverse_repo: "逆回购",
  transfer_out: "资金转出",
  adjustment: "冲正 / 修正",
};

export const ENTRY_TYPE_OPTIONS = Object.entries(ENTRY_TYPE_LABELS).map(
  ([value, label]) => ({ value: value as EntryType, label }),
);

export const ENTRY_TYPE_TONES: Record<
  EntryType,
  "blue" | "green" | "red" | "gold" | "purple" | "default"
> = {
  transfer_in: "blue",
  buy: "red",
  sell: "green",
  dividend: "gold",
  reverse_repo: "purple",
  transfer_out: "default",
  adjustment: "default",
};
