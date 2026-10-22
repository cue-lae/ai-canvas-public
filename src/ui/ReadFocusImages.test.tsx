// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadFocusImages, type ReadFocusImagesProps } from "./ReadFocusImages";
import type { ReadFocusCandidate } from "./readFocusCandidates";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: ReadFocusImagesProps;
const candidate = (imageId: string, overrides: Partial<ReadFocusCandidate> = {}): ReadFocusCandidate => ({
  imageId,
  name: `${imageId}.jpg`,
  dataURL: `data:image/png;base64,${imageId}`,
  unavailableReason: null,
  ...overrides,
});
const render = () => act(() => root.render(<ReadFocusImages {...props} />));
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".read-focus-images__row"));
const isDisabled = (button: HTMLButtonElement) => button.getAttribute("aria-disabled") === "true";
const click = (element: HTMLElement) => act(() => element.click());

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  host.className = "context-panel-content";
  document.body.append(host);
  root = createRoot(host);
  props = {
    candidates: [candidate("a"), candidate("b")],
    focusedImageIds: [],
    imageNumberById: new Map([["a", 1], ["b", 2]]),
    scopeLabel: "根画布",
    busy: false,
    maxImages: 4,
    onToggle: vi.fn(),
    onInspect: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Read focus image rows", () => {
  it("browses by the latest enter or focus event without clearing on leave or blur", () => {
    render();
    act(() => buttons()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => buttons()[1].focus());
    act(() => buttons()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => { buttons()[0].dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); buttons()[1].blur(); });
    expect(props.onInspect).toHaveBeenCalledTimes(3);
    expect(props.onInspect).toHaveBeenNthCalledWith(1, "a");
    expect(props.onInspect).toHaveBeenNthCalledWith(2, "b");
    expect(props.onInspect).toHaveBeenNthCalledWith(3, "a");
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(document.querySelector(".read-focus-images__tooltip")).toBeNull();
    expect(host.querySelector("[title]")).toBeNull();
  });

  it("allows browsing while busy or at the limit without bypassing toggle restrictions", () => {
    props.candidates = ["a", "b", "c", "d", "e"].map((id) => candidate(id));
    props.focusedImageIds = ["a", "b", "c", "d"]; props.busy = true; render();
    act(() => buttons()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => buttons()[4].focus()); click(buttons()[0]); click(buttons()[4]);
    expect(props.onInspect).toHaveBeenNthCalledWith(1, "a");
    expect(props.onInspect).toHaveBeenNthCalledWith(2, "e");
    expect(props.onToggle).not.toHaveBeenCalled();
    props.busy = false; render();
    act(() => buttons()[4].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(props.onInspect).toHaveBeenNthCalledWith(3, "e");
    click(buttons()[4]); expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("places a decorative mark inside the selected button without another interaction target", () => {
    props.focusedImageIds = ["b"]; render();
    expect(buttons()[0].querySelector(".read-focus-images__mark")).toBeNull();
    const mark = buttons()[1].querySelector<HTMLElement>(".read-focus-images__mark")!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.parentElement).toBe(buttons()[1]);
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.getAttribute("tabindex")).toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(2);
    click(mark); expect(props.onToggle).toHaveBeenCalledExactlyOnceWith("b");
  });
  it("distinguishes an empty scope from a nonempty scope without focus", () => {
    props.candidates = [];
    render();
    expect(host.textContent).toContain("本次重点 0/4");
    expect(host.textContent).toContain("根画布 · 0 张图片");
    expect(host.textContent).toContain("当前范围没有图片。");
    expect(host.textContent).not.toContain("尚未加入重点");
    expect(buttons()).toHaveLength(0);
    props.candidates = [candidate("a")];
    render();
    expect(host.textContent).toContain("尚未加入重点，请从下方选择图片。");
    expect(host.textContent).not.toContain("当前范围没有图片。");
  });

  it("uses original full names and existing numbers, with one native button per row", () => {
    const longName = "相同前缀-咖啡馆室内参考图-完整名称.jpg";
    props.candidates = [candidate("a", { name: longName }), candidate("b", { name: "" })];
    render();
    expect(host.querySelectorAll("button")).toHaveLength(2);
    expect(buttons()[0].type).toBe("button");
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons()[0].getAttribute("aria-label")).toBe(`${longName}，未加入重点，加入重点`);
    expect(buttons()[1].getAttribute("aria-label")).toBe("图片 2，未加入重点，加入重点");
    expect(host.querySelectorAll("img[alt='']")).toHaveLength(2);
    expect(host.textContent).toContain("重点图片以完整原图交接，修改对象以画布说明为准。");
  });

  it("toggles once from the thumbnail, name or action without nested buttons", () => {
    render();
    for (const target of [".read-focus-images__thumbnail", ".read-focus-images__name", ".read-focus-images__action"]) {
      click(buttons()[0].querySelector<HTMLElement>(target)!);
    }
    expect(props.onToggle).toHaveBeenCalledTimes(3);
    expect(props.onToggle).toHaveBeenNthCalledWith(1, "a");
    expect(props.onToggle).toHaveBeenNthCalledWith(2, "a");
    expect(props.onToggle).toHaveBeenNthCalledWith(3, "a");
    expect(buttons()[0].querySelector("button")).toBeNull();
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("false");
    props.focusedImageIds = ["a"];
    render();
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons()[0].querySelector(".read-focus-images__action")!.textContent).toBe("已加入");
    expect(buttons()[0].getAttribute("aria-label")).toBe("a.jpg，已加入重点，取消重点");
    click(buttons()[0]);
    expect(props.onToggle).toHaveBeenCalledTimes(4);
  });

  it("preserves stable candidate order and follows rapid controlled updates", () => {
    const toggled = vi.fn();
    const Harness = () => {
      const [selected, setSelected] = useState<string[]>([]);
      return <ReadFocusImages {...props} focusedImageIds={selected} onToggle={(imageId) => {
        toggled(imageId);
        setSelected((current) => current.includes(imageId)
          ? current.filter((id) => id !== imageId)
          : [...current, imageId]);
      }} />;
    };
    act(() => root.render(<Harness />));
    const originalRows = buttons();
    act(() => { originalRows[0].click(); originalRows[0].click(); originalRows[1].click(); });
    expect(toggled.mock.calls).toEqual([["a"], ["a"], ["b"]]);
    expect(buttons()).toEqual(originalRows);
    expect(buttons().map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(host.textContent).toContain("本次重点 1/4");
  });

  it("shows more than four candidates and prevents additions at the limit while retaining cancel", () => {
    props.candidates = ["a", "b", "c", "d", "e", "f"].map((id) => candidate(id));
    props.focusedImageIds = ["d", "b", "a", "c"];
    render();
    expect(host.textContent).toContain("本次重点 4/4");
    expect(host.textContent).toContain("根画布 · 6 张图片");
    expect(host.textContent).toContain("最多加入 4 张重点；可先取消已选图片。");
    expect(buttons().map(isDisabled)).toEqual([false, false, false, false, true, true]);
    click(buttons()[4]);
    expect(props.onToggle).not.toHaveBeenCalled();
    click(buttons()[1]);
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith("b");
    const describedIds = buttons()[4].getAttribute("aria-describedby")!.split(" ");
    expect(describedIds.every((id) => document.getElementById(id))).toBe(true);
    expect(document.getElementById(describedIds[0])!.textContent).toContain("最多加入 4 张重点");
  });

  it("disables every row while busy, including cancellation", () => {
    props.focusedImageIds = ["a"];
    props.busy = true;
    render();
    expect(buttons().every(isDisabled)).toBe(true);
    expect(host.textContent).toContain("正在处理，请稍候再调整重点。");
    buttons().forEach(click);
    expect(props.onToggle).not.toHaveBeenCalled();
    props.busy = false;
    render();
    expect(buttons().every((button) => !isDisabled(button))).toBe(true);
  });

  it("keeps unavailable existing focus visible and cancellable and explains unavailable additions", () => {
    props.candidates = [
      candidate("a", { dataURL: null, unavailableReason: "原图数据缺失。" }),
      candidate("b", { dataURL: null, unavailableReason: "图片实例缺失。" }),
    ];
    props.focusedImageIds = ["a"];
    render();
    expect(host.textContent).toContain("有 1 张重点图片不可用，仍可取消重点。");
    expect(host.textContent).toContain("原图数据缺失。");
    expect(host.textContent).toContain("图片实例缺失。");
    expect(host.querySelectorAll(".is-placeholder")).toHaveLength(2);
    expect(isDisabled(buttons()[0])).toBe(false);
    expect(isDisabled(buttons()[1])).toBe(true);
    click(buttons()[0]);
    click(buttons()[1]);
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith("a");
    const reasonId = buttons()[1].getAttribute("aria-describedby")!.split(" ").at(-1)!;
    expect(document.getElementById(reasonId)!.textContent).toBe("图片实例缺失。");
  });

  it("keeps an unavailable row keyboard reachable for inspecting its name without activating it", () => {
    const longName = "无法发布但仍需完整核对的参考图片名称.jpg";
    props.candidates = [candidate("a", { name: longName, dataURL: null, unavailableReason: "原图数据缺失。" })];
    render();
    const button = buttons()[0];
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    expect(button.tabIndex).toBe(0);
    expect(button.disabled).toBe(false);
    expect(isDisabled(button)).toBe(true);
    expect(props.onInspect).toHaveBeenCalledExactlyOnceWith("a");
    click(button);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("uses a placeholder on thumbnail failure without changing focus or availability", () => {
    props.focusedImageIds = ["a"];
    render();
    const image = buttons()[0].querySelector("img")!;
    act(() => image.dispatchEvent(new Event("error")));
    expect(buttons()[0].querySelector("img")).toBeNull();
    expect(buttons()[0].querySelector(".is-placeholder")).not.toBeNull();
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(isDisabled(buttons()[0])).toBe(false);
    expect(host.textContent).not.toContain("不可用");
    expect(props.onToggle).not.toHaveBeenCalled();
    props.candidates = [candidate("a", { dataURL: "data:image/png;base64,replaced" }), candidate("b")];
    render();
    expect(buttons()[0].querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,replaced");
  });

  it.each(["Enter", " "])("uses native keyboard activation without a second toggle from %j handlers", (key) => {
    render();
    const button = buttons()[0];
    act(() => {
      button.focus();
      button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    expect(document.activeElement).toBe(button);
    expect(button.tabIndex).toBe(0);
    expect(props.onToggle).not.toHaveBeenCalled();
    // jsdom does not synthesize a browser's keyboard click. Supply that one
    // activation, then verify key handlers do not add a duplicate callback.
    act(() => {
      button.click();
      button.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    });
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("updates the current scope count and discards a stale full-name hint on scope changes", () => {
    props.focusedImageIds = ["a", "elsewhere"];
    render();
    act(() => buttons()[0].focus());
    props.candidates = [candidate("c")];
    props.scopeLabel = "参考资料";
    render();
    expect(host.textContent).toContain("本次重点 0/4");
    expect(host.textContent).toContain("参考资料 · 1 张图片");
    expect(document.querySelector(".read-focus-images__tooltip")).toBeNull();
    expect(buttons()[0].getAttribute("aria-pressed")).toBe("false");
  });
});
