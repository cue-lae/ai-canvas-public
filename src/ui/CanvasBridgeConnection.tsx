import { useEffect, useRef, useState } from "react";
import { connectCanvasBridge, canvasBridgeConnectionMessage, type CanvasBridgeConnectionResult } from "../services/canvasBridgeConnection";

export function CanvasBridgeConnection() {
  const [result, setResult] = useState<CanvasBridgeConnectionResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(true);
  const pending = useRef<AbortController | null>(null);

  const check = async (ensure: boolean) => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    if (ensure) setChecking(true);
    try {
      const next = await connectCanvasBridge(ensure, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch {
      if (!controller.signal.aborted) setResult({ status: "disconnected", code: "UNAVAILABLE" });
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) { setChecking(false); setBusy(false); }
      }
    }
  };

  useEffect(() => {
    void check(true);
    const timer = window.setInterval(() => void check(false), 20_000);
    return () => { window.clearInterval(timer); pending.current?.abort(); pending.current = null; };
  }, []);

  const status = checking ? "connecting" : result?.status ?? "disconnected";
  return (
    <section className="canvas-bridge-connection" aria-label="画布交接连接">
      <div className="canvas-bridge-connection__copy" role="status" aria-live="polite">
        <strong><span className={`canvas-bridge-connection__dot is-${status}`} aria-hidden="true" />
          {checking ? "正在连接…" : status === "connected" ? "连接已就绪" : "未连接"}
        </strong>
        <p>{checking ? "正在检查本机连接，画布可继续使用。" : canvasBridgeConnectionMessage(result?.code ?? "UNAVAILABLE")}</p>
      </div>
      <button type="button" disabled={busy} onClick={() => void check(true)}>重新连接</button>
    </section>
  );
}
