import { describe, expect, it } from "vitest";
import { currentMarketDate } from "./marketDate";

describe("A 股市场业务日期", () => {
  it("UTC 跨日时仍按 Asia/Shanghai 返回自然日", () => {
    expect(currentMarketDate(new Date("2026-07-27T16:30:00.000Z")))
      .toBe("2026-07-28");
    expect(currentMarketDate(new Date("2026-07-28T15:59:59.999Z")))
      .toBe("2026-07-28");
  });
});
