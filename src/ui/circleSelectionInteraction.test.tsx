// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@excalidraw/excalidraw", () => ({
  sceneCoordsToViewportCoords: ({ sceneX, sceneY }: { sceneX: number; sceneY: number }) => ({ x: sceneX, y: sceneY }),
  viewportCoordsToSceneCoords: ({ clientX, clientY }: { clientX: number; clientY: number }) => ({ x: clientX, y: clientY }),
}));
import { SelectionCanvasOverlay } from "./SelectionCanvasOverlay";
type Props = ComponentProps<typeof SelectionCanvasOverlay>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: Props;
const pointer = (element: Element, type: string, x: number, y: number, shiftKey = false) => act(() => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, shiftKey });
  Object.defineProperty(event, "pointerId", { value: 1 });
  element.dispatchEvent(event);
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.hasPointerCapture = () => false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {
    elements: [{ id: "image", type: "image", x: 0, y: 0, width: 400, height: 300, angle: 0,
      customData: { imageId: "i" } }, { id: "ellipse", type: "ellipse", x: 40, y: 40,
      width: 100, height: 60, angle: 0,
      customData: { kind: "region", regionId: "r", imageId: "i", selectionKind: "ellipse" } }] as unknown as Props["elements"],
    selectedRegionIds: new Set(["r"]), creationTool: null, creationImageId: null,
    viewport: { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 },
    onCreateSelection: vi.fn(), onCreationRejected: vi.fn(), onSelectRegion: vi.fn(),
    onMoveRegion: vi.fn(), onVertexChange: vi.fn(), onEllipseChange: vi.fn(),
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("circle pointer and keyboard constraints", () => {
  it("reads Shift during a drag and commits the pointer-up modifier", () => {
    act(() => root.render(<SelectionCanvasOverlay {...props} />));
    const handle = host.querySelector('[data-selection-edge="right"]')!;
    const svg = handle.closest("svg")!;
    pointer(handle, "pointerdown", 140, 70);
    pointer(svg, "pointermove", 160, 70, false);
    expect(props.onEllipseChange).toHaveBeenLastCalledWith("r", "right", { x: 160, y: 70 }, false, false);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true })));
    expect(props.onEllipseChange).toHaveBeenLastCalledWith("r", "right", { x: 160, y: 70 }, false, true);
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" })));
    expect(props.onEllipseChange).toHaveBeenLastCalledWith("r", "right", { x: 160, y: 70 }, false, false);
    pointer(svg, "pointerup", 170, 70, true);
    expect(props.onEllipseChange).toHaveBeenLastCalledWith("r", "right", { x: 170, y: 70 }, true, true);
  });
  it("constrains both the draft and final newly created ellipse", () => {
    act(() => root.render(<SelectionCanvasOverlay {...props} creationTool="ellipse" creationImageId="i" />));
    const svg = host.querySelector("svg")!;
    pointer(svg, "pointerdown", 200, 100);
    pointer(svg, "pointermove", 280, 140);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true })));
    const draft = host.querySelector(".selection-canvas-overlay__draft-shape")!;
    expect(draft.getAttribute("rx")).toBe(draft.getAttribute("ry"));
    pointer(svg, "pointerup", 280, 140, true);
    expect(props.onCreateSelection).toHaveBeenCalledWith("ellipse", [{ x: 200, y: 100 }, { x: 280, y: 180 }]);
  });
});
