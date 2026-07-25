import { contextBridge } from "electron";

/**
 * 最小化 preload API：
 * 只暴露 sidecar 连接信息，不暴露任何 Node.js / fs / shell 能力。
 * 参见 ARCHITECTURE.md §9 安全约束。
 */

const SIDECAR_PORT = process.env["DESKTOP_SIDECAR_PORT"];
const SIDECAR_TOKEN = process.env["DESKTOP_SIDECAR_TOKEN"];

if (SIDECAR_PORT && SIDECAR_TOKEN) {
  contextBridge.exposeInMainWorld("desktop", {
    sidecar: {
      baseUrl: `http://127.0.0.1:${SIDECAR_PORT}`,
      token: SIDECAR_TOKEN,
    },
  });
}
