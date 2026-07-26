import { contextBridge, ipcRenderer } from "electron";
import type {
  BacktestRequest,
  BacktestWorkspaceState,
  DesktopApi,
  LedgerEntryInput,
} from "../shared/contracts";

const api: DesktopApi = {
  health: () => ipcRenderer.invoke("app:health"),
  listStocks: () => ipcRenderer.invoke("stocks:list"),
  runBacktest: (request: BacktestRequest) =>
    ipcRenderer.invoke("backtest:run", request),
  listBacktests: () => ipcRenderer.invoke("backtest:list"),
  getBacktestDetail: (backtestId: string) =>
    ipcRenderer.invoke("backtest:detail", backtestId),
  getBacktestWorkspace: () => ipcRenderer.invoke("backtest:workspace:get"),
  saveBacktestWorkspace: (state: BacktestWorkspaceState) =>
    ipcRenderer.invoke("backtest:workspace:save", state),
  exportBacktestComparison: (backtestIds: string[]) =>
    ipcRenderer.invoke("backtest:comparison:export", backtestIds),
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
