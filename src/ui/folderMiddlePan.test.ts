// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderWorkspace } from "./folderWorkspace";

type Props = ComponentProps<typeof FolderWorkspace>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: Props;
let pan: ReturnType<typeof vi.fn>;
const render = (extra: Partial<Props> = {}) => act(() => root.render(createElement(FolderWorkspace, { ...props, ...extra })));
const pointer = (type: string, x: number, y: number, button = 1) => act(() => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(event, "pointerId", { value: 3 });
  host.querySelector(".folder-workspace-hit-target")!.dispatchEvent(event);
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // Diagnostic fixture: browsers provide this decoration observer; jsdom does not.
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  pan = vi.fn();
  props = {
    navigation: { layer: "overview", selectedFolderId: null },
    items: [{ folder: {
      id: "folder-a", schemaVersion: 2, kind: "folder", name: "测试文件夹",
      imageAssetIds: [], descriptionIds: [], focusImageIds: [],
      createdAt: "2026-09-26T00:00:00Z", updatedAt: "2026-09-26T00:00:00Z",
    }, bounds: { x: 100, y: 100, width: 300, height: 200 } }],
    descriptions: [], viewport: { zoom: 2, scrollX: 15, scrollY: 25, offsetLeft: 0, offsetTop: 0 },
    onSelectFolder: vi.fn(), onEnterFolder: vi.fn(), onMoveFolder: vi.fn(),
    onDeleteFolder: vi.fn(), onUngroupFolder: vi.fn(),
    onSelectDescription: vi.fn(), onMoveDescription: vi.fn(), onBeginCanvasPan: vi.fn(() => pan),
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("middle-button pan from a closed Folder", () => {
  it("sends cumulative screen displacement without selecting or moving the folder", () => {
    render(); pointer("pointerdown", 100, 120); pointer("pointermove", 145, 100); pointer("pointerup", 160, 90);
    expect(props.onBeginCanvasPan).toHaveBeenCalledTimes(1);
    expect(pan.mock.calls).toEqual([[45, -20], [60, -30]]);
    act(() => vi.runAllTimers());
    expect(props.onSelectFolder).not.toHaveBeenCalled();
    expect(props.onMoveFolder).not.toHaveBeenCalled();
    expect(props.onEnterFolder).not.toHaveBeenCalled();
    pointer("pointermove", 300, 300);
    expect(pan).toHaveBeenCalledTimes(2);
    expect((host.querySelector("button") as HTMLElement).style.cursor).toBe("");
  });
  it.each(["pointercancel", "lostpointercapture", "blur"])("clears a pan on %s", (end) => {
    render(); pointer("pointerdown", 100, 120); pointer("pointermove", 110, 125);
    if (end === "blur") act(() => window.dispatchEvent(new Event("blur")));
    else pointer(end, 110, 125);
    pointer("pointermove", 140, 150); pointer("pointerup", 150, 160);
    expect(pan).toHaveBeenCalledExactlyOnceWith(10, 5);
    expect(props.onMoveFolder).not.toHaveBeenCalled();
  });
  it("rejects disabled and preview states, and clears on a layer change", () => {
    render({ disabled: true }); pointer("pointerdown", 100, 120);
    expect(props.onBeginCanvasPan).not.toHaveBeenCalled();
    render(); pointer("pointerdown", 100, 120);
    render({ navigation: { layer: "preview", selectedFolderId: "folder-a" } });
    pointer("pointermove", 140, 150); pointer("pointerup", 140, 150); pointer("pointerdown", 100, 120);
    expect(pan).not.toHaveBeenCalled();
    expect(props.onBeginCanvasPan).toHaveBeenCalledTimes(1);
  });
  it("retains the existing left-click preview and left-drag move", () => {
    render(); pointer("pointerdown", 100, 120, 0); pointer("pointerup", 100, 120, 0);
    act(() => vi.runAllTimers());
    expect(props.onSelectFolder).toHaveBeenCalledExactlyOnceWith("folder-a");
    pointer("pointerdown", 100, 120, 0); pointer("pointerup", 140, 160, 0);
    expect(props.onMoveFolder).toHaveBeenCalledExactlyOnceWith("folder-a", 20, 20);
    expect(props.onBeginCanvasPan).not.toHaveBeenCalled();
  });
});
