// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectCanvasBridge, type CanvasWebView } from "./canvasBridgeConnection";

const desktopHarness = () => {
  const listeners = new Set<(event: { data: unknown }) => void>();
  const host: CanvasWebView = {
    postMessage: vi.fn(),
    addEventListener: (_type, fn) => { listeners.add(fn); },
    removeEventListener: (_type, fn) => { listeners.delete(fn); },
  };
  const reply = (data: unknown) => listeners.forEach(fn => fn({ data }));
  return { host, listeners, reply };
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Canvas connection checks", () => {
  it("correlates the native response and sends no canvas payload", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, sessionId: "test", token: "test-only-token" }) });
    vi.stubGlobal("fetch", fetch);
    const { host, listeners, reply } = desktopHarness();
    const result = connectCanvasBridge(true, new AbortController().signal, host);
    const message = vi.mocked(host.postMessage).mock.calls[0][0] as Record<string, unknown>;
    expect(message).toEqual({ type: "canvas-bridge-connect", action: "ensure", requestId: expect.any(String), baseUrl: "http://127.0.0.1:43127" });
    reply({ type: "canvas-bridge-state", requestId: "wrong", status: "connected", code: "READY" });
    expect(listeners.size).toBe(1);
    reply({ type: "canvas-bridge-state", requestId: message.requestId, status: "connected", code: "READY" });
    expect(await result).toEqual({ status: "connected", code: "READY" });
    expect(listeners.size).toBe(0);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:43127/session", expect.objectContaining({ method: "POST" }));
  });
  it("cleans up timed-out requests and ignores late responses", async () => {
    vi.useFakeTimers(); const { host, listeners } = desktopHarness();
    const result = connectCanvasBridge(false, new AbortController().signal, host);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await result).toEqual({ status: "disconnected", code: "TIMEOUT" });
    expect(listeners.size).toBe(0);
    expect((vi.mocked(host.postMessage).mock.calls[0][0] as { action: string }).action).toBe("check");
  });
  it("cancels native listeners on unmount", async () => {
    const { host, listeners } = desktopHarness(); const abort = new AbortController();
    const result = connectCanvasBridge(true, abort.signal, host).catch(error => error);
    abort.abort(); expect((await result).name).toBe("AbortError"); expect(listeners.size).toBe(0);
  });
  it("checks only session in a browser and discards the issued token", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, sessionId: "test", token: "test-only-token" }) });
    vi.stubGlobal("fetch", fetch);
    expect(await connectCanvasBridge(true, new AbortController().signal)).toEqual({ status: "connected", code: "READY" });
    expect(fetch).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:43127/session", expect.objectContaining({ body: '{"version":1}', method: "POST", redirect: "error" }));
  });
  it("reports unavailable, invalid protocol and timeout without publishing", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline")); vi.stubGlobal("fetch", fetch);
    expect((await connectCanvasBridge(true, new AbortController().signal)).code).toBe("BROWSER_UNAVAILABLE");
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 99 }) });
    expect((await connectCanvasBridge(false, new AbortController().signal)).code).toBe("INCOMPATIBLE");
    vi.useFakeTimers(); fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")))));
    const result = connectCanvasBridge(false, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).code).toBe("TIMEOUT");
    expect(fetch.mock.calls.every(call => call[0].endsWith("/session"))).toBe(true);
  });
});
