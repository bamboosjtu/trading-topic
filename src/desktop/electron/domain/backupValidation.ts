import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import type {
  AdjustedBar,
  BacktestExperiment,
  BacktestResult,
  BacktestWorkspaceState,
  BackupPayload,
  DividendEvent,
  LedgerEntry,
  ValidatedBackupPayload,
} from "../../shared/contracts";
import { assertBacktestRequest } from "./analysis";
import { validDate } from "./dateUtils";
import { reduceLedger } from "./ledgerReducer";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function validTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function assertUnique(
  values: readonly string[],
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`备份包含重复的${label}`);
  }
}

function assertLedgerGraph(entries: readonly LedgerEntry[]): void {
  assertUnique(entries.map((entry) => entry.id), "流水 ID");
  const ids = new Set(entries.map((entry) => entry.id));
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const reversedTargets = new Set<string>();
  const correctedTargets = new Set<string>();
  // 预计算所有冲正流水指向的原流水 ID，避免后续对每个 correctsEntryId
  // 都遍历整个 entries 数组（原实现为 O(N²)）。
  const reversedTargetIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "adjustment" && entry.reversesEntryId) {
      reversedTargetIds.add(entry.reversesEntryId);
    }
  }
  for (const entry of entries) {
    if (
      !nonEmptyString(entry.id) ||
      !validDate(entry.businessDate) ||
      !validTimestamp(entry.recordedAt) ||
      (entry.correctedAt !== undefined &&
        !validTimestamp(entry.correctedAt)) ||
      entry.currency !== "CNY" ||
      !["user", "system", "restore"].includes(entry.source)
    ) {
      throw new Error("备份包含非法流水 ID、日期或审计字段");
    }
    if (
      entry.type !== "adjustment" &&
      (!entry.symbol ||
        !/^\d{6}$/.test(entry.symbol) ||
        !["stock", "etf"].includes(entry.securityType ?? ""))
    ) {
      throw new Error("备份包含不属于当前 R1 schema 的投资事实");
    }
    if (entry.type === "buy" || entry.type === "sell") {
      if (
        !positive(entry.price) ||
        !positive(entry.quantity) ||
        !Number.isInteger(entry.quantity) ||
        !finite(entry.fee ?? 0) ||
        (entry.fee ?? 0) < 0 ||
        entry.amount !== undefined ||
        entry.perShare !== undefined ||
        entry.recordDate !== undefined ||
        entry.reversesEntryId !== undefined
      ) {
        throw new Error(
          "备份买卖流水的价格、数量或费用非法，或包含不允许的专属字段",
        );
      }
    } else if (entry.type === "dividend") {
      if (
        !positive(entry.amount) ||
        entry.price !== undefined ||
        entry.quantity !== undefined ||
        entry.fee !== undefined ||
        entry.reversesEntryId !== undefined ||
        (entry.perShare !== undefined &&
          (!finite(entry.perShare) || entry.perShare < 0)) ||
        (entry.recordDate !== undefined &&
          (!validDate(entry.recordDate) ||
            entry.recordDate > entry.businessDate))
      ) {
        throw new Error("备份分红流水的金额或日期非法");
      }
    } else if (entry.type === "adjustment") {
      if (
        !entry.reversesEntryId ||
        entry.reversesEntryId === entry.id ||
        !ids.has(entry.reversesEntryId) ||
        entriesById.get(entry.reversesEntryId)?.type === "adjustment"
      ) {
        throw new Error("备份冲正流水引用了不存在或非法的原流水");
      }
      if (reversedTargets.has(entry.reversesEntryId)) {
        throw new Error("备份对同一流水执行了重复冲正");
      }
      reversedTargets.add(entry.reversesEntryId);
    } else {
      throw new Error("备份包含不属于当前 R1 schema 的投资事实");
    }
    if (
      entry.correctsEntryId &&
      (entry.correctsEntryId === entry.id ||
        !ids.has(entry.correctsEntryId) ||
        entry.type === "adjustment" ||
        entriesById.get(entry.correctsEntryId)?.type === "adjustment")
    ) {
      throw new Error("备份修正流水引用了不存在或非法的原流水");
    }
    if (entry.correctsEntryId) {
      if (correctedTargets.has(entry.correctsEntryId)) {
        throw new Error("备份对同一原流水包含多个修正版本");
      }
      correctedTargets.add(entry.correctsEntryId);
      const target = entriesById.get(entry.correctsEntryId)!;
      if (entry.linkedGroupId !== target.linkedGroupId) {
        throw new Error("备份修正流水的关联关系与原事实不一致");
      }
    }
  }
  for (const entry of entries) {
    if (
      entry.correctsEntryId &&
      !reversedTargetIds.has(entry.correctsEntryId)
    ) {
      throw new Error("备份修正流水缺少对应的冲正事实");
    }
  }
  // 同时执行卖空、有效事实图和分红再投入组级约束。
  reduceLedger(entries, "9999-12-31");
}

function assertFiniteRecord(
  value: unknown,
  label: string,
  allowNull = false,
): void {
  if (allowNull && value === null) return;
  if (!finite(value)) throw new Error(`备份回测${label}必须是有限数字`);
}

function assertBacktestResult(
  result: BacktestResult,
  experiment: BacktestExperiment,
): void {
  if (
    !isObject(result) ||
    !nonEmptyString(result.id) ||
    result.experimentId !== experiment.experimentId ||
    !experiment.request.symbols.includes(result.symbol) ||
    !nonEmptyString(result.name) ||
    !nonEmptyString(result.strategyKey) ||
    !validTimestamp(result.createdAt)
  ) {
    throw new Error("备份回测结果的身份或实验引用非法");
  }
  const requestedEnd = result.requestedEndDate;
  if (
    !validDate(result.requestedStartDate) ||
    !validDate(requestedEnd) ||
    !validDate(result.actualStartDate) ||
    !validDate(result.actualEndDate) ||
    result.requestedStartDate > result.actualStartDate ||
    result.actualStartDate > result.actualEndDate ||
    result.actualEndDate > requestedEnd ||
    result.monthlyAmount !== experiment.request.monthlyAmount ||
    result.buyDay !== experiment.request.buyDay
  ) {
    throw new Error("备份回测结果的区间或请求参数非法");
  }
  const metric = result.metrics;
  if (!isObject(metric)) throw new Error("备份回测指标结构非法");
  for (const key of [
    "totalContribution",
    "endingAsset",
    "totalPnl",
    "maxDrawdown",
    "longestDrawdownMonths",
    "totalDividend",
    "endingCash",
  ] as const) {
    assertFiniteRecord(metric[key], `指标 ${key}`);
  }
  assertFiniteRecord(metric.xirr, "指标 xirr", true);
  // P1-2：回撤日期字段按指标状态进行条件校验。
  // - maxDrawdown < 0：peakDate、troughDate 必须是合法日期
  // - maxDrawdown === 0：peakDate、troughDate 必须为 null
  // - 存在最长回撤阶段：start、end 必须是合法日期
  // - 不存在回撤阶段：start、end 必须为 null，recovered=true
  // 非空日期必须为合法日期字符串。此循环保证后续条件分支中非 null 值已是合法日期。
  for (const value of [
    metric.maxDrawdownPeakDate,
    metric.maxDrawdownTroughDate,
    metric.longestDrawdownStart,
    metric.longestDrawdownEnd,
  ]) {
    if (value !== null && !validDate(value)) {
      throw new Error("备份回测指标回撤日期非法");
    }
  }
  if (metric.maxDrawdown < 0) {
    if (
      metric.maxDrawdownPeakDate === null ||
      metric.maxDrawdownTroughDate === null
    ) {
      throw new Error("备份回测存在回撤但缺少峰谷日期");
    }
  } else if (metric.maxDrawdown === 0) {
    if (
      metric.maxDrawdownPeakDate !== null ||
      metric.maxDrawdownTroughDate !== null
    ) {
      throw new Error("备份回测无回撤但保留了峰谷日期");
    }
  } else {
    // maxDrawdown > 0 视为非法：领域定义中回撤始终 <= 0。
    throw new Error("备份回测 maxDrawdown 必须为非正数");
  }
  // P1-2：longestDrawdownStart 与 longestDrawdownEnd 必须同时为空或同时非空。
  const hasStart = metric.longestDrawdownStart !== null;
  const hasEnd = metric.longestDrawdownEnd !== null;
  if (hasStart !== hasEnd) {
    throw new Error("备份回测最长回撤起止日期必须同时为空或同时非空");
  }
  if (hasStart) {
    // 非空日期的合法性已由上方循环保证，此处无需再次调用 validDate。
  } else if (!metric.longestDrawdownRecovered) {
    // 不存在回撤阶段时，recovered 必须为 true（无回撤即无未恢复状态）。
    throw new Error("备份回测无回撤阶段但标记为未恢复");
  }
  if (typeof metric.longestDrawdownRecovered !== "boolean") {
    throw new Error("备份回测最长回撤恢复状态非法");
  }
  if (
    !Array.isArray(result.priceSeries) ||
    !Array.isArray(result.transactions) ||
    !Array.isArray(result.equityCurve) ||
    !Array.isArray(result.provenance) ||
    !Array.isArray(result.warnings) ||
    result.warnings.some((warning) => typeof warning !== "string")
  ) {
    throw new Error("备份回测结果明细结构非法");
  }
  let previousPriceDate = "";
  for (const row of result.priceSeries) {
    if (
      !isObject(row) ||
      !validDate(row.date) ||
      !positive(row.close) ||
      row.date < result.actualStartDate ||
      row.date > result.actualEndDate ||
      row.date <= previousPriceDate
    ) {
      throw new Error("备份回测价格序列非法");
    }
    previousPriceDate = row.date;
  }
  for (const row of result.transactions) {
    if (
      !isObject(row) ||
      !validDate(row.date) ||
      row.date < result.actualStartDate ||
      row.date > result.actualEndDate ||
      !["contribution", "buy", "dividend", "dividend_reinvest", "share_adjustment"].includes(
        row.type,
      ) ||
      [row.quantity, row.price, row.amount, row.fee, row.cashAfter].some(
        (value) => !finite(value),
      )
    ) {
      throw new Error("备份回测交易明细非法");
    }
  }
  for (const row of result.equityCurve) {
    if (
      !isObject(row) ||
      !validDate(row.date) ||
      row.date < result.actualStartDate ||
      row.date > result.actualEndDate ||
      [row.asset, row.contribution, row.returnRate, row.drawdown].some(
        (value) => !finite(value),
      ) ||
      (row.nav !== undefined && !finite(row.nav))
    ) {
      throw new Error("备份回测权益曲线非法");
    }
  }
  if (
    !isObject(result.chartData) ||
    !["ready", "unavailable", "error"].includes(result.chartData.status)
  ) {
    throw new Error("备份回测图表结构非法");
  }
  if (result.chartData.status === "ready") {
    let previousBarDate = "";
    for (const bar of result.chartData.data as AdjustedBar[]) {
      if (
        !isObject(bar) ||
        !validDate(bar.date) ||
        bar.date < result.requestedStartDate ||
        bar.date > requestedEnd ||
        bar.date <= previousBarDate ||
        bar.adjustment !== "qfq" ||
        !positive(bar.open) ||
        !positive(bar.high) ||
        !positive(bar.low) ||
        !positive(bar.close) ||
        !finite(bar.volume) ||
        bar.volume < 0 ||
        bar.high < Math.max(bar.open, bar.close) ||
        bar.low > Math.min(bar.open, bar.close)
      ) {
        throw new Error("备份回测 OHLCV 图表数据非法");
      }
      previousBarDate = bar.date;
    }
  } else {
    const text =
      result.chartData.status === "unavailable"
        ? result.chartData.reason
        : result.chartData.message;
    if (!nonEmptyString(text)) throw new Error("备份回测图表状态原因缺失");
  }
  for (const item of result.provenance) {
    if (
      !isObject(item) ||
      !nonEmptyString(item.source) ||
      !validTimestamp(item.fetchedAt) ||
      !validDate(item.dataCutoff) ||
      !["none", "qfq"].includes(item.adjustment) ||
      item.caliberVersion !== BACKTEST_CALIBER_VERSION
    ) {
      throw new Error("备份回测来源信息非法");
    }
  }
  // P2-3：核心财务恒等式校验，防止手工修改但结构合法的备份恢复出矛盾结果。
  // 1. totalPnl = endingAsset - totalContribution（允许 0.01 舍入误差）
  const expectedPnl =
    metric.endingAsset - metric.totalContribution;
  if (Math.abs(metric.totalPnl - expectedPnl) > 0.01) {
    throw new Error(
      `备份回测财务恒等式不成立：totalPnl(${metric.totalPnl}) ≠ endingAsset(${metric.endingAsset}) - totalContribution(${metric.totalContribution})`,
    );
  }
  // 2. actualEndDate 必须等于价格序列最后一个交易日（价格序列非空时）
  if (result.priceSeries.length) {
    const lastPriceDate = result.priceSeries[result.priceSeries.length - 1]!.date;
    if (lastPriceDate !== result.actualEndDate) {
      throw new Error(
        `备份回测 actualEndDate(${result.actualEndDate}) 与价格序列截止日(${lastPriceDate})不一致`,
      );
    }
  }
  // 3. endingAsset 必须等于权益曲线最后一个资产值（权益曲线非空时）
  if (result.equityCurve.length) {
    const lastEquity = result.equityCurve[result.equityCurve.length - 1]!;
    if (Math.abs(lastEquity.asset - metric.endingAsset) > 0.01) {
      throw new Error(
        `备份回测 endingAsset(${metric.endingAsset}) 与权益曲线期末资产(${lastEquity.asset})不一致`,
      );
    }
  }
}

function assertBacktestExperiments(
  experiments: readonly BacktestExperiment[],
): void {
  assertUnique(experiments.map((item) => item.experimentId), "回测试验 ID");
  const resultIds: string[] = [];
  for (const experiment of experiments) {
    if (
      !isObject(experiment) ||
      !nonEmptyString(experiment.experimentId) ||
      !validTimestamp(experiment.createdAt) ||
      !validDate(experiment.dataCutoff) ||
      experiment.caliberVersion !== BACKTEST_CALIBER_VERSION ||
      experiment.status !== "completed" ||
      !Array.isArray(experiment.results)
    ) {
      throw new Error("备份回测试验结构非法");
    }
    assertBacktestRequest(experiment.request);
    if (
      experiment.request.caliberVersion !== BACKTEST_CALIBER_VERSION
    ) {
      throw new Error("备份回测请求口径版本非法");
    }
    for (const result of experiment.results) {
      assertBacktestResult(result, experiment);
      // P2-3：dataCutoff 与回测证据一致——回测实际截止日不能晚于试验数据截止日。
      if (result.actualEndDate > experiment.dataCutoff) {
        throw new Error(
          `备份回测 actualEndDate(${result.actualEndDate}) 晚于试验 dataCutoff(${experiment.dataCutoff})`,
        );
      }
      resultIds.push(result.id);
    }
  }
  assertUnique(resultIds, "回测结果 ID");
}

function assertDirectory(backup: BackupPayload): void {
  assertUnique(
    backup.stockUniverse.map((stock) => stock.symbol),
    "证券目录代码",
  );
  for (const stock of backup.stockUniverse) {
    if (
      !/^\d{6}$/.test(stock.symbol) ||
      !nonEmptyString(stock.name) ||
      !["stock", "etf"].includes(stock.securityType) ||
      !nonEmptyString(stock.source) ||
      !nonEmptyString(stock.primarySource) ||
      typeof stock.fallbackUsed !== "boolean" ||
      !validTimestamp(stock.fetchedAt) ||
      (stock.fallbackUsed !== Boolean(stock.fallbackReason))
    ) {
      throw new Error("备份包含不属于当前 R1 schema 的证券目录");
    }
  }
}

type MarketRow = BackupPayload["marketPrices"][number];
type LiveMarketRow = BackupPayload["liveMarketPrices"][number];
type CoverageRow = BackupPayload["liveMarketCoverage"][number];

function assertMarketProvenance(
  row: MarketRow | LiveMarketRow | CoverageRow,
): void {
  if (
    !/^\d{6}$/.test(row.symbol) ||
    !["tencent", "sina"].includes(row.source) ||
    row.primary_source !== "tencent" ||
    ![0, 1].includes(row.fallback_used) ||
    row.fallback_used !== (row.source === "sina" ? 1 : 0) ||
    !["none", "qfq"].includes(row.adjustment) ||
    !validTimestamp(row.fetched_at) ||
    (row.fallback_used === 1) !== Boolean(row.fallback_reason)
  ) {
    throw new Error("备份包含非法行情来源或复权口径");
  }
}

function assertMarketSnapshots(backup: BackupPayload): void {
  const marketKeys: string[] = [];
  for (const row of backup.marketPrices) {
    assertMarketProvenance(row);
    if (
      !validDate(row.trade_date) ||
      !positive(row.close) ||
      !validDate(row.data_cutoff) ||
      row.trade_date > row.data_cutoff
    ) {
      throw new Error("备份包含非法历史行情快照");
    }
    marketKeys.push(`${row.symbol}|${row.trade_date}|${row.adjustment}`);
  }
  assertUnique(marketKeys, "历史行情主键");

  const liveKeys: string[] = [];
  for (const row of backup.liveMarketPrices) {
    assertMarketProvenance(row);
    if (
      !validDate(row.trade_date) ||
      !positive(row.close) ||
      !validDate(row.data_cutoff) ||
      row.trade_date > row.data_cutoff
    ) {
      throw new Error("备份包含非法实盘行情快照");
    }
    liveKeys.push(`${row.symbol}|${row.trade_date}|${row.adjustment}`);
  }
  assertUnique(liveKeys, "实盘行情主键");

  const coverageKeys: string[] = [];
  for (const row of backup.liveMarketCoverage) {
    assertMarketProvenance(row);
    const validRange =
      validDate(row.requested_from) &&
      validDate(row.requested_through) &&
      row.requested_from <= row.requested_through;
    if (
      !validRange ||
      !["data", "empty"].includes(row.result_status) ||
      (row.result_status === "empty" &&
        (!["exchange_calendar", "outside_listing"].includes(
          row.empty_evidence ?? "",
        ) ||
          row.data_cutoff !== null)) ||
      (row.result_status === "data" &&
        (row.empty_evidence !== null ||
          !row.data_cutoff ||
          !validDate(row.data_cutoff) ||
          row.data_cutoff < row.requested_from ||
          row.data_cutoff > row.requested_through))
    ) {
      throw new Error("备份包含非法行情覆盖记录");
    }
    const matching = backup.liveMarketPrices.filter(
      (price) =>
        price.symbol === row.symbol &&
        price.coverage_id === row.coverage_id &&
        price.adjustment === row.adjustment,
    );
    const actualCutoff =
      matching.map((price) => price.trade_date).sort().at(-1) ?? null;
    if (
      (row.result_status === "empty" && matching.length) ||
      (row.result_status === "data" &&
        (!matching.length || actualCutoff !== row.data_cutoff))
    ) {
      throw new Error("备份行情覆盖与价格行不一致");
    }
    coverageKeys.push(
      `${row.symbol}|${row.requested_from}|${row.requested_through}|${row.adjustment}`,
    );
  }
  assertUnique(coverageKeys, "行情覆盖主键");

  const actionKeys: string[] = [];
  for (const row of backup.corporateActions) {
    if (!/^\d{6}$/.test(row.symbol) || !validDate(row.event_date)) {
      throw new Error("备份公司行动身份或日期非法");
    }
    let event: DividendEvent;
    try {
      event = JSON.parse(row.payload_json) as DividendEvent;
    } catch {
      throw new Error("备份公司行动 JSON 无法解析");
    }
    if (
      !isObject(event) ||
      event.date !== row.event_date ||
      !validDate(event.recordDate) ||
      (event.paymentDate !== null && !validDate(event.paymentDate)) ||
      !finite(event.perShare) ||
      event.perShare < 0 ||
      !finite(event.transferRatio) ||
      event.transferRatio < 0 ||
      !finite(event.bonusRatio) ||
      event.bonusRatio < 0 ||
      !nonEmptyString(event.status)
    ) {
      throw new Error("备份公司行动结构非法");
    }
    actionKeys.push(`${row.symbol}|${row.event_date}`);
  }
  assertUnique(actionKeys, "公司行动主键");
}

function assertWorkspace(
  workspace: BacktestWorkspaceState | null,
  experiments: readonly BacktestExperiment[],
): void {
  if (workspace === null) return;
  if (!isObject(workspace)) throw new Error("备份工作区结构非法");
  assertBacktestRequest(workspace.request);
  if (
    !["kline", "return", "drawdown"].includes(workspace.chartMetric) ||
    !["day", "week", "month"].includes(workspace.candlePeriod) ||
    !workspace.request.symbols.includes(workspace.chartSymbol) ||
    !validTimestamp(workspace.updatedAt) ||
    (workspace.activeExperimentId !== undefined &&
      !experiments.some(
        (item) => item.experimentId === workspace.activeExperimentId,
      ))
  ) {
    throw new Error("备份工作区字段或实验引用非法");
  }
}

export function validateBackup(
  payload: unknown,
  schemaVersion: number,
  schemaFingerprint: string,
): ValidatedBackupPayload {
  if (
    !isObject(payload) ||
    payload.schemaVersion !== schemaVersion ||
    payload.schemaFingerprint !== schemaFingerprint ||
    payload.application !== "stock-income-r1" ||
    !validTimestamp(payload.exportedAt) ||
    !Array.isArray(payload.ledgerEntries) ||
    !Array.isArray(payload.backtestExperiments) ||
    !Array.isArray(payload.marketPrices) ||
    !Array.isArray(payload.liveMarketPrices) ||
    !Array.isArray(payload.liveMarketCoverage) ||
    !Array.isArray(payload.corporateActions) ||
    !Array.isArray(payload.stockUniverse) ||
    !isObject(payload.settings) ||
    !Object.prototype.hasOwnProperty.call(payload, "backtestWorkspace")
  ) {
    throw new Error("备份结构或 schema 版本不兼容");
  }
  const backup = payload as unknown as BackupPayload;
  if (
    backup.settings.priceSource !== "tencent_sina" ||
    backup.settings.dividendSource !== "eastmoney" ||
    backup.settings.commissionRate !== 0 ||
    backup.settings.minimumCommission !== 0 ||
    backup.settings.caliberVersion !== BACKTEST_CALIBER_VERSION
  ) {
    throw new Error("备份结构或 schema 版本不兼容");
  }
  assertLedgerGraph(backup.ledgerEntries);
  assertBacktestExperiments(backup.backtestExperiments);
  assertMarketSnapshots(backup);
  assertDirectory(backup);
  assertWorkspace(backup.backtestWorkspace, backup.backtestExperiments);
  return backup as ValidatedBackupPayload;
}
