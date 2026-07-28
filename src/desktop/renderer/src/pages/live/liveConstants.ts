import type { EntryType } from "../../api/client";

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  buy: "买入",
  sell: "卖出",
  dividend: "现金分红",
  adjustment: "冲正 / 修正",
};

export const ENTRY_TYPE_OPTIONS = Object.entries(ENTRY_TYPE_LABELS).map(
  ([value, label]) => ({ value: value as EntryType, label }),
);

export const DIRECT_ENTRY_TYPE_OPTIONS = ENTRY_TYPE_OPTIONS.filter(
  (option) => option.value !== "adjustment",
);

export const ENTRY_TYPE_TONES: Record<
  EntryType,
  "blue" | "green" | "red" | "gold" | "purple" | "default"
> = {
  buy: "red",
  sell: "green",
  dividend: "gold",
  adjustment: "default",
};
