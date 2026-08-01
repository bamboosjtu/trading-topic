import ExcelJS from "exceljs";
import { BACKTEST_RANGE_LABELS } from "../../shared/constants";
import type {
  BacktestExperiment,
  BacktestResult,
  SimpleBacktestRow,
} from "../../shared/contracts";
import { backtestResultToSimpleResult } from "../domain/analysis";
import {
  createWorkbook,
  MONEY_NEUTRAL_NUM_FMT,
  PNL_MONEY_NUM_FMT,
  PNL_PERCENT_NUM_FMT,
  styleWorksheet,
  workbookToBuffer,
} from "./workbookInternals";

const SUMMARY_SHEET_NAME = "回测结果对比";
const INVALID_SHEET_NAME_CHARACTERS = /[\\/*?:[\]]/g;
const EXCEL_SHEET_NAME_MAX_LENGTH = 31;

function rangeLabel(result: BacktestResult): string {
  return result.rangeYears
    ? (BACKTEST_RANGE_LABELS[result.rangeYears] ?? `${result.rangeYears}年`)
    : `${result.requestedStartDate}_${result.requestedEndDate}`;
}

function uniqueSheetName(base: string, used: Set<string>): string {
  const safeBase =
    base.replace(INVALID_SHEET_NAME_CHARACTERS, "_").trim() || "回测明细";
  let suffix = "";
  let sequence = 1;
  while (true) {
    const candidate = `${safeBase.slice(
      0,
      EXCEL_SHEET_NAME_MAX_LENGTH - suffix.length,
    )}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    sequence += 1;
    suffix = `_${sequence}`;
  }
}

function safeSheetBase(base: string): string {
  return base.replace(INVALID_SHEET_NAME_CHARACTERS, "_").trim();
}

function eventLabel(event: SimpleBacktestRow["event"]): string {
  return {
    buy: "定投买入",
    dividend: "分红到账",
    dividend_reinvest: "分红回购",
    share_adjustment: "送股/转增",
  }[event];
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  results: BacktestResult[],
): void {
  const worksheet = workbook.addWorksheet(SUMMARY_SHEET_NAME);
  worksheet.columns = [
    { header: "标的代码", key: "symbol", width: 12 },
    { header: "标的名称", key: "name", width: 16 },
    { header: "回测参数", key: "range", width: 14 },
    { header: "请求开始日期", key: "startDate", width: 14 },
    { header: "请求结束日期", key: "endDate", width: 14 },
    { header: "实际开始日期", key: "actualStartDate", width: 14 },
    { header: "实际结束日期", key: "actualEndDate", width: 14 },
    { header: "每月投入", key: "monthlyAmount", width: 14 },
    { header: "指定买入日", key: "buyDay", width: 12 },
    { header: "累计投入", key: "totalContribution", width: 16 },
    { header: "最终资产", key: "endingAsset", width: 16 },
    { header: "累计盈亏", key: "totalPnl", width: 16 },
    { header: "XIRR", key: "xirr", width: 12 },
    { header: "最大回撤", key: "maxDrawdown", width: 12 },
    { header: "累计分红", key: "totalDividend", width: 16 },
    { header: "期末现金", key: "endingCash", width: 14 },
    { header: "行情实际来源", key: "marketSource", width: 16 },
    { header: "主行情源", key: "primarySource", width: 14 },
    { header: "备用源切换原因", key: "fallbackReason", width: 34 },
    { header: "行情截止", key: "marketCutoff", width: 14 },
    { header: "复权方式", key: "adjustment", width: 12 },
    { header: "告警与口径说明", key: "warnings", width: 48 },
  ];
  for (const result of results) {
    const market = result.provenance.find((item) =>
      ["tencent", "sina"].includes(item.source),
    );
    worksheet.addRow({
      symbol: result.symbol,
      name: result.name,
      range: rangeLabel(result),
      startDate: result.requestedStartDate,
      endDate: result.requestedEndDate,
      actualStartDate: result.actualStartDate,
      actualEndDate: result.actualEndDate,
      monthlyAmount: result.monthlyAmount,
      buyDay: result.buyDay,
      totalContribution: result.metrics.totalContribution,
      endingAsset: result.metrics.endingAsset,
      totalPnl: result.metrics.totalPnl,
      xirr: result.metrics.xirr,
      maxDrawdown: result.metrics.maxDrawdown,
      totalDividend: result.metrics.totalDividend,
      endingCash: result.metrics.endingCash,
      marketSource: market?.source ?? "—",
      primarySource: market?.primarySource ?? "—",
      fallbackReason: market?.fallbackReason ?? "—",
      marketCutoff: market?.dataCutoff ?? "—",
      adjustment:
        market?.adjustment === "qfq"
          ? "前复权"
          : market
            ? "不复权"
            : "—",
      warnings: result.warnings.join("\n"),
    });
  }
  for (const key of [
    "monthlyAmount",
    "totalContribution",
    "endingAsset",
    "totalDividend",
    "endingCash",
  ]) {
    worksheet.getColumn(key).numFmt = MONEY_NEUTRAL_NUM_FMT;
  }
  worksheet.getColumn("totalPnl").numFmt = PNL_MONEY_NUM_FMT;
  worksheet.getColumn("xirr").numFmt = PNL_PERCENT_NUM_FMT;
  worksheet.getColumn("maxDrawdown").numFmt = PNL_PERCENT_NUM_FMT;
  styleWorksheet(worksheet);
}

function addDetailSheet(
  workbook: ExcelJS.Workbook,
  result: BacktestResult,
  usedNames: Set<string>,
): void {
  const detail = backtestResultToSimpleResult(result);
  const preferredName = `${result.name}_${rangeLabel(result)}`;
  const preferredSafe = safeSheetBase(preferredName).slice(
    0,
    EXCEL_SHEET_NAME_MAX_LENGTH,
  );
  const descriptiveName = usedNames.has(preferredSafe)
    ? `${preferredName}_${result.monthlyAmount}元_${result.buyDay}日`
    : preferredName;
  const worksheet = workbook.addWorksheet(
    uniqueSheetName(descriptiveName, usedNames),
  );
  worksheet.columns = [
    { header: "日期", key: "date", width: 14 },
    { header: "事件", key: "event", width: 14 },
    { header: "期初现金", key: "openingCash", width: 16 },
    { header: "外部投入", key: "externalContribution", width: 16 },
    { header: "收盘价", key: "price", width: 12 },
    { header: "新增股数", key: "shares", width: 14 },
    { header: "发生金额", key: "occurrenceAmount", width: 18 },
    { header: "累计股数", key: "cumulativeShares", width: 16 },
    { header: "累计投入", key: "cumulativeContribution", width: 16 },
    { header: "累计分红", key: "cumulativeDividend", width: 16 },
    { header: "期末现金", key: "endingCash", width: 16 },
    { header: "盈亏率", key: "returnRate", width: 12 },
  ];
  for (const row of detail.rows) {
    worksheet.addRow({
      ...row,
      event: eventLabel(row.event),
      occurrenceAmount:
        row.event === "share_adjustment"
          ? `每10股 +${row.shareRatio?.toFixed(4) ?? "—"}`
          : row.event === "dividend"
            ? (row.dividendAmount ?? 0)
            : row.tradeAmount,
    });
  }
  for (const key of [
    "openingCash",
    "externalContribution",
    "occurrenceAmount",
    "cumulativeContribution",
    "cumulativeDividend",
    "endingCash",
  ]) {
    worksheet.getColumn(key).numFmt = MONEY_NEUTRAL_NUM_FMT;
  }
  worksheet.getColumn("price").numFmt = "0.00";
  worksheet.getColumn("shares").numFmt = "0.00";
  worksheet.getColumn("cumulativeShares").numFmt = "0.00";
  worksheet.getColumn("returnRate").numFmt = PNL_PERCENT_NUM_FMT;
  styleWorksheet(worksheet);
}

export async function buildBacktestWorkbook(
  experiment: BacktestExperiment,
): Promise<Buffer<ArrayBuffer>> {
  const { results } = experiment;
  if (!results.length) throw new Error("没有可导出的回测结果");
  if (
    results.some(
      (result) => result.experimentId !== experiment.experimentId,
    )
  ) {
    throw new Error("导出结果不属于同一个回测试验");
  }
  const workbook = createWorkbook();
  addSummarySheet(workbook, results);
  const usedNames = new Set([SUMMARY_SHEET_NAME]);
  for (const result of results) addDetailSheet(workbook, result, usedNames);
  return workbookToBuffer(workbook);
}
