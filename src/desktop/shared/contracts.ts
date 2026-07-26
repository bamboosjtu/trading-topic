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
  /**
   * 分红到账处理口径。
   * - `ex_date`（默认，研究兼容模式）：除权日立即派息并再投资，对齐 research/bank-dca v1。
   * - `payment_date`（真实交易模式，R2 完整支持）：实际到账日后才能使用现金。
   */
  dividendTiming?: "ex_date" | "payment_date";
  /**
   * 国债逆回购年化利率（小数，如 0.015 表示 1.5%）。
   * 默认 0 表示不计息。大于 0 时，闲置现金（定投待用 + 分红待再投资）按
   * 实际日历天数计息，对齐 research verification 的 repo_assumption
   * "前一交易日 204001 定盘利率按实际日历天数计息至下一交易日"。
   * R1 用固定保守值；R2 接入历史 204001 定盘利率。
   */
  repoRate?: number;
}

export interface BacktestTransaction {
  date: string;
  type:
    | "contribution"
    | "buy"
    | "dividend"
    | "dividend_reinvest"
    | "repo_interest";
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
  /**
   * 标的总收益净值（剔除外部投入），对齐 research build_total_return_history。
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
  totalDividend: number;
  endingCash: number;
  /** 闲置现金参与国债逆回购产生的累计利息（repoRate=0 时为 0） */
  totalRepoInterest: number;
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

/**
 * 回测明细列表行（同条件比较视图）。
 *
 * 采用零碎股（2 位小数）+ 分红再投资模型，消除 100 股整数倍离散误差，
 * 便于与研究端同条件对比。不复权价格 + 显式分红再投资在数学上等价于
 * 后复权总收益口径：持仓市值变化已包含分红再投资产生的股数增长，
 * 收益率 = 期末市值 / 累计投入 - 1。
 */
export interface BacktestDetailRow {
  date: string;
  /** 事件类型：monthly_buy=月度定投买入，dividend_reinvest=分红再投资买入 */
  event: "monthly_buy" | "dividend_reinvest";
  /** 当次买入股数（零碎股，保留 2 位小数） */
  shares: number;
  /** 累计股数（含定投买入与分红再投资） */
  cumulativeShares: number;
  /** 当日不复权收盘价 */
  price: number;
  /** 当次投入金额（monthly_buy 为月度金额，dividend_reinvest 为 0） */
  amount: number;
  /** 累计投入：回测开始至该日期的外部成本（仅月度定投累加，分红再投资不计入） */
  cumulativeCost: number;
  /** 累计分红再投资股数 */
  cumulativeDividendShares: number;
  /** 当日持仓市值 = 累计股数 * 价格 */
  marketValue: number;
  /** 累计盈亏 = 持仓市值 - 累计投入 */
  cumulativePnl: number;
  /** 当次每股分红（仅 dividend_reinvest 行，税前） */
  dividendPerShare?: number;
  /** 当次分红金额（仅 dividend_reinvest 行） */
  dividendAmount?: number;
}

/** 回测明细列表结果（同条件比较） */
export interface BacktestDetailResult {
  symbol: string;
  name: string;
  requestedStartDate: string;
  actualStartDate: string;
  actualEndDate: string;
  monthlyAmount: number;
  buyDay: number;
  rows: BacktestDetailRow[];
  /** 期末累计股数 */
  endingShares: number;
  /** 期末累计投入 */
  endingCost: number;
  /** 期末持仓市值 */
  endingMarketValue: number;
  /** 期末累计盈亏 */
  endingPnl: number;
  /** 累计分红再投资股数 */
  totalDividendShares: number;
  /** 累计分红金额 */
  totalDividendAmount: number;
  /** 累计收益率 = endingMarketValue / endingCost - 1 */
  totalReturn: number;
  warnings: string[];
}

/**
 * 简化交易成本回测明细行（drawer 展示视图）。
 *
 * 交易费用统一按 0 计算；contribution（资金投入）与 buy（股票买入）合并为一行；
 * 分红到账与除权调整各自独立行。零碎股（2 位小数），分红以现金到账不再投资。
 */
export interface SimpleBacktestRow {
  date: string;
  /**
   * 事件类型：
   * - `buy`：定投买入（contribution + buy 合并）
   * - `dividend`：分红到账（增加现金，不再投资）
   * - `ex_right`：除权调整（信息行，记录价格变化，不改股数/现金）
   */
  event: "buy" | "dividend" | "ex_right";
  /** 期初现金 = 上期期末现金 + 本期投入（仅 buy 行有投入） */
  openingCash: number;
  /** 当日不复权收盘价 */
  price: number;
  /** 本期买入股数（buy 行，零碎股 2 位小数） */
  shares: number;
  /** 累计总股票数量 */
  cumulativeShares: number;
  /** 累计总投入金额 */
  cumulativeCost: number;
  /** 期末现金余额 */
  endingCash: number;
  /** 当前盈亏率 = (价格 × 累计股数 + 期末现金) / 累计投入 - 1 */
  returnRate: number;
  /** 当次投入金额（buy 行）或分红金额（dividend 行） */
  amount: number;
  /** 每股分红（仅 dividend 行） */
  dividendPerShare?: number;
  /** 除权前价格（仅 ex_right 行） */
  prevClose?: number;
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
  /** 期末累计投入 */
  endingCost: number;
  /** 期末持仓市值 */
  endingMarketValue: number;
  /** 期末现金 */
  endingCash: number;
  /** 累计分红金额 */
  totalDividendAmount: number;
  /** 当前盈亏率 = (期末市值 + 期末现金) / 累计投入 - 1 */
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

export interface DesktopApi {
  health(): Promise<HealthResponse>;
  runBacktest(request: BacktestRequest): Promise<BacktestResult[]>;
  listBacktests(): Promise<BacktestResult[]>;
  runSimpleBacktest(request: BacktestRequest): Promise<SimpleBacktestResult[]>;
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
