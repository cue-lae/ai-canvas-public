import { describe, expect, it } from "vitest";
import { resolveQuickAnnotationConnector as connect } from "./quickAnnotationConnector";

describe("quick annotation connector edge", () => {
  const box = { x: 100, y: 40, width: 120, height: 26 };
  it("enters the facing edge in both directions", () => {
    expect(connect({ x: 20, y: 100 }, box).target).toEqual({ x: 100, y: 53 });
    expect(connect({ x: 300, y: 100 }, box).target).toEqual({ x: 220, y: 53 });
  });
  it("switches both ways after moving the entire label past the anchor", () => {
    const anchor = { x: 250, y: 100 };
    const right = connect(anchor, { ...box, x: 300 });
    const left = connect(anchor, { ...box, x: 50 }, right.side);
    expect(right.side).toBe("left");
    expect(left.side).toBe("right");
    expect(left.target.x).toBe(170);
    expect(connect(anchor, { ...box, x: 300 }, left.side).side).toBe("left");
  });
  it("keeps the previous edge inside the center buffer", () => {
    for (const x of [152, 156, 160, 164, 168]) {
      expect(connect({ x, y: 100 }, box, "left").side).toBe("left");
      expect(connect({ x, y: 100 }, box, "right").side).toBe("right");
    }
    expect(connect({ x: 169, y: 100 }, box, "left").side).toBe("right");
    expect(connect({ x: 151, y: 100 }, box, "right").side).toBe("left");
  });
  it("uses full label width after expanding and collapsing", () => {
    const anchor = { x: 200, y: 100 };
    const compact = connect(anchor, { ...box, width: 33 });
    const expanded = connect(anchor, { ...box, width: 280 }, compact.side);
    expect(compact.target.x).toBe(133);
    expect(expanded.target.x).toBe(100);
    expect(connect(anchor, { ...box, width: 33 }, expanded.side).target.x).toBe(133);
  });
  it("keeps the existing cubic curve and does not mutate placement", () => {
    const anchor = { x: 20, y: 100 };
    expect(connect(anchor, box).path).toBe("M 20 100 C 64 100, 56 53, 100 53");
    expect(box).toEqual({ x: 100, y: 40, width: 120, height: 26 });
    expect(anchor).toEqual({ x: 20, y: 100 });
  });
});
