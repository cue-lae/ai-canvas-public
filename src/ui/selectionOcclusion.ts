import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const ANGLE_EPSILON = 0.0001;

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
