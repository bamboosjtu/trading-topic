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
  adjustment: "none" | "qfq";
  caliberVersion: string;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface AdjustedBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustment: "qfq";
}

export type ChartDataState =
  | { status: "loading" }
  | { status: "ready"; data: AdjustedBar[] }
  | { status: "unavailable"; reason: string }
  | { status: "error"; message: string };

export interface DividendEvent {
  date: string;
  recordDate: string;
  paymentDate: string | null;
  /** 税前每股现金分红（元/股） */
  perShare: number;
  /** 每 10 股转增股数 */
  transferRatio: number;
  /** 每 10 股送股股数 */
  bonusRatio: number;
  status: string;
}

/**
 * R1 不自动参与、但必须在回测结果中披露的公司行动。
 *
 * 不复权行情会保留事件发生后的市场除权影响；这里只记录用户选择和额外
 * 资金要求，避免把“不参与”误解为“事件不存在”。
 */
export interface ReportedCorporateAction {
  type: "rights_issue";
  sourceId: string;
  exDate: string;
  recordDate: string;
  paymentStartDate: string | null;
  paymentEndDate: string | null;
  listingDate: string | null;
  /** 每 10 股可配股数。 */
  ratioPer10: number;
  /** 配股认购价（元/股）。 */
  subscriptionPrice: number;
}

export interface BacktestRequest {
  symbols: string[];
  startDate: string;
  endDate: string;
  monthlyAmount: number;
  buyDay: number;
  /** 执行本请求所使用的金融计算口径；产品入口会补齐当前版本。 */
  caliberVersion?: string;
  /** 快捷区间；固定日期请求不填写。 */
  rangeYears?: 3 | 5 | 10 | 15;
  /**
   * 分红到账处理口径。
   * - `ex_date`（默认）：除权日记入现金并立即回购；
   * - `payment_date`：实际到账日记入现金并立即回购。
   */
  dividendTiming?: "ex_date" | "payment_date";
}

export interface BacktestTransaction {
  date: string;
  type:
    | "contribution"
    | "buy"
    | "dividend"
    | "dividend_reinvest"
    | "share_adjustment";
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  cashAfter: number;
  /** 每 10 股送转比例，仅 share_adjustment 事件使用 */
  shareRatio?: number;
}

export interface EquityPoint {
  date: string;
  asset: number;
  contribution: number;
  /** 账户资产相对累计外部投入的收益率，由领域层计算。 */
  returnRate: number;
  /** 标的总收益净值相对历史峰值的回撤，由领域层计算。 */
  drawdown: number;
  /**
   * 标的总收益净值（剔除外部投入），用于计算可比最大回撤。
   * 用于计算策略最大回撤，避免外部每月投入抬高净值掩盖真实跌幅。
   */
  nav?: number;
}

export interface BacktestMetrics {
  totalContribution: number;
  endingAsset: number;
  totalPnl: number;
  xirr: number | null;
  maxDrawdown: number;
  /** 最大回撤幅度对应的历史峰值日期。 */
  maxDrawdownPeakDate: string;
  /** 最大回撤幅度对应的历史谷值日期。 */
  maxDrawdownTroughDate: string;
  /** 全部回撤周期中持续时间最长的一次，按自然日折算为月。 */
  longestDrawdownMonths: number;
  longestDrawdownStart: string;
  longestDrawdownEnd: string;
  /** 最长回撤周期是否已重新达到其起始峰值。 */
  longestDrawdownRecovered: boolean;
  totalDividend: number;
  endingCash: number;
}

export interface BacktestResult {
  id: string;
  experimentId: string;
  symbol: string;
  name: string;
  requestedStartDate: string;
  requestedEndDate?: string;
  actualStartDate: string;
  actualEndDate: string;
  monthlyAmount: number;
  buyDay: number;
  rangeYears?: 3 | 5 | 10 | 15;
  dividendTiming?: "ex_date" | "payment_date";
  /** 标的和参数的稳定识别键；只用于索引，不作为唯一约束。 */
  strategyKey: string;
  metrics: BacktestMetrics;
  transactions: BacktestTransaction[];
  equityCurve: EquityPoint[];
  /** 回测使用的不复权收盘价快照，用于审计明细与结果复现。 */
  priceSeries: PricePoint[];
  /** 快速走势浏览使用的前复权真实 OHLCV，不作为严格回测证据。 */
  chartData: Exclude<ChartDataState, { status: "loading" }>;
  warnings: string[];
  provenance: DataProvenance[];
  createdAt: string;
}

/**
 * R1 回测审计明细行（modal 展示视图）。
 *
 * 主结果与明细共用同一套计算口径：费用为 0、允许零碎股、现金分红自动回购，
 * 送股/转增按每 10 股比例增加持股。
 */
export interface SimpleBacktestRow {
  date: string;
  /**
   * 事件类型：
   * - `buy`：定投买入；
   * - `dividend`：现金分红到账；
   * - `dividend_reinvest`：分红回购原标的；
   * - `share_adjustment`：送股/转增入账。
   */
  event: "buy" | "dividend" | "dividend_reinvest" | "share_adjustment";
  /** 本事件发生前的现金 */
  openingCash: number;
  /** 当日不复权收盘价 */
  price: number;
  /** 本事件新增股数 */
  shares: number;
  /** 累计总股票数量 */
  cumulativeShares: number;
  /** 本期外部投入，仅定投买入行大于 0 */
  externalContribution: number;
  /** 累计外部投入 */
  cumulativeContribution: number;
  /** 本事件成交金额，仅买入和分红回购行大于 0 */
  tradeAmount: number;
  /** 从回测开始到当前事件的全部买入成交金额 */
  cumulativeInvestment: number;
  /** 从回测开始到当前事件的累计现金分红 */
  cumulativeDividend: number;
  /** 期末现金余额 */
  endingCash: number;
  /** 当前盈亏率 = (价格 × 累计股数 + 期末现金) / 累计外部投入 - 1 */
  returnRate: number;
  /** 每股分红（仅 dividend 行） */
  dividendPerShare?: number;
  /** 当次分红金额（仅 dividend 行） */
  dividendAmount?: number;
  /** 每 10 股送转比例（仅 share_adjustment 行） */
  shareRatio?: number;
}

/** 简化回测结果 */
export interface SimpleBacktestResult {
  symbol: string;
  name: string;
  requestedStartDate: string;
  actualStartDate: string;
  actualEndDate: string;
  monthlyAmount: number;
  buyDay: number;
  rows: SimpleBacktestRow[];
  /** 期末累计股数 */
  endingShares: number;
  /** 期末累计外部投入 */
  endingCost: number;
  /** 期末累计买入成交金额（含分红回购） */
  endingInvestment: number;
  /** 期末持仓市值 */
  endingMarketValue: number;
  /** 期末现金 */
  endingCash: number;
  /** 累计分红金额 */
  totalDividendAmount: number;
  /** 当前盈亏率 = (期末市值 + 期末现金) / 累计外部投入 - 1 */
  returnRate: number;
  warnings: string[];
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

export interface StockInfo {
  symbol: string;
  name: string;
}

export type BacktestChartMetric = "kline" | "return" | "drawdown";
export type BacktestCandlePeriod = "day" | "week" | "month";
export type BacktestExperimentStatus = "completed";

export interface BacktestExperimentSummary {
  experimentId: string;
  createdAt: string;
  request: BacktestRequest;
  dataCutoff: string;
  caliberVersion: string;
  status: BacktestExperimentStatus;
  resultCount: number;
  bestXirr: number | null;
  maxDrawdown: number;
}

export interface BacktestExperiment
  extends Omit<
    BacktestExperimentSummary,
    "resultCount" | "bestXirr" | "maxDrawdown"
  > {
  results: BacktestResult[];
}

export interface BacktestWorkspaceState {
  request: BacktestRequest;
  chartMetric: BacktestChartMetric;
  candlePeriod: BacktestCandlePeriod;
  chartSymbol: string;
  activeExperimentId?: string;
  updatedAt: string;
}

export interface DesktopApi {
  health(): Promise<HealthResponse>;
  listStocks(): Promise<StockInfo[]>;
  runBacktest(request: BacktestRequest): Promise<BacktestExperiment>;
  listBacktestExperiments(): Promise<BacktestExperimentSummary[]>;
  getBacktestExperiment(experimentId: string): Promise<BacktestExperiment>;
  deleteBacktestExperiment(experimentId: string): Promise<void>;
  getBacktestDetail(backtestId: string): Promise<SimpleBacktestResult>;
  getBacktestWorkspace(): Promise<BacktestWorkspaceState | null>;
  saveBacktestWorkspace(state: BacktestWorkspaceState): Promise<void>;
  exportBacktestExperiment(experimentId: string): Promise<ExportResult>;
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
