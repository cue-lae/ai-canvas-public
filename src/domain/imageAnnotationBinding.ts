export interface ImagePlacementFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  scale?: readonly [number, number];
}

export interface ImageBindingTransform {
  from: ImagePlacementFrame;
  to: ImagePlacementFrame;
  scaleX: number;
  scaleY: number;
}

export interface ImageBoundBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const isUnrotatedAndUnflipped = (frame: ImagePlacementFrame): boolean => {
  const [scaleX = 1, scaleY = 1] = frame.scale ?? [];
  return frame.angle === 0 && scaleX === 1 && scaleY === 1;
};

/**
 * Returns the supported parent-image transform for a bound annotation.
 *
 * Image rotation and flipping remain deliberately outside this interaction
 * scope. Returning null for those frames prevents us from pretending that an
 * axis-aligned resize kept an annotation correctly attached.
 */
export const createImageBindingTransform = (
  from: ImagePlacementFrame,
  to: ImagePlacementFrame,
): ImageBindingTransform | null => {
  if (
    !isFinitePositive(from.width) ||
    !isFinitePositive(from.height) ||
    !isFinitePositive(to.width) ||
    !isFinitePositive(to.height) ||
    !isUnrotatedAndUnflipped(from) ||
    !isUnrotatedAndUnflipped(to)
  ) {
    return null;
  }

  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return null;
  }
  if (
    from.x === to.x &&
    from.y === to.y &&
    scaleX === 1 &&
    scaleY === 1
  ) {
    return null;
  }

  return { from, to, scaleX, scaleY };
};

export const transformImageBoundBounds = (
  bounds: ImageBoundBounds,
  transform: ImageBindingTransform,
  resizeBounds = true,
): ImageBoundBounds => ({
  x: transform.to.x + (bounds.x - transform.from.x) * transform.scaleX,
  y: transform.to.y + (bounds.y - transform.from.y) * transform.scaleY,
  width: resizeBounds ? bounds.width * transform.scaleX : bounds.width,
  height: resizeBounds ? bounds.height * transform.scaleY : bounds.height,
});

export const transformImageBoundFreeDrawPoints = (
  points: readonly (readonly [number, number])[],
  transform: ImageBindingTransform,
): readonly [number, number][] =>
  points.map(([x, y]) => [x * transform.scaleX, y * transform.scaleY]);
