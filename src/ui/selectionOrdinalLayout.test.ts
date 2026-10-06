// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSelectionOrdinalPointInside,
  selectionOrdinalLayout,
  type SelectionOrdinalPoint,
  type SelectionOrdinalShape,
} from "./selectionOrdinalLayout";

const corners = (bounds: Readonly<{ x: number; y: number; width: number; height: number }>) => [
  { x: bounds.x, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x, y: bounds.y + bounds.height },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
];

const rotatedRectangle = (
  center: SelectionOrdinalPoint,
  width: number,
  height: number,
  radians: number,
): SelectionOrdinalShape => {
  const rotate = (point: SelectionOrdinalPoint) => ({
    x: center.x + point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: center.y + point.x * Math.sin(radians) + point.y * Math.cos(radians),
  });
  return {
    kind: "polygon",
    points: [
      rotate({ x: -width / 2, y: -height / 2 }),
      rotate({ x: width / 2, y: -height / 2 }),
      rotate({ x: width / 2, y: height / 2 }),
      rotate({ x: -width / 2, y: height / 2 }),
    ],
  };
};

const expectShapeAwareOrdinal = (shape: SelectionOrdinalShape, number: number) => {
  const layout = selectionOrdinalLayout({ shape, number });
  expect(layout).not.toBeNull();
  if (!layout) {
    throw new Error("Expected a shape that can contain its ordinal.");
  }

  expect(layout.text).toBe(`选区 ${number}`);
  expect(isSelectionOrdinalPointInside(shape, layout.anchor)).toBe(true);
  expect(corners(layout.textBounds).every((point) => isSelectionOrdinalPointInside(shape, point))).toBe(
    true,
  );
  expect(layout.cutoutX).toBeLessThanOrEqual(layout.textBounds.x);
  expect(layout.cutoutY).toBeLessThanOrEqual(layout.textBounds.y);
  expect(layout.cutoutX + layout.cutoutWidth).toBeGreaterThanOrEqual(
    layout.textBounds.x + layout.textBounds.width,
  );
  expect(layout.cutoutY + layout.cutoutHeight).toBeGreaterThanOrEqual(
    layout.textBounds.y + layout.textBounds.height,
  );
};

const expectNoOrdinal = (shape: SelectionOrdinalShape, number: number) => {
  expect(() => selectionOrdinalLayout({ shape, number })).not.toThrow();
  expect(selectionOrdinalLayout({ shape, number })).toBeNull();
};

describe("selection ordinal label layout", () => {
  it("keeps an axis-aligned rectangle ordinal inside its top visible contour", () => {
    expectShapeAwareOrdinal(
      {
        kind: "polygon",
        points: [
          { x: 100, y: 200 },
          { x: 340, y: 200 },
          { x: 340, y: 340 },
          { x: 100, y: 340 },
        ],
      },
      1,
    );
  });

  it("does not place a rotated rectangle ordinal in its axis-aligned bounding-box void", () => {
    const shape = rotatedRectangle({ x: 200, y: 200 }, 240, 120, Math.PI / 4);
    const layout = selectionOrdinalLayout({ shape, number: 12 });

    expectShapeAwareOrdinal(shape, 12);
    expect(layout).not.toBeNull();
    if (!layout) {
      throw new Error("Expected a rotated rectangle ordinal.");
    }
    expect(layout.textBounds.y).toBeGreaterThan(80);
    expect(isSelectionOrdinalPointInside(shape, { x: 80, y: 80 })).toBe(false);
  });

  it("uses the real rotated ellipse interior rather than its enclosing rectangle", () => {
    expectShapeAwareOrdinal(
      {
        kind: "ellipse",
        center: { x: 220, y: 180 },
        radiusX: 145,
        radiusY: 82,
        rotationRadians: Math.PI / 6,
      },
      3,
    );
  });

  it("keeps a concave path ordinal in a real top-side interior interval", () => {
    expectShapeAwareOrdinal(
      {
        kind: "polygon",
        points: [
          { x: 20, y: 20 },
          { x: 260, y: 20 },
          { x: 260, y: 55 },
          { x: 150, y: 55 },
          { x: 118, y: 130 },
          { x: 86, y: 55 },
          { x: 20, y: 55 },
        ],
      },
      4,
    );
  });

  it("widens the cutout safely for multi-digit system ordinals", () => {
    const shape: SelectionOrdinalShape = {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 360, y: 0 },
        { x: 360, y: 120 },
        { x: 0, y: 120 },
      ],
    };
    const single = selectionOrdinalLayout({ shape, number: 9 });
    const multi = selectionOrdinalLayout({ shape, number: 1234 });

    expectShapeAwareOrdinal(shape, 1234);
    expect(single).not.toBeNull();
    expect(multi).not.toBeNull();
    if (!single || !multi) {
      throw new Error("Expected wide rectangles to contain both ordinals.");
    }
    expect(multi.textBounds.width).toBeGreaterThan(single.textBounds.width);
    expect(multi.cutoutWidth).toBeGreaterThan(multi.textBounds.width);
  });

  it("safely omits ordinals that cannot fit a complete label", () => {
    expectNoOrdinal(
      {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 34, y: 0 },
          { x: 34, y: 18 },
          { x: 0, y: 18 },
        ],
      },
      1,
    );
    expectNoOrdinal(
      {
        kind: "ellipse",
        center: { x: 20, y: 16 },
        radiusX: 19,
        radiusY: 15,
        rotationRadians: Math.PI / 7,
      },
      2,
    );
    expectNoOrdinal(
      {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 7 },
          { x: 44, y: 7 },
          { x: 39, y: 20 },
          { x: 34, y: 7 },
          { x: 0, y: 7 },
        ],
      },
      3,
    );
    expectNoOrdinal(
      rotatedRectangle({ x: 30, y: 30 }, 42, 14, Math.PI / 5),
      1234,
    );
  });

  it("keeps the rejected geometry helper out of the production overlay", () => {
    const overlaySource = readFileSync(
      new URL("./SelectionCanvasOverlay.tsx", import.meta.url),
      "utf8",
    );

    expect(overlaySource).not.toContain("selectionOrdinalLayout");
    expect(overlaySource).not.toContain("selection-ordinal-cutout-");
    expect(overlaySource).toContain("className=\"selection-canvas-overlay__shape\"");
    expect(overlaySource).toContain("selection-canvas-overlay__ordinal-badge");
    expect(overlaySource).toContain("selection-canvas-overlay__binding-layer");
  });
});
