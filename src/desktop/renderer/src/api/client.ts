import type {
  BacktestRequest,
  BacktestWorkspaceState,
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
  addLedger: (input: LedgerEntryInput) => bridge().addLedger(input),
  addDividendReinvestment: (input: DividendReinvestmentInput) =>
    bridge().addDividendReinvestment(input),
  correctLedger: (entryId: string, input: LedgerEntryInput) =>
    bridge().correctLedger(entryId, input),
  reverseLedger: (entryId: string, reason: string) =>
    bridge().reverseLedger(entryId, reason),
  getSettings: () => bridge().getSettings(),
  exportBackup: () => bridge().exportBackup(),
  restoreBackup: () => bridge().restoreBackup(),
  exportLogs: () => bridge().exportLogs(),
};

export type {
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
  DividendReinvestmentInput,
  DividendReinvestmentResult,
  HealthResponse,
  IncomeCalendarQuery,
  IncomeCalendarDay,
  IncomeCalendarScope,
  IncomeContribution,
  IncomeCalendarView,
  LedgerEntry,
  LedgerEntryInput,
  LedgerImpactPreview,
  LedgerQuery,
  LedgerQueryResult,
  LedgerRecordView,
  LiveDataQuality,
  PerformancePeriod,
  PositionsOverview,
  PositionView,
  SecurityType,
  SimpleBacktestResult,
  SimpleBacktestRow,
  StockInfo,
} from "../../../shared/contracts";
