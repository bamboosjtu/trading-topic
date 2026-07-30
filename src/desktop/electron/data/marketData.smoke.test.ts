import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKTEST_CALIBER_VERSION } from "../../shared/constants";
import type { AdjustedBar, PricePoint } from "../../shared/contracts";
import { LocalDatabase } from "../storage/database";
import {
  assertCrossProviderConsistency,
  fetchWithProviderFallback,
  sinaProvider,
  tencentProvider,
  validateAdjustedBars,
  validatePricePoints,
  type MarketDataProvider,
} from "./marketDataProvider";
import { fetchDomesticEtfUniverse } from "./stockUniverse";
import { latestWeekdayCandidate } from "../domain/marketCalendar";
import { addDays } from "../domain/dateUtils";

const RUN_SMOKE = process.env["RUN_MARKET_SMOKE"] === "1";
const START_DATE = "2026-07-20";
const END_DATE = "2026-07-24";
const CASES = [
  { label: "沪市股票", symbol: "600519" },
  { label: "深市股票", symbol: "000001" },
  { label: "北交所股票", symbol: "920002" },
  { label: "境内交易所 ETF", symbol: "510300" },
] as const;

describe.skipIf(!RUN_SMOKE)("真实行情受控联网冒烟", () => {
  it(
    "验证沪深京与 ETF、两源不复权/前复权、整段兜底及来源落库",
    async () => {
      const checks: Array<Record<string, unknown>> = [];
      const etfUniverse = await fetchDomesticEtfUniverse();
      expect(etfUniverse.rows.length).toBeGreaterThanOrEqual(1_000);
      expect(etfUniverse.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            symbol: "510300",
            securityType: "etf",
          }),
          expect.objectContaining({
            symbol: "159915",
            securityType: "etf",
          }),
        ]),
      );
      for (const marketCase of CASES) {
        const priceRowsBySource = new Map<string, PricePoint[]>();
        const barRowsBySource = new Map<
          string,
          Awaited<ReturnType<MarketDataProvider["fetchAdjustedBars"]>>
        >();
        for (const provider of [tencentProvider, sinaProvider]) {
          let prices: PricePoint[];
          let bars: Awaited<
            ReturnType<MarketDataProvider["fetchAdjustedBars"]>
          > | null = null;
          let priceError: string | null = null;
          let barError: string | null = null;
          try {
            prices = await provider.fetchPrices(
              marketCase.symbol,
              START_DATE,
              END_DATE,
            );
          } catch (error) {
            throw new Error(
              `${marketCase.label}/${provider.source}/不复权：${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          try {
            bars = await provider.fetchAdjustedBars(
              marketCase.symbol,
              START_DATE,
              END_DATE,
            );
          } catch (error) {
            barError =
              error instanceof Error ? error.message : String(error);
            if (provider.source === "sina") {
              throw new Error(
                `${marketCase.label}/sina/前复权：${barError}`,
              );
            }
          }
          try {
            validatePricePoints(
              prices,
              marketCase.symbol,
              provider.source,
            );
            priceRowsBySource.set(provider.source, prices);
          } catch (error) {
            priceError =
              error instanceof Error ? error.message : String(error);
            if (provider.source === "sina") {
              throw new Error(
                `${marketCase.label}/sina/不复权：${priceError}`,
              );
            }
          }
          if (bars) {
            validateAdjustedBars(
              bars,
              marketCase.symbol,
              provider.source,
            );
            barRowsBySource.set(provider.source, bars);
          }
          checks.push({
            ...marketCase,
            source: provider.source,
            unadjustedRows: prices.length,
            qfqRows: bars?.length ?? 0,
            ...(priceError ? { unadjustedError: priceError } : {}),
            ...(barError ? { qfqError: barError } : {}),
            dataCutoff: prices.at(-1)?.date,
          });
        }
        const tencentPrices = priceRowsBySource.get("tencent");
        if (tencentPrices) {
          assertCrossProviderConsistency(
            tencentPrices,
            priceRowsBySource.get("sina")!,
          );
        } else {
          const fallbackPrices = await fetchWithProviderFallback<PricePoint>(
            "prices",
            marketCase.symbol,
            START_DATE,
            END_DATE,
            tencentProvider,
            sinaProvider,
            new Date("2026-07-25T08:00:00Z"),
          );
          expect(fallbackPrices.rows.length).toBeGreaterThan(0);
          validatePricePoints(
            fallbackPrices.rows,
            marketCase.symbol,
            fallbackPrices.provenance.source,
          );
        }
        const tencentBars = barRowsBySource.get("tencent");
        if (tencentBars) {
          assertCrossProviderConsistency(
            tencentBars.map(({ date, close }) => ({ date, close })),
            barRowsBySource
              .get("sina")!
              .map(({ date, close }) => ({ date, close })),
          );
        } else {
          const fallbackBars =
            await fetchWithProviderFallback<AdjustedBar>(
            "bars",
            marketCase.symbol,
            START_DATE,
            END_DATE,
            tencentProvider,
            sinaProvider,
            new Date("2026-07-25T08:00:00Z"),
            );
          expect(fallbackBars.provenance).toMatchObject({
            source: "sina",
            fallbackUsed: true,
          });
          validateAdjustedBars(
            fallbackBars.rows,
            marketCase.symbol,
            "新浪整段兜底",
          );
        }
      }

      const longRangeStart = "2011-07-25";
      const longRangeEnd = END_DATE;
      const [longPrices, longBars] = await Promise.all([
        sinaProvider.fetchPrices("600519", longRangeStart, longRangeEnd),
        sinaProvider.fetchAdjustedBars(
          "600519",
          longRangeStart,
          longRangeEnd,
        ),
      ]);
      validatePricePoints(longPrices, "600519", "新浪长区间");
      validateAdjustedBars(longBars, "600519", "新浪长区间");
      expect(longPrices.length).toBeGreaterThan(3_000);
      expect(longBars.length).toBe(longPrices.length);
      expect(longPrices[0]!.date >= longRangeStart).toBe(true);
      expect(longPrices.at(-1)!.date).toBe(longRangeEnd);
      checks.push({
        label: "沪市股票长历史",
        symbol: "600519",
        source: "sina",
        startDate: longPrices[0]!.date,
        dataCutoff: longPrices.at(-1)!.date,
        unadjustedRows: longPrices.length,
        qfqRows: longBars.length,
      });

      const unavailableTencent: MarketDataProvider = {
        source: "tencent",
        fetchPrices: async () => {
          throw new Error("受控冒烟模拟腾讯故障");
        },
        fetchAdjustedBars: async () => {
          throw new Error("受控冒烟模拟腾讯故障");
        },
      };
      const fallback = await fetchWithProviderFallback<PricePoint>(
        "prices",
        "600519",
        START_DATE,
        END_DATE,
        unavailableTencent,
        sinaProvider,
        new Date("2026-07-25T08:00:00Z"),
      );
      expect(fallback.provenance).toMatchObject({
        source: "sina",
        primarySource: "tencent",
        fallbackUsed: true,
        dataCutoff: END_DATE,
      });

      const currentCompletedDate = latestWeekdayCandidate(new Date());
      const currentPrices = await fetchWithProviderFallback<PricePoint>(
        "prices",
        "600036",
        addDays(currentCompletedDate, -10),
        currentCompletedDate,
        tencentProvider,
        sinaProvider,
      );
      expect(currentPrices.rows.at(-1)?.date).toBe(currentCompletedDate);
      checks.push({
        label: "收盘后最新已完成交易日",
        symbol: "600036",
        source: currentPrices.provenance.source,
        requestedCutoff: currentCompletedDate,
        dataCutoff: currentPrices.rows.at(-1)?.date,
        fallbackUsed: currentPrices.provenance.fallbackUsed,
      });

      const databasePath = join(
        tmpdir(),
        `stock-income-market-smoke-${process.pid}-${Date.now()}.sqlite`,
      );
      const database = await LocalDatabase.open(databasePath);
      try {
        database.saveLiveMarketPriceSnapshots([
          {
            symbol: "600519",
            prices: fallback.rows,
            dividends: [],
            provenance: {
              ...fallback.provenance,
              caliberVersion: BACKTEST_CALIBER_VERSION,
            },
            requestedFrom: START_DATE,
            requestedThrough: END_DATE,
          },
        ]);
        expect(database.listLiveMarketPrices(["600519"]).at(-1)).toMatchObject({
          source: "sina",
          fallbackUsed: true,
          dataCutoff: END_DATE,
        });
        expect(database.listLiveMarketCoverage(["600519"])[0]).toMatchObject({
          source: "sina",
          fallbackUsed: true,
          dataCutoff: END_DATE,
          resultStatus: "data",
        });
      } finally {
        database.close();
        rmSync(databasePath, { force: true });
      }

      const artifactDirectory = join(process.cwd(), "artifacts");
      mkdirSync(artifactDirectory, { recursive: true });
      writeFileSync(
        join(artifactDirectory, "market-data-smoke.json"),
        JSON.stringify(
          {
            executedAt: new Date().toISOString(),
            requestRange: { startDate: START_DATE, endDate: END_DATE },
            instrumentCatalog: {
              etfCount: etfUniverse.rows.length,
              verifiedSymbols: ["510300", "159915"],
              provenance: {
                source: etfUniverse.source,
                primarySource: etfUniverse.primarySource,
                fallbackUsed: etfUniverse.fallbackUsed,
                fallbackReason: etfUniverse.fallbackReason,
                fetchedAt: etfUniverse.fetchedAt,
              },
            },
            checks,
            fallback: fallback.provenance,
            persistence: "passed",
          },
          null,
          2,
        ),
        "utf8",
      );
    },
    180_000,
  );
});
