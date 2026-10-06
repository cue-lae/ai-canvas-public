// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
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
const render = (extra: Partial<Props> = {}) => act(() => root.render(createElement(QuickAnnotationOverlay, { ...props, ...extra })));
const edit = () => act(() => host.querySelector(".quick-annotation-overlay__text")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
const typeText = (text: string) => act(() => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const key = (key: string) => act(() => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {
    elements: [{ type: "image", x: 100, y: 100, width: 200, height: 100, angle: 0,
      isDeleted: false, scale: [1, 1], customData: { imageId: "image-a" } }] as unknown as Props["elements"],
    annotations: [{ id: "a", imageId: "image-a", active: true, ordinal: 12, mode: "point",
      anchor: { x: .2, y: .2 }, labelAnchor: { x: -.1, y: .1 }, labelSide: "left", text: "原注释", collapsed: false,
      createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z" }],
    active: true, nextOrdinal: 13, selectedId: "a",
    viewport: { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 },
    onCreate: vi.fn(), onSelect: vi.fn(), onSetCollapsed: vi.fn(), onSetText: vi.fn(),
    onMove: vi.fn(), onMoveLabel: vi.fn(), onResize: vi.fn(),
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("quick annotation shared-surface editing", () => {
  it("switches only the connector edge while preserving left-aligned stored placement", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(26);
    render();
    const path = () => host.querySelector(".quick-annotation-overlay__connector")!.getAttribute("d")!;
    expect(path()).toMatch(/80 123$/);
    const moved = { ...props.annotations[0], labelAnchor: { x: 1.5, y: .1 } };
    render({ annotations: [moved] });
    expect(path()).toMatch(/280 123$/);
    const label = host.querySelector<HTMLElement>(".quick-annotation-overlay__item")!;
    expect(label.style.left).toBe("400px");
    expect(label.style.transform).toBe("translateX(-100%)");
    render();
    expect(path()).toMatch(/80 123$/);
    expect(props.onMoveLabel).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
  });
  it("keeps the same label and connection side when editing and commits text once", () => {
    render();
    const label = host.querySelector<HTMLElement>(".quick-annotation-overlay__item")!;
    const placement = label.getAttribute("style");
    const connector = host.querySelector(".quick-annotation-overlay__connector")!.getAttribute("d");
    edit();
    expect(host.querySelector("input")?.closest(".quick-annotation-overlay__item")).toBe(label);
    expect(label.getAttribute("style")).toBe(placement);
    expect(label.querySelector(".quick-annotation-overlay__badge")?.textContent).toBe("Q12");
    expect(host.querySelector(".quick-annotation-overlay__connector")!.getAttribute("d")).toBe(connector);
    typeText("修改后的注释"); key("Enter");
    expect(props.onSetText).toHaveBeenCalledExactlyOnceWith("a", "修改后的注释");
    expect(props.onMoveLabel).not.toHaveBeenCalled();
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(host.querySelector("input")).toBeNull();
  });
  it("cancels without mutating text or geometry", () => {
    render(); edit(); typeText("不要保存"); key("Escape");
    expect(props.onSetText).not.toHaveBeenCalled();
    expect(props.onMove).not.toHaveBeenCalled();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector(".quick-annotation-overlay__text")?.textContent).toBe("原注释");
  });
  it("retains blur submission and rejects empty changes", () => {
    render(); edit(); typeText("失焦提交");
    act(() => host.querySelector("input")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(props.onSetText).toHaveBeenCalledExactlyOnceWith("a", "失焦提交");
    edit(); typeText("   "); key("Enter");
    expect(props.onSetText).toHaveBeenCalledTimes(1);
  });
  it("does not expose the editor in read-only or disabled views", () => {
    render({ disabled: true }); edit();
    expect(host.querySelector("input")).toBeNull();
    render({ readOnly: true });
    expect(host.querySelector(".quick-annotation-overlay__item")).toBeNull();
    expect(host.querySelector(".quick-annotation-overlay__point-hit")).toBeNull();
    expect(props.onSetText).not.toHaveBeenCalled();
  });
});
