// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFolderPreviewAnimator, FOLDER_PREVIEW_MOTION } from "./folderPreviewMotion";

let root: HTMLDivElement;
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
let records: { frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn>; animation: Animation }[];
let pauseReadiness: Promise<unknown>[];
beforeEach(() => {
  root = document.createElement("div"); document.body.append(root); records = []; pauseReadiness = [];
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn((frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) => {
    let finish!: () => void;
    let reject!: () => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new Error("cancelled")); });
    const cancel = vi.fn(reject);
    const pause = vi.fn(() => { Object.assign(animation, { ready: pauseReadiness.shift() ?? Promise.resolve(animation) }); });
    const animation = { finished, cancel, startTime: null, pause, play: vi.fn() } as unknown as Animation;
    Object.defineProperty(animation, "currentTime", { get: () => 0, set: () => { throw new Error("Do not override the native hold time"); } });
    Object.defineProperty(animation, "startTime", { get: () => null, set: () => { throw new Error("Do not backdate native playback"); } });
    records.push({ frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, finish, cancel, animation });
    return animation;
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
const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const addImage = (index = 0) => {
  const placeholder = add(index);
  const image = document.createElement("img");
  image.dataset.folderMotion = "member";
  image.dataset.folderMotionIndex = String(index);
  image.style.cssText = placeholder.style.cssText;
  image.src = `https://example.test/image-${index}.jpg`;
  placeholder.replaceWith(image);
  const decoded = deferred();
  const decode = vi.fn(() => decoded.promise);
  Object.defineProperty(image, "decode", { configurable: true, value: decode });
  return { image, decoded, decode };
};

describe("Folder preview animation lifecycle", () => {
  it("includes sibling SVG attachments in the same timing, reversal and close barrier", async () => {
    const folder = document.createElement("div"); root.append(folder);
    const image = add(2); folder.append(image);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const region = document.createElementNS(svg.namespaceURI, "g") as SVGGElement;
    region.dataset.folderMotion = "member"; region.dataset.folderMotionIndex = "2";
    region.style.setProperty("--folder-motion-closed-transform", image.style.getPropertyValue("--folder-motion-closed-transform"));
    region.animate = HTMLElement.prototype.animate;
    svg.append(region); root.append(svg);
    const closed = vi.fn(); const animator = createFolderPreviewAnimator();
    animator.play(root, false, closed);
    expect(records).toHaveLength(2);
    expect(records[0].frames).toEqual(records[1].frames);
    expect(records[0].options).toEqual(records[1].options);
    animator.play(root, true, closed);
    records[2].finish(); await flush(); expect(closed).not.toHaveBeenCalled();
    records[3].finish(); await flush(); expect(closed).toHaveBeenCalledTimes(1);
    animator.dispose(); expect(region.style.transform).toBe("");
  });
  it("uses accepted duration and bounded stagger", () => {
    add(0, true); add(0); add(2); add(100);
    createFolderPreviewAnimator().play(root, false, vi.fn());
    expect(records.map(r => r.options.delay)).toEqual([0, 0, 40, 60]);
    expect(records.every(r => r.options.duration === 420 && r.options.easing === FOLDER_PREVIEW_MOTION.openEasing)).toBe(true);
    expect(records.every(r => r.animation.startTime === null)).toBe(true);
  });
  it("prepares the same paused effects while images decode, then plays the whole group", async () => {
    const cover = add(0, true);
    const first = addImage(); const second = addImage(2); const description = add(1);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const region = document.createElementNS(svg.namespaceURI, "g") as SVGGElement;
    region.dataset.folderMotion = "member";
    region.dataset.folderMotionIndex = "2";
    region.style.cssText = second.image.style.cssText;
    region.animate = HTMLElement.prototype.animate;
    svg.append(region); root.append(svg);
    const animator = createFolderPreviewAnimator(); animator.play(root, false, vi.fn());
    expect(records).toHaveLength(5);
    expect(records.every(record => vi.mocked(record.animation.pause).mock.calls.length === 1)).toBe(true);
    expect(records.every(record => vi.mocked(record.animation.play).mock.calls.length === 0)).toBe(true);
    for (const node of [first.image, second.image, description, region]) {
      expect(node.style.transform).toBe(node.style.getPropertyValue("--folder-motion-closed-transform"));
      expect(node.style.opacity).toBe("0");
    }
    expect(cover.style.opacity).toBe("1");
    first.decoded.resolve(); await flush();
    expect(records.every(record => vi.mocked(record.animation.play).mock.calls.length === 0)).toBe(true);
    second.decoded.resolve(); await flush(); expect(records).toHaveLength(5);
    expect(records.every(record => vi.mocked(record.animation.play).mock.calls.length === 1)).toBe(true);
    expect(records.every(record => record.animation.startTime === null)).toBe(true);
    expect(records[2].options).toEqual(records[4].options);
    animator.dispose();
  });
  it("waits for every paused effect as well as decoded images before resuming", async () => {
    const { decoded } = addImage(); add();
    const first = deferred(); const second = deferred(); pauseReadiness = [first.promise, second.promise];
    const animator = createFolderPreviewAnimator(); animator.play(root, false, vi.fn());
    decoded.resolve(); first.resolve(); await flush();
    expect(records.every(record => vi.mocked(record.animation.play).mock.calls.length === 0)).toBe(true);
    second.resolve(); await flush();
    expect(records.every(record => vi.mocked(record.animation.play).mock.calls.length === 1)).toBe(true);
    expect(records).toHaveLength(2); animator.dispose();
  });
  it("continues with native image fallback after rejected or throwing decode", async () => {
    const first = addImage(); const second = addImage(1);
    second.decode.mockImplementation(() => { throw new Error("decode failed"); });
    const animator = createFolderPreviewAnimator(); animator.play(root, false, vi.fn());
    first.decoded.reject(new Error("broken image")); await flush();
    expect(records).toHaveLength(2);
    expect(records.every(record => vi.mocked(record.animation.play).mock.calls.length === 1)).toBe(true);
    expect(first.image.style.opacity).toBe("1"); animator.dispose();
  });
  it("closes immediately during preparation and never revives that opening", async () => {
    const { image, decoded } = addImage(); const closed = vi.fn(); const animator = createFolderPreviewAnimator();
    const pendingPause = deferred(); pauseReadiness = [pendingPause.promise];
    animator.play(root, false, closed); animator.play(root, true, closed);
    expect(records).toHaveLength(2); expect(records[1].options.duration).toBe(480);
    expect(records[1].frames[0].opacity).toBe("0");
    records[1].finish(); await flush(); expect(closed).toHaveBeenCalledTimes(1);
    pendingPause.reject(new Error("pause aborted by close"));
    decoded.resolve(); await flush(); expect(records).toHaveLength(2);
    expect(records[0].animation.play).not.toHaveBeenCalled();
    expect(image.style.opacity).toBe("0"); animator.dispose();
  });
  it("discards preparation after dispose or removal of the connected root", async () => {
    const first = addImage(); const animator = createFolderPreviewAnimator(); animator.play(root, false, vi.fn());
    animator.dispose(); first.decoded.resolve(); await flush(); expect(records[0].animation.play).not.toHaveBeenCalled();
    const second = deferred(); first.decode.mockReturnValue(second.promise);
    animator.play(root, false, vi.fn()); root.remove(); second.resolve(); await flush();
    expect(records).toHaveLength(2);
    expect(records[1].animation.play).not.toHaveBeenCalled(); animator.dispose();
  });
  it("prepares the replacement source instead of starting from a stale decode", async () => {
    const { image, decoded, decode } = addImage(); const replacement = deferred();
    const animator = createFolderPreviewAnimator(); animator.play(root, false, vi.fn());
    image.src = "https://example.test/replacement.jpg"; decode.mockReturnValue(replacement.promise);
    decoded.resolve(); await flush(); expect(decode).toHaveBeenCalledTimes(2); expect(records).toHaveLength(1);
    expect(records[0].animation.play).not.toHaveBeenCalled();
    replacement.resolve(); await flush(); expect(records).toHaveLength(1);
    expect(records[0].animation.play).toHaveBeenCalledTimes(1); animator.dispose();
  });
  it("reopens from the current closing pose and ignores the stale close barrier", async () => {
    const { image, decoded } = addImage(); const closed = vi.fn(); const animator = createFolderPreviewAnimator();
    animator.play(root, true, closed);
    image.style.transform = "translate(-40px, 24px) scale(.7)"; image.style.opacity = ".6";
    const pose = getComputedStyle(image).transform;
    animator.play(root, false, closed);
    expect(image.style.transform).toBe(pose);
    decoded.resolve(); await flush();
    expect(records[1].frames[0]).toEqual({ transform: pose, opacity: "0.6" });
    records.forEach(record => record.finish()); await flush(); expect(closed).not.toHaveBeenCalled(); animator.dispose();
  });
  it("does not wait for image decoding when reduced motion is requested", async () => {
    const { image, decode } = addImage(); const animator = createFolderPreviewAnimator();
    animator.play(root, false, vi.fn(), true); await flush();
    expect(decode).not.toHaveBeenCalled(); expect(records).toHaveLength(0); expect(image.style.opacity).toBe("1");
    animator.dispose();
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
