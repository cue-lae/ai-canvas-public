// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  sceneCoordsToViewportCoords: ({ sceneX, sceneY }: { sceneX: number; sceneY: number }, state: { zoom: { value: number }; scrollX: number; scrollY: number }) =>
    ({ x: (sceneX + state.scrollX) * state.zoom.value, y: (sceneY + state.scrollY) * state.zoom.value }),
  viewportCoordsToSceneCoords: () => ({ x: 0, y: 0 }),
}));
import { SelectionCanvasOverlay } from "./SelectionCanvasOverlay";
type Props = ComponentProps<typeof SelectionCanvasOverlay>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 2000, height: 1200 } as DOMRect);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const props = (zoom: number): Props => ({
  elements: [
    { id: "image", type: "image", x: 0, y: 0, width: 400, height: 300, angle: 0, customData: { imageId: "image" } },
    { id: "cover", type: "image", x: 50, y: 40, width: 280, height: 240, angle: Math.PI / 7, customData: { imageId: "cover" } },
    ...["rectangle", "ellipse"].map((kind, index) => ({ id: kind, type: kind, x: 100 + index * 30, y: 100, width: 90, height: 60, angle: index * Math.PI / 6,
      customData: { kind: "region", regionId: kind, imageId: "image", selectionKind: kind } })),
  ] as unknown as Props["elements"],
  viewport: { zoom, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 },
  regionNumbers: new Map([["rectangle", 1], ["ellipse", 2]]),
  regionBindings: new Map([["rectangle", [{ id: "description", number: 10 }]]]),
  creationTool: null, creationImageId: null, onCreateSelection: vi.fn(), onCreationRejected: vi.fn(),
  onSelectRegion: vi.fn(), onMoveRegion: vi.fn(), onVertexChange: vi.fn(), onEllipseChange: vi.fn(),
});

describe("read-only folder preview masks", () => {
  it("does not allocate unused viewport clipping resources for image-only or single-image previews", () => {
    const input = props(1);
    input.elements = input.elements.filter((element) => element.id === "image");
    const motion = { sourceRect: { left: 10, top: 10 }, imageIds: new Set(["image"]) };
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={motion} />));
    expect(host.querySelectorAll("mask, clipPath")).toHaveLength(0);
    expect(host.querySelector(".selection-canvas-overlay__draft-layer")!.children).toHaveLength(0);
    input.elements = props(1).elements.filter((element) => element.id !== "cover");
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={motion} />));
    expect(host.querySelectorAll(".selection-canvas-overlay__shape")).toHaveLength(2);
    expect(host.querySelectorAll("mask, clipPath")).toHaveLength(0);
  });

  it("uses the original selection silhouette and viewport clip when higher images cannot cover it", () => {
    const input = props(1);
    input.elements = input.elements.map((element) => element.id === "cover" ? { ...element, x: 800, y: 700 } : element);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={{ sourceRect: { left: 10, top: 10 }, imageIds: new Set(["image", "cover"]) }} />));
    expect(host.querySelectorAll("mask")).toHaveLength(0);
    expect(host.querySelectorAll("clipPath")).toHaveLength(5);
    expect(host.querySelectorAll('.selection-canvas-overlay__shape[clip-path], .selection-canvas-overlay__badge-group[clip-path]')).toHaveLength(4);
    const silhouette = host.querySelector("clipPath#selection-occlusion-0 path")!;
    expect(silhouette.getAttribute("d")).toBe("M 100 100 L 190 100 L 190 160 L 100 160 Z");
    expect(silhouette.getAttribute("clip-path")).toBe("url(#selection-preview-viewport)");
    act(() => root.render(<SelectionCanvasOverlay {...input} />));
    expect(host.querySelectorAll("mask")).toHaveLength(4);
    expect(host.querySelectorAll("clipPath")).toHaveLength(0);
  });

  it.each([0.1, 1, 4])("bounds masks at zoom %s while retaining every cover, label and animation attachment", (zoom) => {
    const input = props(zoom);
    const previewMotion = { sourceRect: { left: 10, top: 10 }, imageIds: new Set(["image", "cover"]) };
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={previewMotion} />));
    const masks = [...host.querySelectorAll("mask")];
    const maskContent = masks.map((mask) => mask.innerHTML);
    const shapeContent = [...host.querySelectorAll(".selection-canvas-overlay__shape")].map((node) => node.outerHTML);
    const badgeText = [...host.querySelectorAll("text")].map((node) => node.textContent);
    expect(masks).toHaveLength(4);
    expect(host.querySelectorAll("[data-folder-motion-image-id='image']")).toHaveLength(4);
    for (const mask of masks) {
      expect(Number(mask.getAttribute("width")) * Number(mask.getAttribute("height"))).toBeLessThan(2000 * 1200);
      expect(mask.querySelectorAll("path[fill='black']")).toHaveLength(1);
    }
    act(() => root.render(<SelectionCanvasOverlay {...input} />));
    expect([...host.querySelectorAll("mask")].map((mask) => mask.innerHTML)).toEqual(maskContent);
    expect([...host.querySelectorAll("mask")].every((mask) => mask.getAttribute("width") === "100%" && mask.getAttribute("height") === "100%")).toBe(true);
    expect([...host.querySelectorAll(".selection-canvas-overlay__shape")].map((node) => node.outerHTML)).toEqual(shapeContent);
    expect([...host.querySelectorAll("text")].map((node) => node.textContent)).toEqual(badgeText);
    expect(input.elements).toHaveLength(4);
  });
});
