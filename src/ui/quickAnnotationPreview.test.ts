import { describe, expect, it } from "vitest";
import { quickAnnotationPreviewLabelFits } from "./quickAnnotationPreview";

const image = { x: 100, y: 100, width: 200, height: 100, angle: 0 };
describe("quick annotation preview label containment", () => {
  it("keeps an inside label and hides an outside label", () => {
    expect(quickAnnotationPreviewLabelFits(image, { x: 150, y: 120 }, "right", 80, 26, 1)).toBe(true);
    expect(quickAnnotationPreviewLabelFits(image, { x: 80, y: 220 }, "right", 80, 26, 1)).toBe(false);
  });
  it("checks the full label width, its anchoring side, and zoom", () => {
    expect(quickAnnotationPreviewLabelFits(image, { x: 250, y: 120 }, "right", 80, 26, 1)).toBe(false);
    expect(quickAnnotationPreviewLabelFits(image, { x: 150, y: 120 }, "left", 80, 26, 1)).toBe(false);
    expect(quickAnnotationPreviewLabelFits(image, { x: 250, y: 120 }, "right", 80, 26, 2)).toBe(true);
    expect(quickAnnotationPreviewLabelFits(image, { x: 150, y: 180 }, "right", 80, 26, 1)).toBe(false);
  });
  it("respects the rotated image footprint", () => {
    expect(quickAnnotationPreviewLabelFits({ ...image, angle: Math.PI / 2 },
      { x: 180, y: 100 }, "right", 30, 20, 1)).toBe(true);
    expect(quickAnnotationPreviewLabelFits({ ...image, angle: Math.PI / 2 },
      { x: 110, y: 100 }, "right", 30, 20, 1)).toBe(false);
  });
});
