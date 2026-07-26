import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAStockUniverse } from "../data/stockUniverse";
import { LocalDatabase } from "../storage/database";
import { AppService } from "./appService";

vi.mock("../data/stockUniverse", () => ({
  fetchAStockUniverse: vi.fn(),
}));

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function serviceWithDatabase(): Promise<{
  service: AppService;
  database: LocalDatabase;
}> {
  const directory = mkdtempSync(join(tmpdir(), "stock-income-service-"));
  temporaryDirectories.push(directory);
  const database = await LocalDatabase.open(
    join(directory, "app.sqlite"),
    process.cwd(),
  );
  return { service: new AppService(database), database };
}

describe("AppService 股票目录", () => {
  it("七天内直接使用 SQLite 快照，不重复联网", async () => {
    const { service, database } = await serviceWithDatabase();
    database.replaceStockUniverse(
      [{ symbol: "000001", name: "平安银行" }],
      "cached",
      new Date().toISOString(),
    );

    await expect(service.listStocks()).resolves.toEqual([
      {
        symbol: "000001",
        name: "平安银行",
        source: "cached",
        fetchedAt: expect.any(String),
      },
    ]);
    expect(fetchAStockUniverse).not.toHaveBeenCalled();
  });

  it("刷新失败时回退到上次成功的全市场快照", async () => {
    const { service, database } = await serviceWithDatabase();
    database.replaceStockUniverse(
      [{ symbol: "601398", name: "工商银行" }],
      "cached",
      "2020-01-01T00:00:00Z",
    );
    vi.mocked(fetchAStockUniverse).mockRejectedValue(
      new Error("network unavailable"),
    );

    await expect(service.listStocks()).resolves.toEqual([
      {
        symbol: "601398",
        name: "工商银行",
        source: "cached",
        fetchedAt: "2020-01-01T00:00:00Z",
      },
    ]);
  });
});
