// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadImagePreview, useReadImagePreview } from "./ReadImagePreview";
import type { ReadFocusCandidate } from "./readFocusCandidates";

const candidate = (imageId: string, overrides: Partial<ReadFocusCandidate> = {}): ReadFocusCandidate => ({
  imageId, name: `${imageId}.jpg`, dataURL: `data:image/png;base64,${imageId}`, unavailableReason: null, ...overrides,
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let candidates: ReadFocusCandidate[];
let identity: string;
let current: ReturnType<typeof useReadImagePreview>;
const numbers = new Map([["a", 1], ["b", 2]]);
const Harness = () => {
  current = useReadImagePreview(candidates, identity);
  return <ReadImagePreview candidate={current.candidate} imageNumberById={numbers} />;
};
const render = () => act(() => root.render(<Harness />));
const inspect = (imageId: string) => act(() => current.inspect(imageId));
const image = () => host.querySelector<HTMLImageElement>(".read-image-preview__image");

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); host.className = "context-panel-content";
  document.body.append(host); root = createRoot(host);
  candidates = [candidate("a"), candidate("b")]; identity = "document-a:scope-root:restore-0";
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Read image browsing", () => {
  it("starts empty, follows the latest inspected ID and does not mutate inputs", () => {
    const before = JSON.stringify(candidates); render();
    expect(current.candidate).toBeNull(); expect(host.textContent).toContain("浏览图片后在此预览");
    inspect("a"); expect(current.candidate).toBe(candidates[0]);
    inspect("b"); expect(current.candidate).toBe(candidates[1]);
    inspect("a"); expect(current.candidate).toBe(candidates[0]);
    expect(JSON.stringify(candidates)).toBe(before);
  });

  it("does not merge candidates with identical names or pixel URLs", () => {
    candidates = [candidate("a", { name: "相同.jpg" }), candidate("b", { name: "相同.jpg", dataURL: candidates[0].dataURL })];
    render(); inspect("b"); expect(current.candidate?.imageId).toBe("b");
    inspect("unknown"); expect(current.candidate?.imageId).toBe("b");
  });

  it.each(["document-b:scope-root:restore-0", "document-a:scope-folder:restore-0", "document-a:scope-root:restore-1"])("clears on identity change %s even when the image ID survives", (nextIdentity) => {
    render(); inspect("a"); const initialIdentity = identity; identity = nextIdentity; render();
    expect(current.candidate).toBeNull(); expect(image()).toBeNull();
    identity = initialIdentity; render(); expect(current.candidate).toBeNull();
    inspect("a"); expect(current.candidate?.imageId).toBe("a");
  });

  it("forgets removed candidates and does not revive them after reinsertion", () => {
    render(); inspect("a"); candidates = [candidate("b")]; render(); expect(current.candidate).toBeNull();
    candidates = [candidate("a"), candidate("b")]; render(); expect(current.candidate).toBeNull();
    inspect("a"); expect(current.candidate?.imageId).toBe("a");
  });

  it("reads current names, reasons and pixels rather than caching an earlier candidate", () => {
    render(); inspect("a");
    candidates = [candidate("a", { name: "更新后的完整名称.jpg", dataURL: "data:image/png;base64,new", unavailableReason: "登记暂不可用。" })]; render();
    expect(current.candidate).toBe(candidates[0]); expect(image()?.getAttribute("src")).toBe("data:image/png;base64,new");
    expect(host.textContent).toContain("更新后的完整名称.jpg"); expect(host.textContent).toContain("登记暂不可用。");
  });

  it("uses existing image numbers for blank names and keeps long names complete", () => {
    candidates = [candidate("a", { name: "" }), candidate("b", { name: "很长的同前缀图片名称_完整保留用于核对.jpg" })];
    render(); inspect("a"); expect(host.querySelector(".read-image-preview__name")?.textContent).toBe("图片 1");
    inspect("b"); expect(host.querySelector(".read-image-preview__name")?.textContent).toBe(candidates[1].name);
    expect(host.querySelector("[title]")).toBeNull(); expect(document.querySelector(".read-focus-images__tooltip")).toBeNull();
  });

  it("keeps missing or failed pixels local and retries changed data", () => {
    candidates[0] = candidate("a", { dataURL: null, unavailableReason: "原图数据缺失。" }); render(); inspect("a");
    expect(image()).toBeNull(); expect(host.textContent).toContain("图片暂不可预览");
    inspect("b"); act(() => image()!.dispatchEvent(new Event("error")));
    expect(image()).toBeNull(); expect(current.candidate).toBe(candidates[1]); expect(candidates[1].unavailableReason).toBeNull();
    candidates = [candidates[0], candidate("b", { dataURL: "data:image/png;base64,replaced" })]; render();
    expect(image()?.getAttribute("src")).toBe("data:image/png;base64,replaced");
  });

  it("ignores late image events after moving to another ID", () => {
    render(); inspect("a"); const oldImage = image()!; inspect("b"); const newImage = image()!;
    act(() => { oldImage.dispatchEvent(new Event("error")); oldImage.dispatchEvent(new Event("load")); });
    expect(image()).toBe(newImage); expect(image()?.getAttribute("src")).toBe(candidates[1].dataURL);
    expect(current.candidate?.imageId).toBe("b");
  });

  it("ignores late failures from older pixels of the same ID", () => {
    render(); inspect("a"); const oldImage = image()!;
    candidates = [candidate("a", { dataURL: "data:image/png;base64,new" })]; render(); const newImage = image()!;
    act(() => oldImage.dispatchEvent(new Event("error")));
    expect(image()).toBe(newImage); expect(image()?.getAttribute("src")).toBe("data:image/png;base64,new");
  });

  it.each(["different-id", "same-id-new-pixels"])("keeps a failed current preview failed after an older request also fails: %s", (transition) => {
    render(); inspect("a"); const oldImage = image()!;
    if (transition === "different-id") inspect("b");
    else {
      candidates = [candidate("a", { dataURL: "data:image/png;base64,new" })]; render();
    }
    const currentId = current.candidate!.imageId;
    act(() => image()!.dispatchEvent(new Event("error")));
    expect(image()).toBeNull();
    expect(host.querySelector(".read-image-preview__placeholder")?.textContent).toBe("图片暂不可预览");
    act(() => { oldImage.dispatchEvent(new Event("error")); oldImage.dispatchEvent(new Event("load")); });
    expect(image()).toBeNull();
    expect(host.querySelector(".read-image-preview__placeholder")?.textContent).toBe("图片暂不可预览");
    expect(current.candidate?.imageId).toBe(currentId);
    expect(current.candidate?.unavailableReason).toBeNull();
  });
});

describe("Read preview layout eligibility", () => {
  it("uses actual columns and total preview height, responds to changes and disconnects observers", () => {
    let height = 200, panelHeight = 300;
    const callbacks: ResizeObserverCallback[] = [], disconnect = vi.fn(), observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe = observe; disconnect = disconnect;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this === host ? panelHeight : 0; });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains("read-image-preview") ? height : 0 } as DOMRect;
    });
    host.style.gridTemplateColumns = "240px 240px 240px"; render();
    const preview = host.querySelector<HTMLElement>(".read-image-preview")!;
    expect(preview.dataset.sticky).toBe("true"); expect(observe).toHaveBeenCalledWith(host); expect(observe).toHaveBeenCalledWith(preview);
    height = 293; act(() => callbacks.at(-1)!([], {} as ResizeObserver)); expect(preview.dataset.sticky).toBe("false");
    height = 292; act(() => window.dispatchEvent(new Event("resize"))); expect(preview.dataset.sticky).toBe("true");
    host.style.gridTemplateColumns = "240px"; act(() => window.dispatchEvent(new Event("resize"))); expect(preview.dataset.sticky).toBe("false");
    host.style.gridTemplateColumns = "240px 240px"; panelHeight = 200; act(() => window.dispatchEvent(new Event("resize"))); expect(preview.dataset.sticky).toBe("false");
    height = 180; act(() => callbacks.at(-1)!([], {} as ResizeObserver)); expect(preview.dataset.sticky).toBe("true");
    inspect("a"); expect(disconnect).toHaveBeenCalled();
  });
});
