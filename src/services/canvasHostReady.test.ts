import { describe, it, expect, vi } from "vitest";
import { scheduleCanvasHostReady } from "./canvasHostReady";

function frames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  return {
    frame: vi.fn((fn: FrameRequestCallback) => { callbacks.set(++id, fn); return id; }),
    cancel: vi.fn((key: number) => { callbacks.delete(key); }),
    next: () => { const pending = [...callbacks]; callbacks.clear(); pending.forEach(([, fn]) => fn(0)); },
  };
}
describe("host startup notification", () => {
  it("waits for two frames and sends only a content-free readiness message", () => {
    const f = frames(), host = { postMessage: vi.fn() };
    scheduleCanvasHostReady(host, f.frame, f.cancel);
    f.next(); expect(host.postMessage).not.toHaveBeenCalled();
    f.next(); expect(host.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "canvas-ready" });
  });
  it.each([0, 1])("cancels pending work on cleanup after %i frames", (count) => {
    const f = frames(), host = { postMessage: vi.fn() };
    const cleanup = scheduleCanvasHostReady(host, f.frame, f.cancel);
    if (count) f.next(); cleanup(); f.next(); f.next();
    expect(host.postMessage).not.toHaveBeenCalled();
  });
  it("does not schedule anything in an ordinary browser", () => {
    const f = frames(); scheduleCanvasHostReady(undefined, f.frame, f.cancel)();
    expect(f.frame).not.toHaveBeenCalled();
  });
});
