import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "./database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("LocalDatabase", () => {
  it("把流水写入 SQLite 并导出可恢复的 JSON 业务备份", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stock-income-r1-"));
    temporaryDirectories.push(directory);
    const database = await LocalDatabase.open(
      join(directory, "app.sqlite"),
      process.cwd(),
    );
    database.addLedger({
      id: "entry-1",
      type: "transfer_in",
      businessDate: "2024-01-01",
      recordedAt: "2024-01-01T00:00:00Z",
      currency: "CNY",
      source: "user",
      amount: 1_000,
    });

    const backup = database.exportBackup();
    expect(backup.schemaVersion).toBe(1);
    expect(backup.ledgerEntries).toHaveLength(1);
    expect(backup.marketPrices).toEqual([]);

    const restored = await LocalDatabase.open(
      join(directory, "restored.sqlite"),
      process.cwd(),
    );
    restored.restoreBackup(backup);
    expect(restored.listLedger()[0].source).toBe("restore");
    expect(restored.listLedger()[0].amount).toBe(1_000);
  });
});

