import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  BacktestRequest,
  BacktestWorkspaceState,
  ConfirmPendingDividendInput,
  IncomeCalendarQuery,
  DividendReinvestmentInput,
  LedgerEntryInput,
  LedgerQuery,
  ValidatedBackupPayload,
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
// P2-5：备份恢复文件大小上限降到 64 MiB，更符合 R1 阶段数据量。
// JSON 解析和领域校验在 worker 线程完成，避免冻结主进程。
const BACKUP_RESTORE_MAX_BYTES = 64 * 1024 * 1024;

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
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#f6f8fb",
    title: "投资研究实验室",
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

  // P1-2：拦截当前窗口导航。桌面应用为 SPA，不允许窗口内导航到外部页面，
  // 避免 preload 向被注入的远程页面暴露 window.desktop。
  win.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

/**
 * P1-2 / P2：判断 URL 是否为可信的应用页面。
 *
 * 开发模式：严格校验 origin + pathname 前缀，不允许 startsWith 绕过。
 * 打包模式：只允许 file: 协议下精确匹配 renderer/index.html，
 * 不接受任意 file: 页面。
 */
function isTrustedAppUrl(url: string): boolean {
  try {
    const target = new URL(url);
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    if (devUrl) {
      const trusted = new URL(devUrl);
      return (
        target.origin === trusted.origin &&
        target.pathname.startsWith(trusted.pathname)
      );
    }
    const trustedFile = new URL(
      `file://${join(__dirname, "..", "renderer", "index.html")}`,
    );
    return (
      target.protocol === "file:" &&
      target.pathname === trustedFile.pathname
    );
  } catch {
    return false;
  }
}

/**
 * P1-2 / P2：校验 IPC 消息来源，拒绝不可信页面或子 Frame 调用特权接口。
 */
function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedAppUrl(event.senderFrame?.url ?? "")
  ) {
    throw new Error("拒绝不可信页面调用");
  }
}

function registerIpc(): void {
  // P1-2：所有 IPC handler 统一通过 secureHandle 包装，校验 sender 来源。
  function secureHandle(
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
  ): void {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event);
      return handler(event, ...args);
    });
  }

  secureHandle("app:health", () => {
    return {
      status: "ok",
      version: app.getVersion(),
      storage: "sqlite",
    };
  });
  secureHandle("diagnostics:get", () => service.getDiagnostics());
  secureHandle("backtest:run", (_event, request: BacktestRequest) =>
    service.runBacktest(request),
  );
  secureHandle("stocks:list", () => service.listAStocks());
  secureHandle("etfs:list", () => service.listEtfs());
  secureHandle("backtest:experiments:list", () =>
    service.listBacktestExperiments(),
  );
  secureHandle(
    "backtest:experiment:get",
    (_event, experimentId: string) =>
      service.getBacktestExperiment(experimentId),
  );
  secureHandle(
    "backtest:experiment:delete",
    (_event, experimentId: string) =>
      service.deleteBacktestExperiment(experimentId),
  );
  secureHandle("backtest:detail", (_event, backtestId: string) =>
    service.getBacktestDetail(backtestId),
  );
  secureHandle("backtest:workspace:get", () =>
    service.getBacktestWorkspace(),
  );
  secureHandle(
    "backtest:workspace:save",
    (_event, state: BacktestWorkspaceState) =>
      service.saveBacktestWorkspace(state),
  );
  secureHandle(
    "backtest:experiment:export",
    async (_event, experimentId: string) => {
      const experiment = service.getBacktestExperiment(experimentId);
      const result = await dialog.showSaveDialog({
        title: "导出回测试验",
        defaultPath: `投资研究实验室-回测试验-${timestamp()}.xlsx`,
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
  secureHandle("positions:overview", () => service.getPositionsOverview());
  secureHandle("positions:refresh", () => service.refreshPositionsMarket());
  secureHandle("positions:export", async () => {
    const overview = service.getPositionsOverview();
    const result = await dialog.showSaveDialog({
      title: "导出持仓明细",
      defaultPath: `投资研究实验室-持仓明细-${timestamp()}.xlsx`,
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    writeFileSync(result.filePath, await buildPositionsWorkbook(overview));
    database.log("info", "已导出持仓明细");
    return { cancelled: false, path: result.filePath };
  });
  secureHandle("ledger:query", (_event, query: LedgerQuery) =>
    service.queryLedger(query),
  );
  secureHandle("ledger:record:get", (_event, entryId: string) =>
    service.getLedgerRecord(entryId),
  );
  secureHandle("ledger:export", async (_event, query: LedgerQuery) => {
    const exportResult = service.exportLedger({ ...query, page: 1, pageSize: 100 });
    const result = await dialog.showSaveDialog({
      title: "导出交易流水",
      defaultPath: `投资研究实验室-交易流水-${timestamp()}.xlsx`,
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
  secureHandle(
    "income-calendar:get",
    (_event, query: IncomeCalendarQuery) =>
      service.getIncomeCalendar(query),
  );
  secureHandle(
    "income-calendar:export",
    async (_event, query: IncomeCalendarQuery) => {
      const view = await service.getIncomeCalendar(query);
      const result = await dialog.showSaveDialog({
        title: "导出收益日历",
        defaultPath: `投资研究实验室-收益日历-${query.month}-${timestamp()}.xlsx`,
        filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      writeFileSync(result.filePath, await buildIncomeCalendarWorkbook(view));
      database.log("info", `已导出 ${query.month} 收益日历`);
      return { cancelled: false, path: result.filePath };
    },
  );
  secureHandle(
    "ledger:preview",
    (_event, input: LedgerEntryInput, replacingEntryId?: string) =>
      service.previewLedger(input, replacingEntryId),
  );
  secureHandle("ledger:add", (_event, input: LedgerEntryInput) =>
    service.addLedger(input),
  );
  secureHandle(
    "ledger:dividend-reinvestment:preview",
    (_event, input: DividendReinvestmentInput) =>
      service.previewDividendReinvestment(input),
  );
  secureHandle(
    "ledger:dividend-reinvestment:add",
    (_event, input: DividendReinvestmentInput) =>
      service.addDividendReinvestment(input),
  );
  secureHandle(
    "ledger:correct",
    (_event, entryId: string, input: LedgerEntryInput) =>
      service.correctLedger(entryId, input),
  );
  secureHandle(
    "ledger:reverse",
    (_event, entryId: string, reason: string) =>
      service.reverseLedger(entryId, reason),
  );
  secureHandle("settings:get", () => database.getSettings());

  secureHandle("dividends:discover", () => service.discoverPendingDividends());
  secureHandle("dividends:list", () => service.listPendingDividends());
  secureHandle(
    "dividends:confirm",
    (_event, id: string, input: ConfirmPendingDividendInput) =>
      service.confirmPendingDividend(id, input),
  );
  secureHandle("dividends:ignore", (_event, id: string) =>
    service.ignorePendingDividend(id),
  );

  secureHandle("backup:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "导出 JSON 备份",
      defaultPath: `投资研究实验室-backup-${timestamp()}.json`,
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

  secureHandle("backup:restore", async () => {
    const selected = await dialog.showOpenDialog({
      title: "选择 JSON 备份",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = selected.filePaths[0];
    if (selected.canceled || !filePath) return { cancelled: true };
    // P2-5：使用异步文件读取，避免冻结主进程。
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
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
    const fileContent = await readFile(filePath, "utf8");
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
    // P2-5：安全备份使用异步写入。
    await writeFile(
      safetyBackupPath,
      JSON.stringify(database.exportBackup(), null, 2),
      "utf8",
    );
    // P2-5：JSON 解析和领域校验在 worker 线程完成，避免冻结主进程。
    // 领域完整性校验在 storage 层之外完成，避免 storage→domain 反向依赖。
    // 校验失败时不会进入 restoreBackup，现有数据不被触碰。
    // P2-4：补充 exit 兜底和超时，避免 worker 异常退出但未触发 message/error
    // 时 Promise 永远悬挂。
    const schemaVersion = database.getSchemaVersion();
    const schemaFingerprint = database.getSchemaFingerprint();
    const backup = await new Promise<ValidatedBackupPayload>(
      (resolvePromise, rejectPromise) => {
        const worker = new Worker(
          join(__dirname, "backupRestoreWorker.js"),
          {
            workerData: { fileContent, schemaVersion, schemaFingerprint },
          },
        );
        let settled = false;
        // P2-4：timer 先声明，cleanup 通过闭包引用，避免 TDZ。
        let timer: NodeJS.Timeout | null = null;
        const cleanup = (reason: "done" | "error" | "exit" | "timeout") => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          worker.removeAllListeners();
          if (reason !== "done") {
            worker.terminate().catch(() => {});
          }
        };
        timer = setTimeout(() => {
          cleanup("timeout");
          rejectPromise(new Error("备份校验超时（60 秒）"));
        }, 60_000);
        worker.on("message", (message: { success: boolean; data?: ValidatedBackupPayload; error?: string }) => {
          if (settled) return;
          if (message.success && message.data) {
            cleanup("done");
            worker.terminate().catch(() => {});
            resolvePromise(message.data);
          } else {
            cleanup("error");
            rejectPromise(new Error(message.error ?? "备份校验失败"));
          }
        });
        worker.on("error", (error) => {
          if (settled) return;
          cleanup("error");
          rejectPromise(error);
        });
        // P2-4：worker 异常退出但未触发 message/error 时，通过 exit 兜底拒绝。
        worker.on("exit", (code) => {
          if (settled) return;
          cleanup("exit");
          rejectPromise(
            new Error(`备份校验 worker 异常退出（code=${code}）`),
          );
        });
      },
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

  secureHandle("logs:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "导出运行日志",
      defaultPath: `投资研究实验室-log-${timestamp()}.txt`,
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
      "投资研究实验室无法启动",
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
