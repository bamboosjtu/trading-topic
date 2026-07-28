import ExcelJS from "exceljs";
import type {
  IncomeCalendarView,
  LedgerQueryResult,
  PositionsOverview,
} from "../../shared/contracts";

function styleWorksheet(worksheet: ExcelJS.Worksheet): void {
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

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer<ArrayBuffer>> {
  const output = await workbook.xlsx.writeBuffer();
  const arrayBuffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(arrayBuffer).set(new Uint8Array(output));
  return Buffer.from(arrayBuffer);
}

export async function buildPositionsWorkbook(
  overview: PositionsOverview,
): Promise<Buffer<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "攒股收息";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("持仓明细");
  sheet.columns = [
    { header: "证券代码", key: "symbol", width: 12 },
    { header: "证券名称", key: "name", width: 18 },
    { header: "资产类型", key: "securityType", width: 12 },
    { header: "持仓数量", key: "quantity", width: 14 },
    { header: "持仓成本", key: "cost", width: 16 },
    { header: "成本价", key: "averageCost", width: 12 },
    { header: "最新价", key: "lastPrice", width: 12 },
    { header: "持仓市值", key: "marketValue", width: 16 },
    { header: "累计买入支出", key: "cumulativeBuySpend", width: 18 },
    { header: "累计卖出净收入", key: "cumulativeSellNetIncome", width: 18 },
    { header: "累计净投入", key: "netInvestment", width: 16 },
    { header: "未实现收益", key: "unrealizedPnl", width: 16 },
    { header: "已实现盈亏", key: "realizedPnl", width: 16 },
    { header: "累计分红", key: "cumulativeDividend", width: 16 },
    { header: "投资总收益", key: "totalReturn", width: 16 },
    { header: "XIRR", key: "xirr", width: 14 },
    { header: "数据截止", key: "dataCutoff", width: 14 },
    { header: "数据状态", key: "quality", width: 12 },
  ];
  for (const position of overview.positions) {
    sheet.addRow({
      ...position,
      securityType: position.securityType === "stock" ? "股票" : "ETF",
      dataCutoff: overview.quality.dataCutoff,
      quality: overview.quality.status,
    });
  }
  for (const key of [
    "cost",
    "marketValue",
    "cumulativeBuySpend",
    "cumulativeSellNetIncome",
    "netInvestment",
    "unrealizedPnl",
    "realizedPnl",
    "cumulativeDividend",
    "totalReturn",
  ]) {
    sheet.getColumn(key).numFmt = '¥#,##0.00;[Red]-¥#,##0.00';
  }
  for (const key of ["averageCost", "lastPrice"]) {
    sheet.getColumn(key).numFmt = "0.000";
  }
  sheet.getColumn("quantity").numFmt = "#,##0.00";
  sheet.getColumn("xirr").numFmt = "0.00%;[Green]-0.00%";
  styleWorksheet(sheet);
  const provenance = workbook.addWorksheet("行情来源");
  provenance.columns = [
    { header: "实际来源", key: "source", width: 14 },
    { header: "主来源", key: "primarySource", width: 14 },
    { header: "是否兜底", key: "fallbackUsed", width: 12 },
    { header: "切换原因", key: "fallbackReason", width: 60 },
    { header: "获取时间", key: "fetchedAt", width: 26 },
    { header: "数据截止", key: "dataCutoff", width: 14 },
    { header: "复权方式", key: "adjustment", width: 12 },
  ];
  for (const row of overview.provenance) {
    provenance.addRow({
      ...row,
      source: row.source === "tencent" ? "腾讯" : "新浪",
      primarySource: "腾讯",
      fallbackUsed: row.fallbackUsed ? "是" : "否",
      adjustment: row.adjustment === "qfq" ? "前复权" : "不复权",
    });
  }
  styleWorksheet(provenance);
  return toBuffer(workbook);
}

export async function buildIncomeCalendarWorkbook(
  view: IncomeCalendarView,
): Promise<Buffer<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "攒股收息";
  workbook.created = new Date();
  const days = workbook.addWorksheet(`${view.month}收益日历`);
  days.columns = [
    { header: "日期", key: "date", width: 14 },
    { header: "范围", key: "scope", width: 18 },
    { header: "当日总收益", key: "totalPnl", width: 16 },
    { header: "市场价格收益", key: "marketPricePnl", width: 18 },
    { header: "分红收益", key: "dividendPnl", width: 16 },
    { header: "交易影响", key: "tradingCostPnl", width: 16 },
    { header: "当日收益率", key: "returnRate", width: 14 },
    { header: "行情状态", key: "marketStatus", width: 14 },
    { header: "事件数", key: "eventCount", width: 10 },
  ];
  for (const day of view.days) {
    days.addRow({
      ...day,
      scope: view.scopeLabel,
      marketStatus: day.isPartial
        ? "部分缺失"
        : day.hasMarketData
          ? "完整"
          : "非交易日",
      eventCount: day.events.length,
    });
  }
  for (const key of [
    "totalPnl",
    "marketPricePnl",
    "dividendPnl",
    "tradingCostPnl",
  ]) {
    days.getColumn(key).numFmt = '¥#,##0.00;[Red]-¥#,##0.00';
  }
  days.getColumn("returnRate").numFmt = "0.00%;[Green]-0.00%";
  styleWorksheet(days);

  const contributions = workbook.addWorksheet("标的贡献");
  contributions.columns = [
    { header: "日期", key: "date", width: 14 },
    { header: "证券代码", key: "symbol", width: 12 },
    { header: "证券名称", key: "name", width: 18 },
    { header: "持仓变动", key: "holdingChange", width: 14 },
    { header: "市场价格收益", key: "marketPricePnl", width: 18 },
    { header: "分红收益", key: "dividendPnl", width: 16 },
    { header: "交易影响", key: "tradingCostPnl", width: 16 },
    { header: "总收益", key: "totalPnl", width: 16 },
  ];
  for (const day of view.days) {
    for (const row of day.contributions) {
      contributions.addRow({ date: day.date, ...row });
    }
  }
  for (const key of [
    "marketPricePnl",
    "dividendPnl",
    "tradingCostPnl",
    "totalPnl",
  ]) {
    contributions.getColumn(key).numFmt =
      '¥#,##0.00;[Red]-¥#,##0.00';
  }
  styleWorksheet(contributions);
  const provenance = workbook.addWorksheet("行情来源");
  provenance.columns = [
    { header: "实际来源", key: "source", width: 14 },
    { header: "主来源", key: "primarySource", width: 14 },
    { header: "是否兜底", key: "fallbackUsed", width: 12 },
    { header: "切换原因", key: "fallbackReason", width: 60 },
    { header: "获取时间", key: "fetchedAt", width: 26 },
    { header: "数据截止", key: "dataCutoff", width: 14 },
    { header: "复权方式", key: "adjustment", width: 12 },
  ];
  for (const row of view.provenance) {
    provenance.addRow({
      ...row,
      source: row.source === "tencent" ? "腾讯" : "新浪",
      primarySource: "腾讯",
      fallbackUsed: row.fallbackUsed ? "是" : "否",
      adjustment: row.adjustment === "qfq" ? "前复权" : "不复权",
    });
  }
  styleWorksheet(provenance);
  return toBuffer(workbook);
}

export async function buildLedgerWorkbook(
  result: LedgerQueryResult,
): Promise<Buffer<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "攒股收息";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("交易流水");
  sheet.columns = [
    { header: "业务日期", key: "businessDate", width: 14 },
    { header: "证券代码", key: "symbol", width: 12 },
    { header: "证券名称", key: "name", width: 18 },
    { header: "资产类型", key: "securityType", width: 12 },
    { header: "流水类型", key: "type", width: 14 },
    { header: "数量", key: "quantity", width: 14 },
    { header: "价格", key: "price", width: 12 },
    { header: "发生金额", key: "amount", width: 16 },
    { header: "费用", key: "fee", width: 14 },
    { header: "备注", key: "note", width: 30 },
    { header: "是否已冲正", key: "isReversed", width: 14 },
    { header: "修正后记录", key: "isCorrection", width: 14 },
    { header: "每股分红", key: "perShare", width: 14 },
    { header: "登记日", key: "recordDate", width: 14 },
    { header: "录入时间", key: "recordedAt", width: 26 },
    { header: "修正时间", key: "correctedAt", width: 26 },
    { header: "关联操作", key: "linkedOperation", width: 20 },
    { header: "关联记录", key: "linkedRecords", width: 32 },
  ];
  for (const row of result.rows) {
    sheet.addRow({
      ...row,
      securityType:
        row.securityType === "stock"
          ? "股票"
          : row.securityType === "etf"
            ? "ETF"
            : null,
      isReversed: row.isReversed ? "是" : "否",
      isCorrection: row.correctsEntryId ? "是" : "否",
      linkedOperation:
        row.linkedOperation === "dividend_reinvestment"
          ? "分红并再投入"
          : null,
      linkedRecords: row.linkedRecords
        .map(
          (linked) =>
            `${linked.type === "dividend" ? "分红到账" : "买入"} ${linked.businessDate}`,
        )
        .join("；"),
    });
  }
  for (const key of ["amount", "fee", "perShare"]) {
    sheet.getColumn(key).numFmt = '¥#,##0.00;[Red]-¥#,##0.00';
  }
  sheet.getColumn("price").numFmt = "0.000";
  sheet.getColumn("quantity").numFmt = "#,##0.00";
  styleWorksheet(sheet);
  return toBuffer(workbook);
}
