import {
  selectionMaskBounds,
  selectionMaskBoundsIntersect,
  type SelectionMaskBounds,
} from "./selectionOcclusion";

export interface FolderPreviewRawMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface FolderPreviewMaskSweepInput {
  /** getBBox() includes the static inner correction, but excludes this node's own CSS transform. */
  bbox: Readonly<SelectionMaskBounds> | null;
  target: Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
    angle?: number;
  }>;
  current: Readonly<FolderPreviewRawMatrix> | null;
  closed: Readonly<{ translateX: number; translateY: number; scale: number }>;
  panel: Readonly<{ width: number; height: number }>;
  padding?: number;
}

const MATRIX_EPSILON = 1e-8;
const positive = (value: number) => Number.isFinite(value) && value > 0;

const supportedMatrix = (matrix: Readonly<FolderPreviewRawMatrix> | null) =>
  matrix !== null &&
  [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) &&
  matrix.a > 0 && matrix.d > 0 &&
  Math.abs(matrix.a - matrix.d) <= MATRIX_EPSILON &&
  Math.abs(matrix.b) <= MATRIX_EPSILON &&
  Math.abs(matrix.c) <= MATRIX_EPSILON;

/** Conservative bounds for one committed preview layout; no DOM reads or retained geometry. */
export const folderPreviewMaskSweepBounds = ({
  bbox,
  target,
  current,
  closed,
  panel,
  padding = 2,
}: FolderPreviewMaskSweepInput): SelectionMaskBounds => {
  const safePadding = Number.isFinite(padding) && padding >= 0 ? padding : 2;
  const fallback = (): SelectionMaskBounds => {
    const extent = (panelSize: number, candidates: readonly number[]) => {
      if (positive(panelSize)) return panelSize;
      const finite = candidates.filter(Number.isFinite);
      return Math.max(1, ...finite.map((value) => Math.ceil(value + safePadding)));
    };
    return {
      x: 0,
      y: 0,
      width: extent(panel.width, [target.left + target.width, bbox ? bbox.x + bbox.width : NaN]),
      height: extent(panel.height, [target.top + target.height, bbox ? bbox.y + bbox.height : NaN]),
    };
  };
  if (
    !bbox || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite) ||
    bbox.width < 0 || bbox.height < 0 ||
    ![target.left, target.top, target.angle ?? 0].every(Number.isFinite) ||
    !positive(target.width) || !positive(target.height) ||
    !positive(panel.width) || !positive(panel.height) ||
    !Number.isFinite(padding) || padding < 0 ||
    !supportedMatrix(current) ||
    ![closed.translateX, closed.translateY].every(Number.isFinite) || !positive(closed.scale)
  ) return fallback();

  const angle = target.angle ?? 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const poses: readonly Readonly<FolderPreviewRawMatrix>[] = [
    current!,
    { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    { a: closed.scale, b: 0, c: 0, d: closed.scale, e: closed.translateX, f: closed.translateY },
  ];
  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ];
  const points = poses.flatMap((matrix) => corners.map((point) => {
    const x = point.x - target.left, y = point.y - target.top;
    const transformedX = matrix.a * x + matrix.c * y + matrix.e;
    const transformedY = matrix.b * x + matrix.d * y + matrix.f;
    return {
      x: target.left + cos * transformedX - sin * transformedY,
      y: target.top + sin * transformedX + cos * transformedY,
    };
  }));
  return selectionMaskBounds(points, panel, padding) ?? fallback();
};

/** Touching swept bounds remain eligible for the exact rounded image mask. */
export const folderPreviewMaskBoundsOverlap = selectionMaskBoundsIntersect;
