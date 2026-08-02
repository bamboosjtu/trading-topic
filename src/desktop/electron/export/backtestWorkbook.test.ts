import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { BacktestResult } from "../../shared/contracts";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import { buildBacktestWorkbook } from "./backtestWorkbook";

function result(
  symbol: string,
  name: string,
  rangeYears: 3 | 5,
): BacktestResult {
  return {
    id: `${symbol}-${rangeYears}`,
    experimentId: "experiment-1",
    symbol,
    name,
    requestedStartDate: rangeYears === 3 ? "2023-07-24" : "2021-07-24",
    requestedEndDate: "2026-07-24",
    actualStartDate: rangeYears === 3 ? "2023-08-01" : "2021-08-02",
    actualEndDate: "2026-07-24",
    monthlyAmount: 3000,
    buyDay: 1,
    rangeYears,
    strategyKey: `${symbol}|${rangeYears}|3000|1|ex_date|${BACKTEST_CALIBER_VERSION}`,
    metrics: {
      totalContribution: 3000,
      endingAsset: 3300,
      totalPnl: 300,
      xirr: 0.1,
      maxDrawdown: -0.15,
      maxDrawdownPeakDate: "2024-01-01",
      maxDrawdownTroughDate: "2024-02-01",
      longestDrawdownMonths: 3,
      longestDrawdownStart: "2024-01-01",
      longestDrawdownEnd: "2024-04-01",
      longestDrawdownRecovered: true,
      totalDividend: 100,
      endingCash: 0,
    },
    transactions: [
      {
        date: "2023-08-01",
        type: "contribution",
        quantity: 0,
        price: 0,
        amount: 3000,
        fee: 0,
        cashAfter: 3000,
      },
      {
        date: "2023-08-01",
        type: "buy",
        quantity: 1000,
        price: 3,
        amount: 3000,
        fee: 0,
        cashAfter: 0,
      },
    ],
    equityCurve: [
      {
        date: "2023-08-01",
        asset: 3000,
        contribution: 3000,
        nav: 1,
        returnRate: 0,
        drawdown: 0,
      },
    ],
    priceSeries: [{ date: "2023-08-01", close: 3 }],
    chartData: { status: "unavailable", reason: "test" },
    warnings: [],
    provenance: [],
    interruptionsUsed: [],
    dataQualityStatus: "strict",
    createdAt: "2026-07-24T00:00:00Z",
  };
}

describe("回测 XLSX 导出", () => {
  it("生成汇总页与每个标的+参数的审计明细页", async () => {
    const results = [
      result("601939", "建设银行", 3),
      result("601398", "工商银行", 3),
    ];
    const output = await buildBacktestWorkbook({
      experimentId: "experiment-1",
      createdAt: "2026-07-24T00:00:00Z",
      request: {
        symbols: results.map((item) => item.symbol),
        startDate: "2023-07-24",
        endDate: "2026-07-24",
        monthlyAmount: 3000,
        buyDay: 1,
        caliberVersion: BACKTEST_CALIBER_VERSION,
      },
      dataCutoff: "2026-07-24",
      caliberVersion: BACKTEST_CALIBER_VERSION,
      status: "completed",
      dataQualityStatus: "strict",
      results,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "回测结果对比",
      "建设银行_三年",
      "工商银行_三年",
    ]);
    expect(workbook.getWorksheet("回测结果对比")?.getCell("C2").value).toBe(
      "三年",
    );
    expect(workbook.getWorksheet("回测结果对比")?.getCell("F2").value).toBe(
      "2023-08-01",
    );
    expect(workbook.getWorksheet("建设银行_三年")?.getCell("B2").value).toBe(
      "定投买入",
    );
    expect(workbook.getWorksheet("建设银行_三年")?.getCell("F2").value).toBe(
      1000,
    );
  });
});
