import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_PANEL_ANCHOR_GAP,
  DESCRIPTION_PANEL_HEIGHT,
  DESCRIPTION_PANEL_WIDTH,
  descriptionAnchorVisualPosition,
  layoutDescriptionPanels,
} from "./descriptionLayout";

describe("画布说明框自动避让", () => {
  it("有足够空间时优先放在锚点右侧", () => {
    const positions = layoutDescriptionPanels(
      [{ id: "a", x: 120, y: 100 }],
      { width: 900, height: 600 },
    );
    expect(positions.get("a")).toMatchObject({ side: "right" });
    expect(positions.get("a")!.x).toBeGreaterThan(120);
  });

  it("锚点位于画布中心右侧但右边仍有空间时不会翻到左侧", () => {
    const positions = layoutDescriptionPanels(
      [{ id: "a", x: 640, y: 180 }],
      { width: 1200, height: 700 },
    );

    expect(positions.get("a")).toMatchObject({ side: "right" });
    expect(positions.get("a")!.x).toBeGreaterThan(640);
  });

  it("贴近右边缘时自动回到画布内", () => {
    const positions = layoutDescriptionPanels(
      [{ id: "a", x: 790, y: 100 }],
      { width: 820, height: 600 },
    );
    expect(positions.get("a")!.x + DESCRIPTION_PANEL_WIDTH).toBeLessThanOrEqual(
      820,
    );
    expect(positions.get("a")!.side).toBe("left");
  });

  it("多个展开说明框不会占用完全相同的位置", () => {
    const positions = layoutDescriptionPanels(
      [
        { id: "a", x: 120, y: 100 },
        { id: "b", x: 120, y: 100 },
      ],
      { width: 1000, height: 700 },
    );
    expect(positions.get("a")).not.toEqual(positions.get("b"));
  });

  it("uses a neighboring placement before the distant right collision fallback", () => {
    const positions = layoutDescriptionPanels(
      [
        { id: "first", x: 500, y: 300 },
        { id: "second", x: 500, y: 300 },
      ],
      { width: 1300, height: 800 },
    );

    expect(positions.get("first")).toMatchObject({ side: "right" });
    expect(positions.get("second")).toMatchObject({ side: "left" });
    expect(positions.get("second")!.x).toBeLessThan(500);
  });

  it("展开态编号嵌入卡片左上角，收起态回到原锚点", () => {
    const anchor = { x: 120, y: 100 };
    const placement = { x: 150, y: 76, side: "right" as const };

    expect(descriptionAnchorVisualPosition({ anchor, placement, collapsed: true }))
      .toEqual(anchor);
    expect(descriptionAnchorVisualPosition({ anchor, placement, collapsed: false }))
      .toEqual(anchor);
  });

  it("reserves visible room above the floating handoff panel", () => {
    const positions = layoutDescriptionPanels(
      [{ id: "bottom", x: 360, y: 760 }],
      { width: 1200, height: 900, bottomInset: 150 },
    );
    expect(positions.get("bottom")!.y + 336).toBeLessThanOrEqual(750 - 12);
  });

  it("uses the measured short frame height for a nearby above placement", () => {
    const anchor = { id: "bottom", x: 520, y: 720 };
    const panelHeight = 261;
    const positions = layoutDescriptionPanels(
      [anchor],
      {
        width: 1200,
        height: 900,
        bottomInset: 150,
        panelSizes: new Map([
          [anchor.id, { width: DESCRIPTION_PANEL_WIDTH, height: panelHeight }],
        ]),
      },
    );
    const placement = positions.get(anchor.id)!;

    expect(placement.side).toBe("above");
    expect(placement.y + panelHeight).toBe(
      anchor.y - DESCRIPTION_PANEL_ANCHOR_GAP,
    );
  });

  it("lays out adjacent measured frames without overlap after an open or close", () => {
    const anchors = [
      { id: "one", x: 500, y: 300 },
      { id: "two", x: 550, y: 300 },
      { id: "three", x: 600, y: 300 },
      { id: "four", x: 650, y: 300 },
    ];
    const panelSizes = new Map(
      anchors.map((anchor) => [
        anchor.id,
        { width: DESCRIPTION_PANEL_WIDTH, height: 261 },
      ]),
    );
    const bounds = { width: 1400, height: 1000, panelSizes };
    const overlaps = (leftId: string, rightId: string, positions: ReadonlyMap<string, { x: number; y: number }>) => {
      const left = positions.get(leftId)!;
      const right = positions.get(rightId)!;
      return (
        left.x < right.x + DESCRIPTION_PANEL_WIDTH &&
        left.x + DESCRIPTION_PANEL_WIDTH > right.x &&
        left.y < right.y + 261 &&
        left.y + 261 > right.y
      );
    };
    const assertNoOverlap = (
      activeAnchors: readonly (typeof anchors)[number][],
      positions: ReadonlyMap<string, { x: number; y: number }>,
    ) => {
      activeAnchors.forEach((anchor, index) => {
        activeAnchors.slice(index + 1).forEach((other) => {
          expect(overlaps(anchor.id, other.id, positions)).toBe(false);
        });
      });
    };

    assertNoOverlap(anchors, layoutDescriptionPanels(anchors, bounds));
    const afterClose = anchors.filter((anchor) => anchor.id !== "two");
    assertNoOverlap(afterClose, layoutDescriptionPanels(afterClose, bounds));
  });

  it("keeps anchors stable across edge and corner panel placements", () => {
    const bounds = { width: 1200, height: 900, bottomInset: 150 };
    const anchors = [
      { id: "top", x: 520, y: 80 },
      { id: "bottom", x: 520, y: 720 },
      { id: "left", x: 36, y: 360 },
      { id: "right", x: 1130, y: 360 },
      { id: "corner", x: 1130, y: 720 },
    ];
    const positions = layoutDescriptionPanels(anchors, bounds);
    const availableBottom = bounds.height - bounds.bottomInset;

    anchors.forEach((anchor) => {
      const placement = positions.get(anchor.id)!;
      expect(
        descriptionAnchorVisualPosition({
          anchor,
          placement,
          collapsed: false,
        }),
      ).toEqual({ x: anchor.x, y: anchor.y });
      expect(placement.x).toBeGreaterThanOrEqual(12);
      expect(placement.y).toBeGreaterThanOrEqual(12);
      expect(placement.x + DESCRIPTION_PANEL_WIDTH).toBeLessThanOrEqual(
        bounds.width - 12,
      );
      expect(placement.y + DESCRIPTION_PANEL_HEIGHT).toBeLessThanOrEqual(
        availableBottom - 12,
      );
    });

    const bottomPlacement = layoutDescriptionPanels(
      [{ id: "bottom", x: 520, y: 720 }],
      bounds,
    ).get("bottom")!;
    expect(bottomPlacement.side).toBe("above");
    expect(bottomPlacement.y + DESCRIPTION_PANEL_HEIGHT).toBe(
      720 - DESCRIPTION_PANEL_ANCHOR_GAP,
    );
  });
});
