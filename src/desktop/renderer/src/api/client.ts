import type {
  BacktestRequest,
  BacktestWorkspaceState,
  ConfirmPendingDividendInput,
  DesktopApi,
  IncomeCalendarQuery,
  DividendReinvestmentInput,
  LedgerEntryInput,
  LedgerQuery,
} from "../../../shared/contracts";

function bridge(): DesktopApi {
  if (!window.desktop) {
    throw new Error("桌面服务不可用；请使用 npm run dev 启动 Electron");
  }
  return window.desktop;
}

export const api = {
  health: () => bridge().health(),
  listAStocks: () => bridge().listAStocks(),
  listEtfs: () => bridge().listEtfs(),
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
  getPositionsOverview: () => bridge().getPositionsOverview(),
  refreshPositionsMarket: () => bridge().refreshPositionsMarket(),
  exportPositions: () => bridge().exportPositions(),
  queryLedger: (query: LedgerQuery) => bridge().queryLedger(query),
  exportLedger: (query: LedgerQuery) => bridge().exportLedger(query),
  getIncomeCalendar: (query: IncomeCalendarQuery) =>
    bridge().getIncomeCalendar(query),
  exportIncomeCalendar: (query: IncomeCalendarQuery) =>
    bridge().exportIncomeCalendar(query),
  previewLedger: (input: LedgerEntryInput, replacingEntryId?: string) =>
    bridge().previewLedger(input, replacingEntryId),
  previewDividendReinvestment: (input: DividendReinvestmentInput) =>
    bridge().previewDividendReinvestment(input),
  addLedger: (input: LedgerEntryInput) => bridge().addLedger(input),
  addDividendReinvestment: (input: DividendReinvestmentInput) =>
    bridge().addDividendReinvestment(input),
  getLedgerRecord: (entryId: string) => bridge().getLedgerRecord(entryId),
  correctLedger: (entryId: string, input: LedgerEntryInput) =>
    bridge().correctLedger(entryId, input),
  reverseLedger: (entryId: string, reason: string) =>
    bridge().reverseLedger(entryId, reason),
  getSettings: () => bridge().getSettings(),
  getDiagnostics: () => bridge().getDiagnostics(),
  exportBackup: () => bridge().exportBackup(),
  restoreBackup: () => bridge().restoreBackup(),
  exportLogs: () => bridge().exportLogs(),
  discoverPendingDividends: () => bridge().discoverPendingDividends(),
  listPendingDividends: () => bridge().listPendingDividends(),
  confirmPendingDividend: (id: string, input: ConfirmPendingDividendInput) =>
    bridge().confirmPendingDividend(id, input),
  ignorePendingDividend: (id: string) => bridge().ignorePendingDividend(id),
  listTradingInterruptions: (symbol?: string) =>
    bridge().listTradingInterruptions(symbol),
  addTradingInterruption: (
    input: Parameters<DesktopApi["addTradingInterruption"]>[0],
  ) => bridge().addTradingInterruption(input),
  deleteTradingInterruption: (
    input: Parameters<DesktopApi["deleteTradingInterruption"]>[0],
  ) => bridge().deleteTradingInterruption(input),
};

export type {
  AdjustedBar,
  BacktestExperiment,
  BacktestExperimentSummary,
  BacktestRequest,
  BacktestResult,
  BacktestCandlePeriod,
  BacktestChartMetric,
  BacktestWorkspaceState,
  ChartDataState,
  EntryType,
  DirectoryProvenance,
  DividendReinvestmentInput,
  DividendReinvestmentPreview,
  ConfirmPendingDividendInput,
  IncomeCalendarQuery,
  IncomeCalendarScope,
  IncomeContribution,
  LedgerEntryInput,
  LedgerImpactPreview,
  LedgerQuery,
  LedgerRecordView,
  LiveDataQuality,
  MarketCalendarDiagnostic,
  PendingDividend,
  PendingDividendDiscoveryResult,
  PerformancePeriod,
  PositionView,
  SecurityTradingInterruption,
  SecurityType,
  SimpleBacktestRow,
  StockInfo,
  XirrStatus,
} from "../../../shared/contracts";
