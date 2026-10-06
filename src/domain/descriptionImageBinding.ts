import type { Point } from "./types";

export interface DescriptionImageBinding {
  imageId: string;
  relativeX: number;
  /** Legacy top-edge bindings omit this; they remain readable as y = 0. */
  relativeY?: number;
}

export interface DescriptionBindingImageFrame {
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  scale?: readonly [number, number];
  /** Larger values are visually above lower values when images overlap. */
  zIndex?: number;
}

const clampUnit = (value: number) => Math.min(Math.max(value, 0), 1);

interface ImageLocalPoint {
  relativeX: number;
  relativeY: number;
}

const imageScale = (image: DescriptionBindingImageFrame) => {
  const [scaleX = 1, scaleY = 1] = image.scale ?? [];
  return { scaleX, scaleY };
};

const supportsImageBinding = (image: DescriptionBindingImageFrame): boolean => {
  const { scaleX, scaleY } = imageScale(image);
  return (
    Number.isFinite(image.x) &&
    Number.isFinite(image.y) &&
    Number.isFinite(image.width) &&
    Number.isFinite(image.height) &&
    Number.isFinite(image.angle) &&
    Number.isFinite(scaleX) &&
    Number.isFinite(scaleY) &&
    image.width > 0 &&
    image.height > 0 &&
    scaleX !== 0 &&
    scaleY !== 0
  );
};

/** Converts normalized image-local coordinates to the transformed scene quad. */
const imageLocalToScene = (
  image: DescriptionBindingImageFrame,
  local: ImageLocalPoint,
): Point => {
  const { scaleX, scaleY } = imageScale(image);
  const cos = Math.cos(image.angle);
  const sin = Math.sin(image.angle);
  const localX = (local.relativeX - 0.5) * image.width * scaleX;
  const localY = (local.relativeY - 0.5) * image.height * scaleY;
  return {
    x: image.x + image.width / 2 + localX * cos - localY * sin,
    y: image.y + image.height / 2 + localX * sin + localY * cos,
  };
};

/** Inverts the image transform so containment uses the true visible quad. */
const sceneToImageLocal = (
  point: Point,
  image: DescriptionBindingImageFrame,
): ImageLocalPoint => {
  const { scaleX, scaleY } = imageScale(image);
  const cos = Math.cos(image.angle);
  const sin = Math.sin(image.angle);
  const offsetX = point.x - (image.x + image.width / 2);
  const offsetY = point.y - (image.y + image.height / 2);
  return {
    relativeX:
      (offsetX * cos + offsetY * sin) / (image.width * scaleX) + 0.5,
    relativeY:
      (-offsetX * sin + offsetY * cos) / (image.height * scaleY) + 0.5,
  };
};

const isInsideImage = (local: ImageLocalPoint) =>
  local.relativeX >= 0 &&
  local.relativeX <= 1 &&
  local.relativeY >= 0 &&
  local.relativeY <= 1;

export const snapDescriptionAnchorToImageTop = (
  anchor: Point,
  images: readonly DescriptionBindingImageFrame[],
  threshold: number,
): { anchor: Point; imageBinding: DescriptionImageBinding | null } => {
  const candidate = images
    .flatMap((image) => {
      if (!supportsImageBinding(image)) {
        return [];
      }
      const local = sceneToImageLocal(anchor, image);
      const { scaleY } = imageScale(image);
      const visibleTopLocalY = scaleY < 0 ? 1 : 0;
      const edgeDistance =
        Math.abs(local.relativeY - visibleTopLocalY) *
        image.height *
        Math.abs(scaleY);
      return local.relativeX >= 0 && local.relativeX <= 1 && edgeDistance <= threshold
        ? [{ image, local, edgeDistance, visibleTopLocalY }]
        : [];
    })
    .sort(
      (left, right) =>
        left.edgeDistance - right.edgeDistance ||
        (right.image.zIndex ?? 0) - (left.image.zIndex ?? 0),
    )[0];
  if (!candidate) {
    return { anchor, imageBinding: null };
  }
  return {
    anchor: imageLocalToScene(candidate.image, {
      relativeX: clampUnit(candidate.local.relativeX),
      relativeY: candidate.visibleTopLocalY,
    }),
    imageBinding: {
      imageId: candidate.image.imageId,
      relativeX: clampUnit(candidate.local.relativeX),
    },
  };
};

export const followDescriptionImageBinding = (
  binding: DescriptionImageBinding,
  image: DescriptionBindingImageFrame,
): Point | null => {
  if (
    binding.imageId !== image.imageId ||
    !supportsImageBinding(image) ||
    !Number.isFinite(binding.relativeX)
  ) {
    return null;
  }
  return imageLocalToScene(image, {
    relativeX: clampUnit(binding.relativeX),
    relativeY: clampUnit(binding.relativeY ?? 0),
  });
};

/**
 * Binds a description anchor to the image whose visible rectangle contains its
 * centre. The host supplies scene order, so overlap resolves to the topmost
 * image without turning a visual decision into JSX state.
 */
export const bindDescriptionAnchorToImage = (
  anchor: Point,
  images: readonly DescriptionBindingImageFrame[],
): { anchor: Point; imageBinding: DescriptionImageBinding | null } => {
  const candidate = images
    .flatMap((image) => {
      if (!supportsImageBinding(image)) {
        return [];
      }
      const local = sceneToImageLocal(anchor, image);
      return isInsideImage(local) ? [{ image, local }] : [];
    })
    .sort(
      (left, right) => (right.image.zIndex ?? 0) - (left.image.zIndex ?? 0),
    )[0];
  if (!candidate) {
    return { anchor, imageBinding: null };
  }
  return {
    anchor,
    imageBinding: {
      imageId: candidate.image.imageId,
      relativeX: clampUnit(candidate.local.relativeX),
      relativeY: clampUnit(candidate.local.relativeY),
    },
  };
};
