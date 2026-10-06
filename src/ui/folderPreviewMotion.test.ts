// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFolderPreviewAnimator, FOLDER_PREVIEW_MOTION } from "./folderPreviewMotion";

let root: HTMLDivElement;
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
let records: { frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn> }[];
beforeEach(() => {
  root = document.createElement("div"); document.body.append(root); records = [];
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn((frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) => {
    let finish!: () => void;
    let reject!: () => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new Error("cancelled")); });
    const cancel = vi.fn(reject);
    records.push({ frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, finish, cancel });
    return { finished, cancel } as unknown as Animation;
  }) });
});
afterEach(() => {
  root.remove();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.restoreAllMocks();
});
const add = (index = 0, cover = false) => {
  const node = document.createElement("div"); node.dataset.folderMotion = cover ? "cover" : "member";
  node.dataset.folderMotionIndex = String(index);
  node.style.setProperty("--folder-motion-closed-transform", "translate(-100px, 60px) scale(.42)");
  node.style.setProperty("--folder-motion-open-transform", cover ? "scale(.9)" : "translate(0px, 0px) scale(1)");
  root.append(node); return node;
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("Folder preview animation lifecycle", () => {
  it("uses accepted duration and bounded stagger", () => {
    add(0, true); add(0); add(2); add(100);
    createFolderPreviewAnimator().play(root, false, vi.fn());
    expect(records.map(r => r.options.delay)).toEqual([0, 0, 40, 60]);
    expect(records.every(r => r.options.duration === 420 && r.options.easing === FOLDER_PREVIEW_MOTION.openEasing)).toBe(true);
  });
  it("waits for every closing part before handing navigation back", async () => {
    add(0, true); add(); const closed = vi.fn(); const animator = createFolderPreviewAnimator();
    animator.play(root, true, closed);
    expect(records.every(r => r.options.duration === 480 && r.options.delay === 0)).toBe(true);
    records[0].finish(); await flush(); expect(closed).not.toHaveBeenCalled();
    records[1].finish(); await flush(); expect(closed).toHaveBeenCalledTimes(1);
  });
  it("reverses from displayed geometry and rejects a stale close callback", async () => {
    const node = add(); const closed = vi.fn(); const animator = createFolderPreviewAnimator();
    animator.play(root, false, closed);
    node.style.transform = "translate(-40px, 24px) scale(.7)"; node.style.opacity = ".6";
    const visible = getComputedStyle(node).transform;
    animator.play(root, true, closed);
    expect(records[1].frames[0]).toEqual({ transform: visible, opacity: "0.6" });
    animator.play(root, false, closed);
    records.forEach(r => r.finish()); await flush();
    expect(closed).not.toHaveBeenCalled();
    expect(records[1].cancel).toHaveBeenCalledTimes(1);
  });
  it("cleans up on navigation/unmount and supports reduced motion", async () => {
    const node = add(); const closed = vi.fn(); const animator = createFolderPreviewAnimator();
    animator.play(root, true, closed); animator.dispose(); await flush();
    expect(closed).not.toHaveBeenCalled(); expect(node.style.transform).toBe("");
    animator.play(root, true, closed, true); await flush();
    expect(closed).toHaveBeenCalledTimes(1); expect(node.style.opacity).toBe("0");
  });
});
