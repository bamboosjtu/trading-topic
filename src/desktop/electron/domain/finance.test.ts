import { describe, expect, it } from "vitest";
import { drawdownProfile } from "./finance";

describe("drawdownProfile", () => {
  it("返回最大回撤的峰值、恢复日和持续月份", () => {
    const result = drawdownProfile([
      { date: "2024-01-01", value: 1 },
      { date: "2024-02-01", value: 1.2 },
      { date: "2024-03-01", value: 0.9 },
      { date: "2024-04-01", value: 1.1 },
      { date: "2024-05-01", value: 1.2 },
    ]);

    expect(result.maxDrawdown).toBeCloseTo(-0.25);
    expect(result.maxDrawdownStart).toBe("2024-02-01");
    expect(result.maxDrawdownEnd).toBe("2024-05-01");
    expect(result.maxDrawdownMonths).toBe(3);
  });

  it("尚未恢复时以样本截止日作为回撤区间终点", () => {
    const result = drawdownProfile([
      { date: "2024-01-01", value: 1 },
      { date: "2024-02-01", value: 0.8 },
      { date: "2024-04-01", value: 0.9 },
    ]);

    expect(result.maxDrawdownStart).toBe("2024-01-01");
    expect(result.maxDrawdownEnd).toBe("2024-04-01");
    expect(result.maxDrawdownMonths).toBe(3);
  });
});
