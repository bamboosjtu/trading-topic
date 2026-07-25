import type {
  BacktestRequest,
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
  runBacktest: (request: BacktestRequest) => bridge().runBacktest(request),
  listBacktests: () => bridge().listBacktests(),
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
  AppSettings,
  BacktestRequest,
  BacktestResult,
  EntryType,
  HealthResponse,
  LedgerEntry,
  LedgerEntryInput,
} from "../../../shared/contracts";
