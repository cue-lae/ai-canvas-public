import { describe, expect, it } from "vitest";
import { selectionOrdinalBadgeLayout } from "./selectionOrdinalBadge";

describe("selection ordinal badge layout", () => {
  it("keeps the badge above the highest anchor with an 8px screen gap", () => {
    const layout = selectionOrdinalBadgeLayout({
      number: 1,
      node: { x: 200, y: 80 },
    });

    expect(layout.text).toBe("01");
    expect(layout.width).toBe(24);
    expect(layout.left + layout.width).toBe(194);
    expect(200 - (layout.left + layout.width) - 5).toBe(1);
    expect(layout.top).toBe(49);
    expect(layout.top + layout.height).toBe(67);
    expect(80 - 5 - (layout.top + layout.height)).toBe(8);
    expect(layout.centerY).toBe(58);
    expect(layout.height).toBe(18);
  });

  it("keeps every small, tilted, or concave region displayable from its highest anchor", () => {
    const firstNode = { x: 3.5, y: -7.25 };
    const layout = selectionOrdinalBadgeLayout({ number: 1234, node: firstNode });

    expect(layout.text).toBe("1234");
    expect(layout.centerY).toBe(firstNode.y - 5 - 8 - 9);
    expect(layout.left + layout.width).toBe(firstNode.x - 6);
    expect(layout.width).toBe(45);
    expect(layout.width - selectionOrdinalBadgeLayout({ number: 9, node: firstNode }).width).toBe(21);
  });

  it("leaves horizontal clamping to the complete group layout", () => {
    const layout = selectionOrdinalBadgeLayout({
      number: 1,
      node: { x: 40, y: 80 },
    });

    expect(layout.left + layout.width).toBe(34);
  });

  it("scales the badge and anchor gap with the canvas", () => {
    const zoomed = selectionOrdinalBadgeLayout({
      number: 1,
      node: { x: 320, y: 240 },
      zoom: 2,
      nodeRadius: 6,
    });
    expect(zoomed.scale).toBeCloseTo(Math.sqrt(2));
    expect(zoomed.width).toBeCloseTo(24 * Math.sqrt(2));
    expect(zoomed.height).toBeCloseTo(18 * Math.sqrt(2));
    expect(zoomed.top + zoomed.height).toBeCloseTo(
      240 - 6 - 8 * Math.sqrt(2),
    );
    expect(240 - 6 - (zoomed.top + zoomed.height)).toBeCloseTo(
      8 * Math.sqrt(2),
    );
  });
});
