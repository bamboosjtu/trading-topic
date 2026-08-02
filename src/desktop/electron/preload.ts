import { contextBridge, ipcRenderer } from "electron";
import type {
  BacktestRequest,
  BacktestWorkspaceState,
  ConfirmPendingDividendInput,
  DesktopApi,
  IncomeCalendarQuery,
  LedgerEntryInput,
  LedgerQuery,
} from "../shared/contracts";

const api: DesktopApi = {
  health: () => ipcRenderer.invoke("app:health"),
  listAStocks: () => ipcRenderer.invoke("stocks:list"),
  listEtfs: () => ipcRenderer.invoke("etfs:list"),
  runBacktest: (request: BacktestRequest) =>
    ipcRenderer.invoke("backtest:run", request),
  listBacktestExperiments: () =>
    ipcRenderer.invoke("backtest:experiments:list"),
  getBacktestExperiment: (experimentId: string) =>
    ipcRenderer.invoke("backtest:experiment:get", experimentId),
  deleteBacktestExperiment: (experimentId: string) =>
    ipcRenderer.invoke("backtest:experiment:delete", experimentId),
  getBacktestDetail: (backtestId: string) =>
    ipcRenderer.invoke("backtest:detail", backtestId),
  getBacktestWorkspace: () => ipcRenderer.invoke("backtest:workspace:get"),
  saveBacktestWorkspace: (state: BacktestWorkspaceState) =>
    ipcRenderer.invoke("backtest:workspace:save", state),
  exportBacktestExperiment: (experimentId: string) =>
    ipcRenderer.invoke("backtest:experiment:export", experimentId),
  getPositionsOverview: () => ipcRenderer.invoke("positions:overview"),
  refreshPositionsMarket: () => ipcRenderer.invoke("positions:refresh"),
  exportPositions: () => ipcRenderer.invoke("positions:export"),
  queryLedger: (query: LedgerQuery) =>
    ipcRenderer.invoke("ledger:query", query),
  exportLedger: (query: LedgerQuery) =>
    ipcRenderer.invoke("ledger:export", query),
  getIncomeCalendar: (query: IncomeCalendarQuery) =>
    ipcRenderer.invoke("income-calendar:get", query),
  exportIncomeCalendar: (query: IncomeCalendarQuery) =>
    ipcRenderer.invoke("income-calendar:export", query),
  previewLedger: (input: LedgerEntryInput, replacingEntryId?: string) =>
    ipcRenderer.invoke("ledger:preview", input, replacingEntryId),
  addLedger: (input: LedgerEntryInput) =>
    ipcRenderer.invoke("ledger:add", input),
  getLedgerRecord: (entryId: string) =>
    ipcRenderer.invoke("ledger:record:get", entryId),
  correctLedger: (entryId: string, input: LedgerEntryInput) =>
    ipcRenderer.invoke("ledger:correct", entryId, input),
  reverseLedger: (entryId: string, reason: string) =>
    ipcRenderer.invoke("ledger:reverse", entryId, reason),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getDiagnostics: () => ipcRenderer.invoke("diagnostics:get"),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  restoreBackup: () => ipcRenderer.invoke("backup:restore"),
  exportLogs: () => ipcRenderer.invoke("logs:export"),
  discoverPendingDividends: () => ipcRenderer.invoke("dividends:discover"),
  listPendingDividends: () => ipcRenderer.invoke("dividends:list"),
  confirmPendingDividend: (id: string, input: ConfirmPendingDividendInput) =>
    ipcRenderer.invoke("dividends:confirm", id, input),
  ignorePendingDividend: (id: string) =>
    ipcRenderer.invoke("dividends:ignore", id),
  listTradingInterruptions: (symbol?: string) =>
    ipcRenderer.invoke("interruptions:list", symbol),
  addTradingInterruption: (input) =>
    ipcRenderer.invoke("interruptions:add", input),
  deleteTradingInterruption: (input) =>
    ipcRenderer.invoke("interruptions:delete", input),
};

contextBridge.exposeInMainWorld("desktop", api);
