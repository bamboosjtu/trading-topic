import { describe, expect, it } from "vitest";
import type { AdjustedBar } from "../../api/client";
import {
  aggregateAdjustedBars,
  buildPerformanceOption,
  movingAverage,
} from "./marketChartModel";

const bars: AdjustedBar[] = [
  {
    date: "2024-01-02",
    open: 10,
    high: 13,
    low: 9,
    close: 12,
    volume: 100,
    adjustment: "qfq",
  },
  {
    date: "2024-01-03",
    open: 12.5,
    high: 14,
    low: 8,
    close: 11,
    volume: 250,
    adjustment: "qfq",
  },
  {
    date: "2024-02-01",
    open: 15,
    high: 16,
    low: 14,
    close: 15.5,
    volume: 400,
    adjustment: "qfq",
  },
];

describe("marketChartModel", () => {
  it("周 K 使用首日开盘、周期高低、末日收盘和成交量合计", () => {
    const result = aggregateAdjustedBars(bars.slice(0, 2), "week");

    expect(result).toEqual([
      {
        date: "2024-01-03",
        open: 10,
        high: 14,
        low: 8,
        close: 11,
        volume: 350,
        adjustment: "qfq",
      },
    ]);
  });

  it("月 K 不会把第一个收盘价伪装成开盘价", () => {
    const result = aggregateAdjustedBars(bars, "month");

    expect(result[0].open).toBe(10);
    expect(result[0].open).not.toBe(bars[0].close);
    expect(result[0]).toMatchObject({
      date: "2024-01-03",
      high: 14,
      low: 8,
      close: 11,
      volume: 350,
    });
    expect(result[1]).toMatchObject({
      date: "2024-02-01",
      open: 15,
      high: 16,
      low: 14,
      close: 15.5,
      volume: 400,
    });
  });

  it("收益与回撤图只消费领域层给出的序列", () => {
    const result = {
      name: "测试标的",
      equityCurve: [
        {
          date: "2024-01-01",
          asset: 999,
          contribution: 333,
          returnRate: 0.12,
          drawdown: -0.08,
        },
      ],
    } as never;

    const returnOption = buildPerformanceOption([result], "return") as {
      series: Array<{ data: number[] }>;
    };
    const drawdownOption = buildPerformanceOption([result], "drawdown") as {
      series: Array<{ data: number[] }>;
    };

    expect(returnOption.series[0].data).toEqual([0.12]);
    expect(drawdownOption.series[0].data).toEqual([-0.08]);
  });

  it("均线使用滚动窗口且保留窗口前空值", () => {
    expect(movingAverage([1, 2, 3, 4], 3)).toEqual(["-", "-", 2, 3]);
  });
});
