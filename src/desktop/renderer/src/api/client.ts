import type {
  BacktestRequest,
  BacktestWorkspaceState,
  DesktopApi,
  LedgerEntryInput,
} from "../../../shared/contracts";

function bridge(): DesktopApi {
  if (!window.desktop) {
    throw new Error("桌面服务不可用；请使用 npm run dev 启动 Electron");
  }
  return window.desktop;
}

export const api = {
  health: () => bridge().health(),
  listStocks: () => bridge().listStocks(),
  runBacktest: (request: BacktestRequest) => bridge().runBacktest(request),
  listBacktestExperiments: () => bridge().listBacktestExperiments(),
  getBacktestExperiment: (experimentId: string) =>
    bridge().getBacktestExperiment(experimentId),
  deleteBacktestExperiment: (experimentId: string) =>
    bridge().deleteBacktestExperiment(experimentId),
  getBacktestDetail: (backtestId: string) =>
    bridge().getBacktestDetail(backtestId),
  getBacktestWorkspace: () => bridge().getBacktestWorkspace(),
  saveBacktestWorkspace: (state: BacktestWorkspaceState) =>
    bridge().saveBacktestWorkspace(state),
  exportBacktestExperiment: (experimentId: string) =>
    bridge().exportBacktestExperiment(experimentId),
  listLedger: () => bridge().listLedger(),
  addLedger: (input: LedgerEntryInput) => bridge().addLedger(input),
  reverseLedger: (entryId: string, reason: string) =>
    bridge().reverseLedger(entryId, reason),
  accountSummary: () => bridge().accountSummary(),
  getSettings: () => bridge().getSettings(),
  exportBackup: () => bridge().exportBackup(),
  restoreBackup: () => bridge().restoreBackup(),
  exportLogs: () => bridge().exportLogs(),
};

export type {
  AccountSummary,
  AdjustedBar,
  AppSettings,
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestRequest,
  BacktestResult,
  BacktestCandlePeriod,
  BacktestChartMetric,
  BacktestWorkspaceState,
  ChartDataState,
  EntryType,
  HealthResponse,
  LedgerEntry,
  LedgerEntryInput,
  SimpleBacktestResult,
  SimpleBacktestRow,
  StockInfo,
} from "../../../shared/contracts";
