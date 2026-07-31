/**
 * 数据源共享 HTTP 客户端：统一 fetch + 超时 + User-Agent。
 *
 * tencent/sina/stockUniverse 三个数据适配器原本各自复制同一套
 * AbortController + setTimeout 模板，且对超时错误（AbortError）的处理
 * 不一致（有的转译为中文提示，有的直接抛出）。集中到 httpClient 后：
 * - 统一超时行为与 User-Agent 头；
 * - 统一将 AbortError 转译为带 label 的超时错误；
 * - 调用方仍自行处理 response.ok 与响应体解析（各源错误格式不同）。
 */

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface FetchWithTimeoutOptions extends RequestInit {
  /** 超时毫秒数，默认 15000。 */
  timeoutMs?: number;
  /** 用于构造超时错误信息的来源标签，例如 "腾讯行情"。 */
  label?: string;
}

/**
 * 发起带超时的 fetch 请求，自动注入 User-Agent 头。
 *
 * 超时后会 abort 请求并抛出 `<label>请求超时`（无 label 时回退为"数据源"）。
 * 调用方负责检查 `response.ok` 并解析响应体。
 */
export async function fetchWithTimeout(
  url: URL | string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 15_000, label = "数据源", headers, ...rest } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        ...headers,
      },
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label}请求超时`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
