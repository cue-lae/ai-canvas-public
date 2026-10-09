// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@excalidraw/excalidraw", () => ({
  sceneCoordsToViewportCoords: ({ sceneX, sceneY }: { sceneX: number; sceneY: number }) => ({ x: sceneX, y: sceneY }),
  viewportCoordsToSceneCoords: ({ clientX, clientY }: { clientX: number; clientY: number }) => ({ x: clientX, y: clientY }),
}));
import { SelectionCanvasOverlay } from "./SelectionCanvasOverlay";
import { QuickAnnotationOverlay } from "./QuickAnnotationOverlay";
type RegionProps = ComponentProps<typeof SelectionCanvasOverlay>;
type QuickProps = ComponentProps<typeof QuickAnnotationOverlay>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let regionProps: RegionProps;
let quickProps: QuickProps;
const pointer = (element: Element, type: string, x = 130, y = 130) => act(() => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 7 });
  element.dispatchEvent(event);
});
const render = () => act(() => root.render(<>
  <SelectionCanvasOverlay {...regionProps} />
  <QuickAnnotationOverlay {...quickProps} />
</>));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.hasPointerCapture = () => false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const elements = [{ id: "image", type: "image", x: 0, y: 0, width: 500, height: 400, angle: 0,
    scale: [1, 1], customData: { imageId: "i" } },
    ...["a", "b"].map(id => ({ id, type: "rectangle", x: 100, y: 100, width: 80, height: 80, angle: 0,
      customData: { kind: "region", regionId: id, imageId: "i", selectionKind: "rectangle" } }))] as unknown as RegionProps["elements"];
  const viewport = { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 };
  regionProps = { elements, viewport, selectedRegionIds: new Set(), regionNumbers: new Map([["a", 1], ["b", 2]]),
    creationTool: null, creationImageId: null, onSelectRegion: vi.fn(), onCreateSelection: vi.fn(),
    onCreationRejected: vi.fn(), onMoveRegion: vi.fn(), onVertexChange: vi.fn(), onEllipseChange: vi.fn() };
  quickProps = { elements, viewport, active: false, selectedId: null, nextOrdinal: 3,
    annotations: ["q1", "q2"].map((id, index) => ({ id, imageId: "i", active: true, ordinal: index + 1,
      mode: "rectangle", anchor: { x: .1, y: .1 }, rectangle: { x: .1, y: .1, width: .6, height: .6 },
      labelAnchor: { x: .8, y: .1 }, labelSide: "right", text: id, collapsed: false,
      createdAt: "2026-10-09", updatedAt: "2026-10-09" })) as QuickProps["annotations"],
    onCreate: vi.fn(), onSelect: vi.fn(), onSetCollapsed: vi.fn(), onSetText: vi.fn(),
    onMove: vi.fn(), onMoveLabel: vi.fn(), onResize: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("overlapping selection presentation", () => {
  it("activates a covered region from its number without remounting or duplicating its shape", () => {
    regionProps.onSelectRegionFromBadge = id => {
      regionProps = { ...regionProps, selectedRegionIds: new Set([id]) };
      quickProps = { ...quickProps, selectedId: null };
      render();
    };
    render();
    const layer = host.querySelector('[data-region-layer="a"]')!;
    const shape = layer.querySelector('[data-selection-drag="move"]')!;
    const number = host.querySelector('[aria-label="选择01"]')!;
    act(() => number.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector('[data-region-layer="a"]')).toBe(layer);
    expect(layer.querySelector('[data-selection-drag="move"]')).toBe(shape);
    expect(layer.classList.contains("is-active")).toBe(true);
    expect(host.querySelectorAll('[data-canvas-object="region"][data-region-id="a"]')).toHaveLength(1);
    pointer(shape, "pointerdown"); pointer(layer, "pointermove", 150, 140); pointer(layer, "pointerup", 150, 140);
    expect(regionProps.onMoveRegion).toHaveBeenCalledWith("a", { x: 20, y: 10 }, false);
    expect(quickProps.onMove).not.toHaveBeenCalled();
    const before = regionProps.elements;
    regionProps = { ...regionProps, selectedRegionIds: new Set() }; render();
    expect(layer.classList.contains("is-active")).toBe(false);
    expect(host.querySelector('[data-region-layer="a"]')).toBe(layer);
    expect(regionProps.elements).toBe(before);
  });
  it("keeps Q pointer capture nodes stable when selection changes during a move", () => {
    quickProps.onSelect = id => { quickProps = { ...quickProps, selectedId: id }; render(); };
    render();
    const layer = host.querySelector('[data-quick-range-layer="q1"]')!;
    const range = layer.querySelector(".quick-annotation-overlay__range-hit")!;
    pointer(range, "pointerdown");
    expect(range.setPointerCapture).toHaveBeenCalledWith(7);
    expect(layer.classList.contains("is-active")).toBe(true);
    expect(layer.querySelector(".quick-annotation-overlay__range-hit")).toBe(range);
    pointer(range, "pointermove", 150, 140); pointer(range, "pointerup", 150, 140);
    expect(quickProps.onMove).toHaveBeenCalled();
    quickProps = { ...quickProps, selectedId: "q2" }; render();
    expect(layer.classList.contains("is-active")).toBe(false);
    expect(host.querySelector('[data-quick-range-layer="q2"]')!.classList.contains("is-active")).toBe(true);
  });
  it("does not elevate read-only or drawing targets and preserves Q collapse gestures", () => {
    regionProps = { ...regionProps, selectedRegionIds: new Set(["a"]), readOnly: true };
    quickProps = { ...quickProps, selectedId: "q1", readOnly: true }; render();
    expect(host.querySelectorAll(".selection-canvas-overlay__region-layer.is-active, .quick-annotation-overlay__range-layer.is-active")).toHaveLength(0);
    act(() => host.querySelector('[aria-label="选择01"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(regionProps.onSelectRegion).not.toHaveBeenCalled();
    regionProps = { ...regionProps, readOnly: false, creationTool: "rectangle", creationImageId: "i" };
    quickProps = { ...quickProps, readOnly: false, disabled: true }; render();
    expect(host.querySelectorAll(".selection-canvas-overlay__region-layer.is-active, .quick-annotation-overlay__range-layer.is-active")).toHaveLength(0);
    quickProps = { ...quickProps, disabled: false, active: true }; render();
    expect(host.querySelector(".quick-annotation-overlay__range-layer.is-active")).toBeNull();
    quickProps = { ...quickProps, active: false }; render();
    act(() => (host.querySelector('[aria-label="快速标注 Q1，收拢文本"]') as HTMLButtonElement).click());
    expect(quickProps.onSetCollapsed).toHaveBeenCalledWith("q1", true);
  });
});
