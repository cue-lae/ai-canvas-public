export interface ScreenPoint {
  x: number;
  y: number;
}

export const SELECTION_BADGE_VISUALS = {
  height: 18,
  fontSize: 10,
  fontWeight: 400,
  ordinalSingleDigitWidth: 24,
  descriptionSingleDigitWidth: 58,
  moreWidth: 34,
  extraDigitWidth: 7,
  ordinalRadius: 4,
  descriptionRadius: 4,
  nodeRadius: 5,
  nodeCenterOffset: 6,
  anchorGap: 8,
  bindingRowGap: 4,
} as const;

export const SELECTION_BADGE_MAX_SCALE = 2;
export const selectionBadgeScaleForZoom = (zoom: number) =>
  zoom <= 1 ? zoom : Math.min(SELECTION_BADGE_MAX_SCALE, Math.sqrt(zoom));

export interface BindingBadgeAnchor {
  point: ScreenPoint;
  pointIndex: number;
}

/** Selects the highest exposed screen anchor, resolving equal y by x. */
export const selectHighestScreenPoint = (
  points: readonly ScreenPoint[],
): ScreenPoint | null => {
  if (points.length === 0) {
    return null;
  }
  return points.reduce((best, point) =>
    point.y < best.y || (point.y === best.y && point.x < best.x)
      ? point
      : best,
  );
};

const widthForNumber = (
  singleDigitWidth: number,
  number: number,
  scale: number,
) =>
  (singleDigitWidth +
    Math.max(0, String(number).length - 1) *
      SELECTION_BADGE_VISUALS.extraDigitWidth) *
  scale;

export const formatBadgeNumber = (number: number) =>
  String(number).padStart(2, "0");

/** Selects a real converted outline node without scanning the shape interior. */
export const selectBindingBadgeAnchor = ({
  points,
  previousPointIndex,
}: {
  points: readonly ScreenPoint[];
  previousPointIndex?: number;
}): BindingBadgeAnchor | null => {
  if (points.length === 0) {
    return null;
  }

  const maxX = Math.max(...points.map((point) => point.x));
  if (previousPointIndex !== undefined) {
    const previous = points[previousPointIndex];
    if (previous && maxX - previous.x <= 6) {
      return { point: previous, pointIndex: previousPointIndex };
    }
  }

  let pointIndex = 0;
  points.forEach((point, index) => {
    const selected = points[pointIndex]!;
    if (point.x > selected.x || (point.x === selected.x && point.y < selected.y)) {
      pointIndex = index;
    }
  });
  return { point: points[pointIndex]!, pointIndex };
};

export const ordinalBadgeWidth = (number: number, scale = 1) =>
  widthForNumber(
    SELECTION_BADGE_VISUALS.ordinalSingleDigitWidth,
    number,
    scale,
  );

export const descriptionBadgeWidth = (number: number, scale = 1) =>
  widthForNumber(
    SELECTION_BADGE_VISUALS.descriptionSingleDigitWidth,
    number,
    scale,
  );

export const bindingBadgePosition = ({
  anchor,
  rowIndex,
}: {
  anchor: ScreenPoint;
  rowIndex: number;
}) => ({
  left: anchor.x + SELECTION_BADGE_VISUALS.nodeCenterOffset,
  top:
    anchor.y - SELECTION_BADGE_VISUALS.height / 2 +
    rowIndex * (SELECTION_BADGE_VISUALS.height + SELECTION_BADGE_VISUALS.bindingRowGap),
});

export interface HorizontalSelectionBadgeSegment {
  kind: "region" | "description";
  id: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface HorizontalSelectionBadgeLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  centerY: number;
  scale: number;
  segments: readonly HorizontalSelectionBadgeSegment[];
  separatorXs: readonly number[];
}

/**
 * Produces one continuous, deterministic badge row. The helper only knows
 * presentation geometry; business state and activation remain in the host.
 */
export const horizontalSelectionBadgeLayout = ({
  ordinal,
  bindings,
  scale = 1,
}: {
  ordinal: Readonly<{
    text: string;
    left: number;
    top: number;
    width: number;
    height: number;
    centerY: number;
  }>;
  bindings: readonly Readonly<{ id: string; number: number }>[];
  scale?: number;
}): HorizontalSelectionBadgeLayout => {
  const segments: HorizontalSelectionBadgeSegment[] = [
    {
      kind: "region",
      id: "region",
      text: ordinal.text,
      left: ordinal.left,
      top: ordinal.top,
      width: ordinal.width,
      height: ordinal.height,
      centerX: ordinal.left + ordinal.width / 2,
      centerY: ordinal.centerY,
    },
  ];
  let left = ordinal.left + ordinal.width;
  for (const binding of bindings) {
    const width = descriptionBadgeWidth(binding.number, scale);
    segments.push({
      kind: "description",
      id: binding.id,
      text: `说明 ${formatBadgeNumber(binding.number)}`,
      left,
      top: ordinal.top,
      width,
      height: ordinal.height,
      centerX: left + width / 2,
      centerY: ordinal.centerY,
    });
    left += width;
  }

  const groupWidth = left - ordinal.left;

  return {
    left: ordinal.left,
    top: ordinal.top,
    width: groupWidth,
    height: ordinal.height,
    centerY: ordinal.centerY,
    scale,
    segments,
    separatorXs: segments
      .slice(0, -1)
      .map((segment) => segment.left + segment.width),
  };
};
