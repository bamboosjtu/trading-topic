import { describe, expect, it } from "vitest";
import { drawdownProfile } from "./finance";

describe("drawdownProfile", () => {
  it("分别返回最大回撤的峰谷与最长回撤周期", () => {
    const result = drawdownProfile([
      { date: "2024-01-01", value: 1 },
      { date: "2024-02-01", value: 1.2 },
      { date: "2024-03-01", value: 0.9 },
      { date: "2024-04-01", value: 1.1 },
      { date: "2024-05-01", value: 1.2 },
    ]);

    expect(result.maxDrawdown).toBeCloseTo(-0.25);
    expect(result.maxDrawdownPeakDate).toBe("2024-02-01");
    expect(result.maxDrawdownTroughDate).toBe("2024-03-01");
    expect(result.longestDrawdownStart).toBe("2024-02-01");
    expect(result.longestDrawdownEnd).toBe("2024-05-01");
    expect(result.longestDrawdownMonths).toBe(3);
    expect(result.longestDrawdownRecovered).toBe(true);
  });

  it("尚未恢复时以样本截止日作为回撤区间终点", () => {
    const result = drawdownProfile([
      { date: "2024-01-01", value: 1 },
      { date: "2024-02-01", value: 0.8 },
      { date: "2024-04-01", value: 0.9 },
    ]);

    expect(result.maxDrawdownPeakDate).toBe("2024-01-01");
    expect(result.maxDrawdownTroughDate).toBe("2024-02-01");
    expect(result.longestDrawdownStart).toBe("2024-01-01");
    expect(result.longestDrawdownEnd).toBe("2024-04-01");
    expect(result.longestDrawdownMonths).toBe(3);
    expect(result.longestDrawdownRecovered).toBe(false);
  });

  it("最大回撤与最长亏损时间可以来自不同回撤周期", () => {
    const result = drawdownProfile([
      { date: "2020-01-01", value: 100 },
      { date: "2020-02-01", value: 70 },
      { date: "2020-04-01", value: 100 },
      { date: "2020-05-01", value: 110 },
      { date: "2020-06-01", value: 99 },
      { date: "2021-11-01", value: 110 },
    ]);

    expect(result.maxDrawdown).toBeCloseTo(-0.3);
    expect(result.maxDrawdownPeakDate).toBe("2020-01-01");
    expect(result.maxDrawdownTroughDate).toBe("2020-02-01");
    expect(result.longestDrawdownStart).toBe("2020-05-01");
    expect(result.longestDrawdownEnd).toBe("2021-11-01");
    expect(result.longestDrawdownMonths).toBe(18);
    expect(result.longestDrawdownRecovered).toBe(true);
  });
});
