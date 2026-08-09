import { performance } from "node:perf_hooks";
import type {
  AdjustedBar,
  DataSourceHealthId,
  DataSourceHealthItem,
  DataSourceHealthReport,
  DataSourceHealthStatus,
  DirectoryProvenance,
  MarketDataIssue,
  PricePoint,
  StockInfo,
} from "../../shared/contracts";
import {
  DATA_SOURCE_THROTTLE_MS,
  ETF_UNIVERSE_MIN_SIZE,
  STOCK_UNIVERSE_MIN_SIZE,
} from "../../shared/constants";
import { addDays, currentMarketDate } from "../domain/dateUtils";
import {
  fetchAdjustedBars,
  fetchUnadjustedPrices,
} from "./tencent";
import { fetchVerifiedCorporateActions } from "./corporateActions";
import {
  fetchBaiduTradingSuspensions,
  fetchEastmoneyTradingSuspensions,
  type TradingSuspensionSourceResult,
} from "./tradingSuspensions";
import {
  fetchSinaAdjustedBars,
  fetchSinaUnadjustedPrices,
} from "./sina";
import {
  fetchAStockUniverse,
  fetchDomesticEtfUniverse,
} from "./stockUniverse";

interface Provenance {
  source: string;
  dataCutoff: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

interface ProviderResult<T> {
  rows: T[];
  issues: MarketDataIssue[];
}

interface CorporateActionResult {
  rows: Array<{ date: string }>;
  reportedActions: Array<{ exDate: string }>;
  provenance: Provenance;
}

interface DirectoryResult extends DirectoryProvenance {
  rows: StockInfo[];
}

export interface DataSourceHealthDependencies {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  fetchAStockUniverse(): Promise<DirectoryResult>;
  fetchDomesticEtfUniverse(): Promise<DirectoryResult>;
  fetchTencentPrices(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<{ rows: PricePoint[]; provenance: Provenance }>;
  fetchTencentBars(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<{ rows: AdjustedBar[]; provenance: Provenance }>;
  fetchSinaPrices(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<ProviderResult<PricePoint>>;
  fetchSinaBars(
    symbol: string,
    startDate: string,
    endDate: string,
  ): Promise<ProviderResult<AdjustedBar>>;
  fetchCorporateActions(
    symbol: string,
    securityType: "stock" | "etf",
    startDate: string,
    endDate: string,
  ): Promise<CorporateActionResult>;
  fetchEastmoneyTradingSuspensions(
    symbols: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<TradingSuspensionSourceResult>;
  fetchBaiduTradingSuspensions(
    symbols: readonly string[],
    startDate: string,
    endDate: string,
  ): Promise<TradingSuspensionSourceResult>;
}

function defaultDependencies(): DataSourceHealthDependencies {
  return {
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    fetchAStockUniverse,
    fetchDomesticEtfUniverse,
    fetchTencentPrices: fetchUnadjustedPrices,
    fetchTencentBars: fetchAdjustedBars,
    fetchSinaPrices: fetchSinaUnadjustedPrices,
    fetchSinaBars: fetchSinaAdjustedBars,
    fetchCorporateActions: fetchVerifiedCorporateActions,
    fetchEastmoneyTradingSuspensions,
    fetchBaiduTradingSuspensions,
  };
}

interface ProbeDefinition {
  id: DataSourceHealthId;
  capability: string;
  route: string;
  source: string;
}

interface ProbeEvidence {
  status?: Exclude<DataSourceHealthStatus, "unavailable">;
  source?: string;
  detail: string;
  dataCutoff?: string;
  fallbackReason?: string;
}

const definitions = {
  stockDirectory: {
    id: "a_stock_directory",
    capability: "沪深京 A 股目录",
    route: "上交所 + 深交所 + 北交所复合主源",
    source: "三家交易所公开列表",
  },
  etfDirectory: {
    id: "etf_directory",
    capability: "境内 ETF 目录",
    route: "新浪主源 + 沪深交易所官方校验 / 整段备用",
    source: "新浪财经、上交所、深交所",
  },
  tencentMarket: {
    id: "tencent_market",
    capability: "不复权 / 前复权日线",
    route: "腾讯主源",
    source: "腾讯财经",
  },
  sinaMarket: {
    id: "sina_market",
    capability: "不复权 / 前复权日线",
    route: "新浪整段备用",
    source: "新浪财经",
  },
  corporateActions: {
    id: "stock_corporate_actions",
    capability: "分红送转 / 配股",
    route: "东方财富 + 同花顺已实施记录合并 / 互为整段备用",
    source: "东方财富数据中心、同花顺 F10",
  },
  etfCorporateActions: {
    id: "etf_corporate_actions",
    capability: "ETF 现金分红",
    route: "新浪累计分红 + 东方财富基金 F10 记录合并 / 互为整段备用",
    source: "新浪财经、东方财富基金 F10",
  },
  suspensions: {
    id: "eastmoney_suspensions",
    capability: "证券停复牌",
    route: "东方财富按证券历史事件主源",
    source: "东方财富个股日历停牌事件",
  },
  suspensionFallback: {
    id: "baidu_suspensions",
    capability: "证券停复牌备用",
    route: "百度股市通独立备用源",
    source: "百度股市通交易提醒",
  },
} as const satisfies Record<string, ProbeDefinition>;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

async function runProbe(
  definition: ProbeDefinition,
  now: () => Date,
  probe: () => Promise<ProbeEvidence>,
): Promise<DataSourceHealthItem> {
  const startedAt = performance.now();
  try {
    const evidence = await probe();
    return {
      ...definition,
      status: evidence.status ?? "available",
      checkedAt: now().toISOString(),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      source: evidence.source ?? definition.source,
      detail: evidence.detail,
      ...(evidence.dataCutoff
        ? { dataCutoff: evidence.dataCutoff }
        : {}),
      ...(evidence.fallbackReason
        ? { fallbackReason: evidence.fallbackReason }
        : {}),
    };
  } catch (error) {
    return {
      ...definition,
      status: "unavailable",
      checkedAt: now().toISOString(),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      detail: errorMessage(error),
    };
  }
}

function assertRows(
  label: string,
  rows: readonly unknown[],
): void {
  if (!rows.length) throw new Error(`${label}未返回样本区间数据`);
}

function overallStatus(
  items: readonly DataSourceHealthItem[],
): DataSourceHealthStatus {
  if (items.some((item) => item.status === "unavailable")) {
    return "unavailable";
  }
  return items.some((item) => item.status === "degraded")
    ? "degraded"
    : "available";
}

/**
 * 显式探测产品实际使用的固定路由。
 *
 * 结果不写入证券目录、行情或公司行动缓存，只用于设置页观察当次可用性。
 * 东方财富相关能力串行并节流，避免健康检查本身放大其限流风险。
 */
export async function checkDataSourceHealth(
  overrides: Partial<DataSourceHealthDependencies> = {},
): Promise<DataSourceHealthReport> {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const today = currentMarketDate(dependencies.now());
  const priceEndDate = addDays(today, -1);
  const priceStartDate = addDays(priceEndDate, -20);
  const actionStartDate = addDays(priceEndDate, -1_095);
  const marketSymbol = "600519";

  const [stockDirectory, tencentMarket, sinaMarket] = await Promise.all([
    runProbe(definitions.stockDirectory, dependencies.now, async () => {
      const result = await dependencies.fetchAStockUniverse();
      if (
        result.rows.length < STOCK_UNIVERSE_MIN_SIZE ||
        result.rows.some((item) => item.securityType === "etf")
      ) {
        throw new Error(
          `A 股目录未通过完整性门槛：${result.rows.length} 只`,
        );
      }
      return {
        source: result.source,
        detail: `${result.rows.length} 只，三地复合目录通过完整性门槛`,
      };
    }),
    runProbe(definitions.tencentMarket, dependencies.now, async () => {
      const [prices, bars] = await Promise.all([
        dependencies.fetchTencentPrices(
          marketSymbol,
          priceStartDate,
          priceEndDate,
        ),
        dependencies.fetchTencentBars(
          marketSymbol,
          priceStartDate,
          priceEndDate,
        ),
      ]);
      assertRows("腾讯不复权日线", prices.rows);
      assertRows("腾讯前复权日线", bars.rows);
      return {
        source: prices.provenance.source,
        detail: `${marketSymbol} ${priceStartDate}..${priceEndDate}：不复权 ${prices.rows.length} 行，前复权 ${bars.rows.length} 行`,
        dataCutoff: prices.rows.at(-1)?.date,
      };
    }),
    runProbe(definitions.sinaMarket, dependencies.now, async () => {
      const [prices, bars] = await Promise.all([
        dependencies.fetchSinaPrices(
          marketSymbol,
          priceStartDate,
          priceEndDate,
        ),
        dependencies.fetchSinaBars(
          marketSymbol,
          priceStartDate,
          priceEndDate,
        ),
      ]);
      assertRows("新浪不复权日线", prices.rows);
      assertRows("新浪前复权日线", bars.rows);
      const issueCount = prices.issues.length + bars.issues.length;
      return {
        status: issueCount ? "degraded" : "available",
        source: "新浪财经 K 线（产品域独立适配）",
        detail: `${marketSymbol} ${priceStartDate}..${priceEndDate}：不复权 ${prices.rows.length} 行，前复权 ${bars.rows.length} 行${issueCount ? `，发现 ${issueCount} 个解析问题` : ""}`,
        dataCutoff: prices.rows.at(-1)?.date,
      };
    }),
  ]);

  const etfDirectory = await runProbe(
    definitions.etfDirectory,
    dependencies.now,
    async () => {
      const result = await dependencies.fetchDomesticEtfUniverse();
      if (result.rows.length < ETF_UNIVERSE_MIN_SIZE) {
        throw new Error(
          `ETF 目录未通过完整性门槛：${result.rows.length} 只`,
        );
      }
      return {
        status: result.fallbackUsed ? "degraded" : "available",
        source: result.source,
        detail: result.fallbackUsed
          ? `${result.rows.length} 只，新浪失败后使用沪深交易所官方完整目录`
          : `${result.rows.length} 只，新浪主目录与沪深交易所官方目录校验通过`,
        fallbackReason: result.fallbackReason,
      };
    },
  );

  await dependencies.sleep(DATA_SOURCE_THROTTLE_MS);
  const corporateActions = await runProbe(
    definitions.corporateActions,
    dependencies.now,
    async () => {
      const result = await dependencies.fetchCorporateActions(
        marketSymbol,
        "stock",
        actionStartDate,
        priceEndDate,
      );
      const rowCount = result.rows.length + result.reportedActions.length;
      if (!rowCount) {
        throw new Error(
          `股票公司行动双源未返回 ${marketSymbol} 的三年稳定样本`,
        );
      }
      return {
        status:
          result.provenance.fallbackUsed || result.provenance.fallbackReason
            ? "degraded"
            : "available",
        source: result.provenance.source,
        detail: `${marketSymbol} ${actionStartDate}..${priceEndDate}：分红送转 ${result.rows.length} 条，配股 ${result.reportedActions.length} 条`,
        dataCutoff: result.provenance.dataCutoff,
        fallbackReason: result.provenance.fallbackReason,
      };
    },
  );

  await dependencies.sleep(DATA_SOURCE_THROTTLE_MS);
  const etfCorporateActions = await runProbe(
    definitions.etfCorporateActions,
    dependencies.now,
    async () => {
      const symbol = "510050";
      const result = await dependencies.fetchCorporateActions(
        symbol,
        "etf",
        actionStartDate,
        priceEndDate,
      );
      if (!result.rows.length) {
        throw new Error(`ETF 分红双源未返回 ${symbol} 的三年稳定样本`);
      }
      return {
        status:
          result.provenance.fallbackUsed || result.provenance.fallbackReason
            ? "degraded"
            : "available",
        source: result.provenance.source,
        detail: `${symbol} ${actionStartDate}..${priceEndDate}：现金分红 ${result.rows.length} 条`,
        dataCutoff: result.provenance.dataCutoff,
        fallbackReason: result.provenance.fallbackReason,
      };
    },
  );

  await dependencies.sleep(DATA_SOURCE_THROTTLE_MS);
  const suspensionSymbol = "603221";
  const suspensionStartDate = "2026-08-03";
  const suspensionEndDate = "2026-08-06";
  const [suspensions, suspensionFallback] = await Promise.all([
    runProbe(definitions.suspensions, dependencies.now, async () => {
      const result = await dependencies.fetchEastmoneyTradingSuspensions(
        [suspensionSymbol],
        suspensionStartDate,
        suspensionEndDate,
      );
      assertRows("东方财富停复牌稳定样本", result.rows);
      return {
        source: result.source,
        detail: `${suspensionSymbol} ${suspensionStartDate}..${suspensionEndDate}：${result.rows.length} 条，证券级历史全分页、事件类型和全天时段解析通过`,
        dataCutoff: result.coverageEnd,
      };
    }),
    runProbe(definitions.suspensionFallback, dependencies.now, async () => {
      const result = await dependencies.fetchBaiduTradingSuspensions(
        [suspensionSymbol],
        suspensionStartDate,
        suspensionEndDate,
      );
      assertRows("百度停复牌稳定样本", result.rows);
      return {
        status: result.unresolvedOpenIntervals ? "degraded" : "available",
        source: result.source,
        detail: `${suspensionSymbol} ${suspensionStartDate}..${suspensionEndDate}：${result.rows.length} 条，独立备用源日期覆盖和分页通过`,
        dataCutoff: result.coverageEnd,
      };
    }),
  ]);

  const items = [
    stockDirectory,
    etfDirectory,
    tencentMarket,
    sinaMarket,
    corporateActions,
    etfCorporateActions,
    suspensions,
    suspensionFallback,
  ];
  return {
    checkedAt: dependencies.now().toISOString(),
    status: overallStatus(items),
    items,
  };
}
