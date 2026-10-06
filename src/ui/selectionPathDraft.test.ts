import { describe, expect, it } from "vitest";
import { removeLastSelectionPathAnchor } from "./selectionPathDraft";

describe("路径选区锚点草稿", () => {
  it("每次只移除最后一个已落锚点", () => {
    const points = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ];
    expect(removeLastSelectionPathAnchor(points)).toEqual(points.slice(0, 2));
    expect(points).toHaveLength(3);
  });

  it("支持连续回退至零个锚点", () => {
    const one = removeLastSelectionPathAnchor([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    const none = removeLastSelectionPathAnchor(one);
    expect(one).toEqual([{ x: 10, y: 20 }]);
    expect(none).toEqual([]);
  });

  it("空草稿保持同一引用", () => {
    const empty: readonly { x: number; y: number }[] = [];
    expect(removeLastSelectionPathAnchor(empty)).toBe(empty);
  });
});
