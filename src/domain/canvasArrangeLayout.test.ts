import { describe, expect, it } from "vitest";
import {
  arrangeCanvasObjects,
  resolveCanvasArrangeDescriptionImageId,
  type CanvasArrangeObject,
} from "./canvasArrangeLayout";

const objects: readonly CanvasArrangeObject[] = [
  { id: "image-a", kind: "image", x: 90, y: 80, width: 250, height: 170 },
  { id: "description-a", kind: "description", x: 280, y: 145, width: 216, height: 144 },
  { id: "folder-a", kind: "folder", x: 460, y: 95, width: 148, height: 200 },
  { id: "image-b", kind: "image", x: 620, y: 330, width: 310, height: 190 },
];

const overlaps = (
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

describe("arrangeCanvasObjects", () => {
  it("keeps the original content anchor and preserves object geometry", () => {
    const arranged = arrangeCanvasObjects(objects, { maxRowWidth: 720 });

    expect(Math.min(...arranged.map(({ x }) => x))).toBe(90);
    expect(Math.min(...arranged.map(({ y }) => y))).toBe(80);
    arranged.forEach((placement) => {
      const source = objects.find(({ id }) => id === placement.id);
      expect(source).toBeDefined();
      expect(placement).toMatchObject({
        kind: source!.kind,
        width: source!.width,
        height: source!.height,
      });
    });
  });

  it("uses stable top-to-bottom and left-to-right reading order", () => {
    const arranged = arrangeCanvasObjects(objects, { maxRowWidth: 2000 });

    expect(arranged.map(({ id }) => id)).toEqual([
      "image-a",
      "description-a",
      "folder-a",
      "image-b",
    ]);
  });

  it("wraps mixed-size objects without overlaps and with fixed gaps", () => {
    const arranged = arrangeCanvasObjects(objects, {
      maxRowWidth: 650,
      horizontalGap: 28,
      verticalGap: 32,
    });

    arranged.forEach((left, index) => {
      arranged.slice(index + 1).forEach((right) => {
        expect(overlaps(left, right)).toBe(false);
      });
    });
    expect(arranged[2]).toMatchObject({ x: 90, y: 80 + 170 + 32 });
    expect(arranged[3]).toMatchObject({ x: 90 + 148 + 28, y: 80 + 170 + 32 });
  });

  it("keeps duplicate positions deterministic through source order", () => {
    const duplicates: readonly CanvasArrangeObject[] = [
      { id: "first", kind: "image", x: 10, y: 10, width: 100, height: 80 },
      { id: "second", kind: "description", x: 10, y: 10, width: 90, height: 70 },
      { id: "third", kind: "folder", x: 10, y: 10, width: 80, height: 60 },
    ];

    expect(
      arrangeCanvasObjects(duplicates, { maxRowWidth: 1000 }).map(({ id }) => id),
    ).toEqual(["first", "second", "third"]);
  });

  it("does not invent members outside the supplied current-layer scope", () => {
    const currentLayer = objects.filter(({ id }) => id !== "image-b");
    const arranged = arrangeCanvasObjects(currentLayer, { maxRowWidth: 720 });

    expect(arranged.map(({ id }) => id)).toEqual([
      "image-a",
      "description-a",
      "folder-a",
    ]);
  });
});

describe("resolveCanvasArrangeDescriptionImageId", () => {
  const scopeImageIds = new Set(["image-a", "image-b"]);

  it("keeps an explicit image binding as the arrange group owner", () => {
    expect(
      resolveCanvasArrangeDescriptionImageId({
        imageBindingImageId: "image-a",
        linkedRegionImageIds: ["image-b"],
        scopeImageIds,
      }),
    ).toBe("image-a");
  });

  it("groups a description linked to regions from one visible image", () => {
    expect(
      resolveCanvasArrangeDescriptionImageId({
        linkedRegionImageIds: ["image-b", "image-b"],
        scopeImageIds,
      }),
    ).toBe("image-b");
  });

  it("leaves cross-image descriptions independent", () => {
    expect(
      resolveCanvasArrangeDescriptionImageId({
        linkedRegionImageIds: ["image-a", "image-b"],
        scopeImageIds,
      }),
    ).toBeNull();
  });
});
