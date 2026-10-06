// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeCanvasCardShadows } from "./canvasCardShadowVisibility";

const rect = (x: number, y: number, width: number, height: number) =>
  ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height }) as DOMRect;

const setup = () => {
  let callback: IntersectionObserverCallback;
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe = observe; unobserve = unobserve; disconnect = disconnect;
  });
  const root = document.createElement("div");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 700));
  document.body.append(root);
  const card = (name: string, bounds: DOMRect) => {
    const element = document.createElement("button");
    element.className = name;
    element.style.left = `${bounds.left}px`;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(bounds);
    root.append(element);
    return element;
  };
  return { root, card, observe, unobserve, disconnect,
    notify(target: HTMLElement, area: DOMRect, intersects = true) {
      callback!([{ target, intersectionRect: area, isIntersecting: intersects,
        boundingClientRect: area, intersectionRatio: intersects ? 1 : 0,
        rootBounds: null, time: 0 }], {} as IntersectionObserver);
    },
  };
};
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("viewport card shadows", () => {
  it("suppresses the reported offscreen Folder without moving or removing it", () => {
    const s = setup();
    const folder = s.card("folder-workspace-hit-target", rect(25, -219, 148, 200));
    const partial = s.card("folder-description-item", rect(300, -10, 216, 144));
    const other = s.card("image-card", rect(25, -219, 148, 200));
    const visibility = observeCanvasCardShadows(s.root); visibility.sync();
    expect(folder.hasAttribute("data-shadow-offscreen")).toBe(true);
    expect(partial.hasAttribute("data-shadow-offscreen")).toBe(false);
    expect(other.hasAttribute("data-shadow-offscreen")).toBe(false);
    expect(folder.style.left).toBe("25px");
    expect(s.root.contains(folder)).toBe(true);
    expect(s.observe).toHaveBeenCalledTimes(2);
    visibility.dispose();
  });
  it("restores the original shadow when pan, zoom or animation exposes the body", () => {
    const s = setup();const card = s.card("folder-workspace-hit-target", rect(25, -219, 148, 200));
    const visibility = observeCanvasCardShadows(s.root);visibility.sync();
    s.notify(card, rect(25, 0, 148, 1));
    expect(card.hasAttribute("data-shadow-offscreen")).toBe(false);
    s.notify(card, rect(25, 0, 148, 0));
    expect(card.hasAttribute("data-shadow-offscreen")).toBe(true);
    s.notify(card, rect(25, 0, 148, 200));
    expect(card.hasAttribute("data-shadow-offscreen")).toBe(false);
    visibility.dispose();
  });
  it("does not let a late observer entry modify a removed or disposed card", () => {
    const s = setup();const old = s.card("folder-description-item", rect(25, -219, 148, 200));
    const visibility = observeCanvasCardShadows(s.root);visibility.sync();
    old.remove();visibility.sync();s.notify(old, rect(0, 0, 0, 0), false);
    expect(s.unobserve).toHaveBeenCalledWith(old);
    expect(old.hasAttribute("data-shadow-offscreen")).toBe(false);
    const next = s.card("folder-description-item", rect(25, -219, 148, 200));
    visibility.sync();visibility.dispose();s.notify(next, rect(0, 0, 0, 0), false);
    expect(s.disconnect).toHaveBeenCalledOnce();
    expect(next.hasAttribute("data-shadow-offscreen")).toBe(false);
  });
  it("reuses observers and avoids layout reads when the card set is unchanged", () => {
    const s = setup();const card = s.card("folder-workspace-hit-target", rect(25, 20, 148, 200));
    const visibility = observeCanvasCardShadows(s.root);visibility.sync();visibility.sync();
    expect(s.observe).toHaveBeenCalledOnce();
    expect(card.getBoundingClientRect).toHaveBeenCalledOnce();
    expect(s.root.getBoundingClientRect).toHaveBeenCalledOnce();
    visibility.dispose();
  });
});
