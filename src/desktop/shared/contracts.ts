export type EntryType =
  | "buy"
  | "sell"
  | "dividend"
  | "adjustment";

export interface DataProvenance {
  source: string;
  primarySource?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  dataCutoff: string;
  adjustment: "none" | "qfq";
  caliberVersion: string;
}

export interface MarketDataProvenance {
  source: "tencent" | "sina";
  primarySource: "tencent";
  fallbackUsed: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  /** 本次响应最后一个正式交易日；合法空区间为 null。 */
  dataCutoff: string | null;
  adjustment: "none" | "qfq";
  /** 空结果只有获得独立证据后才允许持久化。 */
  emptyEvidence?: "exchange_calendar" | "outside_listing";
}

export type MarketTailStatus =
  | "complete"
  | "confirmed_non_trading"
  | "incomplete";

/**
 * 行情数据行级或区间级问题。severity 决定是否阻断严格回测：
 * - `error`：请求范围内存在该级别问题时必须停止回测；
 * - `warning`：可降级使用，但必须写入结果 warnings。
 */
export interface MarketDataIssue {
  /** 问题涉及的交易日；无法确定时省略。 */
  date?: string;
  /**
   * 区间问题的结束日（含）；单日问题时省略。
   * 与 date 配合表示 [date, endDate] 区间，用于两源共同缺口降级时
   * 计算交集，而非只检查起始日。
   */
  endDate?: string;
  /**
   * 该缺口覆盖的具体缺失日期集合（含 date 和 endDate）。
   * detectDateCompletenessIssues 合并连续缺口时填充，
   * 用于两源共同缺口降级时精确计算交集，避免只检查起始日导致误判。
   */
  missingDates?: string[];
  /**
   * 结构化分类，用于业务状态判断不依赖中文文案。
   * - `cross_provider_common_gap`：两源共同缺口降级为 warning；
   * - `single_provider_gap`：仅单源缺口的 error；
   * - `head_truncation`：头部截断；
   * - `tail_incomplete`：尾部不完整。
   */
  classification?:
    | "cross_provider_common_gap"
    | "single_provider_gap"
    | "head_truncation"
    | "tail_incomplete";
  type: "invalid_ohlcv" | "invalid_date" | "duplicate" | "gap";
  severity: "warning" | "error";
  message: string;
}

export interface MarketFetchResult<
  T,
  P extends MarketDataProvenance = MarketDataProvenance,
> {
  rows: T[];
  requestedThrough: string;
  dataCutoff: string | null;
  tailStatus: MarketTailStatus;
  issues: MarketDataIssue[];
  provenance: P;
  /** 请求区间内拥有正式日历的年份。 */
  officialCalendarYears?: number[];
  /** 请求区间内未覆盖正式日历的年份，回测须标记为降级。 */
  uncoveredCalendarYears?: number[];
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

interface BacktestMetrics {
  totalContribution: number;
  endingAsset: number;
  totalPnl: number;
  xirr: number | null;
  maxDrawdown: number;
  /**
   * 最大回撤幅度对应的历史峰值日期。
   * 仅在 maxDrawdown < 0 时有值；无回撤时为 null。
   */
  maxDrawdownPeakDate: string | null;
  /**
   * 最大回撤幅度对应的历史谷值日期。
   * 仅在 maxDrawdown < 0 时有值；无回撤时为 null。
   */
  maxDrawdownTroughDate: string | null;
  /** 全部回撤周期中持续时间最长的一次，按自然日折算为月。 */
  longestDrawdownMonths: number;
  /**
   * 最长回撤周期的起始日期。
   * 仅在发生过回撤时有值；无回撤时为 null。
   */
  longestDrawdownStart: string | null;
  /**
   * 最长回撤周期的结束日期。
   * 仅在发生过回撤时有值；无回撤时为 null。
   */
  longestDrawdownEnd: string | null;
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
  requestedEndDate: string;
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
  /**
   * 本次回测行情完整性检查使用过的证券级停复牌证据。
   *
   * 保存证据是为了让以后能复现为什么某些交易日没有价格——这些日期属于
   * "交易所开市但该证券停牌"，不应被误判为行情缺失。
   */
  interruptionsUsed: SecurityTradingInterruption[];
  /**
   * 行情数据质量状态（兼容字段，新代码应使用 dataQuality）：
   * - `strict`：所有交易日都有独立停牌证据或完整行情，严格回测完成；
   * - `degraded_common_gap`：存在两源共同缺口且缺少独立停牌证据，
   *   按降级数据继续计算。不能等同于严格回测完成。
   */
  dataQualityStatus: "strict" | "degraded_common_gap";
  /**
   * 结构化数据质量模型，用于区分降级原因。
   * 旧数据可能没有此字段，读取时通过 dataQualityStatus 和 warnings 推断。
   */
  dataQuality?: BacktestDataQuality;
  createdAt: string;
}

/**
 * 回测数据质量模型。
 *
 * 将"回测能否继续计算"和"数据是否得到严格完整性证明"分开：
 * - `strict`：所有年份都有正式交易日历覆盖且无两源共同缺口；
 * - `degraded`：存在未覆盖日历年份或两源共同缺口，回测仍可继续
 *   但不能等同于严格结果。
 */
export interface BacktestDataQuality {
  level: "strict" | "degraded";
  reasons: Array<"cross_provider_common_gap" | "calendar_coverage_missing">;
  officialCalendarYears: number[];
  uncoveredCalendarYears: number[];
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
  securityType?: SecurityType;
  instrumentName?: string;
  amount?: number;
  symbol?: string;
  price?: number;
  quantity?: number;
  fee?: number;
  perShare?: number;
  recordDate?: string;
  note?: string;
  reversesEntryId?: string;
  correctsEntryId?: string;
  /** 非财务关联，仅用于 UI 跳转和审计，不参与净投入/XIRR/收益归因 */
  originDividendEntryId?: string;
}

export interface LedgerEntry extends LedgerEntryInput {
  id: string;
  recordedAt: string;
  /** 修正操作发生时间；仅用于审计，不决定投资事实生效日期。 */
  correctedAt?: string;
  currency: "CNY";
  source: "user" | "system" | "restore";
}

type LiveDataStatus = "ready" | "empty" | "stale" | "partial";
export type SecurityType = "stock" | "etf";
export type PerformancePeriod =
  | "day"
  | "week"
  | "month"
  | "threeMonths"
  | "sixMonths"
  | "year";

export interface LiveDataQuality {
  status: LiveDataStatus;
  dataCutoff: string | null;
  updatedAt: string | null;
  issues: string[];
  missingSymbols: string[];
  missingDates: string[];
}

export type PeriodPerformance = Record<PerformancePeriod, number | null>;
export type XirrStatus =
  | "ready"
  | "short_sample"
  | "missing_valuation"
  | "insufficient_cashflows"
  | "no_solution";

export interface PositionView {
  symbol: string;
  name: string;
  securityType: SecurityType;
  quantity: number;
  cost: number;
  averageCost: number;
  lastPrice: number | null;
  marketValue: number | null;
  /** 持仓占组合市值的比例（0~1），无市值时为 null。 */
  weight: number | null;
  /** 当日盈亏（近似）：基于 periodPerformance.day 反推，无数据时为 null。 */
  dayPnl: number | null;
  cumulativeBuySpend: number;
  cumulativeSellNetIncome: number;
  netInvestment: number;
  unrealizedPnl: number | null;
  realizedPnl: number;
  cumulativeDividend: number;
  totalReturn: number | null;
  xirr: number | null;
  xirrStatus: XirrStatus;
  periodPerformance: PeriodPerformance;
  recentEntries: LedgerRecordView[];
}

export interface PositionsOverview {
  quality: LiveDataQuality;
  hasLedgerEntries: boolean;
  metrics: {
    marketValue: number | null;
    cumulativeBuySpend: number;
    cumulativeSellNetIncome: number;
    netInvestment: number;
    unrealizedPnl: number | null;
    realizedPnl: number;
    cumulativeDividend: number;
    totalReturn: number | null;
    xirr: number | null;
    xirrStatus: XirrStatus;
  };
  portfolioPerformance: PeriodPerformance;
  positions: PositionView[];
  valuationSource: string;
  provenance: MarketDataProvenance[];
}

export interface MarketRefreshResult {
  overview: PositionsOverview;
  requestedCutoff: string | null;
  actualCutoff: string | null;
  tailStatus: MarketTailStatus;
  issues: string[];
}

export interface LedgerQuery {
  startDate?: string;
  endDate?: string;
  entryTypes?: EntryType[];
  securityType?: SecurityType;
  symbol?: string;
  keyword?: string;
  page: number;
  pageSize: 20 | 50 | 100;
}

export interface LedgerRecordView {
  id: string;
  businessDate: string;
  type: EntryType;
  symbol: string | null;
  name: string | null;
  securityType: SecurityType | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fee: number;
  note: string | null;
  perShare: number | null;
  recordDate: string | null;
  recordedAt: string;
  correctedAt: string | null;
  linkedRecords: Array<{
    id: string;
    type: "buy" | "dividend";
    businessDate: string;
  }>;
  isReversed: boolean;
  reversesEntryId: string | null;
  correctsEntryId: string | null;
}

export interface LedgerImpactState {
  holdingQuantity: number;
  holdingCost: number;
  cumulativeBuySpend: number;
  cumulativeSellNetIncome: number;
  cumulativeDividend: number;
  netInvestment: number;
}

export interface LedgerImpactPreview {
  normalizedInput: LedgerEntryInput;
  symbol: string | null;
  tradeAmount: number;
  before: LedgerImpactState;
  after: LedgerImpactState;
  warnings: string[];
}

export interface LedgerQueryResult {
  quality: LiveDataQuality;
  integrityError: string | null;
  metrics: {
    /** 当前筛选范围内可见的全部记录条数，含已冲正与审计事件。 */
    recordCount: number;
    /** 当前有效业务流水条数（不含 adjustment 与已冲正记录）。 */
    effectiveCount: number;
    /** 已冲正流水条数。 */
    reversedCount: number;
    cumulativeBuySpend: number;
    cumulativeSellNetIncome: number;
    cumulativeDividend: number;
    netInvestment: number;
  };
  rows: LedgerRecordView[];
  total: number;
  page: number;
  pageSize: 20 | 50 | 100;
  symbolOptions: Array<{
    symbol: string;
    name: string;
    securityType: SecurityType;
  }>;
}

export type IncomeCalendarScope = "all" | "current";

export interface IncomeCalendarQuery {
  month: string;
  scope: IncomeCalendarScope;
  symbol?: string;
}

export interface IncomeContribution {
  symbol: string;
  name: string;
  holdingChange: number;
  marketPricePnl: number | null;
  dividendPnl: number;
  /** 成交价与当日估值价之差及手续费；费用、不利成交为负。 */
  tradingCostPnl: number;
  totalPnl: number | null;
}

interface IncomeCalendarEvent {
  type: EntryType;
  symbol: string | null;
  name: string | null;
  quantity: number | null;
  perShare: number | null;
  amount: number | null;
  note: string | null;
}

export interface IncomeCalendarDay {
  date: string;
  totalPnl: number | null;
  marketPricePnl: number | null;
  dividendPnl: number;
  tradingCostPnl: number;
  returnRate: number | null;
  hasMarketData: boolean;
  isPartial: boolean;
  contributions: IncomeContribution[];
  events: IncomeCalendarEvent[];
}

interface IncomeMetric {
  amount: number | null;
  rate: number | null;
}

export interface IncomeCalendarView {
  quality: LiveDataQuality;
  provenance: MarketDataProvenance[];
  valuationSource: string;
  month: string;
  scope: IncomeCalendarScope;
  symbol: string | null;
  scopeLabel: string;
  metrics: {
    month: IncomeMetric;
    marketPrice: IncomeMetric;
    dividend: IncomeMetric;
    tradingCost: IncomeMetric;
    cumulative: IncomeMetric;
    yearToDate: IncomeMetric;
  };
  days: IncomeCalendarDay[];
  symbolOptions: Array<{
    symbol: string;
    name: string;
    isCurrent: boolean;
  }>;
}

export interface AppSettings {
  priceSource: "tencent_sina";
  dividendSource: "eastmoney";
  commissionRate: number;
  minimumCommission: number;
  caliberVersion: string;
}

export type PendingDividendStatus = "pending" | "confirmed" | "ignored";

export interface PendingDividend {
  id: string;
  symbol: string;
  instrumentName: string;
  securityType: SecurityType;
  /** 除权除息日（公司行动事件日） */
  exDate: string;
  /** 股权登记日 */
  recordDate: string;
  /** 实际到账日（可为空，部分分红尚未公告到账日） */
  paymentDate: string | null;
  /** 每股税前现金分红（元/股） */
  perShare: number;
  /** 登记日有效持股数量 */
  holdingQuantity: number;
  /** 预计分红金额 = holdingQuantity * perShare */
  expectedAmount: number;
  status: PendingDividendStatus;
  discoveredAt: string;
  /** 用户确认的实际到账金额（确认时填写） */
  confirmedAmount?: number;
  /** 确认后创建的 ledger entry ID */
  linkedEntryId?: string;
  /** 数据来源 */
  source: "corporate_action";
  note?: string;
}

export interface PendingDividendDiscoveryIssue {
  symbol: string;
  message: string;
}

export interface PendingDividendDiscoveryResult {
  /** 本次新写入的候选数量 */
  discovered: number;
  /** 已检查的标的数量（含成功与失败） */
  checked: number;
  /** 跳过的标的数量（如无持仓或已存在候选项） */
  skipped: number;
  /** 查询失败的标的数量 */
  failed: number;
  /** 失败标的的具体错误信息 */
  issues: PendingDividendDiscoveryIssue[];
  /** 全部待确认候选（含历史遗留 + 本次新增）的数量 */
  total: number;
  /** 本次新写入的候选项 */
  candidates: PendingDividend[];
}

export interface ConfirmPendingDividendInput {
  /** 用户确认的实际到账金额；不填时使用 expectedAmount */
  actualAmount?: number;
  /**
   * 用户确认的实际到账日期。
   * - 当 pending.paymentDate 已存在时，可省略，使用 paymentDate；
   * - 当 pending.paymentDate 为空时，必须由用户填写，不能默认用 exDate 代替。
   */
  actualPaymentDate?: string;
}

/**
 * 证券级停复牌证据。
 *
 * 与交易所级休市日历不同，这是单只证券的停牌/退市/未上市证据，
 * 用于完整性检查排除"交易所开市但该证券不交易"的合法缺口。
 *
 * 不要把停牌伪装成行情问题；这是独立维度的事实证据。
 */
export interface SecurityTradingInterruption {
  symbol: string;
  /** 停牌/不交易起始日（含） */
  startDate: string;
  /** 停牌/不交易结束日（含）；复牌日不在区间内 */
  endDate: string;
  reason: "suspension" | "delisted" | "not_yet_listed";
  /** 证据来源（如 "eastmoney_announcement"） */
  source: string;
  /** 来源公告或记录 ID */
  sourceId?: string;
  fetchedAt: string;
}

interface HealthResponse {
  status: "ok";
  version: string;
  storage: "sqlite";
}

interface ExportResult {
  cancelled: boolean;
  path?: string;
}

interface RestoreResult extends ExportResult {
  restored?: boolean;
  safetyBackupPath?: string;
}

export interface StockInfo {
  symbol: string;
  name: string;
  securityType: SecurityType;
  /**
   * 上市日期（YYYY-MM-DD）。
   * 仅在交易所目录接口返回该字段时填充；缺省时表示数据源未提供。
   * 用于行情完整性检查区分"新上市股票的预期前置缺口"与"接口截断"。
   */
  listingDate?: string;
}

export interface DirectoryProvenance {
  source: string;
  primarySource: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  fetchedAt: string;
}

export interface StoredStockInfo extends StockInfo, DirectoryProvenance {}

export interface MarketDataCacheEntry {
  symbol: string;
  prices: PricePoint[];
  dividends: DividendEvent[];
  provenance: MarketDataProvenance & { caliberVersion: string };
  requestedFrom?: string;
  requestedThrough?: string;
  /**
   * P1-3：标记本次覆盖的完整性状态。
   * - `partial`：请求范围内存在 error 级别行情问题，prices 仍保存但覆盖不确认完整，
   *   `missingLivePriceRanges` 会重新请求该区间。
   * 省略时由 `saveLiveMarketPriceSnapshots` 根据是否有价格推导为 `data` / `empty`。
   */
  resultStatus?: "data" | "empty" | "partial";
  /**
   * P2-1：partial 覆盖的 error 级别问题列表，持久化为 `issues_json`。
   * 用于解释 partial 原因、计算 `confirmedCoverageThrough`（首个错误日期前）和审计。
   */
  issues?: MarketDataIssue[];
}

export interface StoredMarketPrice {
  symbol: string;
  date: string;
  close: number;
  source: "tencent" | "sina";
  primarySource: "tencent";
  fallbackUsed: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  dataCutoff: string;
  adjustment: "none" | "qfq";
}

export interface StoredMarketCoverage {
  coverageId: number;
  symbol: string;
  requestedFrom: string;
  requestedThrough: string;
  source: "tencent" | "sina";
  primarySource: "tencent";
  fallbackUsed: boolean;
  fallbackReason?: string;
  fetchedAt: string;
  dataCutoff: string | null;
  adjustment: "none" | "qfq";
  emptyEvidence?: "exchange_calendar" | "outside_listing";
  /**
   * P1-3：`partial` 表示请求范围内存在 error 级别行情问题，
   * prices 已保存但覆盖不确认完整，`missingLivePriceRanges` 会重新请求。
   */
  resultStatus: "data" | "empty" | "partial";
  /**
   * P2-1：partial 覆盖的 error 级别问题列表（从 `issues_json` 反序列化）。
   * 用于解释 partial 原因和计算 `confirmedCoverageThrough`（首个错误日期前）。
   */
  issues?: MarketDataIssue[];
}

export interface BackupPayload {
  schemaVersion: number;
  schemaFingerprint: string;
  exportedAt: string;
  application: "stock-income-r1";
  ledgerEntries: LedgerEntry[];
  backtestExperiments: BacktestExperiment[];
  marketPrices: Array<{
    symbol: string;
    trade_date: string;
    close: number;
    source: string;
    primary_source: string;
    fallback_used: number;
    fallback_reason: string | null;
    fetched_at: string;
    data_cutoff: string;
    adjustment: "none" | "qfq";
  }>;
  liveMarketPrices: Array<{
    symbol: string;
    trade_date: string;
    close: number;
    source: string;
    primary_source: string;
    fallback_used: number;
    fallback_reason: string | null;
    fetched_at: string;
    data_cutoff: string;
    adjustment: "none" | "qfq";
    coverage_id: number;
  }>;
  liveMarketCoverage: Array<{
    coverage_id: number;
    symbol: string;
    requested_from: string;
    requested_through: string;
    source: "tencent" | "sina";
    primary_source: "tencent";
    fallback_used: number;
    fallback_reason: string | null;
    fetched_at: string;
    data_cutoff: string | null;
    adjustment: "none" | "qfq";
    empty_evidence: "exchange_calendar" | "outside_listing" | null;
    result_status: "data" | "empty" | "partial";
    /** P2-1：partial 覆盖的 error 级别问题 JSON；非 partial 时为 null。 */
    issues_json: string | null;
  }>;
  corporateActions: Array<{
    symbol: string;
    event_date: string;
    payload_json: string;
  }>;
  settings: AppSettings;
  stockUniverse: StoredStockInfo[];
  backtestWorkspace: BacktestWorkspaceState | null;
  pendingDividends: PendingDividend[];
  /** P1：证券级停复牌证据（手工录入或外部数据源导入）。 */
  tradingInterruptions: SecurityTradingInterruption[];
}

/**
 * Branded type：只有 `domain/backupValidation.ts` 的 `validateBackup()`
 * 能产生此类型。`storage/database.ts` 的 `restoreBackup()` 只接受此类型，
 * 使得 TypeScript 在编译期阻止未校验的 `BackupPayload` 或 `unknown`
 * 直接传入破坏性恢复。运行时无额外开销——brand 是编译期 phantom 字段。
 */
declare const __validatedBackup: unique symbol;
export type ValidatedBackupPayload = BackupPayload & {
  readonly [__validatedBackup]: true;
};

export interface MarketCalendarDiagnostic {
  year: number;
  status: "official" | "pending_official_schedule";
  source: string | null;
}

export interface AppDiagnostics {
  schemaVersion: number;
  stockDirectory: DirectoryProvenance | null;
  etfDirectory: DirectoryProvenance | null;
  marketCalendars: MarketCalendarDiagnostic[];
}

export type BacktestChartMetric = "kline" | "return" | "drawdown";
export type BacktestCandlePeriod = "day" | "week" | "month";
type BacktestExperimentStatus = "completed";

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
  /**
   * 实验中是否存在降级行情证据。
   * - `strict`：所有结果均为严格回测；
   * - `degraded_common_gap`：至少一个结果存在两源共同缺口降级。
   */
  dataQualityStatus: "strict" | "degraded_common_gap";
  /** 结构化数据质量模型，由所有标的结果汇总。 */
  dataQuality?: BacktestDataQuality;
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
  listAStocks(): Promise<StockInfo[]>;
  listEtfs(): Promise<StockInfo[]>;
  runBacktest(request: BacktestRequest): Promise<BacktestExperiment>;
  listBacktestExperiments(): Promise<BacktestExperimentSummary[]>;
  getBacktestExperiment(experimentId: string): Promise<BacktestExperiment>;
  deleteBacktestExperiment(experimentId: string): Promise<void>;
  getBacktestDetail(backtestId: string): Promise<SimpleBacktestResult>;
  getBacktestWorkspace(): Promise<BacktestWorkspaceState | null>;
  saveBacktestWorkspace(state: BacktestWorkspaceState): Promise<void>;
  exportBacktestExperiment(experimentId: string): Promise<ExportResult>;
  getPositionsOverview(): Promise<PositionsOverview>;
  refreshPositionsMarket(): Promise<MarketRefreshResult>;
  exportPositions(): Promise<ExportResult>;
  queryLedger(query: LedgerQuery): Promise<LedgerQueryResult>;
  exportLedger(query: LedgerQuery): Promise<ExportResult>;
  getIncomeCalendar(query: IncomeCalendarQuery): Promise<IncomeCalendarView>;
  exportIncomeCalendar(query: IncomeCalendarQuery): Promise<ExportResult>;
  previewLedger(
    input: LedgerEntryInput,
    replacingEntryId?: string,
  ): Promise<LedgerImpactPreview>;
  addLedger(input: LedgerEntryInput): Promise<LedgerEntry>;
  getLedgerRecord(entryId: string): Promise<LedgerRecordView>;
  correctLedger(
    entryId: string,
    input: LedgerEntryInput,
  ): Promise<LedgerEntry>;
  reverseLedger(entryId: string, reason: string): Promise<LedgerEntry>;
  getSettings(): Promise<AppSettings>;
  getDiagnostics(): Promise<AppDiagnostics>;
  exportBackup(): Promise<ExportResult>;
  restoreBackup(): Promise<RestoreResult>;
  exportLogs(): Promise<ExportResult>;
  discoverPendingDividends(): Promise<PendingDividendDiscoveryResult>;
  listPendingDividends(): Promise<PendingDividend[]>;
  confirmPendingDividend(
    id: string,
    input: ConfirmPendingDividendInput,
  ): Promise<LedgerEntry>;
  ignorePendingDividend(id: string): Promise<void>;
  /** P1：列出全部证券级停复牌证据，可选按 symbol 过滤。 */
  listTradingInterruptions(symbol?: string): Promise<SecurityTradingInterruption[]>;
  /** P1：手工录入停复牌证据（如公告披露的临时停牌）。 */
  addTradingInterruption(
    input: Omit<SecurityTradingInterruption, "fetchedAt"> & {
      fetchedAt?: string;
    },
  ): Promise<SecurityTradingInterruption>;
  /** P1：删除停复牌证据（用于纠正错误录入）。 */
  deleteTradingInterruption(input: {
    symbol: string;
    startDate: string;
    endDate: string;
    reason: SecurityTradingInterruption["reason"];
  }): Promise<void>;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
