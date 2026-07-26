import type {
  BacktestResult,
  ChartDataState,
} from "../../api/client";

export function useMarketBars(
  result: BacktestResult | undefined,
  experimentLoading: boolean,
): ChartDataState {
  if (experimentLoading) return { status: "loading" };
  if (!result) {
    return {
      status: "unavailable",
      reason: "运行回测后可查看标的前复权走势",
    };
  }
  if (result.chartData.status === "ready" && !result.chartData.data.length) {
    return { status: "unavailable", reason: "该标的没有可展示的前复权日线" };
  }
  return result.chartData;
}
