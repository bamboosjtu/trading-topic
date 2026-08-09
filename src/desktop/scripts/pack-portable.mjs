import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const relativeOutputDirectory = `release/portable-build-${timestamp}-${process.pid}`;
const outputDirectory = resolve(desktopDirectory, relativeOutputDirectory);
const electronBuilderCli = resolve(
  desktopDirectory,
  "node_modules",
  "electron-builder",
  "cli.js",
);

mkdirSync(outputDirectory, { recursive: true });
console.log(`Portable build output: ${outputDirectory}`);

const result = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    "--win",
    "portable",
    "--x64",
    `--config.directories.output=${relativeOutputDirectory}`,
  ],
  {
    cwd: desktopDirectory,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Portable package created in: ${outputDirectory}`);
