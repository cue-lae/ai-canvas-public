export interface DescriptionPanelAnchor {
  id: string;
  x: number;
  y: number;
}

export interface DescriptionPanelPosition {
  x: number;
  y: number;
  side: "right" | "left" | "below" | "above";
}

export interface DescriptionPanelSize {
  width: number;
  height: number;
}

export interface DescriptionPanelBounds {
  width: number;
  height: number;
  /** Viewport pixels reserved by a floating canvas-owned panel at the bottom. */
  bottomInset?: number;
  /** Measured expanded frame sizes, keyed by description id. */
  panelSizes?: ReadonlyMap<string, DescriptionPanelSize>;
}

export const DESCRIPTION_PANEL_WIDTH = 340;
export const DESCRIPTION_PANEL_HEIGHT = 336;

const PANEL_MARGIN = 12;
export const DESCRIPTION_PANEL_ANCHOR_GAP = 18;
const COLLISION_GAP = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const defaultPanelSize: DescriptionPanelSize = {
  width: DESCRIPTION_PANEL_WIDTH,
  height: DESCRIPTION_PANEL_HEIGHT,
};

const panelSizeFor = (
  anchor: DescriptionPanelAnchor,
  bounds: DescriptionPanelBounds,
): DescriptionPanelSize => {
  const measured = bounds.panelSizes?.get(anchor.id);
  return measured && measured.width > 0 && measured.height > 0
    ? measured
    : defaultPanelSize;
};

const intersects = (
  left: Readonly<{ x: number; y: number; size: DescriptionPanelSize }>,
  right: Readonly<{ x: number; y: number; size: DescriptionPanelSize }>,
) =>
  left.x < right.x + right.size.width + COLLISION_GAP &&
  left.x + left.size.width + COLLISION_GAP > right.x &&
  left.y < right.y + right.size.height + COLLISION_GAP &&
  left.y + left.size.height + COLLISION_GAP > right.y;

export const descriptionAnchorVisualPosition = ({
  anchor,
}: {
  anchor: Readonly<{ x: number; y: number }>;
  placement: DescriptionPanelPosition;
  collapsed: boolean;
}) => ({ x: anchor.x, y: anchor.y });

const positionCandidates = (
  anchor: DescriptionPanelAnchor,
  size: DescriptionPanelSize,
) => {
  const stackStep = size.height + COLLISION_GAP;
  const stackedOffsets = [stackStep, -stackStep, stackStep * 2, -stackStep * 2];
  const right = {
    x: anchor.x + DESCRIPTION_PANEL_ANCHOR_GAP,
    y: anchor.y - 24,
    side: "right" as const,
  };
  const left = {
    x: anchor.x - size.width - DESCRIPTION_PANEL_ANCHOR_GAP,
    y: anchor.y - 24,
    side: "left" as const,
  };
  return [
    // Prefer the four neighboring placements before collision-only fallbacks.
    right,
    left,
    {
      x: anchor.x - 24,
      y: anchor.y + DESCRIPTION_PANEL_ANCHOR_GAP,
      side: "below" as const,
    },
    {
      x: anchor.x - 24,
      y:
        anchor.y -
        size.height -
        DESCRIPTION_PANEL_ANCHOR_GAP,
      side: "above" as const,
    },
    {
      x:
        anchor.x +
        DESCRIPTION_PANEL_ANCHOR_GAP +
        size.width +
        COLLISION_GAP,
      y: anchor.y - 24,
      side: "right" as const,
    },
    ...stackedOffsets.flatMap((offset) => [
      { ...right, y: right.y + offset },
      { ...left, y: left.y + offset },
    ]),
  ];
};

const uniqueCoordinates = (values: readonly number[]) =>
  [...new Set(values.map((value) => Math.round(value * 1000) / 1000))];

const collisionFreeFallback = ({
  anchor,
  size,
  occupied,
  bounds,
  availableBottom,
}: {
  anchor: DescriptionPanelAnchor;
  size: DescriptionPanelSize;
  occupied: readonly Readonly<{
    x: number;
    y: number;
    size: DescriptionPanelSize;
  }>[];
  bounds: DescriptionPanelBounds;
  availableBottom: number;
}): DescriptionPanelPosition | undefined => {
  const maxX = bounds.width - size.width - PANEL_MARGIN;
  const maxY = availableBottom - size.height - PANEL_MARGIN;
  const xCoordinates = uniqueCoordinates([
    PANEL_MARGIN,
    maxX,
    anchor.x - 24,
    ...occupied.flatMap((current) => [
      current.x - size.width - COLLISION_GAP,
      current.x + current.size.width + COLLISION_GAP,
    ]),
  ]).map((x) => clamp(x, PANEL_MARGIN, maxX));
  const yCoordinates = uniqueCoordinates([
    PANEL_MARGIN,
    maxY,
    anchor.y - 24,
    ...occupied.flatMap((current) => [
      current.y - size.height - COLLISION_GAP,
      current.y + current.size.height + COLLISION_GAP,
    ]),
  ]).map((y) => clamp(y, PANEL_MARGIN, maxY));

  return xCoordinates
    .flatMap((x) =>
      yCoordinates.map(
        (y): DescriptionPanelPosition => ({ x, y, side: "right" }),
      ),
    )
    .filter(
      (candidate) =>
        !occupied.some((current) => intersects({ ...candidate, size }, current)),
    )
    .sort(
      (left, right) =>
        Math.hypot(left.x - anchor.x, left.y - anchor.y) -
        Math.hypot(right.x - anchor.x, right.y - anchor.y),
    )[0];
};

export const layoutDescriptionPanels = (
  anchors: readonly DescriptionPanelAnchor[],
  bounds: DescriptionPanelBounds,
): ReadonlyMap<string, DescriptionPanelPosition> => {
  const placements = new Map<string, DescriptionPanelPosition>();
  const occupied: Array<{
    x: number;
    y: number;
    size: DescriptionPanelSize;
  }> = [];
  const availableBottom = Math.max(
    PANEL_MARGIN,
    bounds.height - (bounds.bottomInset ?? 0),
  );

  anchors.forEach((anchor) => {
    const size = panelSizeFor(anchor, bounds);
    const maxX = bounds.width - size.width - PANEL_MARGIN;
    const maxY = availableBottom - size.height - PANEL_MARGIN;
    const rawCandidates = positionCandidates(anchor, size);
    const fittingCandidates = rawCandidates.filter(
      (candidate) =>
        candidate.x >= PANEL_MARGIN &&
        candidate.y >= PANEL_MARGIN &&
        candidate.x + size.width <= bounds.width - PANEL_MARGIN &&
        candidate.y + size.height <= availableBottom - PANEL_MARGIN,
    );
    const clampedCandidates = rawCandidates.map((candidate) => ({
      ...candidate,
      x: clamp(
        candidate.x,
        PANEL_MARGIN,
        maxX,
      ),
      y: clamp(
        candidate.y,
        PANEL_MARGIN,
        maxY,
      ),
    }));
    const candidates = [...fittingCandidates, ...clampedCandidates];
    const placement =
      candidates.find(
        (candidate) =>
          !occupied.some((current) => intersects({ ...candidate, size }, current)),
      ) ??
      collisionFreeFallback({
        anchor,
        size,
        occupied,
        bounds,
        availableBottom,
      }) ??
      candidates[0];
    placements.set(anchor.id, placement);
    occupied.push({ ...placement, size });
  });

  return placements;
};
