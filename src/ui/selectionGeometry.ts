import {
  localPointToScene,
  scenePointToLocal,
  type RectTransform,
} from "../domain/geometry";
import type { Point } from "../domain/types";

export type SelectionKind = "path" | "rectangle" | "ellipse";
export type SelectionLocalPoint = readonly [number, number];
export type SelectionHandle =
  | { kind: "vertex"; index: number }
  | { kind: "ellipse"; edge: "top" | "right" | "bottom" | "left" };

export interface SelectionElementLike {
  id: string;
  type: string;
  isDeleted?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  points?: readonly SelectionLocalPoint[];
  customData?: Record<string, unknown> | null;
}

export interface SelectionDescriptor {
  id: string;
  regionId: string;
  imageId: string;
  kind: SelectionKind;
  element: SelectionElementLike;
}

export interface SelectionPointFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  localPoints: readonly SelectionLocalPoint[];
}

const isFinitePoint = (value: unknown): value is SelectionLocalPoint =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "number" &&
  Number.isFinite(value[0]) &&
  typeof value[1] === "number" &&
  Number.isFinite(value[1]);

const localPointsFromCustomData = (
  element: SelectionElementLike,
): readonly SelectionLocalPoint[] | null => {
  const raw = element.customData?.selectionPoints;
  if (!Array.isArray(raw)) {
    return null;
  }
  const points = raw.filter(isFinitePoint);
  return points.length === raw.length && points.length >= 3 ? points : null;
};

export const selectionKindOf = (
  element: Pick<SelectionElementLike, "customData">,
): SelectionKind | null => {
  const value = element.customData?.selectionKind;
  return value === "path" || value === "rectangle" || value === "ellipse"
    ? value
    : null;
};

export const selectionRegionIdOf = (
  element: Pick<SelectionElementLike, "customData">,
): string | null =>
  typeof element.customData?.regionId === "string"
    ? element.customData.regionId
    : null;

export const selectionImageIdOf = (
  element: Pick<SelectionElementLike, "customData">,
): string | null =>
  typeof element.customData?.imageId === "string"
    ? element.customData.imageId
    : null;

export const isSelectionElement = (
  element: SelectionElementLike,
): element is SelectionElementLike & { customData: Record<string, unknown> } =>
  !element.isDeleted &&
  element.customData?.kind === "region" &&
  selectionKindOf(element) !== null &&
  selectionRegionIdOf(element) !== null &&
  selectionImageIdOf(element) !== null;

export const getSelectionElements = (
  elements: readonly SelectionElementLike[],
): readonly SelectionDescriptor[] =>
  elements.flatMap((element) => {
    if (!isSelectionElement(element)) {
      return [];
    }
    return [
      {
        id: element.id,
        regionId: selectionRegionIdOf(element)!,
        imageId: selectionImageIdOf(element)!,
        kind: selectionKindOf(element)!,
        element,
      },
    ];
  });

export const selectionLocalPoints = (
  element: SelectionElementLike,
): readonly SelectionLocalPoint[] => {
  const fromCustomData = localPointsFromCustomData(element);
  if (fromCustomData) {
    return fromCustomData;
  }
  if (element.type === "freedraw" && element.points?.length) {
    return element.points;
  }
  return [
    [0, 0],
    [element.width, 0],
    [element.width, element.height],
    [0, element.height],
  ];
};

export const selectionScenePoints = (
  element: SelectionElementLike,
): readonly Point[] =>
  selectionLocalPoints(element).map(([x, y]) =>
    localPointToScene({ x, y }, element),
  );

export const ellipseHandleScenePoints = (
  element: SelectionElementLike,
): Readonly<Record<"top" | "right" | "bottom" | "left", Point>> => ({
  top: localPointToScene({ x: element.width / 2, y: 0 }, element),
  right: localPointToScene({ x: element.width, y: element.height / 2 }, element),
  bottom: localPointToScene(
    { x: element.width / 2, y: element.height },
    element,
  ),
  left: localPointToScene({ x: 0, y: element.height / 2 }, element),
});

export const selectionLabelPoint = (points: readonly Point[]): Point => {
  const top = points.reduce((best, point) =>
    point.y < best.y || (point.y === best.y && point.x < best.x)
      ? point
      : best,
  );
  return { x: top.x, y: top.y };
};

export const selectionNumberMap = (
  selections: readonly SelectionDescriptor[],
): ReadonlyMap<string, number> =>
  new Map(selections.map((selection, index) => [selection.regionId, index + 1]));

export const selectionImageOrdinalMap = (
  selections: readonly SelectionDescriptor[],
  imageId: string,
): ReadonlyMap<string, { index: number; total: number }> => {
  const sameImage = selections.filter((selection) => selection.imageId === imageId);
  return new Map(
    sameImage.map((selection, index) => [
      selection.regionId,
      { index: index + 1, total: sameImage.length },
    ]),
  );
};

export const selectionPointFrame = (
  points: readonly Point[],
): SelectionPointFrame => {
  if (points.length < 2) {
    throw new Error("A selection frame needs at least two scene points.");
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - x);
  const height = Math.max(1, Math.max(...ys) - y);
  return {
    x,
    y,
    width,
    height,
    localPoints: points.map(
      (point) => [point.x - x, point.y - y] as SelectionLocalPoint,
    ),
  };
};

export const orthogonalRectanglePointsFromVertex = (
  points: readonly Point[],
  index: number,
  point: Point,
): readonly Point[] | null => {
  if (points.length !== 4 || index < 0 || index >= points.length) {
    return null;
  }
  const opposite = points[(index + 2) % points.length];
  const left = Math.min(point.x, opposite.x);
  const right = Math.max(point.x, opposite.x);
  const top = Math.min(point.y, opposite.y);
  const bottom = Math.max(point.y, opposite.y);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
};

export const isScenePointInsideElementBounds = (
  point: Point,
  element: SelectionElementLike,
): boolean => {
  const local = scenePointToLocal(point, element as RectTransform);
  return (
    local.x >= 0 &&
    local.x <= element.width &&
    local.y >= 0 &&
    local.y <= element.height
  );
};

export const clampScenePointToElementBounds = (
  point: Point,
  element: SelectionElementLike,
): Point => {
  const local = scenePointToLocal(point, element as RectTransform);
  return localPointToScene(
    {
      x: Math.min(element.width, Math.max(0, local.x)),
      y: Math.min(element.height, Math.max(0, local.y)),
    },
    element as RectTransform,
  );
};

interface LocalAxisBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const selectionBoundsInElementLocal = (
  selection: SelectionElementLike,
  element: SelectionElementLike,
): LocalAxisBounds => {
  if (selectionKindOf(selection) === "ellipse") {
    const centerScene = localPointToScene(
      { x: selection.width / 2, y: selection.height / 2 },
      selection,
    );
    const rightScene = localPointToScene(
      { x: selection.width, y: selection.height / 2 },
      selection,
    );
    const bottomScene = localPointToScene(
      { x: selection.width / 2, y: selection.height },
      selection,
    );
    const center = scenePointToLocal(centerScene, element);
    const right = scenePointToLocal(rightScene, element);
    const bottom = scenePointToLocal(bottomScene, element);
    const radiusX = Math.hypot(right.x - center.x, bottom.x - center.x);
    const radiusY = Math.hypot(right.y - center.y, bottom.y - center.y);
    return {
      minX: center.x - radiusX,
      minY: center.y - radiusY,
      maxX: center.x + radiusX,
      maxY: center.y + radiusY,
    };
  }

  const points = selectionScenePoints(selection).map((point) =>
    scenePointToLocal(point, element),
  );
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

export const clampSelectionTranslationToImageBounds = (
  selection: SelectionElementLike,
  image: SelectionElementLike,
  requestedDelta: Point,
): Point => {
  const bounds = selectionBoundsInElementLocal(selection, image);
  const imageOriginScene = localPointToScene({ x: 0, y: 0 }, image);
  const movedOriginLocal = scenePointToLocal(
    {
      x: imageOriginScene.x + requestedDelta.x,
      y: imageOriginScene.y + requestedDelta.y,
    },
    image,
  );
  const minDeltaX = -bounds.minX;
  const minDeltaY = -bounds.minY;
  const maxDeltaX = image.width - bounds.maxX;
  const maxDeltaY = image.height - bounds.maxY;
  const localDelta = {
    x:
      minDeltaX <= maxDeltaX
        ? Math.min(maxDeltaX, Math.max(minDeltaX, movedOriginLocal.x))
        : 0,
    y:
      minDeltaY <= maxDeltaY
        ? Math.min(maxDeltaY, Math.max(minDeltaY, movedOriginLocal.y))
        : 0,
  };
  const clampedOriginScene = localPointToScene(localDelta, image);
  return {
    x: clampedOriginScene.x - imageOriginScene.x,
    y: clampedOriginScene.y - imageOriginScene.y,
  };
};

export const scenePointToSelectionLocal = (
  point: Point,
  element: SelectionElementLike,
): Point => scenePointToLocal(point, element as RectTransform);

export const replaceSelectionLocalPoint = (
  element: SelectionElementLike,
  index: number,
  point: Point,
): readonly SelectionLocalPoint[] => {
  const current = selectionLocalPoints(element);
  const next = current.map((candidate, candidateIndex) =>
    candidateIndex === index ? ([point.x, point.y] as const) : candidate,
  );
  return next;
};

/** A scene-aligned square, limited by all four corners in the image's rotated frame. */
export const circleCreationEndPoint = (start: Point, end: Point, image: RectTransform): Point => {
  const sx = end.x < start.x ? -1 : 1;
  const sy = end.y < start.y ? -1 : 1;
  const origin = scenePointToLocal(start, image);
  let side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  for (const [dx, dy] of [[sx, 0], [0, sy], [sx, sy]]) {
    const local = scenePointToLocal({ x: start.x + dx, y: start.y + dy }, image);
    for (const [position, delta, extent] of [
      [origin.x, local.x - origin.x, image.width],
      [origin.y, local.y - origin.y, image.height],
    ]) {
      if (delta > 1e-9) side = Math.min(side, (extent - position) / delta);
      if (delta < -1e-9) side = Math.min(side, -position / delta);
    }
  }
  side = Math.max(0, side);
  return { x: start.x + sx * side, y: start.y + sy * side };
};

export const ellipseFrameForHandle = (
  element: SelectionElementLike,
  edge: "top" | "right" | "bottom" | "left",
  scenePoint: Point,
  constrainToCircle = false,
  image?: RectTransform,
): Pick<SelectionElementLike, "x" | "y" | "width" | "height"> => {
  const local = scenePointToSelectionLocal(scenePoint, element);
  const centerX = element.width / 2;
  const centerY = element.height / 2;
  const minRadius = 4;
  if (constrainToCircle) {
    const requested = Math.abs(edge === "top" || edge === "bottom"
      ? local.y - centerY : local.x - centerX);
    const center = { x: element.x + centerX, y: element.y + centerY };
    const imageCenter = image ? scenePointToLocal(center, image) : null;
    const maxRadius = image && imageCenter
      ? Math.max(0, Math.min(imageCenter.x, image.width - imageCenter.x,
          imageCenter.y, image.height - imageCenter.y))
      : Number.POSITIVE_INFINITY;
    if (maxRadius === 0) return { x: element.x, y: element.y, width: element.width, height: element.height };
    const radius = Math.min(Math.max(minRadius, requested), maxRadius);
    return { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
  }
  if (edge === "top" || edge === "bottom") {
    const height = Math.max(minRadius * 2, Math.abs(local.y - centerY) * 2);
    return {
      x: element.x,
      y: element.y + centerY - height / 2,
      width: element.width,
      height,
    };
  }
  const width = Math.max(minRadius * 2, Math.abs(local.x - centerX) * 2);
  return {
    x: element.x + centerX - width / 2,
    y: element.y,
    width,
    height: element.height,
  };
};
