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

interface FetchWithTimeoutOptions extends RequestInit {
  /** 超时毫秒数，默认 15000。 */
  timeoutMs?: number;
  /** 用于构造超时错误信息的来源标签，例如 "腾讯行情"。 */
  label?: string;
}

/**
 * 发起带超时的 fetch 请求，自动注入 User-Agent 头。
 *
 * 超时会 abort 请求并抛出 `<label>请求超时`（无 label 时回退为"数据源"）。
 * 如果调用方传入了外部 `signal`，外部取消会立即生效，超时取消也会生效，
 * 两者任一触发都会 abort 请求。
 *
 * Headers 合并使用 `Headers` 构造器，正确处理 `Headers` 对象、二维数组
 * 和普通对象三种 `RequestInit.headers` 形态。
 *
 * 调用方负责检查 `response.ok` 并解析响应体。
 */
export async function fetchWithTimeout(
  url: URL | string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = 15_000, label = "数据源", headers, signal: externalSignal, ...rest } = options;
  const controller = new AbortController();
  // 显式记录最先触发的取消原因，避免超时与外部取消近乎同时发生时
  // 事后通过 externalSignal.aborted 推断导致错误归类。
  let abortReason: "timeout" | "external" | null = null;
  const timeout = setTimeout(() => {
    if (abortReason === null) abortReason = "timeout";
    controller.abort();
  }, timeoutMs);

  // 组合外部 signal 与超时 signal：外部取消或超时任一触发都 abort。
  // 保存回调引用以便在 finally 中移除，避免长生命周期 signal 上累积监听器。
  const onExternalAbort = (): void => {
    if (abortReason === null) abortReason = "external";
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortReason = "external";
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    // 使用 Headers 构造器正确合并，支持 Headers 对象、数组、普通对象。
    const mergedHeaders = new Headers(headers);
    mergedHeaders.set("User-Agent", DEFAULT_USER_AGENT);

    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: mergedHeaders,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const cause = abortReason === "external" ? "外部取消" : "超时";
      throw new Error(`${label}请求${cause === "外部取消" ? "被外部取消" : "超时"}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}
