import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const ANGLE_EPSILON = 0.0001;

export interface SelectionMaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Conservative test: touching bounds still keep the real occlusion mask. */
export const selectionMaskBoundsIntersect = (
  first: SelectionMaskBounds,
  second: SelectionMaskBounds,
) => first.width > 0 && first.height > 0 && second.width > 0 && second.height > 0 &&
  first.x <= second.x + second.width && second.x <= first.x + first.width &&
  first.y <= second.y + second.height && second.y <= first.y + first.height;

/** Bound a preview mask without changing its original viewport clipping. */
export const selectionMaskBounds = (
  points: readonly Readonly<{ x: number; y: number }>[],
  viewport: Readonly<{ width: number; height: number }>,
  padding = 0,
): SelectionMaskBounds | undefined => {
  if (points.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return undefined;
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const x = Math.min(viewport.width, Math.max(0, Math.floor(left - padding)));
  const y = Math.min(viewport.height, Math.max(0, Math.floor(top - padding)));
  return {
    x,
    y,
    width: Math.max(0, Math.min(viewport.width, Math.ceil(right + padding)) - x),
    height: Math.max(0, Math.min(viewport.height, Math.ceil(bottom + padding)) - y),
  };
};

const imageIdOf = (element: ExcalidrawElement): string | null =>
  element.type === "image" && typeof element.customData?.imageId === "string"
    ? element.customData.imageId
    : null;

/** Kept for callers that need to identify the simpler axis-aligned geometry. */
export const isAxisAlignedAngle = (angle: number): boolean => {
  const normalized = Math.abs(angle % Math.PI);
  return normalized < ANGLE_EPSILON || Math.abs(normalized - Math.PI) < ANGLE_EPSILON;
};

export const higherImageElementsFor = (
  elements: readonly ExcalidrawElement[],
  imageId: string,
): readonly ExcalidrawElement[] => {
  const imageElements = elements.filter(
    (element) => !element.isDeleted && imageIdOf(element) !== null,
  );
  const selectedIndex = imageElements.findIndex(
    (element) => imageIdOf(element) === imageId,
  );
  return selectedIndex < 0 ? [] : imageElements.slice(selectedIndex + 1);
};

export const rotatedRectScenePoints = (
  element: Pick<ExcalidrawElement, "x" | "y" | "width" | "height" | "angle">,
): readonly { x: number; y: number }[] => {
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return [
    { x: -element.width / 2, y: -element.height / 2 },
    { x: element.width / 2, y: -element.height / 2 },
    { x: element.width / 2, y: element.height / 2 },
    { x: -element.width / 2, y: element.height / 2 },
  ].map(({ x, y }) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  }));
};

export const ellipseScenePoints = (
  element: Pick<ExcalidrawElement, "x" | "y" | "width" | "height" | "angle">,
  segments = 32,
): readonly { x: number; y: number }[] => {
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  return Array.from({ length: segments }, (_, index) => {
    const radians = (index / segments) * Math.PI * 2;
    const x = (element.width / 2) * Math.cos(radians);
    const y = (element.height / 2) * Math.sin(radians);
    return {
      x: center.x + x * cos - y * sin,
      y: center.y + x * sin + y * cos,
    };
  });
};
