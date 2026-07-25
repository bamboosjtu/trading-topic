import { app, BrowserWindow, shell } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// 开发模式：electron-vite 把 main.ts 编译到 out/main/main.js，
// process.cwd() 是 src/desktop/（用户运行 npm run dev 的目录）。
// 生产模式：PyInstaller bundle 放在 process.resourcesPath 下。
const PROJECT_ROOT = app.isPackaged
  ? process.resourcesPath
  : process.cwd();
const REPO_ROOT = resolve(PROJECT_ROOT, "..", ".."); // 仓库根目录（用于 uv --project）
const SIDECAR_DIR = resolve(PROJECT_ROOT, "sidecar");

const SIDECAR_PORT = pickFreePort();
const SIDECAR_TOKEN = randomBytes(24).toString("hex");

// 开发期把 userData 指向项目内的 .userData 目录，
// 避免某些沙箱环境（如 TRAE Sandbox）阻止访问 %APPDATA%。
const DEV_USER_DATA_DIR = resolve(PROJECT_ROOT, ".userData");
if (!app.isPackaged && !existsSync(DEV_USER_DATA_DIR)) {
  mkdirSync(DEV_USER_DATA_DIR, { recursive: true });
}
if (!app.isPackaged) {
  app.setPath("userData", DEV_USER_DATA_DIR);
}

let sidecarProcess: ChildProcess | null = null;

function pickFreePort(): number {
  // 简单实现：随机选一个动态端口区间内的端口，绑定失败由 uvicorn 报错
  // 生产实现应使用 net.createServer().listen(0) 获取真正空闲端口
  return 8000 + Math.floor(Math.random() * 999);
}

function startSidecar(): ChildProcess {
  const isProd = app.isPackaged;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DESKTOP_SIDECAR_PORT: String(SIDECAR_PORT),
    DESKTOP_SIDECAR_TOKEN: SIDECAR_TOKEN,
    PYTHONUNBUFFERED: "1",
  };

  if (isProd) {
    // 生产模式：spawn PyInstaller 单可执行
    const exePath = resolve(
      process.resourcesPath,
      "sidecar",
      process.platform === "win32" ? "desktop_backend.exe" : "desktop_backend"
    );
    return spawn(exePath, { env, cwd: process.resourcesPath });
  }

  // 开发模式：spawn uvicorn via uv
  // --project 接受相对 cwd 的路径，所以用相对 REPO_ROOT 的 sidecar 路径
  const sidecarProjectPath = resolve(REPO_ROOT, "src", "desktop", "sidecar");
  return spawn(
    "uv",
    [
      "run",
      "--project",
      sidecarProjectPath,
      "uvicorn",
      "desktop_backend.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(SIDECAR_PORT),
    ],
    { env, cwd: REPO_ROOT, shell: process.platform === "win32" }
  );
}

async function waitForSidecar(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(
        `http://127.0.0.1:${SIDECAR_PORT}/api/v1/health`,
        { headers: { Authorization: `Bearer ${SIDECAR_TOKEN}` } }
      );
      if (resp.ok) return;
    } catch {
      // sidecar 尚未启动，继续等
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Sidecar 健康检查超时（${timeoutMs}ms）`);
}

function createWindow(): void {
  // 编译后 __dirname = out/main/，preload 在 out/preload/preload.js
  const preloadPath = app.isPackaged
    ? join(__dirname, "preload.js")
    : join(__dirname, "..", "preload", "preload.js");

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#fafafa",
    title: "攒股收息",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
  }
}

app.whenReady().then(async () => {
  try {
    sidecarProcess = startSidecar();
    sidecarProcess.stdout?.on("data", (chunk) =>
      process.stdout.write(`[sidecar] ${chunk}`)
    );
    sidecarProcess.stderr?.on("data", (chunk) =>
      process.stderr.write(`[sidecar] ${chunk}`)
    );
    sidecarProcess.on("exit", (code) => {
      if (code !== 0) console.warn(`[sidecar] exited with ${code}`);
    });

    await waitForSidecar();
    createWindow();
  } catch (err) {
    console.error("[main] 启动失败：", err);
    // 即便 sidecar 失败也打开窗口，便于看到错误
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

const cleanup = (): void => {
  if (sidecarProcess && !sidecarProcess.killed) {
    try {
      sidecarProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  // 清理可能残留的临时端口锁文件（如有）
  const lockFile = join(app.getPath("temp"), `desktop-sidecar-${SIDECAR_PORT}.lock`);
  if (existsSync(lockFile)) rmSync(lockFile, { force: true });
};

app.on("before-quit", cleanup);
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
