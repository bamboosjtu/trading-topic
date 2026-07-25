import { contextBridge, ipcRenderer } from "electron";
import type {
  BacktestRequest,
  DesktopApi,
  LedgerEntryInput,
} from "../shared/contracts";

const api: DesktopApi = {
  health: () => ipcRenderer.invoke("app:health"),
  runBacktest: (request: BacktestRequest) =>
    ipcRenderer.invoke("backtest:run", request),
  listBacktests: () => ipcRenderer.invoke("backtest:list"),
  listLedger: () => ipcRenderer.invoke("ledger:list"),
  addLedger: (input: LedgerEntryInput) =>
    ipcRenderer.invoke("ledger:add", input),
  reverseLedger: (entryId: string, reason: string) =>
    ipcRenderer.invoke("ledger:reverse", entryId, reason),
  accountSummary: () => ipcRenderer.invoke("account:summary"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  restoreBackup: () => ipcRenderer.invoke("backup:restore"),
  exportLogs: () => ipcRenderer.invoke("logs:export"),
};

contextBridge.exposeInMainWorld("desktop", api);
