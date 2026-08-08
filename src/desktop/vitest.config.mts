import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "electron/domain/**/*.test.ts",
            "electron/services/**/*.unit.test.ts",
            "shared/**/*.test.ts",
            "renderer/src/**/*.test.{ts,tsx}",
          ],
        },
      },
      {
        test: {
          name: "contract",
          include: ["electron/data/**/*.test.ts"],
          exclude: ["electron/data/**/*.smoke.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: [
            "electron/services/**/*.test.ts",
            "electron/storage/**/*.test.ts",
            "electron/export/**/*.test.ts",
          ],
          exclude: ["electron/services/**/*.unit.test.ts"],
        },
      },
      {
        test: {
          name: "smoke",
          include: ["electron/data/**/*.smoke.test.ts"],
        },
      },
    ],
  },
});
