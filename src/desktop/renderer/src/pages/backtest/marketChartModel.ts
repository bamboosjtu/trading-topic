import type {
  AdjustedBar,
  BacktestCandlePeriod,
  BacktestChartMetric,
  BacktestResult,
} from "../../api/client";

const CHART_COLORS = [
  "#1677ff",
  "#ff9f1a",
  "#12a594",
  "#7c6cf2",
  "#ef5da8",
  "#875bf7",
  "#0ba5ec",
  "#f79009",
  "#6172f3",
  "#039855",
];

function periodKey(date: string, period: BacktestCandlePeriod): string {
  if (period === "month") return date.slice(0, 7);
  if (period === "day") return date;
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

export function aggregateAdjustedBars(
  bars: AdjustedBar[],
  period: BacktestCandlePeriod,
): AdjustedBar[] {
  const orderedBars = [...bars].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  if (period === "day") return orderedBars;
  const groups = new Map<string, AdjustedBar[]>();
  for (const bar of orderedBars) {
    const key = periodKey(bar.date, period);
    const group = groups.get(key);
    if (group) group.push(bar);
    else groups.set(key, [bar]);
  }
  return [...groups.values()].map((group) => ({
    date: group.at(-1)!.date,
    open: group[0].open,
    high: Math.max(...group.map((bar) => bar.high)),
    low: Math.min(...group.map((bar) => bar.low)),
    close: group.at(-1)!.close,
    volume: group.reduce((sum, bar) => sum + bar.volume, 0),
    adjustment: "qfq",
  }));
}

export function movingAverage(
  values: number[],
  window: number,
): Array<number | "-"> {
  let rollingTotal = 0;
  return values.map((value, index) => {
    rollingTotal += value;
    if (index >= window) rollingTotal -= values[index - window];
    if (index < window - 1) return "-";
    return Number((rollingTotal / window).toFixed(3));
  });
}

export function buildKlineOption(
  source: AdjustedBar[],
  period: BacktestCandlePeriod,
): object {
  const bars = aggregateAdjustedBars(source, period);
  const closes = bars.map((bar) => bar.close);
  return {
    animationDuration: 260,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "#ffffff",
      borderColor: "#dfe6ef",
      textStyle: { color: "#183251", fontSize: 12 },
      valueFormatter: (value: unknown) => {
        // 前复权 OHLC 系列在 axis tooltip 中会传入数据数组 [open, close, low, high]，
        // 系列名那一行不需要格式化数字；MA 均线和 OHLC 四个具体值为数字，保留 2 位小数。
        if (typeof value === "number" && Number.isFinite(value)) {
          return value.toFixed(2);
        }
        return value;
      },
    },
    legend: {
      top: 3,
      left: 20,
      data: ["前复权 OHLC", "MA5", "MA10", "MA20", "MA60"],
      textStyle: { color: "#64758c", fontSize: 11 },
    },
    grid: { left: 14, right: 14, top: 40, bottom: 17, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: true,
      data: bars.map((bar) => bar.date),
      axisLabel: {
        hideOverlap: true,
        color: "#5d6f87",
        fontSize: 10,
        formatter: (value: string) => value.slice(0, 7),
      },
      axisLine: { lineStyle: { color: "#dce4ed" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: "#5d6f87",
        fontSize: 10,
        formatter: (value: number) => value.toFixed(2),
      },
      splitLine: { lineStyle: { color: "#e9eef4", type: "dashed" } },
    },
    series: [
      {
        name: "前复权 OHLC",
        type: "candlestick",
        data: bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]),
        itemStyle: {
          color: "#f04438",
          color0: "#13a68f",
          borderColor: "#f04438",
          borderColor0: "#13a68f",
        },
      },
      ...[
        [5, "#f59b17"],
        [10, "#377dff"],
        [20, "#1677ff"],
        [60, "#13a68f"],
      ].map(([window, color]) => ({
        name: `MA${window}`,
        type: "line",
        showSymbol: false,
        data: movingAverage(closes, Number(window)),
        lineStyle: { width: 1.3, color },
        itemStyle: { color },
      })),
    ],
  };
}

export function buildPerformanceOption(
  results: BacktestResult[],
  metric: Exclude<BacktestChartMetric, "kline">,
): object {
  const dates = [
    ...new Set(
      results.flatMap((result) =>
        result.equityCurve.map((point) => point.date),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return {
    animationDuration: 320,
    tooltip: {
      trigger: "axis",
      backgroundColor: "#ffffff",
      borderColor: "#dfe6ef",
      textStyle: { color: "#183251", fontSize: 11 },
      valueFormatter: (value: number) => `${(value * 100).toFixed(2)}%`,
    },
    grid: { left: 14, right: 12, top: 38, bottom: 18, containLabel: true },
    legend: {
      top: 2,
      left: 28,
      textStyle: { color: "#64758c", fontSize: 11 },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dates,
      axisLabel: {
        hideOverlap: true,
        color: "#5d6f87",
        fontSize: 10,
        formatter: (value: string) => value.slice(0, 7),
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#5d6f87",
        fontSize: 10,
        formatter: (value: number) => `${Math.round(value * 100)}%`,
      },
      splitLine: { lineStyle: { color: "#e9eef4" } },
    },
    series: results.map((result, index) => {
      const values = new Map(
        result.equityCurve.map((point) => [
          point.date,
          metric === "return" ? point.returnRate : point.drawdown,
        ]),
      );
      return {
        name: result.name,
        type: "line",
        showSymbol: false,
        connectNulls: false,
        data: dates.map((date) => values.get(date) ?? null),
        lineStyle: { width: 1.8, color: CHART_COLORS[index] },
        itemStyle: { color: CHART_COLORS[index] },
      };
    }),
  };
}
