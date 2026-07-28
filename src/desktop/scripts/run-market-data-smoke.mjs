import { spawnSync } from "node:child_process";
import { join } from "node:path";

const vitest = join(
  process.cwd(),
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const result = spawnSync(
  process.execPath,
  [vitest, "run", "electron/data/marketData.smoke.test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, RUN_MARKET_SMOKE: "1" },
  },
);
process.exit(result.status ?? 1);
