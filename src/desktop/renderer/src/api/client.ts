/**
 * Sidecar API 客户端。
 *
 * Sidecar 在启动时由 Electron 主进程生成随机端口与会话令牌；
 * 渲染层通过 preload 暴露的 `window.desktop.sidecar` 获取这些信息。
 * 开发模式下（独立运行 Vite）回退到默认端口 8001。
 */

const SIDECAR_BASE_URL =
  (window as unknown as { desktop?: { sidecar?: { baseUrl?: string } } })
    .desktop?.sidecar?.baseUrl ?? "http://127.0.0.1:8001";

const SIDECAR_TOKEN =
  (window as unknown as { desktop?: { sidecar?: { token?: string } } })
    .desktop?.sidecar?.token ?? "";

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  data_cutoff?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SIDECAR_BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(SIDECAR_TOKEN
        ? { Authorization: `Bearer ${SIDECAR_TOKEN}` }
        : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Sidecar ${response.status}: ${response.statusText} (${path})`
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
};
