// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@excalidraw/excalidraw", () => ({
  sceneCoordsToViewportCoords: ({ sceneX, sceneY }: { sceneX: number; sceneY: number }) => ({ x: sceneX, y: sceneY }),
  viewportCoordsToSceneCoords: ({ clientX, clientY }: { clientX: number; clientY: number }) => ({ x: clientX, y: clientY }),
}));
import { QuickAnnotationOverlay } from "./QuickAnnotationOverlay";

type Props = ComponentProps<typeof QuickAnnotationOverlay>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: Props;
const render = (extra: Partial<Props> = {}) => act(() => root.render(<QuickAnnotationOverlay {...props} {...extra} />));
const pointer = (element: Element, type: string, x: number) => act(() => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 120 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  element.dispatchEvent(event);
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  SVGElement.prototype.setPointerCapture = vi.fn();
  SVGElement.prototype.hasPointerCapture = () => false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {
    elements: [{ type: "image", x: 100, y: 100, width: 200, height: 100, angle: 0,
      isDeleted: false, scale: [1, 1], customData: { imageId: "image-a" } }] as unknown as Props["elements"],
    annotations: [{ id: "a", imageId: "image-a", active: true, ordinal: 1, mode: "rectangle",
      anchor: { x: 0.2, y: 0.2 }, rectangle: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      labelAnchor: { x: 0.4, y: 0.2 }, labelSide: "right", text: "test", collapsed: false,
      createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" }] as unknown as Props["annotations"],
    active: false, nextOrdinal: 2, selectedId: "a",
    viewport: { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 },
    onCreate: vi.fn(), onSelect: vi.fn(), onSetCollapsed: vi.fn(), onSetText: vi.fn(),
    onMove: vi.fn(), onMoveLabel: vi.fn(), onResize: vi.fn(),
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("quick annotation read-only preview", () => {
  it("removes move/resize targets and blocks labels, collapse, and editing", () => {
    render({ readOnly: true });
    expect(host.querySelector(".quick-annotation-overlay__resize-hit")).toBeNull();
    expect(host.querySelector(".quick-annotation-overlay__range-hit")).toBeNull();
    expect(host.querySelector(".quick-annotation-overlay__preview-marker")).not.toBeNull();
    const button = host.querySelector(".quick-annotation-overlay__preview-marker")!;
    pointer(button, "pointerdown", 120); pointer(button, "pointermove", 170); pointer(button, "pointerup", 170);
    expect(host.querySelector("input")).toBeNull();
    for (const callback of [props.onMove, props.onMoveLabel, props.onResize, props.onSelect,
      props.onSetText, props.onSetCollapsed, props.onCreate]) expect(callback).not.toHaveBeenCalled();
  });
  it("cancels an in-progress label move when entering preview and restores interaction on exit", () => {
    render();
    pointer(host.querySelector(".quick-annotation-overlay__badge")!, "pointerdown", 120);
    pointer(host.querySelector(".quick-annotation-overlay__badge")!, "pointermove", 170);
    render({ readOnly: true });
    pointer(host.querySelector(".quick-annotation-overlay__preview-marker")!, "pointerup", 170);
    expect(props.onMoveLabel).not.toHaveBeenCalled();
    render({ readOnly: false });
    act(() => (host.querySelector(".quick-annotation-overlay__badge") as HTMLButtonElement).click());
    expect(props.onSetCollapsed).toHaveBeenCalledWith("a", true);
  });
  it("hides outside labels and connectors only in preview, preserving the anchor and stored placement", () => {
    props.annotations = [{ ...props.annotations[0], labelAnchor: { x: -0.3, y: 1.1 } }];
    render({ readOnly: true });
    expect(host.querySelector(".quick-annotation-overlay__item")).toBeNull();
    expect(host.querySelector(".quick-annotation-overlay__connector")).toBeNull();
    expect(host.querySelector(".quick-annotation-overlay__preview-marker")).not.toBeNull();
    render({ readOnly: false });
    expect((host.querySelector(".quick-annotation-overlay__item") as HTMLElement).style.visibility).toBe("");
    expect(host.querySelector(".quick-annotation-overlay__connector")).not.toBeNull();
    expect(props.annotations[0].labelAnchor).toEqual({ x: -0.3, y: 1.1 });
  });
  it("registers every annotation part with the owning image animation", () => {
    render({ readOnly: true, previewMotion: { sourceRect: { left: 20, top: 50 }, imageIds: new Set(["other", "image-a"]), targets: new Map([["image-a", { left: 100, top: 100, width: 200, height: 100 }]]) } });
    const parts = host.querySelectorAll<HTMLElement>(".quick-annotation-preview-motion");
    expect(parts.length).toBe(3);
    const marker = host.querySelector(".quick-annotation-overlay__preview-marker")!;
    expect(marker.className).not.toContain("quick-annotation-preview-motion");
    expect(host.querySelector(".quick-annotation-overlay__preview-marker-motion")?.className)
      .toContain("quick-annotation-preview-motion");
    parts.forEach((part) => {
      expect(part.style.getPropertyValue("--folder-motion-closed-transform")).toBe("translate(-80px, -50px) scale(.42)");
      expect(part.dataset.folderMotion).toBe("member");
      expect(part.dataset.folderMotionIndex).toBe("1");
      expect(part.style.animationDelay).toBe("");
    });
  });
});
