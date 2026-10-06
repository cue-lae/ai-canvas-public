import { resolveBridgeBaseUrl } from "./canvasContextBridge";

export interface CanvasBridgeConnectionResult {
  status: "connected" | "disconnected";
  code: string;
}
export interface CanvasWebView {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
  removeEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
}
export const canvasDesktopBridge = (): CanvasWebView | undefined =>
  (window as Window & { chrome?: { webview?: CanvasWebView } }).chrome?.webview;

const abortError = () => new DOMException("Connection check cancelled", "AbortError");

export async function connectCanvasBridge(
  ensure: boolean,
  signal: AbortSignal,
  desktop: CanvasWebView | null | undefined = canvasDesktopBridge(),
): Promise<CanvasBridgeConnectionResult> {
  if (signal.aborted) throw abortError();
  const baseUrl = resolveBridgeBaseUrl();
  if (desktop) {
    const result = await new Promise<CanvasBridgeConnectionResult>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const finish = (result?: CanvasBridgeConnectionResult, error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        desktop.removeEventListener("message", receive);
        if (error) reject(error); else resolve(result!);
      };
      const abort = () => finish(undefined, abortError());
      const receive = (event: { data: unknown }) => {
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.type !== "canvas-bridge-state" || data.requestId !== requestId ||
            !["connected", "disconnected"].includes(String(data.status)) || typeof data.code !== "string") return;
        finish({ status: data.status as CanvasBridgeConnectionResult["status"], code: data.code });
      };
      const timer = setTimeout(() => finish({ status: "disconnected", code: "TIMEOUT" }), 16_000);
      desktop.addEventListener("message", receive);
      signal.addEventListener("abort", abort, { once: true });
      try { desktop.postMessage({ type: "canvas-bridge-connect", requestId, action: ensure ? "ensure" : "check", baseUrl }); }
      catch { finish({ status: "disconnected", code: "HOST_UNAVAILABLE" }); }
    });
    if (result.status !== "connected") return result;
    // Native readiness alone does not prove that this page can pass CORS/origin checks.
    const pageResult = await connectCanvasBridge(false, signal, null);
    return pageResult.code === "BROWSER_UNAVAILABLE"
      ? { status: "disconnected", code: "ACCESS_FAILED" }
      : pageResult;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 5000);
  try {
    const response = await fetch(`${baseUrl}/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }), credentials: "omit", cache: "no-store",
      signal: controller.signal, redirect: "error",
    });
    if (!response.ok) return { status: "disconnected", code: response.status === 403 ? "ORIGIN_DENIED" : "INCOMPATIBLE" };
    const data = await response.json();
    return data?.version === 1 && typeof data.sessionId === "string" && !!data.sessionId && typeof data.token === "string" && !!data.token
      ? { status: "connected", code: "READY" }
      : { status: "disconnected", code: "INCOMPATIBLE" };
  } catch {
    if (signal.aborted) throw abortError();
    return { status: "disconnected", code: controller.signal.aborted ? "TIMEOUT" : "BROWSER_UNAVAILABLE" };
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

export function canvasBridgeConnectionMessage(code: string): string {
  switch (code) {
    case "READY": return "可以交接画布；内容仍需点击 Codex Read 后才会交接。";
    case "RUNTIME_MISSING": return "连接组件缺失，请修复或更新桌面应用后重试。";
    case "ORIGIN_DENIED": return "已有连接服务不接受当前应用，请更新原启动入口后重试。";
    case "INCOMPATIBLE": return "连接地址上的服务与当前应用不兼容，未替换或关闭该服务。";
    case "CONFIG_MISMATCH": return "连接配置不匹配，请使用配套的桌面应用版本。";
    case "BROWSER_UNAVAILABLE": return "请从 AI Canvas 桌面应用启动连接服务，再回到这里重试。";
    case "ACCESS_FAILED": return "连接服务已启动，但画布暂时无法访问，请重新连接或更新应用。";
    case "TIMEOUT": return "连接超时，画布仍可继续使用，请稍后重新连接。";
    default: return "连接暂不可用，画布仍可继续使用，可点击重新连接重试。";
  }
}
