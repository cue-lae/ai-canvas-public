import { describe, expect, it } from "vitest";
import {
  marqueeSelectsBounds,
  marqueeSelectionMode,
  normalizeMarqueeRect,
  selectCanvasObjectsInMarquee,
} from "./canvasObjectSelection";

describe("Canvas 宿主对象框选", () => {
  it("左到右只选择被完整包住的图片、说明对象与选区", () => {
    const marquee = normalizeMarqueeRect(
      { x: 100, y: 100 },
      { x: 420, y: 360 },
    );

    expect(
      selectCanvasObjectsInMarquee(marquee, [
        {
          kind: "description",
          id: "description-a",
          bounds: { left: 140, top: 120, right: 360, bottom: 280 },
        },
        {
          kind: "region",
          id: "region-a",
          bounds: { left: 180, top: 220, right: 300, bottom: 330 },
        },
        {
          kind: "region",
          id: "region-outside",
          bounds: { left: 500, top: 400, right: 620, bottom: 520 },
        },
        {
          kind: "image",
          id: "placement-a",
          bounds: { left: 110, top: 105, right: 410, bottom: 350 },
        },
      ], marqueeSelectionMode({ x: 100, y: 100 }, { x: 420, y: 360 })),
    ).toEqual({
      descriptionIds: ["description-a"],
      imagePlacementIds: ["placement-a"],
      regionIds: ["region-a"],
    });
  });

  it("右到左按碰撞选择，左到右不会选择只部分相交的对象", () => {
    const candidates = [
      {
        kind: "region" as const,
        id: "partial-region",
        bounds: { left: 80, top: 120, right: 140, bottom: 180 },
      },
    ];
    const marquee = normalizeMarqueeRect(
      { x: 100, y: 100 },
      { x: 180, y: 200 },
    );

    expect(
      selectCanvasObjectsInMarquee(
        marquee,
        candidates,
        marqueeSelectionMode({ x: 100, y: 100 }, { x: 180, y: 200 }),
      ),
    ).toEqual({ descriptionIds: [], imagePlacementIds: [], regionIds: [] });
    expect(
      selectCanvasObjectsInMarquee(
        marquee,
        candidates,
        marqueeSelectionMode({ x: 180, y: 200 }, { x: 100, y: 100 }),
      ),
    ).toEqual({
      descriptionIds: [],
      imagePlacementIds: [],
      regionIds: ["partial-region"],
    });
    expect(marqueeSelectsBounds(marquee, candidates[0].bounds, "contain")).toBe(false);
    expect(marqueeSelectsBounds(marquee, candidates[0].bounds, "intersect")).toBe(true);
  });

  it("同一说明的锚点与说明框相交时只返回一次", () => {
    const marquee = normalizeMarqueeRect(
      { x: 100, y: 100 },
      { x: 400, y: 400 },
    );

    const result = selectCanvasObjectsInMarquee(marquee, [
      {
        kind: "description",
        id: "description-a",
        bounds: { left: 110, top: 110, right: 135, bottom: 135 },
      },
      {
        kind: "description",
        id: "description-a",
        bounds: { left: 150, top: 150, right: 390, bottom: 390 },
      },
    ]);

    expect(result).toEqual({
      descriptionIds: ["description-a"],
      imagePlacementIds: [],
      regionIds: [],
    });
    expect(Object.keys(result).sort()).toEqual([
      "descriptionIds",
      "imagePlacementIds",
      "regionIds",
    ]);
    expect(result).not.toHaveProperty("activateDescriptionId");
    expect(result).not.toHaveProperty("openDescriptionId");
    expect(result).not.toHaveProperty("focusDescriptionId");
  });
});
