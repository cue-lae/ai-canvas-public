// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../services/canvasBridgeConnection", async importOriginal => ({
  ...await importOriginal<typeof import("../services/canvasBridgeConnection")>(), connectCanvasBridge: vi.fn(),
}));
import { connectCanvasBridge } from "../services/canvasBridgeConnection";
import { CanvasBridgeConnection } from "./CanvasBridgeConnection";
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(connectCanvasBridge).mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it("tries once on startup, retries manually and only checks during polling", async () => {
  vi.mocked(connectCanvasBridge).mockResolvedValueOnce({ status: "disconnected", code: "NOT_RUNNING" }).mockResolvedValue({ status: "connected", code: "READY" });
  await act(async () => root.render(createElement(CanvasBridgeConnection)));
  expect(host.textContent).toContain("未连接"); expect(connectCanvasBridge).toHaveBeenCalledTimes(1);
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(host.textContent).toContain("连接已就绪");
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(vi.mocked(connectCanvasBridge).mock.calls.map(call => call[0])).toEqual([true, true, false]);
});
it("disables duplicate requests and cancels pending work on unmount", async () => {
  vi.mocked(connectCanvasBridge).mockImplementation((_ensure, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")))));
  await act(async () => root.render(createElement(CanvasBridgeConnection)));
  const button = host.querySelector("button") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await act(async () => { button.click(); await vi.advanceTimersByTimeAsync(40_000); });
  expect(connectCanvasBridge).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(connectCanvasBridge).mock.calls[0][1];
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
});
