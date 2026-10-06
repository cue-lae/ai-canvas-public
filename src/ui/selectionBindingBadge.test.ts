import { describe, expect, it } from "vitest";
import {
  SELECTION_BADGE_VISUALS,
  bindingBadgePosition,
  descriptionBadgeWidth,
  horizontalSelectionBadgeLayout,
  ordinalBadgeWidth,
  selectionBadgeScaleForZoom,
  selectHighestScreenPoint,
  selectBindingBadgeAnchor,
} from "./selectionBindingBadge";

describe("selection binding badge layout", () => {
  it("uses the rightmost real outline node and resolves an initial tie upward", () => {
    const anchor = selectBindingBadgeAnchor({
      points: [
        { x: 110, y: 80 },
        { x: 124, y: 90 },
        { x: 124, y: 54 },
        { x: 99, y: 46 },
      ],
    });

    expect(anchor).toEqual({ point: { x: 124, y: 54 }, pointIndex: 2 });
  });

  it("keeps the prior node within six pixels of the live maximum before switching", () => {
    const points = [
      { x: 101, y: 65 },
      { x: 104, y: 40 },
      { x: 106, y: 84 },
    ];

    expect(selectBindingBadgeAnchor({ points, previousPointIndex: 0 })).toEqual({
      point: points[0],
      pointIndex: 0,
    });
    expect(selectBindingBadgeAnchor({
      points: [{ x: 101, y: 65 }, { x: 106, y: 40 }, { x: 108, y: 84 }],
      previousPointIndex: 0,
    })).toEqual({ point: { x: 108, y: 84 }, pointIndex: 2 });
  });

  it("centralizes the compact text-label scale and row geometry", () => {
    const first = bindingBadgePosition({ anchor: { x: 200, y: 80 }, rowIndex: 0 });
    const second = bindingBadgePosition({ anchor: { x: 200, y: 80 }, rowIndex: 1 });

    expect(SELECTION_BADGE_VISUALS).toMatchObject({
      height: 18,
      fontSize: 10,
      fontWeight: 400,
      ordinalSingleDigitWidth: 24,
      descriptionSingleDigitWidth: 58,
      moreWidth: 34,
      extraDigitWidth: 7,
      descriptionRadius: 4,
      anchorGap: 8,
    });
    expect(first).toEqual({ left: 206, top: 71 });
    expect(first.left - 200 - SELECTION_BADGE_VISUALS.nodeRadius).toBe(1);
    expect(second.top - first.top).toBe(22);
    expect(ordinalBadgeWidth(1)).toBe(24);
    expect(ordinalBadgeWidth(12)).toBe(31);
    expect(descriptionBadgeWidth(1)).toBe(58);
    expect(descriptionBadgeWidth(12)).toBe(65);
    expect(SELECTION_BADGE_VISUALS.moreWidth).toBe(34);
  });

  it("preserves the accepted 100% size and caps gentle zoom-in growth", () => {
    expect(selectionBadgeScaleForZoom(0.1)).toBe(0.1);
    expect(selectionBadgeScaleForZoom(0.5)).toBe(0.5);
    expect(selectionBadgeScaleForZoom(1)).toBe(1);
    expect(selectionBadgeScaleForZoom(1.5)).toBeCloseTo(Math.sqrt(1.5));
    expect(selectionBadgeScaleForZoom(2)).toBeCloseTo(Math.sqrt(2));
    expect(selectionBadgeScaleForZoom(4)).toBe(2);
    expect(ordinalBadgeWidth(1, 2)).toBe(48);
    expect(descriptionBadgeWidth(1, 0.5)).toBe(29);
  });

  it("selects the highest public anchor and resolves equal y by x", () => {
    expect(
      selectHighestScreenPoint([
        { x: 240, y: 30 },
        { x: 180, y: 12 },
        { x: 160, y: 12 },
        { x: 200, y: 26 },
      ]),
    ).toEqual({ x: 160, y: 12 });
  });

  it("lays every description segment in one ordered continuous row", () => {
    const layout = horizontalSelectionBadgeLayout({
      ordinal: {
        text: "02",
        left: 100,
        top: 40,
        width: 40,
        height: 16,
        centerY: 50,
      },
      bindings: [
        { id: "description-1", number: 1 },
        { id: "description-12", number: 12 },
        { id: "description-123", number: 123 },
      ],
    });

    expect(layout.segments.map((segment) => segment.text)).toEqual([
      "02",
      "说明 01",
      "说明 12",
      "说明 123",
    ]);
    expect(layout.segments).toHaveLength(4);
    expect(layout.segments[0].left).toBe(100);
    expect(layout.segments[0].centerX).toBe(120);
    expect(layout.segments[1].left).toBe(140);
    expect(layout.segments[2].left).toBe(198);
    expect(layout.segments[3].left).toBe(263);
    expect(layout.segments.every((segment) => segment.centerY === 50)).toBe(true);
    expect(layout.separatorXs).toEqual([140, 198, 263]);
    expect(layout.separatorXs).toHaveLength(layout.segments.length - 1);
    expect(layout.width).toBe(40 + 58 + 65 + 72);
    expect(layout.segments[3].left + layout.segments[3].width).toBe(
      layout.left + layout.width,
    );
  });

  it("scales every horizontal segment by the same factor", () => {
    const layout = horizontalSelectionBadgeLayout({
      ordinal: {
        text: "01",
        left: 100,
        top: 40,
        width: 50,
        height: 25,
        centerY: 52.5,
      },
      bindings: [{ id: "description-1", number: 1 }],
      scale: 1.25,
    });

    expect(layout.scale).toBe(1.25);
    expect(layout.height).toBe(25);
    expect(layout.segments[1]).toMatchObject({
      left: 150,
      width: 72.5,
      height: 25,
      centerY: 52.5,
    });
    expect(layout.width).toBe(122.5);
  });

  it("keeps the complete group in anchor coordinates while offscreen", () => {
    const bindings = [
      { id: "description-1", number: 1 },
      { id: "description-12", number: 12 },
      { id: "description-123", number: 123 },
    ];
    const makeOrdinal = (left: number) => ({
      text: "02",
      left,
      top: 40,
      width: 40,
      height: 16,
      centerY: 50,
    });
    const visible = horizontalSelectionBadgeLayout({
      ordinal: makeOrdinal(200),
      bindings,
    });
    const partiallyOffscreen = horizontalSelectionBadgeLayout({
      ordinal: makeOrdinal(-20),
      bindings,
    });
    const fullyOffscreen = horizontalSelectionBadgeLayout({
      ordinal: makeOrdinal(-400),
      bindings,
    });
    const reentered = horizontalSelectionBadgeLayout({
      ordinal: makeOrdinal(100),
      bindings,
    });

    expect(visible.width).toBe(235);
    expect(partiallyOffscreen.left).toBe(-20);
    expect(partiallyOffscreen.segments[0].left).toBe(-20);
    expect(partiallyOffscreen.segments.at(-1)!.left + partiallyOffscreen.segments.at(-1)!.width).toBe(215);
    expect(fullyOffscreen.left).toBe(-400);
    expect(fullyOffscreen.segments.at(-1)!.left + fullyOffscreen.segments.at(-1)!.width).toBe(-165);
    expect(reentered.left).toBe(100);
    expect(reentered.segments[0].left).toBe(100);
    expect(reentered.segments.every((segment) => segment.top === 40)).toBe(true);
    expect(reentered.segments.every((segment) => segment.centerY === 50)).toBe(true);
    expect(reentered.separatorXs).toEqual([140, 198, 263]);
  });
});
