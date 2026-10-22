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

describe("complete-target folder preview mask integration", () => {
  let previousBBox: PropertyDescriptor | undefined;
  let measuredBBox: { x: number; y: number; width: number; height: number };
  let bboxReads: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    measuredBBox = { x: 100, y: 100, width: 90, height: 60 };
    previousBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");
    bboxReads = vi.fn(() => ({ ...measuredBBox }));
    Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: bboxReads });
    vi.stubGlobal("DOMMatrix", class {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(value?: string) {
        if (!value || value === "none") return;
        const match = /^matrix\(([^)]+)\)$/.exec(value);
        if (!match) throw new Error("This test stub accepts only the browser's 2D computed matrix");
        [this.a, this.b, this.c, this.d, this.e, this.f] = match[1].split(",").map(Number);
      }
    });
  });

  afterEach(() => {
    if (previousBBox) Object.defineProperty(SVGElement.prototype, "getBBox", previousBBox);
    else Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  });

  const motion = (): NonNullable<Props["previewMotion"]> => ({
    sourceRect: { left: 10, top: 10 },
    imageIds: new Set(["image", "cover"]),
    targets: new Map([
      ["image", { left: 0, top: 0, width: 400, height: 300, angle: Math.PI / 4 }],
      ["cover", { left: 50, top: 40, width: 280, height: 240, angle: -Math.PI / 6 }],
    ]),
  });

  const shapeFor = (regionId: string) => host.querySelector<SVGElement>(
    `.selection-canvas-overlay__shape[data-region-id='${regionId}']`,
  )!;
  const badgeFor = (regionId: string) => host.querySelector<SVGGElement>(
    `.selection-canvas-overlay__badge-group[data-region-id='${regionId}']`,
  )!;

  it("keeps owner and foreground image transforms on their own animation indices", () => {
    const input = props(1), previewMotion = motion();
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={previewMotion} />));
    const frame = host.querySelector<SVGGElement>("[data-preview-mask-content='selection-occlusion-0']")!;
    expect(frame.dataset.folderMotionImageId).toBe("image");
    expect(frame.dataset.folderMotionIndex).toBe("0");
    expect(frame.style.getPropertyValue("rotate")).toBe(`${Math.PI / 4}rad`);
    expect(frame.style.transformOrigin).toBe("0px 0px");
    expect(frame.style.getPropertyValue("--folder-motion-closed-transform")).toBe("translate(10px, 10px) scale(.42)");
    expect(frame.firstElementChild!.getAttribute("transform")).toBe("rotate(-45 200 150)");
    const covers = [...host.querySelectorAll<SVGRectElement>("rect[data-preview-mask-cover='cover']")];
    expect(covers).toHaveLength(4);
    for (const cover of covers) {
      expect(cover.dataset.folderMotionImageId).toBe("cover");
      expect(cover.dataset.folderMotionIndex).toBe("1");
      expect(cover.style.getPropertyValue("rotate")).toBe(`${-Math.PI / 6}rad`);
      expect(cover.style.transformOrigin).toBe("50px 40px");
      expect(cover.style.getPropertyValue("--folder-motion-closed-transform")).toBe("translate(-40px, -30px) scale(.42)");
      expect(cover.getAttribute("rx")).toBe("6");
      expect(cover.getAttribute("fill")).toBe("black");
    }
    expect(input.elements).toHaveLength(4);
  });

  it("puts masks and the viewport outside moving shapes and badges", () => {
    const input = props(1);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={motion()} />));
    for (const regionId of ["rectangle", "ellipse"]) {
      const shape = shapeFor(regionId);
      expect(shape.hasAttribute("mask")).toBe(false);
      expect(shape.hasAttribute("clip-path")).toBe(false);
      const moving = shape.closest<SVGGElement>("[data-preview-mask-content]")!;
      const silhouette = moving.parentElement!;
      const stableMask = silhouette.parentElement!;
      expect(stableMask.getAttribute("mask")).toBe(`url(#${moving.dataset.previewMaskContent})`);
      expect(stableMask.getAttribute("clip-path")).toBe("url(#selection-preview-viewport)");
      expect(stableMask.hasAttribute("data-folder-motion")).toBe(false);
      expect(stableMask.closest("[data-folder-motion]")).toBeNull();
      const selection = shape.closest(".selection-canvas-overlay__selection")!;
      expect(selection.hasAttribute("data-folder-motion")).toBe(false);
      const badge = badgeFor(regionId);
      expect(badge.getAttribute("clip-path")).toBe("url(#selection-preview-viewport)");
      expect(badge.hasAttribute("data-folder-motion")).toBe(false);
      const badgeFrame = badge.querySelector<SVGGElement>("[data-preview-mask-content]")!;
      expect(badge.getAttribute("mask")).toBe(`url(#${badgeFrame.dataset.previewMaskContent})`);
      expect(badgeFrame.dataset.folderMotionIndex).toBe("0");
    }
    const viewportClip = host.querySelector("clipPath#selection-preview-viewport")!;
    expect(viewportClip.querySelector("rect")!.getAttribute("width")).toBe("100%");
    expect(viewportClip.querySelector("[data-folder-motion]")).toBeNull();
  });

  it("uses an inverse-rotated raw silhouette, independent from the ellipse's own rotation", () => {
    act(() => root.render(<SelectionCanvasOverlay {...props(1)} readOnly previewMotion={motion()} />));
    const silhouette = host.querySelector<SVGPathElement>("clipPath#selection-occlusion-0-silhouette > path")!;
    expect(silhouette.dataset.folderMotionIndex).toBe("0");
    expect(silhouette.parentElement!.hasAttribute("data-folder-motion")).toBe(false);
    expect(silhouette.hasAttribute("clip-path")).toBe(false);
    const coordinates = silhouette.getAttribute("d")!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
    // Original first point (100,100), inverse rotated around the image centre (200,150).
    expect(coordinates[0]).toBeCloseTo(200 - 150 / Math.sqrt(2), 8);
    expect(coordinates[1]).toBeCloseTo(150 + 50 / Math.sqrt(2), 8);
    expect(silhouette.getAttribute("d")).not.toBe(shapeFor("rectangle").getAttribute("d"));
    const ellipseClip = host.querySelector("clipPath#selection-occlusion-1-silhouette > path")!;
    expect(ellipseClip.getAttribute("d")!.match(/\bL\b/g)).toHaveLength(31);
    expect(Number(/^rotate\(([^ ]+)/.exec(shapeFor("ellipse").getAttribute("transform")!)![1]))
      .toBeCloseTo(30, 8);
    expect(shapeFor("ellipse").hasAttribute("mask")).toBe(false);
  });

  it("keeps selected handles outside the shape masks while following the owner", () => {
    const input = props(1);
    input.selectedRegionIds = new Set(["rectangle", "ellipse"]);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={motion()} />));
    const handles = [...host.querySelectorAll<SVGCircleElement>(".selection-canvas-overlay__handle")];
    expect(handles).toHaveLength(8);
    for (const handle of handles) {
      expect(handle.closest("[mask], [clip-path]")).toBeNull();
      const owner = handle.closest<SVGGElement>("[data-folder-motion]")!;
      expect(owner.dataset.folderMotionImageId).toBe("image");
      expect(owner.dataset.folderMotionIndex).toBe("0");
      expect(owner.hasAttribute("data-preview-mask-content")).toBe(false);
    }
  });

  it("keeps the single-image path free of mask and viewport allocations with complete targets", () => {
    const input = props(1);
    input.elements = input.elements.filter((element) => element.id !== "cover");
    const previewMotion = motion();
    previewMotion.imageIds = new Set(["image"]);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={previewMotion} />));
    expect(host.querySelectorAll("mask, clipPath")).toHaveLength(0);
    expect(host.querySelectorAll(".selection-canvas-overlay__shape")).toHaveLength(2);
    expect(shapeFor("rectangle").closest("[data-folder-motion-image-id='image']")).not.toBeNull();
    expect(badgeFor("rectangle").querySelector("g[transform='rotate(-45 200 150)']")).not.toBeNull();
  });

  it("bounds the sweep again after the overlay's internal measurement and later panel resize", () => {
    measuredBBox = { x: 120, y: 90, width: 80, height: 40 };
    const input = props(1), previewMotion = motion();
    previewMotion.sourceRect = { left: 40, top: 50 };
    previewMotion.targets = new Map([
      ["image", { left: 100, top: 80, width: 160, height: 100, angle: 0 }],
      ["cover", { left: 50, top: 40, width: 280, height: 240, angle: -Math.PI / 6 }],
    ]);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={previewMotion} />));
    const shapeMask = host.querySelector<SVGMaskElement>("mask#selection-occlusion-0")!;
    const getBounds = (node: Element) => ["x", "y", "width", "height"].map((name) => Number(node.getAttribute(name)));
    expect(getBounds(shapeMask)).toEqual([46, 52, 156, 80]);
    expect(bboxReads.mock.calls.length).toBeGreaterThanOrEqual(8);
    const badgeMask = host.querySelector<SVGMaskElement>("mask#selection-badge-occlusion-0")!;
    expect(getBounds(badgeMask)).toEqual([36, 42, 176, 100]);

    // Retargeting starts from a currently displayed matrix outside both fresh endpoints.
    const frame = host.querySelector<SVGGElement>("[data-preview-mask-content='selection-occlusion-0']")!;
    frame.style.transform = "matrix(0.63, 0, 0, 0.63, 350, 220)";
    input.regionBindings = new Map(input.regionBindings);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={previewMotion} />));
    const retargeted = getBounds(shapeMask);
    expect(retargeted[0] + retargeted[2]).toBeGreaterThan(510);
    expect(retargeted[2] * retargeted[3]).toBeLessThan(2000 * 1200);

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 170, height: 110 } as DOMRect);
    act(() => window.dispatchEvent(new Event("resize")));
    const resized = getBounds(shapeMask);
    expect(resized[0] + resized[2]).toBe(170);
    expect(resized[1] + resized[3]).toBe(110);
    expect(resized[2] * resized[3]).toBeLessThan(170 * 110);
  });

  it("reverts to the original editable mask structure after leaving preview", () => {
    const input = props(1);
    act(() => root.render(<SelectionCanvasOverlay {...input} />));
    const originalRectanglePath = shapeFor("rectangle").getAttribute("d");
    const originalEllipseTransform = shapeFor("ellipse").getAttribute("transform");
    const originalBadgeText = [...host.querySelectorAll("text")].map((node) => node.textContent);
    const originalMasks = [...host.querySelectorAll("mask")].map((node) => node.innerHTML);
    act(() => root.render(<SelectionCanvasOverlay {...input} readOnly previewMotion={motion()} />));
    expect(host.querySelectorAll("[data-preview-mask-for]")).toHaveLength(4);
    act(() => root.render(<SelectionCanvasOverlay {...input} />));
    expect(host.querySelectorAll("[data-preview-mask-for], [data-preview-mask-content], [data-folder-motion], clipPath")).toHaveLength(0);
    expect([...host.querySelectorAll("mask")].map((node) => node.innerHTML)).toEqual(originalMasks);
    expect(shapeFor("rectangle").getAttribute("d")).toBe(originalRectanglePath);
    expect(shapeFor("ellipse").getAttribute("transform")).toBe(originalEllipseTransform);
    expect(shapeFor("rectangle").parentElement!.classList.contains("selection-canvas-overlay__selection")).toBe(true);
    expect(shapeFor("ellipse").parentElement!.classList.contains("selection-canvas-overlay__selection")).toBe(true);
    expect([...host.querySelectorAll("text")].map((node) => node.textContent)).toEqual(originalBadgeText);
    expect(host.querySelectorAll("mask[width='100%'][height='100%']")).toHaveLength(4);
  });
});
