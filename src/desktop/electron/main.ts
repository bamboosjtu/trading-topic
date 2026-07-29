import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BacktestRequest,
  BacktestWorkspaceState,
  IncomeCalendarQuery,
  DividendReinvestmentInput,
  LedgerEntryInput,
  LedgerQuery,
} from "../shared/contracts";
import { buildBacktestWorkbook } from "./export/backtestWorkbook";
import {
  buildIncomeCalendarWorkbook,
  buildLedgerWorkbook,
  buildPositionsWorkbook,
} from "./export/liveWorkbooks";
import { AppService } from "./services/appService";
import { LocalDatabase } from "./storage/database";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = app.isPackaged ? process.resourcesPath : process.cwd();
const DEV_USER_DATA_DIR = resolve(PROJECT_ROOT, ".userData");

if (!app.isPackaged) app.setPath("userData", DEV_USER_DATA_DIR);
if (!existsSync(app.getPath("userData"))) {
  mkdirSync(app.getPath("userData"), { recursive: true });
}

let database: LocalDatabase;
let service: AppService;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function createWindow(): void {
  const preloadPath = join(__dirname, "..", "preload", "preload.js");
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1920,
    minHeight: 900,
    backgroundColor: "#f6f8fb",
    title: "攒股收息",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

function registerIpc(): void {
  ipcMain.handle("app:health", () => {
    const latest = database.latestPrices();
    return {
      status: "ok",
      version: app.getVersion(),
      storage: "sqlite",
      dataCutoff: latest.dataCutoff,
    };
  });
  ipcMain.handle("backtest:run", (_event, request: BacktestRequest) =>
    service.runBacktest(request),
  );
  ipcMain.handle("stocks:list", () => service.listAStocks());
  ipcMain.handle("etfs:list", () => service.listEtfs());
  ipcMain.handle("instruments:list", () => service.listInstruments());
  ipcMain.handle("backtest:experiments:list", () =>
    service.listBacktestExperiments(),
  );
  ipcMain.handle(
    "backtest:experiment:get",
    (_event, experimentId: string) =>
      service.getBacktestExperiment(experimentId),
  );
  ipcMain.handle(
    "backtest:experiment:delete",
    (_event, experimentId: string) =>
      service.deleteBacktestExperiment(experimentId),
  );
  ipcMain.handle("backtest:detail", (_event, backtestId: string) =>
    service.getBacktestDetail(backtestId),
  );
  ipcMain.handle("backtest:workspace:get", () =>
    service.getBacktestWorkspace(),
  );
  ipcMain.handle(
    "backtest:workspace:save",
    (_event, state: BacktestWorkspaceState) =>
      service.saveBacktestWorkspace(state),
  );
  ipcMain.handle(
    "backtest:experiment:export",
    async (_event, experimentId: string) => {
      const experiment = service.getBacktestExperiment(experimentId);
      const result = await dialog.showSaveDialog({
        title: "导出回测试验",
        defaultPath: `攒股收息-回测试验-${timestamp()}.xlsx`,
        filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      writeFileSync(
        result.filePath,
        await buildBacktestWorkbook(experiment),
      );
      database.log(
        "info",
        `已导出回测试验 ${experiment.experimentId} 的 ${experiment.results.length} 条结果及明细`,
      );
      return { cancelled: false, path: result.filePath };
    },
  );
  ipcMain.handle("positions:overview", () => service.getPositionsOverview());
  ipcMain.handle("positions:refresh", () => service.refreshPositionsMarket());
  ipcMain.handle("positions:export", async () => {
    const overview = service.getPositionsOverview();
    const result = await dialog.showSaveDialog({
      title: "导出持仓明细",
      defaultPath: `攒股收息-持仓明细-${timestamp()}.xlsx`,
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(result.filePath, await buildPositionsWorkbook(overview));
    database.log("info", "已导出持仓明细");
    return { cancelled: false, path: result.filePath };
  });
  ipcMain.handle("ledger:query", (_event, query: LedgerQuery) =>
    service.queryLedger(query),
  );
  ipcMain.handle("ledger:record:get", (_event, entryId: string) =>
    service.getLedgerRecord(entryId),
  );
  ipcMain.handle("ledger:export", async (_event, query: LedgerQuery) => {
    const firstPage = service.queryLedger({ ...query, page: 1, pageSize: 100 });
    const rows = [...firstPage.rows];
    const pages = Math.ceil(firstPage.total / 100);
    for (let page = 2; page <= pages; page += 1) {
      rows.push(
        ...service.queryLedger({ ...query, page, pageSize: 100 }).rows,
      );
    }
    const result = await dialog.showSaveDialog({
      title: "导出交易流水",
      defaultPath: `攒股收息-交易流水-${timestamp()}.xlsx`,
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(
      result.filePath,
      await buildLedgerWorkbook({ ...firstPage, rows }),
    );
    database.log("info", `已导出 ${rows.length} 条交易流水`);
    return { cancelled: false, path: result.filePath };
  });
  ipcMain.handle(
    "income-calendar:get",
    (_event, query: IncomeCalendarQuery) =>
      service.getIncomeCalendar(query),
  );
  ipcMain.handle(
    "income-calendar:export",
    async (_event, query: IncomeCalendarQuery) => {
      const view = await service.getIncomeCalendar(query);
      const result = await dialog.showSaveDialog({
        title: "导出收益日历",
        defaultPath: `攒股收息-收益日历-${query.month}-${timestamp()}.xlsx`,
        filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      writeFileSync(result.filePath, await buildIncomeCalendarWorkbook(view));
      database.log("info", `已导出 ${query.month} 收益日历`);
      return { cancelled: false, path: result.filePath };
    },
  );
  ipcMain.handle(
    "ledger:preview",
    (_event, input: LedgerEntryInput, replacingEntryId?: string) =>
      service.previewLedger(input, replacingEntryId),
  );
  ipcMain.handle("ledger:add", (_event, input: LedgerEntryInput) =>
    service.addLedger(input),
  );
  ipcMain.handle(
    "ledger:dividend-reinvestment:preview",
    (_event, input: DividendReinvestmentInput) =>
      service.previewDividendReinvestment(input),
  );
  ipcMain.handle(
    "ledger:dividend-reinvestment:add",
    (_event, input: DividendReinvestmentInput) =>
      service.addDividendReinvestment(input),
  );
  ipcMain.handle(
    "ledger:correct",
    (_event, entryId: string, input: LedgerEntryInput) =>
      service.correctLedger(entryId, input),
  );
  ipcMain.handle(
    "ledger:reverse",
    (_event, entryId: string, reason: string) =>
      service.reverseLedger(entryId, reason),
  );
  ipcMain.handle("settings:get", () => database.getSettings());

  ipcMain.handle("backup:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "导出 JSON 备份",
      defaultPath: `攒股收息-backup-${timestamp()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(
      result.filePath,
      JSON.stringify(database.exportBackup(), null, 2),
      "utf8",
    );
    database.log("info", "已导出 JSON 备份");
    return { cancelled: false, path: result.filePath };
  });

  ipcMain.handle("backup:restore", async () => {
    const selected = await dialog.showOpenDialog({
      title: "选择 JSON 备份",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = selected.filePaths[0];
    if (selected.canceled || !filePath) return { cancelled: true };
    const payload = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const confirmation = await dialog.showMessageBox({
      type: "warning",
      title: "确认恢复",
      message: "恢复会覆盖当前流水和回测记录。",
      detail: "系统会先在本地生成安全备份。此操作不会读取 Labs 或 Research。",
      buttons: ["取消", "生成备份并恢复"],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return { cancelled: true };
    const safetyBackupPath = join(
      app.getPath("userData"),
      `pre-restore-${timestamp()}.json`,
    );
    writeFileSync(
      safetyBackupPath,
      JSON.stringify(database.exportBackup(), null, 2),
      "utf8",
    );
    database.restoreBackup(payload);
    database.log("info", "已从 JSON 备份恢复");
    return {
      cancelled: false,
      restored: true,
      path: filePath,
      safetyBackupPath,
    };
  });

  ipcMain.handle("logs:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "导出运行日志",
      defaultPath: `攒股收息-log-${timestamp()}.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(result.filePath, database.getLogs(), "utf8");
    return { cancelled: false, path: result.filePath };
  });
}

app.whenReady().then(async () => {
  const databasePath = join(app.getPath("userData"), "stock-income.sqlite");
  database = await LocalDatabase.open(databasePath);
  service = new AppService(database);
  registerIpc();
  database.log("info", "应用启动");
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  database?.close();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
