// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageRotationFeedback } from "./ImageRotationFeedback";
import type { AppState, ExcalidrawImperativeAPI, PointerDownState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let onChange: (elements: readonly ExcalidrawElement[], state: AppState) => void;
let onUp: () => void;
let onDown: (tool: AppState["activeTool"], down: PointerDownState) => void;
let api: ExcalidrawImperativeAPI;
let state: AppState;
let elements: ExcalidrawElement[];
let unsubChange: ReturnType<typeof vi.fn>;
let unsubUp: ReturnType<typeof vi.fn>;
const panelRef = { current: null as HTMLElement | null };
const render = () => act(() => root.render(
  <ImageRotationFeedback api={api} panelRef={panelRef} />,
));
const update = () => act(() => onChange(elements, state));
const begin = (origin = { x: 200, y: 84 }) => act(() => onDown({ type: "selection" } as AppState["activeTool"], {
  origin,
  resize: { handleType: "rotation" },
  originalElements: new Map([[elements[0].id, { ...elements[0] }]]),
} as unknown as PointerDownState));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  panelRef.current = host;
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }) as DOMRect;
  state = { isRotating: false, selectedElementIds: { img: true }, zoom: { value: 1 } } as unknown as AppState;
  elements = [{ id: "img", type: "image", isDeleted: false, x: 100, y: 100, width: 200, height: 100, angle: 0 }] as ExcalidrawElement[];
  unsubChange = vi.fn(); unsubUp = vi.fn();
  api = {
    getAppState: () => state, getSceneElements: () => elements,
    onChange: (callback: typeof onChange) => { onChange = callback; return unsubChange; },
    onPointerUp: (callback: typeof onUp) => { onUp = callback; return unsubUp; },
    onPointerDown: (callback: typeof onDown) => { onDown = callback; return vi.fn(); },
    updateScene: vi.fn(), setActiveTool: vi.fn(),
  } as unknown as ExcalidrawImperativeAPI;
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("rotation display without scene writes", () => {
  it("shows only during a single image rotation and disappears on release", () => {
    render();
    expect(host.querySelector(".canvas-view-controls__rotation")).toBeNull();
    state.isRotating = true;
    begin();
    const before = structuredClone(elements);
    update();
    expect(host.textContent).toBe("旋转0°");
    expect(host.querySelector(".is-aligned")).not.toBeNull();
    expect(host.querySelector(".image-rotation-feedback__guide")).toBeNull();
    expect(host.querySelector("kbd")).toBeNull();
    expect(elements).toEqual(before);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(api.setActiveTool).not.toHaveBeenCalled();
    act(() => onUp());
    expect(host.querySelector(".canvas-view-controls__rotation")).toBeNull();
  });
  it("hides on blur and ignores group rotation", () => {
    state.isRotating = true; render(); begin(); update();
    expect(host.textContent).toBe("旋转0°");
    act(() => window.dispatchEvent(new Event("blur")));
    expect(host.textContent).toBe("");
    begin();
    elements.push({ ...elements[0], id: "second" });
    state.selectedElementIds = { img: true, second: true };
    update();
    expect(host.textContent).toBe("");
  });
  it("highlights true alignment only and never draws guides", () => {
    state.isRotating = true; elements[0] = { ...elements[0], angle: 0.04 * Math.PI / 180 };
    render(); begin(); update();
    expect(host.textContent).toBe("旋转≈0.0°");
    expect(host.querySelector(".is-aligned")).toBeNull();
    expect(host.querySelector(".image-rotation-feedback__guide")).toBeNull();
    elements[0] = { ...elements[0], angle: Math.PI / 2 };
    update();
    expect(host.textContent).toBe("旋转90°");
    expect(host.querySelector(".is-aligned")).not.toBeNull();
    expect(host.querySelector(".image-rotation-feedback__guide")).toBeNull();
    state.isRotating = false; update();
    expect(host.textContent).toBe("");
  });
  it("reads angles without image or pointer positioning in the toolbar", () => {
    render(); begin(); state.isRotating = true; update();
    const label = () => host.querySelector<HTMLElement>(".canvas-view-controls__rotation")!;
    expect(label().getAttribute("style")).toBeNull();
    act(() => onUp());
    begin({ x: 207, y: 89 }); update();
    expect(label().getAttribute("style")).toBeNull();
    act(() => host.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 600 })));
    update();
    expect(label().getAttribute("style")).toBeNull();
    elements[0] = { ...elements[0], angle: Math.PI / 2 };
    update();
    expect(label().textContent).toBe("旋转90°");
    expect(label().getAttribute("style")).toBeNull();
  });
});
