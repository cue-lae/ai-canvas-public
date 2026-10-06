import type { DocumentSaveResult } from "./documentSaveState";

export type HostDocumentPresentation = "normal" | "lightweight";
export interface NativeDocumentIdentity { documentId: string; recoveryId?: string; isolated?: boolean; presentation?: HostDocumentPresentation }
export const readHostDocumentPresentation = (value: unknown, documentId: string): HostDocumentPresentation | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  return data.type === "canvas-document-presentation" && data.documentId === documentId &&
    (data.presentation === "normal" || data.presentation === "lightweight") ? data.presentation : undefined;
};
type WebViewPort = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
};
declare global {
  interface Window { __AI_CANVAS_NATIVE_DOCUMENT__?: NativeDocumentIdentity }
}
let savedRecoveryId: string | undefined;
export const nativeDocumentIdentity = (): NativeDocumentIdentity | undefined => {
  if (typeof window === "undefined") return undefined;
  const value = window.__AI_CANVAS_NATIVE_DOCUMENT__;
  return value && /^[a-f0-9]{32}$/i.test(value.documentId) ? { ...value, recoveryId: savedRecoveryId ?? value.recoveryId } : undefined;
};
export const nativeDocumentPort = (): WebViewPort | undefined =>
  typeof window === "undefined" ? undefined :
    (window as Window & { chrome?: { webview?: WebViewPort } }).chrome?.webview;

export const sendNativeDocumentState = (revision: number, dirty: boolean) => {
  const identity = nativeDocumentIdentity();
  if (identity) nativeDocumentPort()?.postMessage({ type: "canvas-document-state", documentId: identity.documentId, revision, dirty });
};

export const installNativeDocumentRenameListener = (documentId: string, renamed: (fileName: string) => void, port = nativeDocumentPort()) => {
  if (!port) return () => undefined;
  const receive = (event: { data: unknown }) => {
    const data = event.data as Record<string, unknown> | null;
    if (data?.type !== "canvas-document-renamed" || data.documentId !== documentId ||
        typeof data.fileName !== "string" || typeof data.recoveryId !== "string" || !/^[a-f0-9]{32}$/i.test(data.recoveryId)) return;
    savedRecoveryId = data.recoveryId;
    renamed(data.fileName);
  };
  port.addEventListener("message", receive);
  return () => port.removeEventListener("message", receive);
};

/** A short, one-use menu-paste intent, not a persistent clipboard permission. */
export const readNativeMenuClipboard = async <T>(read: () => Promise<T>, identity = nativeDocumentIdentity(), port = nativeDocumentPort()): Promise<T> => {
  if (!identity || !port) return read();
  const requestId = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (ready: boolean) => {
        clearTimeout(timer); port.removeEventListener("message", receive);
        if (ready) resolve(); else reject(new Error("当前文档尚未准备好读取剪贴板。"));
      };
      const receive = (event: { data: unknown }) => {
        const data = event.data as Record<string, unknown> | null;
        if (data?.type === "canvas-clipboard-read-ready" && data.documentId === identity.documentId && data.requestId === requestId) finish(data.ready === true);
      };
      const timer = setTimeout(() => finish(false), 2000);
      port.addEventListener("message", receive);
      try { port.postMessage({ type: "canvas-clipboard-read-begin", documentId: identity.documentId, requestId }); }
      catch { finish(false); }
    });
    return await read();
  } finally { port.postMessage({ type: "canvas-clipboard-read-end", documentId: identity.documentId, requestId }); }
};

/** Sample current Canvas/business synchronously on a correlated close request.
 * An unavailable baseline is failure, never an inferred clean document. */
export const installNativeDocumentCloseStateResponder = (
  documentId: string,
  snapshot: () => { revision: number; dirty: boolean } | undefined,
  port = nativeDocumentPort(),
): (() => void) => {
  if (!port) return () => undefined;
  const receive = (event: { data: unknown }) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.type !== "canvas-document-command" || data.action !== "refresh-close-state" ||
        data.documentId !== documentId || typeof data.requestId !== "string" || !/^[a-f0-9]{32}$/i.test(data.requestId)) return;
    let current: ReturnType<typeof snapshot>;
    try { current = snapshot(); } catch { current = undefined; }
    port.postMessage({ type: "canvas-document-close-state-result", documentId, requestId: data.requestId,
      ready: !!current, ...(current ?? {}) });
  };
  port.addEventListener("message", receive);
  return () => port.removeEventListener("message", receive);
};

export const requestNativeDocumentSave = (
  content: string,
  fileName: string,
  request: { documentId: string; requestId: string; revision: number; saveAs?: boolean },
  port = nativeDocumentPort(),
): Promise<DocumentSaveResult> => new Promise((resolve) => {
  if (!port) { resolve({ ...request, status: "failed", message: "Native file saving unavailable" }); return; }
  let finished = false;
  const finish = (result: DocumentSaveResult) => {
    if (finished) return; finished = true;
    clearTimeout(timer); port.removeEventListener("message", receive); resolve(result);
  };
  const receive = (event: { data: unknown }) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.type !== "canvas-document-save-result" || data.documentId !== request.documentId ||
        data.requestId !== request.requestId || data.revision !== request.revision ||
        !["saved", "cancelled", "failed"].includes(String(data.status))) return;
    if (data.status === "saved" && typeof data.recoveryId === "string" && /^[a-f0-9]{32}$/i.test(data.recoveryId)) savedRecoveryId = data.recoveryId;
    finish({ ...request, status: data.status as DocumentSaveResult["status"],
      fileName: typeof data.fileName === "string" ? data.fileName : undefined,
      message: typeof data.message === "string" ? data.message : undefined });
  };
  // A visible file dialog can stay open while its user chooses a path. Timeout
  // is a failure and never grants close permission or marks a snapshot saved.
  const timer = setTimeout(() => finish({ ...request, status: "failed", message: "保存尚未确认完成" }), 300_000);
  port.addEventListener("message", receive);
  try { port.postMessage({ type: "canvas-document-save", ...request, fileName, content }); }
  catch { finish({ ...request, status: "failed", message: "保存请求未送达宿主" }); }
});
