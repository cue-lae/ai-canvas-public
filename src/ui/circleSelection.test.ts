import { describe, expect, it } from "vitest";
import { localPointToScene, scenePointToLocal } from "../domain/geometry";
import { circleCreationEndPoint, ellipseFrameForHandle } from "./selectionGeometry";

const ellipse = { id: "r", type: "ellipse", x: 100, y: 80, width: 100, height: 60, angle: Math.PI / 6 };
describe("Shift circle geometry", () => {
  it.each(["top", "right", "bottom", "left"] as const)("locks %s to a circle while preserving its center", edge => {
    const point = localPointToScene({ x: edge === "left" ? -20 : edge === "right" ? 120 : 50,
      y: edge === "top" ? -40 : edge === "bottom" ? 100 : 30 }, ellipse);
    const frame = ellipseFrameForHandle(ellipse, edge, point, true);
    expect(frame.width).toBeCloseTo(140);
    expect(frame.height).toBeCloseTo(frame.width);
    expect(frame.x + frame.width / 2).toBe(150);
    expect(frame.y + frame.height / 2).toBe(110);
  });
  it("caps a circle at the nearest edge of a rotated image without moving its center", () => {
    const image = { x: 20, y: 10, width: 300, height: 200, angle: Math.PI / 4 };
    const center = localPointToScene({ x: 40, y: 100 }, image);
    const region = { ...ellipse, x: center.x - 20, y: center.y - 10, width: 40, height: 20 };
    const point = localPointToScene({ x: 220, y: 10 }, region);
    const frame = ellipseFrameForHandle(region, "right", point, true, image);
    expect(frame.width).toBeCloseTo(80);
    expect(frame.height).toBeCloseTo(80);
    expect(frame.x + frame.width / 2).toBeCloseTo(center.x);
    expect(frame.y + frame.height / 2).toBeCloseTo(center.y);
  });
  it("retains independent radii without Shift", () => {
    const point = localPointToScene({ x: 120, y: 30 }, ellipse);
    const frame = ellipseFrameForHandle(ellipse, "right", point, false);
    expect(frame.width).toBeCloseTo(140);
    expect(frame.height).toBe(60);
  });
  it.each([0, Math.PI / 4, -Math.PI / 3])("keeps new circle bounds inside an image rotated by %s", angle => {
    const image = { x: 0, y: 0, width: 200, height: 160, angle };
    const start = localPointToScene({ x: 100, y: 80 }, image);
    for (const [dx, dy] of [[300, 100], [-300, 100], [300, -100], [-300, -100]]) {
      const end = circleCreationEndPoint(start, { x: start.x + dx, y: start.y + dy }, image);
      expect(Math.abs(end.x - start.x)).toBeCloseTo(Math.abs(end.y - start.y));
      for (const point of [start, end, { x: end.x, y: start.y }, { x: start.x, y: end.y }]) {
        const local = scenePointToLocal(point, image);
        expect(local.x).toBeGreaterThanOrEqual(-1e-7);
        expect(local.x).toBeLessThanOrEqual(image.width + 1e-7);
        expect(local.y).toBeGreaterThanOrEqual(-1e-7);
        expect(local.y).toBeLessThanOrEqual(image.height + 1e-7);
      }
    }
  });
});
