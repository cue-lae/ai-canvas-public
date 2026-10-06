import type {
  Bounds,
  ImageCropRecord,
  Point,
  RegionGeometry,
} from "./types";

export interface RectTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  scaleX?: number;
  scaleY?: number;
}

export interface ImageTransform extends RectTransform {
  naturalWidth: number;
  naturalHeight: number;
  crop?: ImageCropRecord | null;
}

const EPSILON = 1e-9;

const assertPositive = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是大于 0 的有限数值`);
  }
};

const rotate = (point: Point, angle: number): Point => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

const effectiveScale = (value: number | undefined): number =>
  value === -1 ? -1 : 1;

export const localPointToScene = (
  local: Point,
  transform: RectTransform,
): Point => {
  assertPositive("width", transform.width);
  assertPositive("height", transform.height);

  const scaleX = effectiveScale(transform.scaleX);
  const scaleY = effectiveScale(transform.scaleY);
  const centered = {
    x: (local.x - transform.width / 2) * scaleX,
    y: (local.y - transform.height / 2) * scaleY,
  };
  const rotated = rotate(centered, transform.angle);

  return {
    x: transform.x + transform.width / 2 + rotated.x,
    y: transform.y + transform.height / 2 + rotated.y,
  };
};

export const scenePointToLocal = (
  scene: Point,
  transform: RectTransform,
): Point => {
  assertPositive("width", transform.width);
  assertPositive("height", transform.height);

  const centered = {
    x: scene.x - (transform.x + transform.width / 2),
    y: scene.y - (transform.y + transform.height / 2),
  };
  const unrotated = rotate(centered, -transform.angle);

  return {
    x:
      unrotated.x * effectiveScale(transform.scaleX) +
      transform.width / 2,
    y:
      unrotated.y * effectiveScale(transform.scaleY) +
      transform.height / 2,
  };
};

const sourceRect = (image: ImageTransform): Bounds => {
  assertPositive("naturalWidth", image.naturalWidth);
  assertPositive("naturalHeight", image.naturalHeight);

  if (!image.crop) {
    return {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }

  assertPositive("crop.width", image.crop.width);
  assertPositive("crop.height", image.crop.height);
  return image.crop;
};

export const scenePointToImagePixel = (
  scene: Point,
  image: ImageTransform,
): Point => {
  const local = scenePointToLocal(scene, image);
  const source = sourceRect(image);

  return {
    x: source.x + (local.x / image.width) * source.width,
    y: source.y + (local.y / image.height) * source.height,
  };
};

export const imagePixelToScenePoint = (
  pixel: Point,
  image: ImageTransform,
): Point => {
  const source = sourceRect(image);
  const local = {
    x: ((pixel.x - source.x) / source.width) * image.width,
    y: ((pixel.y - source.y) / source.height) * image.height,
  };

  return localPointToScene(local, image);
};

export const rectSceneCorners = (rect: RectTransform): Point[] => [
  localPointToScene({ x: 0, y: 0 }, rect),
  localPointToScene({ x: rect.width, y: 0 }, rect),
  localPointToScene({ x: rect.width, y: rect.height }, rect),
  localPointToScene({ x: 0, y: rect.height }, rect),
];

export const pointsBounds = (points: readonly Point[]): Bounds => {
  if (points.length === 0) {
    throw new Error("无法计算空点集的边界");
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const clipBounds = (
  bounds: Bounds,
  width: number,
  height: number,
): Bounds => {
  const left = Math.max(0, Math.min(width, bounds.x));
  const top = Math.max(0, Math.min(height, bounds.y));
  const right = Math.max(0, Math.min(width, bounds.x + bounds.width));
  const bottom = Math.max(0, Math.min(height, bounds.y + bounds.height));

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
};

export const pointDistance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const calculateRegionGeometry = (
  region: RectTransform,
  image: ImageTransform,
): RegionGeometry => {
  const sceneCorners = rectSceneCorners(region);
  const imageLocalCorners = sceneCorners.map((point) =>
    scenePointToLocal(point, image),
  );
  const originalPixelCorners = sceneCorners.map((point) =>
    scenePointToImagePixel(point, image),
  );
  const normalizedCorners = originalPixelCorners.map((point) => ({
    x: point.x / image.naturalWidth,
    y: point.y / image.naturalHeight,
  }));
  const originalPixelBounds = pointsBounds(originalPixelCorners);
  const clippedPixelBounds = clipBounds(
    originalPixelBounds,
    image.naturalWidth,
    image.naturalHeight,
  );
  const roundTripMaxErrorPx = Math.max(
    ...originalPixelCorners.map((pixel) =>
      pointDistance(
        pixel,
        scenePointToImagePixel(imagePixelToScenePoint(pixel, image), image),
      ),
    ),
  );

  return {
    sceneCorners,
    imageLocalCorners,
    originalPixelCorners,
    normalizedCorners,
    originalPixelBounds,
    clippedPixelBounds,
    isClipped:
      Math.abs(originalPixelBounds.x - clippedPixelBounds.x) > EPSILON ||
      Math.abs(originalPixelBounds.y - clippedPixelBounds.y) > EPSILON ||
      Math.abs(originalPixelBounds.width - clippedPixelBounds.width) >
        EPSILON ||
      Math.abs(originalPixelBounds.height - clippedPixelBounds.height) >
        EPSILON,
    roundTripMaxErrorPx,
  };
};
