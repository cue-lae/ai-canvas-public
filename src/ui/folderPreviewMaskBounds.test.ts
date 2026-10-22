import { describe, expect, it } from "vitest";
import {
  folderPreviewMaskBoundsOverlap,
  folderPreviewMaskSweepBounds,
  type FolderPreviewRawMatrix,
} from "./folderPreviewMaskBounds";

const identity: FolderPreviewRawMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const fixture = () => ({
  bbox: { x: 120, y: 90, width: 80, height: 40 },
  target: { left: 100, top: 80, width: 160, height: 100, angle: 0 },
  current: identity as FolderPreviewRawMatrix | null,
  closed: { translateX: -60, translateY: -30, scale: 0.42 },
  panel: { width: 800, height: 600 },
  padding: 2,
});

const contains = (bounds: ReturnType<typeof folderPreviewMaskSweepBounds>, x: number, y: number) => {
  expect(x).toBeGreaterThanOrEqual(bounds.x);
  expect(y).toBeGreaterThanOrEqual(bounds.y);
  expect(x).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(y).toBeLessThanOrEqual(bounds.y + bounds.height);
};

describe("folder preview mask swept bounds", () => {
  it("covers the closed-to-open path while retaining a small bounded surface", () => {
    const bounds = folderPreviewMaskSweepBounds(fixture());
    expect(bounds).toEqual({ x: 46, y: 52, width: 156, height: 80 });
    expect(bounds.width * bounds.height).toBeLessThan(800 * 600 / 10);
  });

  it("includes the displayed pose left over from a different layout before reversal", () => {
    const input = fixture();
    input.current = { a: 0.63, b: 0, c: 0, d: 0.63, e: 350, f: 220 };
    const bounds = folderPreviewMaskSweepBounds(input);
    contains(bounds, 100 + 0.63 * 100 + 350, 80 + 0.63 * 50 + 220);
    expect(bounds.x + bounds.width).toBeGreaterThan(500);
  });

  it("rotates translation outside scaling about the owning image origin", () => {
    const input = fixture();
    input.target.angle = Math.PI / 2;
    const bounds = folderPreviewMaskSweepBounds(input);
    // Open top-left: (100,80) + R90(20,10) = (90,100).
    contains(bounds, 90, 100);
    // Closed top-left: (100,80) + R90(.42*(20,10) + (-60,-30)).
    contains(bounds, 125.8, 28.4);
    expect(bounds.width * bounds.height).toBeLessThan(800 * 600 / 10);
  });

  it("contains intermediate points across rotations, retargeted starts and both directions", () => {
    for (const angle of [-0.7, -0.13, 0, 0.17, 0.9]) {
      const input = fixture();
      input.target.angle = angle;
      input.current = { a: 0.71, b: 0, c: 0, d: 0.71, e: 180, f: 95 };
      input.panel = { width: 2000, height: 2000 };
      input.target.left = 500;
      input.target.top = 500;
      input.bbox = { x: 510, y: 520, width: 60, height: 20 };
      const bounds = folderPreviewMaskSweepBounds(input);
      for (const end of [identity, { a: 0.42, b: 0, c: 0, d: 0.42, e: -60, f: -30 }]) {
        for (let step = 0; step <= 20; step++) {
          const progress = step / 20;
          const scale = input.current.a + (end.a - input.current.a) * progress;
          const dx = input.current.e + (end.e - input.current.e) * progress;
          const dy = input.current.f + (end.f - input.current.f) * progress;
          for (const x of [510, 540, 570]) for (const y of [520, 530, 540]) {
            const localX = scale * (x - 500) + dx;
            const localY = scale * (y - 500) + dy;
            contains(bounds, 500 + Math.cos(angle) * localX - Math.sin(angle) * localY,
              500 + Math.sin(angle) * localX + Math.cos(angle) * localY);
          }
        }
      }
    }
  });

  it("clamps only at the stable panel boundary", () => {
    const input = fixture();
    input.current = { a: 1, b: 0, c: 0, d: 1, e: -500, f: -300 };
    input.closed = { translateX: 1000, translateY: 1000, scale: 0.42 };
    expect(folderPreviewMaskSweepBounds(input)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("includes badge shadows with caller-supplied padding and supports zero-sized points", () => {
    const input = fixture();
    input.bbox = { x: 150, y: 100, width: 0, height: 0 };
    input.closed = { translateX: 0, translateY: 0, scale: 1 };
    input.padding = 12;
    expect(folderPreviewMaskSweepBounds(input)).toEqual({ x: 138, y: 88, width: 24, height: 24 });
  });

  it.each([
    null,
    { ...identity, a: -1, d: -1 },
    { ...identity, a: 0, d: 0 },
    { ...identity, d: 2 },
    { ...identity, b: 0.01 },
    { ...identity, c: 0.01 },
    { ...identity, e: Infinity },
    { ...identity, f: NaN },
  ])("falls back to the panel for unavailable or unsupported current transforms: %j", (current) => {
    expect(folderPreviewMaskSweepBounds({ ...fixture(), current }))
      .toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("falls back conservatively for missing/invalid geometry and unlaid panels", () => {
    const input = fixture();
    expect(folderPreviewMaskSweepBounds({ ...input, bbox: null }))
      .toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(folderPreviewMaskSweepBounds({ ...input, bbox: { ...input.bbox, width: -1 } }))
      .toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(folderPreviewMaskSweepBounds({ ...input, target: { ...input.target, angle: NaN } }))
      .toEqual({ x: 0, y: 0, width: 800, height: 600 });
    const unlaid = folderPreviewMaskSweepBounds({ ...input, panel: { width: 0, height: NaN } });
    expect(unlaid.width).toBeGreaterThanOrEqual(260);
    expect(unlaid.height).toBeGreaterThanOrEqual(180);
    expect(folderPreviewMaskSweepBounds({ ...input, bbox: null,
      target: { left: NaN, top: NaN, width: 0, height: 0 },
      panel: { width: 0, height: 0 } })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("does not drop touching or intermediate-only overlaps", () => {
    const first = folderPreviewMaskSweepBounds(fixture());
    expect(folderPreviewMaskBoundsOverlap(first, { x: first.x + first.width, y: 60, width: 10, height: 10 })).toBe(true);
    expect(folderPreviewMaskBoundsOverlap(first, { x: 205, y: 60, width: 10, height: 10 })).toBe(false);
    expect(folderPreviewMaskBoundsOverlap(first, { x: 60, y: 60, width: 10, height: 10 })).toBe(true);
    expect(folderPreviewMaskBoundsOverlap(first, { x: 60, y: 60, width: 0, height: 10 })).toBe(false);
  });
});
