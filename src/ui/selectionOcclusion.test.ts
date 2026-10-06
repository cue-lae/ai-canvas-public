import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  ellipseScenePoints,
  higherImageElementsFor,
  isAxisAlignedAngle,
  rotatedRectScenePoints,
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
