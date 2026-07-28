import { describe, expect, it } from "vitest";
import {
  extractSinaKlcPayload,
  parseSinaFactorPayload,
} from "./sina";

describe("新浪全量历史适配器", () => {
  it("只提取赋值右侧的 KLC 数据，不执行远端脚本", () => {
    expect(
      extractSinaKlcPayload('var KLC_KL_sh600000="Abc_123+/$";'),
    ).toBe("Abc_123+/$");
    expect(() => extractSinaKlcPayload("window.alert(1)")).toThrow(
      "响应结构已变化",
    );
  });

  it("严格解析并按日期排序前复权因子", () => {
    expect(
      parseSinaFactorPayload(
        'var qfq_sh600000={"data":[{"d":"2024-06-01","f":"1"},{"d":"2023-06-01","f":"1.2"}]}\n/* signature */',
      ),
    ).toEqual([
      ["2023-06-01", 1.2],
      ["2024-06-01", 1],
    ]);
    expect(() =>
      parseSinaFactorPayload(
        'var qfq_sh600000={"data":[{"d":"-","f":"1"}]}',
      ),
    ).toThrow("非法日期或数值");
    expect(() =>
      parseSinaFactorPayload('var qfq_sh600000={"status":0}'),
    ).toThrow("缺少 data");
  });
});
