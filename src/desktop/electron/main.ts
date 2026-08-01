import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
import { validateBackup } from "./domain/backupValidation";
import { AppService } from "./services/appService";
import { LocalDatabase } from "./storage/database";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = app.isPackaged ? process.resourcesPath : process.cwd();
const DEV_USER_DATA_DIR = resolve(PROJECT_ROOT, ".userData");
// 备份恢复文件大小上限：256 MiB。覆盖典型历史流水 + 行情快照 + 回测试验，
// 同时拒绝明显异常的大型文件，避免 JSON.parse 消耗过多内存。
const BACKUP_RESTORE_MAX_BYTES = 256 * 1024 * 1024;

if (!app.isPackaged) app.setPath("userData", DEV_USER_DATA_DIR);
if (!existsSync(app.getPath("userData"))) {
  mkdirSync(app.getPath("userData"), { recursive: true });
}

let database: LocalDatabase;
let service: AppService;

// 导出/备份文件名时间戳统一使用北京时间，与界面显示保持一致。
function timestamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}-${value("hour")}-${value("minute")}-${value("second")}`;
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
    // 仅允许 http/https 在外部浏览器打开，避免 file://、javascript:、
    // 自定义协议等被 shell.openExternal 转交给系统处理而引入风险。
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        void shell.openExternal(parsed.href);
      }
    } catch {
      // 非法 URL 直接忽略，不抛出到主进程。
    }
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

function registerIpc(): void {
  ipcMain.handle("app:health", () => {
    return {
      status: "ok",
      version: app.getVersion(),
      storage: "sqlite",
    };
  });
  ipcMain.handle("diagnostics:get", () => service.getDiagnostics());
  ipcMain.handle("backtest:run", (_event, request: BacktestRequest) =>
    service.runBacktest(request),
  );
  ipcMain.handle("stocks:list", () => service.listAStocks());
  ipcMain.handle("etfs:list", () => service.listEtfs());
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
    const exportResult = service.exportLedger({ ...query, page: 1, pageSize: 100 });
    const result = await dialog.showSaveDialog({
      title: "导出交易流水",
      defaultPath: `攒股收息-交易流水-${timestamp()}.xlsx`,
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(
      result.filePath,
      await buildLedgerWorkbook(exportResult),
    );
    database.log("info", `已导出 ${exportResult.rows.length} 条交易流水`);
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
    const fileSize = statSync(filePath).size;
    if (fileSize > BACKUP_RESTORE_MAX_BYTES) {
      await dialog.showMessageBox({
        type: "error",
        title: "备份文件过大",
        message: `备份文件 ${fileSize.toLocaleString()} 字节超出 ${BACKUP_RESTORE_MAX_BYTES.toLocaleString()} 字节上限。`,
        detail: "请确认选择的是应用导出的 JSON 备份，而非其他大型文件。",
        buttons: ["关闭"],
        defaultId: 0,
      });
      return { cancelled: true };
    }
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
    // 领域完整性校验在 storage 层之外完成，避免 storage→domain 反向依赖。
    // 校验失败时不会进入 restoreBackup，现有数据不被触碰。
    const backup = validateBackup(
      payload,
      database.getSchemaVersion(),
      database.getSchemaFingerprint(),
    );
    database.restoreBackup(backup);
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

app
  .whenReady()
  .then(async () => {
    const databasePath = join(app.getPath("userData"), "stock-income.sqlite");
    database = await LocalDatabase.open(databasePath);
    service = new AppService(database);
    registerIpc();
    database.log("info", "应用启动");
    createWindow();
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "攒股收息无法启动",
      `${message}\n\nMVP 不迁移或兼容旧数据库。请保留原文件，并使用新的本地数据目录启动当前版本。`,
    );
    app.quit();
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
