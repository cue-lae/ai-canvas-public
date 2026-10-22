import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  ellipseScenePoints,
  higherImageElementsFor,
  isAxisAlignedAngle,
  rotatedRectScenePoints,
  selectionMaskBounds,
  selectionMaskBoundsIntersect,
} from "./selectionOcclusion";

const image = (id: string, angle = 0) =>
  ({
    id,
    type: "image",
    isDeleted: false,
    angle,
    customData: { imageId: id },
  }) as unknown as ExcalidrawElement;

describe("selection occlusion integration gate", () => {
  it("keeps touching and rotated bounding boxes conservatively, and rejects only disjoint covers", () => {
    const region = { x: 10, y: 20, width: 30, height: 40 };
    expect(selectionMaskBoundsIntersect(region, { x: 40, y: 60, width: 10, height: 10 })).toBe(true);
    expect(selectionMaskBoundsIntersect(region, { x: 41, y: 20, width: 10, height: 10 })).toBe(false);
    const rotated = selectionMaskBounds(rotatedRectScenePoints({ x: 40, y: 30, width: 20, height: 20, angle: Math.PI / 4 }), { width: 200, height: 200 })!;
    expect(selectionMaskBoundsIntersect(region, rotated)).toBe(true);
    expect(selectionMaskBoundsIntersect(region, { x: 10, y: 20, width: 0, height: 10 })).toBe(false);
  });
  it("bounds rotated mask content and rounds out without moving its geometry", () => {
    const points = rotatedRectScenePoints({ x: 10, y: 20, width: 20, height: 10, angle: Math.PI / 4 });
    const bounds = selectionMaskBounds(points, { width: 100, height: 100 }, 2)!;
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.x + 2);
      expect(point.y).toBeGreaterThanOrEqual(bounds.y + 2);
      expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width - 2);
      expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height - 2);
    }
    expect(bounds.width * bounds.height).toBeLessThan(100 * 100);
  });

  it("preserves the original viewport clip at every edge, including offscreen badges", () => {
    const viewport = { width: 200, height: 100 };
    expect(selectionMaskBounds([{ x: -20, y: -10 }, { x: 220, y: 110 }], viewport, 12))
      .toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(selectionMaskBounds([{ x: 240, y: 120 }, { x: 260, y: 140 }], viewport, 12))
      .toEqual({ x: 200, y: 100, width: 0, height: 0 });
    expect(selectionMaskBounds([{ x: -40, y: -40 }, { x: -20, y: -20 }], viewport, 12))
      .toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("falls back before viewport measurement or for invalid geometry", () => {
    expect(selectionMaskBounds([{ x: 1, y: 2 }], { width: 0, height: 0 })).toBeUndefined();
    expect(selectionMaskBounds([], { width: 100, height: 100 })).toBeUndefined();
    expect(selectionMaskBounds([{ x: NaN, y: 2 }], { width: 100, height: 100 })).toBeUndefined();
  });

  it("uses only images after the selected image as covers", () => {
    const first = image("first");
    const second = image("second");
    const third = image("third");
    expect(higherImageElementsFor([first, second, third], "first")).toEqual([
      second,
      third,
    ]);
    expect(higherImageElementsFor([first, second, third], "third")).toEqual([]);
  });

  it("keeps rotated image geometry outside the first integration gate", () => {
    expect(isAxisAlignedAngle(0)).toBe(true);
    expect(isAxisAlignedAngle(Math.PI)).toBe(true);
    expect(isAxisAlignedAngle(Math.PI / 6)).toBe(false);
  });

  it("returns rotated image corners for runtime masking", () => {
    const points = rotatedRectScenePoints({
      x: 10,
      y: 20,
      width: 20,
      height: 10,
      angle: Math.PI / 2,
    });
    expect(points).toHaveLength(4);
    expect(points[0].x).toBeCloseTo(25);
    expect(points[0].y).toBeCloseTo(15);
  });

  it("approximates an ellipse with a closed polygon", () => {
    const points = ellipseScenePoints(
      { x: 0, y: 0, width: 20, height: 10, angle: 0 },
      16,
    );
    expect(points).toHaveLength(16);
    expect(points[0]).toEqual({ x: 20, y: 5 });
  });
});
