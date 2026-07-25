export type EntryType =
  | "transfer_in"
  | "buy"
  | "sell"
  | "dividend"
  | "reverse_repo"
  | "transfer_out"
  | "adjustment";

export interface DataProvenance {
  source: string;
  fetchedAt: string;
  dataCutoff: string;
  adjustment: "none";
  caliberVersion: string;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface DividendEvent {
  date: string;
  recordDate: string;
  paymentDate: string | null;
  perShare: number;
  transferRatio: number;
  bonusRatio: number;
  status: string;
}

export interface BacktestRequest {
  symbols: string[];
  startDate: string;
  endDate: string;
  monthlyAmount: number;
  buyDay: number;
}

export interface BacktestTransaction {
  date: string;
  type: "contribution" | "buy" | "dividend" | "dividend_reinvest";
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  cashAfter: number;
}

export interface EquityPoint {
  date: string;
  asset: number;
  contribution: number;
}

export interface BacktestMetrics {
  totalContribution: number;
  endingAsset: number;
  totalPnl: number;
  xirr: number | null;
  maxDrawdown: number;
  totalDividend: number;
  endingCash: number;
}

export interface BacktestResult {
  id: string;
  symbol: string;
  name: string;
  requestedStartDate: string;
  actualStartDate: string;
  actualEndDate: string;
  monthlyAmount: number;
  buyDay: number;
  metrics: BacktestMetrics;
  transactions: BacktestTransaction[];
  equityCurve: EquityPoint[];
  warnings: string[];
  provenance: DataProvenance[];
  createdAt: string;
}

export interface LedgerEntryInput {
  type: EntryType;
  businessDate: string;
  amount?: number;
  symbol?: string;
  price?: number;
  quantity?: number;
  fee?: number;
  perShare?: number;
  recordDate?: string;
  paymentDate?: string;
  repoCode?: string;
  annualRate?: number;
  termDays?: number;
  maturityAmount?: number;
  maturityDate?: string;
  note?: string;
  reversesEntryId?: string;
}

export interface LedgerEntry extends LedgerEntryInput {
  id: string;
  recordedAt: string;
  currency: "CNY";
  source: "user" | "system" | "restore";
}

export interface PositionSummary {
  symbol: string;
  quantity: number;
  cost: number;
  averageCost: number;
  lastPrice: number | null;
  marketValue: number;
  pnl: number;
}

export interface AccountSummary {
  positions: PositionSummary[];
  availableCash: number;
  marketValue: number;
  reverseRepoAsset: number;
  totalAsset: number;
  totalContribution: number;
  totalWithdrawal: number;
  totalPnl: number;
  xirr: number | null;
  valuationSource: string;
  dataCutoff: string | null;
}

export interface AppSettings {
  priceSource: "tencent";
  dividendSource: "eastmoney";
  commissionRate: number;
  minimumCommission: number;
  caliberVersion: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  storage: "sqlite";
  dataCutoff: string | null;
}

export interface ExportResult {
  cancelled: boolean;
  path?: string;
}

export interface RestoreResult extends ExportResult {
  restored?: boolean;
  safetyBackupPath?: string;
}

export interface DesktopApi {
  health(): Promise<HealthResponse>;
  runBacktest(request: BacktestRequest): Promise<BacktestResult[]>;
  listBacktests(): Promise<BacktestResult[]>;
  listLedger(): Promise<LedgerEntry[]>;
  addLedger(input: LedgerEntryInput): Promise<LedgerEntry>;
  reverseLedger(entryId: string, reason: string): Promise<LedgerEntry>;
  accountSummary(): Promise<AccountSummary>;
  getSettings(): Promise<AppSettings>;
  exportBackup(): Promise<ExportResult>;
  restoreBackup(): Promise<RestoreResult>;
  exportLogs(): Promise<ExportResult>;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
