import { describe, expect, it } from "vitest";
import {
  parseSinaJson,
  parseSinaKlinePayload,
} from "./sina";

describe("新浪行情响应解析", () => {
  it("接受 JSONP 并读取 result.data", () => {
    const payload = parseSinaJson(
      'callback({"result":{"status":{"code":0},"data":[{"day":"2026-07-28","close":"5.10"}]}})',
    );
    expect(parseSinaKlinePayload(payload)).toEqual([
      { day: "2026-07-28", close: "5.10" },
    ]);
  });

  it("源错误码或缺少 data 时明确失败", () => {
    expect(() =>
      parseSinaKlinePayload({
        result: { status: { code: 3 }, data: [] },
      }),
    ).toThrow("错误码 3");
    expect(() =>
      parseSinaKlinePayload({ result: { status: { code: 0 } } }),
    ).toThrow("缺少 result.data");
  });
});
