/**
 * P2-2：域隔离自动门禁。
 *
 * 禁止 src/desktop 中出现指向 labs/ 或 research/ 的引用：
 * - import/require 路径
 * - fs 路径字符串
 * - child_process 调用
 *
 * 放入 pretest 和 prebuild，防止架构回退。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC_DIR = join(ROOT, "electron");
const RENDERER_DIR = join(ROOT, "renderer");
const SHARED_DIR = join(ROOT, "shared");

const FORBIDDEN_PATTERNS = [
  // import/require 路径指向 labs 或 research
  /(?:import|require)\s*\(?\s*['"][^'"]*(?:\/labs\/|\/research\/)/,
  // fs 路径字符串指向 labs 或 research
  /['"][^'"]*(?:\/labs\/|\/research\/)['"]/,
  // child_process 调用（防止调用研究代码）
  /(?:require|import)\s*\(?\s*['"]child_process['"]/,
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const violations = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        file: relative(ROOT, filePath),
        match: match[0],
      });
    }
  }
  return violations;
}

function scanDir(dir) {
  const violations = [];
  if (!exists(dir)) return violations;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      violations.push(...scanDir(fullPath));
    } else if (SCAN_EXTENSIONS.has(extname(fullPath))) {
      violations.push(...scanFile(fullPath));
    }
  }
  return violations;
}

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

function extname(p) {
  const idx = p.lastIndexOf(".");
  return idx >= 0 ? p.slice(idx) : "";
}

const allViolations = [
  ...scanDir(SRC_DIR),
  ...scanDir(RENDERER_DIR),
  ...scanDir(SHARED_DIR),
];

if (allViolations.length) {
  console.error("域隔离检查失败：发现跨域引用");
  for (const v of allViolations) {
    console.error(`  ${v.file}: ${v.match}`);
  }
  process.exit(1);
} else {
  console.log("域隔离检查通过：未发现指向 labs/ 或 research/ 的引用");
}
