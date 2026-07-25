import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BacktestRequest, LedgerEntryInput } from "../shared/contracts";
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
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f3f5f7",
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
  ipcMain.handle("backtest:list", () => service.listBacktests());
  ipcMain.handle("ledger:list", () => service.listLedger());
  ipcMain.handle("ledger:add", (_event, input: LedgerEntryInput) =>
    service.addLedger(input),
  );
  ipcMain.handle(
    "ledger:reverse",
    (_event, entryId: string, reason: string) =>
      service.reverseLedger(entryId, reason),
  );
  ipcMain.handle("account:summary", () => service.accountSummary());
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
  database = await LocalDatabase.open(databasePath, PROJECT_ROOT);
  service = new AppService(database);
  registerIpc();
  database.log("info", "应用启动");
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
