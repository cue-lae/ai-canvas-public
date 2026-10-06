import { describe, expect, it } from "vitest";
import { imageRotationReadout } from "./rotationFeedbackPresentation";

describe("image rotation feedback", () => {
  it.each([
    [0, "0°", "horizontal"], [90, "90°", "vertical"],
    [180, "180°", "horizontal"], [270, "-90°", "vertical"],
    [360, "0°", "horizontal"], [30, "30°", null], [32.4, "32.4°", null],
  ])("formats %s degrees without changing the native angle", (degrees, label, axis) => {
    expect(imageRotationReadout(Number(degrees) * Math.PI / 180)).toEqual({ label, axis });
  });
  it.each([0.04, -0.04, 89.98, 179.98])("does not claim exact alignment for %s degrees", (degrees) => {
    const result = imageRotationReadout(degrees * Math.PI / 180);
    expect(result.axis).toBeNull();
    expect(result.label).toMatch(/^≈/);
  });
});
