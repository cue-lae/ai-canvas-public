import { describe, expect, it } from "vitest";
import {
  clampScenePointToElementBounds,
  clampSelectionTranslationToImageBounds,
  ellipseFrameForHandle,
  ellipseHandleScenePoints,
  getSelectionElements,
  isScenePointInsideElementBounds,
  orthogonalRectanglePointsFromVertex,
  selectionImageOrdinalMap,
  selectionLabelPoint,
  selectionNumberMap,
  selectionPointFrame,
  selectionScenePoints,
} from "./selectionGeometry";

const region = (input: Record<string, unknown>) => ({
  id: String(input.id),
  type: String(input.type ?? "freedraw"),
  x: Number(input.x ?? 10),
  y: Number(input.y ?? 20),
  width: Number(input.width ?? 100),
  height: Number(input.height ?? 80),
  angle: Number(input.angle ?? 0),
  points: input.points as readonly [number, number][] | undefined,
  customData: input.customData as Record<string, unknown>,
});

describe("selection geometry", () => {
  it("keeps path and rectangle selections as separate multi-node descriptors", () => {
    const selections = getSelectionElements([
      region({
        id: "path-element",
        customData: {
          kind: "region",
          regionId: "path",
          imageId: "image-a",
          selectionKind: "path",
          selectionPoints: [
            [0, 0],
            [40, 8],
            [32, 50],
            [0, 0],
          ],
        },
      }),
      region({
        id: "rect-element",
        type: "rectangle",
        customData: {
          kind: "region",
          regionId: "rectangle",
          imageId: "image-a",
          selectionKind: "rectangle",
        },
      }),
    ]);

    expect(selections.map((selection) => selection.kind)).toEqual([
      "path",
      "rectangle",
    ]);
    expect(selectionScenePoints(selections[0].element)).toHaveLength(4);
    expect(selectionNumberMap(selections).get("rectangle")).toBe(2);
    expect(selectionImageOrdinalMap(selections, "image-a").get("path")).toEqual({
      index: 1,
      total: 2,
    });
  });

  it("uses only four cardinal handles for an ellipse and preserves its frame", () => {
    const ellipse = region({
      id: "ellipse-element",
      type: "ellipse",
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      customData: {
        kind: "region",
        regionId: "ellipse",
        imageId: "image-a",
        selectionKind: "ellipse",
      },
    });
    expect(Object.keys(ellipseHandleScenePoints(ellipse))).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
    const frame = ellipseFrameForHandle(ellipse, "right", { x: 120, y: 50 });
    expect(frame).toMatchObject({ x: 0, y: 20, width: 120, height: 60 });
  });

  it("places the global label just outside the top-most vertex", () => {
    expect(
      selectionLabelPoint([
        { x: 80, y: 80 },
        { x: 40, y: 20 },
        { x: 10, y: 40 },
      ]),
    ).toEqual({ x: 40, y: 20 });
  });

  it("normalizes arbitrary path nodes without limiting them to four vertices", () => {
    const frame = selectionPointFrame([
      { x: 30, y: 20 },
      { x: 90, y: 10 },
      { x: 120, y: 60 },
      { x: 70, y: 90 },
      { x: 20, y: 70 },
    ]);
    expect(frame).toEqual({
      x: 20,
      y: 10,
      width: 100,
      height: 80,
      localPoints: [
        [10, 10],
        [70, 0],
        [100, 50],
        [50, 80],
        [0, 60],
      ],
    });
  });

  it("constrains a rectangle vertex drag to a right-angle rectangle without locking aspect ratio", () => {
    expect(
      orthogonalRectanglePointsFromVertex(
        [
          { x: 10, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 70 },
          { x: 10, y: 70 },
        ],
        1,
        { x: 100, y: 45 },
      ),
    ).toEqual([
      { x: 10, y: 45 },
      { x: 100, y: 45 },
      { x: 100, y: 70 },
      { x: 10, y: 70 },
    ]);
  });

  it("keeps selection creation points inside the owning image", () => {
    const image = region({
      id: "image-element",
      type: "image",
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      customData: {},
    });
    expect(isScenePointInsideElementBounds({ x: 50, y: 50 }, image)).toBe(true);
    expect(isScenePointInsideElementBounds({ x: 150, y: 50 }, image)).toBe(false);
    expect(clampScenePointToElementBounds({ x: 150, y: 5 }, image)).toEqual({
      x: 110,
      y: 20,
    });
  });

  it.each([
    {
      kind: "path",
      selection: region({
        id: "path-selection",
        x: 120,
        y: 120,
        width: 40,
        height: 30,
        customData: {
          kind: "region",
          regionId: "path",
          imageId: "image-a",
          selectionKind: "path",
          selectionPoints: [
            [0, 0],
            [40, 0],
            [30, 30],
            [0, 20],
          ],
        },
      }),
      expectedMin: { x: -20, y: -20 },
      expectedMax: { x: 140, y: 50 },
    },
    {
      kind: "rectangle",
      selection: region({
        id: "rectangle-selection",
        type: "rectangle",
        x: 140,
        y: 130,
        width: 60,
        height: 40,
        customData: {
          kind: "region",
          regionId: "rectangle",
          imageId: "image-a",
          selectionKind: "rectangle",
          selectionPoints: [
            [0, 0],
            [60, 5],
            [50, 40],
            [5, 35],
          ],
        },
      }),
      expectedMin: { x: -40, y: -30 },
      expectedMax: { x: 100, y: 30 },
    },
    {
      kind: "ellipse",
      selection: region({
        id: "ellipse-selection",
        type: "rectangle",
        x: 160,
        y: 120,
        width: 80,
        height: 40,
        customData: {
          kind: "region",
          regionId: "ellipse",
          imageId: "image-a",
          selectionKind: "ellipse",
        },
      }),
      expectedMin: { x: -60, y: -20 },
      expectedMax: { x: 60, y: 40 },
    },
  ])("clamps $kind whole-selection movement to every image edge", ({
    selection,
    expectedMin,
    expectedMax,
  }) => {
    const image = region({
      id: "image-element",
      type: "image",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      customData: { imageId: "image-a" },
    });

    expect(
      clampSelectionTranslationToImageBounds(selection, image, {
        x: -1_000,
        y: -1_000,
      }),
    ).toEqual(expectedMin);
    expect(
      clampSelectionTranslationToImageBounds(selection, image, {
        x: 1_000,
        y: 1_000,
      }),
    ).toEqual(expectedMax);
  });
});
