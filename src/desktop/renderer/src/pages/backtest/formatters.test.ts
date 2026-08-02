import { describe, expect, it } from "vitest";
import { formatYearRanges } from "./formatters";

describe("formatYearRanges", () => {
  it("空数组返回空串", () => {
    expect(formatYearRanges([])).toBe("");
  });

  it("单个年份", () => {
    expect(formatYearRanges([2024])).toBe("2024");
  });

  it("连续年份格式化为区间", () => {
    expect(formatYearRanges([2011, 2012, 2013])).toBe("2011—2013");
  });

  it("多段连续年份", () => {
    expect(formatYearRanges([2011, 2012, 2013, 2015, 2016])).toBe(
      "2011—2013、2015—2016",
    );
  });

  it("无序输入自动排序", () => {
    expect(formatYearRanges([2016, 2013, 2012, 2011, 2015])).toBe(
      "2011—2013、2015—2016",
    );
  });

  it("单个年份与区间混合", () => {
    expect(formatYearRanges([2018, 2020, 2021])).toBe("2018、2020—2021");
  });
});
