import {
  clipBounds,
  localPointToScene,
  rectSceneCorners,
  scenePointToImagePixel,
  type ImageTransform,
  type RectTransform,
} from "./geometry";
import {
  selectionKindOf,
  type SelectionElementLike,
  type SelectionLocalPoint,
} from "../ui/selectionGeometry";
import type { Bounds, BusinessState, ImageCropRecord, Point } from "./types";

export interface PublishedSelectionGeometry {
  version: 1;
  type: "rectangle" | "ellipse" | "path";
  coordinateSpace: "original-image-pixels";
  sourceWidth: number;
  sourceHeight: number;
  points: Point[];
  closed: true;
  fillRule: "nonzero" | "evenodd";
  sampling: "integer";
  clipBounds: Bounds;
}

export interface PublishedSceneElement extends SelectionElementLike {
  scale?: readonly [number, number];
  crop?: ImageCropRecord | null;
  fileId?: string | null;
}

const MAX_POINTS = 10_000;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const positiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const transformOf = (element: PublishedSceneElement): RectTransform | null => {
  if (
    ![element.x, element.y, element.width, element.height, element.angle].every(finite) ||
    element.width <= 0 || element.height <= 0 ||
    (element.scale !== undefined &&
      (!Array.isArray(element.scale) || element.scale.length !== 2 ||
        !element.scale.every((value) => value === 1 || value === -1)))
  ) {
    return null;
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    angle: element.angle,
    scaleX: element.scale?.[0] ?? 1,
    scaleY: element.scale?.[1] ?? 1,
  };
};

const contourPoints = (value: unknown): readonly SelectionLocalPoint[] | null => {
  if (!Array.isArray(value) || value.length < 3 || value.length > MAX_POINTS) {
    return null;
  }
  return value.every((point) =>
    Array.isArray(point) && point.length === 2 && finite(point[0]) && finite(point[1]),
  ) ? value as SelectionLocalPoint[] : null;
};

// A bow-tie can have zero signed area and still have a nonempty filled mask.
const hasNonCollinearPoints = (points: readonly Point[]): boolean => {
  const first = points[0];
  const second = points.find((point) => point.x !== first.x || point.y !== first.y);
  if (!second) return false;
  return points.some((point) => {
    const cross = (second.x - first.x) * (point.y - first.y) -
      (second.y - first.y) * (point.x - first.x);
    return Number.isFinite(cross) && cross !== 0;
  });
};

const sameFolder = (expected: string | undefined, actual: unknown): boolean =>
  actual === undefined || (typeof actual === "string" && actual === expected);

/** Derive publication-only geometry from one canonical scene/business snapshot. */
export const buildPublishedSelectionGeometry = ({
  business,
  sceneElements,
  regionId,
}: {
  business: BusinessState;
  sceneElements?: readonly PublishedSceneElement[];
  regionId: string;
}): PublishedSelectionGeometry | null => {
  if (!Array.isArray(sceneElements) ||
    sceneElements.some((element) => !element || typeof element !== "object")) {
    return null;
  }
  const region = business?.regions?.[regionId];
  const asset = region && business.imageAssets?.[region.imageId];
  if (!region || region.id !== regionId || !region.active || region.status !== "valid" ||
    !asset || asset.id !== region.imageId ||
    !positiveInteger(asset.naturalWidth) || !positiveInteger(asset.naturalHeight) ||
    (region.folderId !== undefined && region.folderId !== asset.folderId)) {
    return null;
  }

  const selections = sceneElements.filter((element) =>
    !element.isDeleted && element.customData?.kind === "region" &&
    element.customData.regionId === regionId,
  );
  const selection = selections[0];
  if (selections.length !== 1 || selection.id !== region.elementId ||
    sceneElements.filter((element) => element.id === region.elementId).length !== 1 ||
    selection.customData?.imageId !== region.imageId ||
    !sameFolder(asset.folderId, selection.customData?.folderId)) {
    return null;
  }
  const kind = selectionKindOf(selection);
  const selectionTransform = transformOf(selection);
  if (!kind || !selectionTransform) return null;

  const images = sceneElements.filter((element) =>
    !element.isDeleted && element.type === "image" &&
    element.customData?.kind === "image" && element.customData.imageId === asset.id,
  );
  const image = images[0];
  if (images.length !== 1 ||
    sceneElements.filter((element) => element.id === image.id).length !== 1 ||
    !sameFolder(asset.folderId, image.customData?.folderId) ||
    (image.fileId !== undefined && image.fileId !== asset.fileId)) {
    return null;
  }
  const placementId = image.customData?.placementId;
  const placements = Object.values(business.imagePlacements ?? {}).filter((placement) =>
    placement.active && placement.imageId === asset.id,
  );
  if (placementId !== undefined || placements.length > 0) {
    if (typeof placementId !== "string" || placements.length !== 1) return null;
    const placement = business.imagePlacements[placementId];
    if (!placement || !placement.active || placement.id !== placementId ||
      placement.imageId !== asset.id || placement.elementId !== image.id ||
      placements[0] !== placement ||
      !sameFolder(asset.folderId, placement.folderId)) {
      return null;
    }
  }

  const imageTransform = transformOf(image);
  if (!imageTransform) return null;
  const crop = image.crop;
  if (crop != null && (
    ![crop.x, crop.y, crop.width, crop.height].every(finite) ||
    crop.width <= 0 || crop.height <= 0 ||
    !finite(crop.x + crop.width) || !finite(crop.y + crop.height) ||
    crop.naturalWidth !== asset.naturalWidth || crop.naturalHeight !== asset.naturalHeight
  )) {
    return null;
  }
  const domain = clipBounds(crop ?? {
    x: 0, y: 0, width: asset.naturalWidth, height: asset.naturalHeight,
  }, asset.naturalWidth, asset.naturalHeight);
  if (domain.width <= 0 || domain.height <= 0) return null;
  const source: ImageTransform = {
    ...imageTransform,
    naturalWidth: asset.naturalWidth,
    naturalHeight: asset.naturalHeight,
    crop,
  };

  let scenePoints: readonly Point[];
  if (kind === "ellipse") {
    scenePoints = rectSceneCorners(selectionTransform);
  } else {
    const raw = selection.customData?.selectionPoints;
    let localPoints = contourPoints(raw);
    if (raw !== undefined && !localPoints) return null;
    if (!localPoints && kind === "path" && selection.type === "freedraw") {
      // Only explicitly closed legacy freedraw contours are supported here.
      localPoints = contourPoints(selection.points);
      const first = localPoints?.[0];
      const last = localPoints?.[localPoints.length - 1];
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) return null;
    }
    if (!localPoints) {
      if (kind !== "rectangle" || selection.type !== "rectangle") return null;
      scenePoints = rectSceneCorners(selectionTransform);
    } else {
      if (kind === "rectangle" && localPoints.length !== 4) return null;
      scenePoints = localPoints.map(([x, y]) =>
        localPointToScene({ x, y }, selectionTransform),
      );
    }
  }
  const points = scenePoints.map((point) => scenePointToImagePixel(point, source));
  if (points.some((point) => !finite(point.x) || !finite(point.y)) ||
    !hasNonCollinearPoints(points) ||
    (kind === "rectangle" && new Set(points.map((point) => `${point.x},${point.y}`)).size !== 4)) {
    return null;
  }
  return {
    version: 1,
    type: kind,
    coordinateSpace: "original-image-pixels",
    sourceWidth: asset.naturalWidth,
    sourceHeight: asset.naturalHeight,
    points,
    closed: true,
    fillRule: "nonzero",
    sampling: "integer",
    clipBounds: domain,
  };
};
