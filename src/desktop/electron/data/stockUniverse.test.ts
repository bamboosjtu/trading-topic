import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAStockUniverse,
  parseAStockUniverse,
} from "./stockUniverse";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("A 股代码表", () => {
  it("解析并按代码去重排序", () => {
    expect(
      parseAStockUniverse({
        data: {
          diff: [
            { f12: "601398", f14: "工商银行" },
            { f12: "000001", f14: "平安银行" },
            { f12: "601398", f14: "工商银行" },
            { f12: "-", f14: "-" },
          ],
        },
      }),
    ).toEqual([
      { symbol: "000001", name: "平安银行" },
      { symbol: "601398", name: "工商银行" },
    ]);
  });

  it("使用东财全 A 股市场过滤条件请求代码和名称", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { diff: [{ f12: "920001", f14: "北交所示例" }] },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAStockUniverse();
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.searchParams.get("pz")).toBe("50000");
    expect(requested.searchParams.get("fields")).toBe("f12,f14");
    expect(requested.searchParams.get("fs")).toContain("m:0+t:81+s:2048");
    expect(result.rows).toEqual([
      { symbol: "920001", name: "北交所示例" },
    ]);
  });
});
