import ExcelJS from "exceljs";
import type { MarketDataProvenance } from "../../shared/contracts";

/**
 * Excel 导出共享工具：工作簿初始化、表头样式、缓冲区转换、行情来源工作表。
 *
 * backtestWorkbook.ts 与 liveWorkbooks.ts 共用同一套样式与初始化逻辑，
 * 避免两份近似的私有实现因排版/配色漂移而割裂。
 */

/**
 * 中性金额格式：买入支出、卖出收入、累计分红等不带盈亏语义的金额。
 * 正负数均使用默认黑色，不做红绿着色。
 */
export const MONEY_NEUTRAL_NUM_FMT = "¥#,##0.00;-¥#,##0.00;¥0.00";

/**
 * 盈亏金额格式：A 股语境"红盈绿亏"。
 * 正数红色（盈利），负数绿色（亏损），零值不着色。
 */
export const PNL_MONEY_NUM_FMT = "[Red]+¥#,##0.00;[Green]-¥#,##0.00;¥0.00";

/**
 * 盈亏百分比格式：A 股语境"红盈绿亏"。
 * 用于收益率、回撤等盈亏比例字段。
 */
export const PNL_PERCENT_NUM_FMT = "[Red]+0.00%;[Green]-0.00%;0.00%";

/** 创建带统一 creator/created 元数据的工作簿。 */
export function createWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "投资研究实验室";
  workbook.created = new Date();
  return workbook;
}

/** 为工作表应用冻结首行、自动筛选、表头加粗与底色、垂直居中对齐。 */
export function styleWorksheet(worksheet: ExcelJS.Worksheet): void {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: "A1",
    to: worksheet.getRow(1).getCell(worksheet.columnCount).address,
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FF112543" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F7FC" },
  };
  worksheet.eachRow((row) => {
    row.alignment = { vertical: "middle" };
  });
}

/** 将工作簿写入 Buffer，供 IPC 层直接落盘。 */
export async function workbookToBuffer(
  workbook: ExcelJS.Workbook,
): Promise<Buffer<ArrayBuffer>> {
  const output = await workbook.xlsx.writeBuffer();
  const arrayBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(arrayBuffer).set(new Uint8Array(output));
  return Buffer.from(arrayBuffer);
}

/**
 * 追加"行情来源"工作表，统一展示行情 provenance 字段。
 *
 * 多个工作簿（持仓、收益日历）都需要披露同一份行情来源信息，
 * 集中实现避免列宽、文案、本地化映射在不同调用点漂移。
 */
export function addProvenanceSheet(
  workbook: ExcelJS.Workbook,
  provenance: readonly MarketDataProvenance[],
  sheetName = "行情来源",
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: "实际来源", key: "source", width: 14 },
    { header: "主来源", key: "primarySource", width: 14 },
    { header: "是否兜底", key: "fallbackUsed", width: 12 },
    { header: "切换原因", key: "fallbackReason", width: 60 },
    { header: "获取时间", key: "fetchedAt", width: 26 },
    { header: "数据截止", key: "dataCutoff", width: 14 },
    { header: "复权方式", key: "adjustment", width: 12 },
  ];
  for (const row of provenance) {
    sheet.addRow({
      ...row,
      source: row.source === "tencent" ? "腾讯" : "新浪",
      primarySource: "腾讯",
      fallbackUsed: row.fallbackUsed ? "是" : "否",
      adjustment: row.adjustment === "qfq" ? "前复权" : "不复权",
    });
  }
  styleWorksheet(sheet);
  return sheet;
}
