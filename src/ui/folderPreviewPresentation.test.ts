// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderWorkspace } from "./folderWorkspace";

type Props = ComponentProps<typeof FolderWorkspace>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: Props;
const render = (extra: Partial<Props> = {}) => act(() => root.render(createElement(FolderWorkspace, { ...props, ...extra })));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // Diagnostic fixture: browsers provide this decoration observer; jsdom does not.
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {
    navigation: { layer: "preview", selectedFolderId: "f" }, descriptions: [],
    items: [{ folder: { id: "f", schemaVersion: 2, kind: "folder", name: "示例文件夹", imageAssetIds: ["i"], descriptionIds: ["d"], focusImageIds: [], createdAt: "2026-09-26", updatedAt: "2026-09-26" }, bounds: { x: 20, y: 150, width: 120, height: 150 } }],
    viewport: { zoom: 1, scrollX: 0, scrollY: 0, offsetLeft: 0, offsetTop: 0 },
    previewCoverBounds: { x: 20, y: 150, width: 108, height: 135 },
    previewMotion: { folderId: "f", images: [{ id: "i", imageUrl: "data:image/png;base64,", target: { x: 160, y: 50, width: 100, height: 100, scale: 1, angle: 0 } }], descriptions: [{ id: "d", label: "说明 1", text: "正文", target: { x: 160, y: 200, width: 100, height: 80, scale: 1 } }] },
    onSelectFolder: vi.fn(), onEnterFolder: vi.fn(), onMoveFolder: vi.fn(), onDeleteFolder: vi.fn(), onUngroupFolder: vi.fn(), onSelectDescription: vi.fn(), onMoveDescription: vi.fn(), onPreviewClosed: vi.fn(), onPreviewReopen: vi.fn(),
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("Folder preview presentation", () => {
  it("drives sibling selection overlays when reduced motion completes a preview", () => {
    const panel = document.createElement("div"); panel.className = "canvas-panel";
    document.body.append(panel); panel.append(host);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const attachment = document.createElementNS(svg.namespaceURI, "g") as SVGGElement;
    attachment.dataset.folderMotion = "member";
    attachment.style.setProperty("--folder-motion-closed-transform", "translate(-140px, 100px) scale(.42)");
    svg.append(attachment); panel.append(svg);
    render(); expect(attachment.style.opacity).toBe("1");
    render({ previewClosing: true });
    expect(attachment.style.opacity).toBe("0");
    expect(attachment.style.transform).toBe("translate(-140px, 100px) scale(.42)");
    document.body.append(host); panel.remove();
  });
  it("keeps the cover layout origin fixed when handing off from preview to overview", () => {
    render({ previewCoverBounds: { x: 65, y: 190, width: 108, height: 135 } });
    const cover = host.querySelector<HTMLElement>(".folder-workspace-item")!;
    expect([cover.style.left, cover.style.top]).toEqual(["20px", "150px"]);
    expect(cover.style.getPropertyValue("--folder-motion-closed-transform")).toBe("translate(0px, 0px) scale(1)");
    render({ navigation: { layer: "overview", selectedFolderId: null }, previewCoverBounds: null });
    expect([cover.style.left, cover.style.top]).toEqual(["20px", "150px"]);
  });
  it("keeps member presses inside the read-only preview and permits double-click entry", () => {
    render(); const outside = vi.fn(); document.body.addEventListener("pointerdown", outside);
    for (const selector of [".folder-preview-motion-image", ".folder-preview-motion-description"]) {
      act(() => host.querySelector(selector)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    }
    document.body.removeEventListener("pointerdown", outside);
    expect(outside).not.toHaveBeenCalled();
    expect(props.onPreviewClosed).not.toHaveBeenCalled();
    act(() => host.querySelector("img")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(props.onEnterFolder).toHaveBeenCalledExactlyOnceWith("f");
    expect(props.onSelectFolder).not.toHaveBeenCalled();
  });
  it("keeps destructive actions behind More and supports keyboard dismissal", () => {
    render(); expect(host.querySelector('[role="menu"]')).toBeNull();
    act(() => (host.querySelector(".folder-workspace-more") as HTMLButtonElement).click());
    const menu = host.querySelector('[role="menu"]')!;
    expect(menu.textContent).toContain("解组"); expect(menu.textContent).toContain("删除");
    expect(document.activeElement?.textContent).toBe("解组");
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })));
    expect(document.activeElement?.textContent).toBe("删除");
    act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement?.className).toBe("folder-workspace-more");
    expect(props.onDeleteFolder).not.toHaveBeenCalled();
  });
  it("reuses management callbacks and allows reversing a close on the folder", () => {
    render(); act(() => (host.querySelector(".folder-workspace-more") as HTMLButtonElement).click());
    act(() => (host.querySelector(".folder-workspace-ungroup") as HTMLButtonElement).click());
    expect(props.onUngroupFolder).toHaveBeenCalledExactlyOnceWith("f");
    render({ previewClosing: true });
    act(() => (host.querySelector(".folder-workspace-hit-target") as HTMLButtonElement).click());
    expect(props.onPreviewReopen).toHaveBeenCalledTimes(1);
  });
});
