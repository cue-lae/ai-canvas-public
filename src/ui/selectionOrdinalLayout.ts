export interface SelectionOrdinalPoint {
  x: number;
  y: number;
}

export type SelectionOrdinalShape =
  | {
      kind: "polygon";
      points: readonly SelectionOrdinalPoint[];
    }
  | {
      kind: "ellipse";
      center: SelectionOrdinalPoint;
      radiusX: number;
      radiusY: number;
      rotationRadians: number;
    };

export interface SelectionOrdinalLayout {
  text: string;
  anchor: SelectionOrdinalPoint;
  textBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  textX: number;
  textY: number;
  cutoutX: number;
  cutoutY: number;
  cutoutWidth: number;
  cutoutHeight: number;
}

const FONT_ASCENT = 11;
const FONT_DESCENT = 4;
const TEXT_HEIGHT = FONT_ASCENT + FONT_DESCENT;
const INSIDE_PADDING_X = 7;
const CUTOUT_PADDING_X = 5;
const CUTOUT_PADDING_Y = 5;
const EPSILON = 0.001;
const ELLIPSE_SAMPLES = 96;

const textWidthForOrdinal = (number: number) =>
  // Two CJK glyphs, a space, and every decimal digit, rounded upward for the
  // rendered 11px bold face rather than relying on one fixed two-digit width.
  29 + String(number).length * 10;

const rotate = (point: SelectionOrdinalPoint, radians: number) => ({
  x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
  y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
});

const ellipseBoundary = (
  center: SelectionOrdinalPoint,
  radiusX: number,
  radiusY: number,
  rotationRadians: number,
) =>
  Array.from({ length: ELLIPSE_SAMPLES }, (_, index) => {
    const radians = (Math.PI * 2 * index) / ELLIPSE_SAMPLES;
    const local = rotate(
      { x: Math.cos(radians) * radiusX, y: Math.sin(radians) * radiusY },
      rotationRadians,
    );
    return { x: center.x + local.x, y: center.y + local.y };
  });

const boundaryForShape = (
  shape: SelectionOrdinalShape,
): readonly SelectionOrdinalPoint[] =>
  shape.kind === "polygon"
    ? shape.points
    : ellipseBoundary(
        shape.center,
        shape.radiusX,
        shape.radiusY,
        shape.rotationRadians,
      );

const isPointOnSegment = (
  point: SelectionOrdinalPoint,
  start: SelectionOrdinalPoint,
  end: SelectionOrdinalPoint,
) => {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > EPSILON) {
    return false;
  }
  return (
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
};

const isPointInPolygon = (
  point: SelectionOrdinalPoint,
  polygon: readonly SelectionOrdinalPoint[],
) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!;
    const end = polygon[index]!;
    if (isPointOnSegment(point, start, end)) {
      return true;
    }
    const intersects =
      (start.y > point.y) !== (end.y > point.y) &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

export const isSelectionOrdinalPointInside = (
  shape: SelectionOrdinalShape,
  point: SelectionOrdinalPoint,
) => {
  if (shape.kind === "polygon") {
    return isPointInPolygon(point, shape.points);
  }
  const local = rotate(
    { x: point.x - shape.center.x, y: point.y - shape.center.y },
    -shape.rotationRadians,
  );
  return (
    (local.x / shape.radiusX) ** 2 + (local.y / shape.radiusY) ** 2 <=
    1 + EPSILON
  );
};

const scanlineIntervals = (
  polygon: readonly SelectionOrdinalPoint[],
  y: number,
) => {
  const intersections: number[] = [];
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]!;
    const end = polygon[index]!;
    if ((start.y <= y && end.y > y) || (end.y <= y && start.y > y)) {
      intersections.push(
        start.x + ((y - start.y) * (end.x - start.x)) / (end.y - start.y),
      );
    }
  }
  intersections.sort((left, right) => left - right);
  return Array.from({ length: Math.floor(intersections.length / 2) }, (_, index) => ({
    left: intersections[index * 2]!,
    right: intersections[index * 2 + 1]!,
  }));
};

const rectangleCorners = (
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
) => [
  { x: bounds.x, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x, y: bounds.y + bounds.height },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
];

export const selectionOrdinalLayout = ({
  number,
  shape,
}: {
  number: number;
  shape: SelectionOrdinalShape;
}): SelectionOrdinalLayout | null => {
  const boundary = boundaryForShape(shape);
  if (boundary.length < 3) {
    throw new Error("A selection ordinal needs a closed visible shape.");
  }
  const text = `选区 ${number}`;
  const textWidth = textWidthForOrdinal(number);
  const requiredWidth = textWidth + INSIDE_PADDING_X * 2;
  const minY = Math.min(...boundary.map((point) => point.y));
  const maxY = Math.max(...boundary.map((point) => point.y));

  for (let textTop = Math.ceil(minY); textTop <= Math.floor(maxY - TEXT_HEIGHT); textTop += 1) {
    const middleY = textTop + TEXT_HEIGHT / 2;
    for (const interval of scanlineIntervals(boundary, middleY)) {
      if (interval.right - interval.left < requiredWidth) {
        continue;
      }
      for (
        let textX = Math.ceil(interval.left + INSIDE_PADDING_X);
        textX <= Math.floor(interval.right - textWidth - INSIDE_PADDING_X);
        textX += 1
      ) {
        const textBounds = {
          x: textX,
          y: textTop,
          width: textWidth,
          height: TEXT_HEIGHT,
        };
        const samples = [
          ...rectangleCorners(textBounds),
          {
            x: textBounds.x + textBounds.width / 2,
            y: textBounds.y + textBounds.height / 2,
          },
        ];
        if (!samples.every((point) => isSelectionOrdinalPointInside(shape, point))) {
          continue;
        }
        return {
          text,
          anchor: { x: textBounds.x, y: textBounds.y + FONT_ASCENT },
          textBounds,
          textX: textBounds.x,
          textY: textBounds.y + FONT_ASCENT,
          cutoutX: textBounds.x - CUTOUT_PADDING_X,
          cutoutY: textBounds.y - CUTOUT_PADDING_Y,
          cutoutWidth: textBounds.width + CUTOUT_PADDING_X * 2,
          cutoutHeight: textBounds.height + CUTOUT_PADDING_Y * 2,
        };
      }
    }
  }

  // Older saved selections and valid tiny regions can be too small to contain
  // the complete system ordinal. The overlay must keep rendering the shape and
  // its relation badges in that case, without inventing a substitute label.
  return null;
};
