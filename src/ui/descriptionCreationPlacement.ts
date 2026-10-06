import type { Point } from "../domain/types";

export type DescriptionPlacementBounds = readonly [number, number, number, number];
export const DESCRIPTION_CREATION_IMAGE_GAP_PX = 24;

// Reserve the existing card's full size, including growth after its first edit.
// Low zoom uses the same minimum screen footprint as .is-low-zoom.
export const descriptionCreationCardSize = (zoom: number) => ({
  width: Math.max(216, 48 / zoom),
  height: Math.max(144, 32 / zoom),
});

type Size = Readonly<{ width: number; height: number }>;
const EPSILON = 1e-7;
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** Find the closest free anchor by sweeping image edges, not sampling a grid. */
const closestPlacement = (
  preferred: Point,
  size: Size,
  obstacles: readonly DescriptionPlacementBounds[],
  domain: DescriptionPlacementBounds,
): Point | null => {
  const [minX, minY, maxX, maxY] = domain;
  if (minX > maxX || minY > maxY) return null;
  const xs = new Set([clamp(preferred.x, minX, maxX)]);
  if (Number.isFinite(minX)) xs.add(minX);
  if (Number.isFinite(maxX)) xs.add(maxX);
  for (const [left, , right] of obstacles) {
    if (left - size.width >= minX && left - size.width <= maxX) xs.add(left - size.width);
    if (right >= minX && right <= maxX) xs.add(right);
  }
  let best: Point | null = null;
  let bestDistance = Infinity;
  const consider = (x: number, low: number, high: number) => {
    if (low > high) return;
    const y = clamp(preferred.y, low, high);
    const distance = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
    if (
      distance < bestDistance - EPSILON ||
      (Math.abs(distance - bestDistance) <= EPSILON &&
        (!best || y < best.y || (y === best.y && x < best.x)))
    ) {
      best = { x, y };
      bestDistance = distance;
    }
  };
  for (const x of xs) {
    const blockedY = obstacles
      .filter(([left, , right]) =>
        x + size.width > left + EPSILON && x < right - EPSILON)
      .map(([, top, , bottom]) => [top - size.height, bottom] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cursor = minY;
    for (const [low, high] of blockedY) {
      if (high < cursor) continue;
      if (low > maxY) break;
      if (low >= cursor) consider(x, cursor, Math.min(low, maxY));
      cursor = Math.max(cursor, high);
      if (cursor > maxY) break;
    }
    if (cursor <= maxY) consider(x, cursor, maxY);
  }
  return best;
};

/** Scene coordinates only; never mutates images, existing cards, or viewport. */
export const placeNewDescriptionOutsideImages = ({
  preferred,
  size,
  imageBounds,
  viewport,
  gap,
}: {
  preferred: Point;
  size: Size;
  imageBounds: readonly DescriptionPlacementBounds[];
  viewport: DescriptionPlacementBounds;
  gap: number;
}): Point => {
  if (imageBounds.length === 0) return { ...preferred };
  const obstacles: DescriptionPlacementBounds[] = imageBounds.map(
    ([left, top, right, bottom]) => [left - gap, top - gap, right + gap, bottom + gap],
  );
  const visible = closestPlacement(preferred, size, obstacles, [
    viewport[0], viewport[1], viewport[2] - size.width, viewport[3] - size.height,
  ]);
  if (visible) return visible;
  // Finite image bounds always leave free space beyond their outermost edge.
  return closestPlacement(preferred, size, obstacles, [-Infinity, -Infinity, Infinity, Infinity])!;
};
