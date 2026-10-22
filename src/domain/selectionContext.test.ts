import { describe, expect, it } from "vitest";
import { createEmptyBusinessState } from "./types";
import { calculateRegionGeometry } from "./geometry";
import {
  buildPublishedSelectionGeometry,
  type PublishedSceneElement,
} from "./selectionContext";

const fixture = (kind: "rectangle" | "ellipse" | "path" = "rectangle") => {
  const business = createEmptyBusinessState("document");
  business.document.imageAssetIds = ["image"];
  business.document.imagePlacementIds = ["placement"];
  business.document.regionIds = ["region"];
  business.imageAssets.image = {
    id: "image", fileId: "file", name: "original.png", mimeType: "image/png",
    naturalWidth: 1200, naturalHeight: 800, source: "local", createdAt: "2026-10-20",
    folderId: "folder-a",
  };
  business.regions.region = {
    id: "region", imageId: "image", elementId: "selection", geometry: null,
    active: true, status: "valid", folderId: "folder-a",
  };
  const image: PublishedSceneElement = {
    id: "image-element", type: "image", x: 100, y: 200, width: 600, height: 400,
    angle: 0, scale: [1, 1], crop: null, fileId: "file",
    customData: { kind: "image", imageId: "image", placementId: "placement", folderId: "folder-a" },
  };
  business.imagePlacements.placement = {
    id: "placement", imageId: "image", elementId: image.id,
    x: image.x, y: image.y, width: image.width, height: image.height, angle: 0,
    scale: [1, 1], crop: null, active: true, folderId: "folder-a",
  };
  const selection: PublishedSceneElement = {
    id: "selection", type: "rectangle", x: 250, y: 300, width: 120, height: 80, angle: 0,
    customData: {
      kind: "region", regionId: "region", imageId: "image", selectionKind: kind,
      folderId: "folder-a",
      ...(kind === "ellipse" ? {} : { selectionPoints: kind === "path"
        ? [[0, 0], [120, 0], [80, 30], [120, 80], [0, 80]]
        : [[0, 0], [120, 0], [120, 80], [0, 80]] }),
    },
  };
  return { business, sceneElements: [image, selection], image, selection, regionId: "region" };
};

describe("published canonical selection geometry", () => {
  it("keeps rectangle, ellipse and actual path distinct even with the same bounds", () => {
    const results = (["rectangle", "ellipse", "path"] as const).map((kind) =>
      buildPublishedSelectionGeometry(fixture(kind))!,
    );
    expect(results.map((result) => result.type)).toEqual(["rectangle", "ellipse", "path"]);
    expect(results[0].points).toEqual([
      { x: 300, y: 200 }, { x: 540, y: 200 }, { x: 540, y: 360 }, { x: 300, y: 360 },
    ]);
    expect(results[1].points).toEqual(results[0].points);
    const expectedPath = [
      { x: 300, y: 200 }, { x: 540, y: 200 }, { x: 460, y: 260 },
      { x: 540, y: 360 }, { x: 300, y: 360 },
    ];
    expect(results[2].points).toHaveLength(expectedPath.length);
    results[2].points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(expectedPath[index].x, 8);
      expect(point.y).toBeCloseTo(expectedPath[index].y, 8);
    });
    expect(results[0]).toMatchObject({
      version: 1, coordinateSpace: "original-image-pixels", sourceWidth: 1200, sourceHeight: 800,
      closed: true, fillRule: "nonzero", sampling: "integer",
      clipBounds: { x: 0, y: 0, width: 1200, height: 800 },
    });
  });

  it("maps a quarter-turn, image flip and crop without clamping contour vertices", () => {
    const input = fixture("ellipse");
    Object.assign(input.image, {
      x: 100, y: 200, width: 200, height: 100, angle: Math.PI / 2, scale: [-1, 1],
      crop: { x: 100, y: 50, width: 400, height: 200, naturalWidth: 1200, naturalHeight: 800 },
    });
    Object.assign(input.selection, { x: 150, y: 200, width: 100, height: 100 });
    const result = buildPublishedSelectionGeometry(input)!;
    const expected = [[400, 250], [400, 50], [200, 50], [200, 250]];
    result.points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(expected[index][0], 8);
      expect(point.y).toBeCloseTo(expected[index][1], 8);
    });
    expect(result.clipBounds).toEqual({ x: 100, y: 50, width: 400, height: 200 });
  });

  it("preserves an ellipse's affine frame under anisotropic mapping", () => {
    const input = fixture("ellipse");
    input.image.height = 200;
    input.selection.angle = Math.PI / 4;
    const { points } = buildPublishedSelectionGeometry(input)!;
    expect(points[2].x).toBeCloseTo(points[1].x + points[3].x - points[0].x, 8);
    expect(points[2].y).toBeCloseTo(points[1].y + points[3].y - points[0].y, 8);
    const dot = (points[1].x - points[0].x) * (points[3].x - points[0].x) +
      (points[1].y - points[0].y) * (points[3].y - points[0].y);
    expect(Math.abs(dot)).toBeGreaterThan(1);
  });

  it("clips the visible source crop to the full image domain, not the ROI", () => {
    const input = fixture();
    input.image.crop = { x: -100, y: 700, width: 500, height: 300, naturalWidth: 1200, naturalHeight: 800 };
    input.selection.x = 0;
    const result = buildPublishedSelectionGeometry(input)!;
    expect(result.clipBounds).toEqual({ x: 0, y: 700, width: 400, height: 100 });
    expect(result.points[0].x).toBeLessThan(0);
  });

  it("does not replace a missing or malformed path with its rectangular host", () => {
    const input = fixture("path");
    delete input.selection.customData!.selectionPoints;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.selection.customData!.selectionPoints = [[0, 0], [20, NaN], [30, 40]];
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.selection.customData!.selectionPoints = [[0, 0], [20, 20]];
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("accepts only explicitly closed legacy freedraw contours", () => {
    const input = fixture("path");
    input.selection.type = "freedraw";
    delete input.selection.customData!.selectionPoints;
    input.selection.points = [[0, 0], [120, 0], [60, 80]];
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.selection.points = [[0, 0], [120, 0], [60, 80], [0, 0]];
    expect(buildPublishedSelectionGeometry(input)?.points).toHaveLength(4);
    input.selection.customData!.selectionPoints = [];
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("uses a native rectangle frame only when its rectangle kind is explicit", () => {
    const input = fixture();
    delete input.selection.customData!.selectionPoints;
    expect(buildPublishedSelectionGeometry(input)?.points).toHaveLength(4);
    input.selection.type = "freedraw";
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.selection.type = "rectangle";
    delete input.selection.customData!.selectionKind;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("retains self-intersecting paths even when signed area cancels", () => {
    const input = fixture("path");
    input.selection.customData!.selectionPoints = [[0, 0], [120, 80], [0, 80], [120, 0]];
    expect(buildPublishedSelectionGeometry(input)?.points).toHaveLength(4);
  });

  it("preserves every repeated winding point of a rectangle-hosted path and declares the visible nonzero rule", () => {
    const input = fixture("path");
    input.selection.customData!.selectionPoints = [
      [0, 0], [120, 0], [120, 80], [0, 80], [0, 0],
      [120, 0], [120, 80], [0, 80], [0, 0],
    ];
    const result = buildPublishedSelectionGeometry(input)!;
    expect(input.selection.type).toBe("rectangle");
    expect(result.type).toBe("path");
    expect(result.fillRule).toBe("nonzero");
    expect(result.points).toEqual([
      { x: 300, y: 200 }, { x: 540, y: 200 }, { x: 540, y: 360 },
      { x: 300, y: 360 }, { x: 300, y: 200 }, { x: 540, y: 200 },
      { x: 540, y: 360 }, { x: 300, y: 360 }, { x: 300, y: 200 },
    ]);
  });

  it("rejects degenerate contours and paths over the point limit", () => {
    const input = fixture("path");
    input.selection.customData!.selectionPoints = [[0, 0], [30, 20], [60, 40]];
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.selection.customData!.selectionPoints = Array.from({ length: 10_000 }, (_, index) => [index, index % 3]);
    expect(buildPublishedSelectionGeometry(input)?.points).toHaveLength(10_000);
    input.selection.customData!.selectionPoints = Array.from({ length: 10_001 }, (_, index) => [index, index % 3]);
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it.each([
    ["deleted selection", (input: ReturnType<typeof fixture>) => { input.selection.isDeleted = true; }],
    ["deleted image", (input: ReturnType<typeof fixture>) => { input.image.isDeleted = true; }],
    ["wrong selection element", (input: ReturnType<typeof fixture>) => { input.business.regions.region.elementId = "other"; }],
    ["wrong selection owner", (input: ReturnType<typeof fixture>) => { input.selection.customData!.imageId = "other"; }],
    ["wrong image owner", (input: ReturnType<typeof fixture>) => { input.image.customData!.imageId = "other"; }],
    ["wrong image file", (input: ReturnType<typeof fixture>) => { input.image.fileId = "other"; }],
    ["wrong folder owner", (input: ReturnType<typeof fixture>) => { input.image.customData!.folderId = "other"; }],
    ["wrong placement element", (input: ReturnType<typeof fixture>) => { input.business.imagePlacements.placement.elementId = "other"; }],
    ["inactive placement", (input: ReturnType<typeof fixture>) => { input.business.imagePlacements.placement.active = false; }],
    ["missing declared placement", (input: ReturnType<typeof fixture>) => { delete input.business.imagePlacements.placement; }],
    ["duplicate image", (input: ReturnType<typeof fixture>) => { input.sceneElements.push({ ...input.image, id: "duplicate" }); }],
    ["duplicate region", (input: ReturnType<typeof fixture>) => { input.sceneElements.push({ ...input.selection, id: "duplicate" }); }],
    ["invalid region", (input: ReturnType<typeof fixture>) => { input.business.regions.region.status = "invalid"; }],
  ] as const)("rejects %s instead of pairing an unrelated canonical element", (_name, mutate) => {
    const input = fixture();
    mutate(input);
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("permits a unique legacy pair without placement metadata, without guessing its shape", () => {
    const input = fixture("path");
    delete input.image.customData!.placementId;
    input.business.imagePlacements = {};
    expect(buildPublishedSelectionGeometry(input)?.type).toBe("path");
    delete input.selection.customData!.selectionPoints;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("refuses a missing scene or a missing placement declaration for a known placement", () => {
    const input = fixture();
    expect(buildPublishedSelectionGeometry({ business: input.business, regionId: "region" })).toBeNull();
    expect(buildPublishedSelectionGeometry({ ...input, regionId: "missing" })).toBeNull();
    delete input.image.customData!.placementId;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it.each([0, -1, 12.5, NaN, Infinity])("rejects invalid source dimensions %s", (dimension) => {
    const input = fixture();
    input.business.imageAssets.image.naturalWidth = dimension;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("rejects zero/invalid transforms and unusable or mismatched crops", () => {
    const input = fixture();
    input.selection.width = 0;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.selection.width = 120;
    input.image.angle = NaN;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.image.angle = 0;
    input.image.crop = { x: 1300, y: 0, width: 100, height: 100, naturalWidth: 1200, naturalHeight: 800 };
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
    input.image.crop.x = 0;
    input.image.crop.naturalWidth = 1300;
    expect(buildPublishedSelectionGeometry(input)).toBeNull();
  });

  it("survives scene JSON save/reopen without mutating persistent RegionGeometry", () => {
    const input = fixture("path");
    input.business.regions.region.geometry = calculateRegionGeometry(input.selection, {
      ...input.image, naturalWidth: 1200, naturalHeight: 800,
    });
    const before = JSON.stringify({ business: input.business, sceneElements: input.sceneElements });
    const original = buildPublishedSelectionGeometry(input);
    const reopened = JSON.parse(before) as typeof input;
    expect(buildPublishedSelectionGeometry({ ...reopened, regionId: "region" })).toEqual(original);
    expect(JSON.stringify({ business: input.business, sceneElements: input.sceneElements })).toBe(before);
    expect(original!.points).toHaveLength(5);
    expect(input.business.regions.region.geometry.originalPixelCorners).toHaveLength(4);
  });
});
