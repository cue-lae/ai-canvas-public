export const ANNOTATION_CARD_PLACEHOLDER = "双击此处输入修改指令";

export type AnnotationCardBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}>;

export type AnnotationCardPoint = Readonly<{
  x: number;
  y: number;
}>;

export type BoundsEdge = "left" | "right" | "top" | "bottom";

export type BoundsEdgeAnchor = Readonly<{
  edge: BoundsEdge;
  offset: number;
}>;

/** Excalidraw 0.18.1 Helvetica and adaptive-radius values. */
export const ANNOTATION_CARD_FONT_FAMILY = 2;
export const ANNOTATION_CARD_ROUNDNESS = { type: 3 } as const;
export const ANNOTATION_CARD_SHADOW_OFFSET = 2;

export const BUBBLE_CARD_PLACEHOLDER = "输入批注";
export const BUBBLE_CARD_KIND = "bubble-card";
export const BUBBLE_TEXT_KIND = "bubble-text";
export const BUBBLE_LEADER_KIND = "bubble-leader";
export const BUBBLE_TARGET_DOT_KIND = "bubble-target-dot";
export const BUBBLE_SHADOW_KIND = "bubble-shadow";
/**
 * B3 keeps the host-owned shadow introduced by B2, while making the new bubble
 * defaults independently versioned. Existing B/B2 element data stays intact.
 */
export const BUBBLE_REFERENCE_STYLE_VERSION = "editorial-b3";
export const BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION = "editorial-b2";
export const BUBBLE_LEGACY_REFERENCE_STYLE_VERSION = "editorial-b";
/**
 * New bubbles need a quiet but still visible surface against a white canvas.
 * User-picked soft colors are preserved by normalizeBubbleCardBackgroundColor.
 */
export const BUBBLE_CARD_BACKGROUND_COLOR = "#ebfbee";
export const BUBBLE_CARD_SHADOW_OFFSET = 2;
export const BUBBLE_CARD_SHADOW_COLOR = "#5b6470";
export const BUBBLE_CARD_SHADOW_OPACITY = 12;
export const BUBBLE_LEADER_COLOR = "#9aa2ad";
/** New B3 bubbles start at the product's regular (middle) line width. */
export const BUBBLE_LEADER_STROKE_WIDTH = 4;
export const BUBBLE_TARGET_DOT_COLOR = "#9aa2ad";
export const BUBBLE_TARGET_DOT_FILL = "#fffdf8";
export const BUBBLE_TARGET_DOT_SIZE = 6;
export const BUBBLE_TEXT_COLOR = "#3d4047";
export const BUBBLE_CARD_OUTLINE_MODE_KEY = "bubbleCardOutlineMode";
export const BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY =
  "bubbleCardDefaultOutlineColor";
export const BUBBLE_TEXT_DEFAULT_COLOR_KEY = "bubbleTextDefaultColor";
/** Entering this distance from a rectangle binds a bubble endpoint to it. */
export const BUBBLE_REGION_SNAP_DISTANCE = 20;
/** A slightly larger release distance prevents endpoint jitter while dragging. */
export const BUBBLE_REGION_RELEASE_DISTANCE = 30;

/**
 * A card move can temporarily include the independent endpoint in the current
 * Excalidraw selection. Only a dot selected on its own is a retarget gesture;
 * otherwise the leader must keep its region binding and reflow from the card.
 */
export const shouldTreatBubbleTargetDotAsManualMove = (input: Readonly<{
  dotSelected: boolean;
  cardSelected: boolean;
  textSelected: boolean;
}>): boolean =>
  input.dotSelected && !input.cardSelected && !input.textSelected;

export const getAnnotationCardGroupId = (annotationId: string): string =>
  `annotation-card:${annotationId}`;

export const getBubbleCardGroupId = (bubbleId: string): string =>
  `bubble-card:${bubbleId}`;

export const ORDINARY_TEXT_BOX_KIND = "ordinary-text-box";

export const getOrdinaryTextBoxGroupId = (textId: string): string =>
  `ordinary-text-box:${textId}`;

const hasGroupId = (
  groupIds: readonly string[],
  groupId: string,
): boolean => groupIds.includes(groupId);

const withGroupId = (
  groupIds: readonly string[],
  groupId: string,
): readonly string[] =>
  hasGroupId(groupIds, groupId) ? groupIds : [...groupIds, groupId];

export const normalizeAnnotationCardGroupIds = (input: {
  kind: unknown;
  annotationId: unknown;
  groupIds: readonly string[];
}): readonly string[] => {
  if (typeof input.annotationId !== "string") {
    return input.groupIds;
  }

  const groupId = getAnnotationCardGroupId(input.annotationId);
  if (input.kind === "annotation-card" || input.kind === "annotation") {
    return withGroupId(input.groupIds, groupId);
  }
  if (input.kind === "annotation-leader") {
    const nextGroupIds = input.groupIds.filter(
      (candidate) => candidate !== groupId,
    );
    return nextGroupIds.length === input.groupIds.length
      ? input.groupIds
      : nextGroupIds;
  }
  return input.groupIds;
};

export type RegionCornerStyle = "sharp" | "round";

export const createOrdinaryTextBoxBounds = (
  text: Pick<AnnotationCardBounds, "x" | "y" | "width" | "height">,
): AnnotationCardBounds => {
  const width = Math.max(120, text.width + 24);
  const height = Math.max(48, text.height + 24);
  return {
    x: text.x - (width - text.width) / 2,
    y: text.y - (height - text.height) / 2,
    width,
    height,
  };
};

export const getRegionRoundness = (
  cornerStyle: RegionCornerStyle = "sharp",
) =>
  cornerStyle === "round"
    ? ANNOTATION_CARD_ROUNDNESS
    : null;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const centerOf = (bounds: AnnotationCardBounds): AnnotationCardPoint => ({
  x: bounds.x + bounds.width / 2,
  y: bounds.y + bounds.height / 2,
});

const rotatePoint = (
  point: AnnotationCardPoint,
  center: AnnotationCardPoint,
  angle: number,
): AnnotationCardPoint => {
  if (angle === 0) {
    return point;
  }
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const deltaX = point.x - center.x;
  const deltaY = point.y - center.y;
  return {
    x: center.x + deltaX * cosine - deltaY * sine,
    y: center.y + deltaX * sine + deltaY * cosine,
  };
};

const boundsAngle = (bounds: AnnotationCardBounds): number =>
  typeof bounds.angle === "number" && Number.isFinite(bounds.angle)
    ? bounds.angle
    : 0;

const toUnrotatedBoundsPoint = (
  bounds: AnnotationCardBounds,
  point: AnnotationCardPoint,
): AnnotationCardPoint => rotatePoint(point, centerOf(bounds), -boundsAngle(bounds));

const toRotatedBoundsPoint = (
  bounds: AnnotationCardBounds,
  point: AnnotationCardPoint,
): AnnotationCardPoint => rotatePoint(point, centerOf(bounds), boundsAngle(bounds));

const getAxisAlignedBoundsEdgePointClosestTo = (
  bounds: AnnotationCardBounds,
  point: AnnotationCardPoint,
): AnnotationCardPoint => {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;

  if (point.x <= left) {
    return { x: left, y: clamp(point.y, top, bottom) };
  }
  if (point.x >= right) {
    return { x: right, y: clamp(point.y, top, bottom) };
  }
  if (point.y <= top) {
    return { x: clamp(point.x, left, right), y: top };
  }
  if (point.y >= bottom) {
    return { x: clamp(point.x, left, right), y: bottom };
  }

  const distances = [
    { distance: point.x - left, x: left, y: point.y },
    { distance: right - point.x, x: right, y: point.y },
    { distance: point.y - top, x: point.x, y: top },
    { distance: bottom - point.y, x: point.x, y: bottom },
  ];
  const nearest = distances.reduce((candidate, current) =>
    current.distance < candidate.distance ? current : candidate,
  );
  return { x: nearest.x, y: nearest.y };
};

export const getBoundsEdgePointClosestTo = (
  bounds: AnnotationCardBounds,
  point: AnnotationCardPoint,
): AnnotationCardPoint =>
  toRotatedBoundsPoint(
    bounds,
    getAxisAlignedBoundsEdgePointClosestTo(
      bounds,
      toUnrotatedBoundsPoint(bounds, point),
    ),
  );

export const getBoundsEdgeAnchor = (
  bounds: AnnotationCardBounds,
  point: AnnotationCardPoint,
): BoundsEdgeAnchor => {
  const edgePoint = getAxisAlignedBoundsEdgePointClosestTo(
    bounds,
    toUnrotatedBoundsPoint(bounds, point),
  );
  if (edgePoint.x === bounds.x) {
    return {
      edge: "left",
      offset: clamp((edgePoint.y - bounds.y) / Math.max(bounds.height, 1), 0, 1),
    };
  }
  if (edgePoint.x === bounds.x + bounds.width) {
    return {
      edge: "right",
      offset: clamp((edgePoint.y - bounds.y) / Math.max(bounds.height, 1), 0, 1),
    };
  }
  if (edgePoint.y === bounds.y) {
    return {
      edge: "top",
      offset: clamp((edgePoint.x - bounds.x) / Math.max(bounds.width, 1), 0, 1),
    };
  }
  return {
    edge: "bottom",
    offset: clamp((edgePoint.x - bounds.x) / Math.max(bounds.width, 1), 0, 1),
  };
};

export const isBoundsEdgeAnchor = (
  value: unknown,
): value is BoundsEdgeAnchor => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<BoundsEdgeAnchor>;
  return (
    (candidate.edge === "left" ||
      candidate.edge === "right" ||
      candidate.edge === "top" ||
      candidate.edge === "bottom") &&
    typeof candidate.offset === "number" &&
    Number.isFinite(candidate.offset) &&
    candidate.offset >= 0 &&
    candidate.offset <= 1
  );
};

export const getBoundsEdgePoint = (
  bounds: AnnotationCardBounds,
  anchor: BoundsEdgeAnchor,
): AnnotationCardPoint => {
  const offset = clamp(anchor.offset, 0, 1);
  const point = (() => {
  switch (anchor.edge) {
    case "left":
      return { x: bounds.x, y: bounds.y + bounds.height * offset };
    case "right":
      return { x: bounds.x + bounds.width, y: bounds.y + bounds.height * offset };
    case "top":
      return { x: bounds.x + bounds.width * offset, y: bounds.y };
    case "bottom":
      return { x: bounds.x + bounds.width * offset, y: bounds.y + bounds.height };
  }
  })();
  return toRotatedBoundsPoint(bounds, point);
};

export type BubbleRegionSnapCandidate = Readonly<{
  regionId: string;
  bounds: AnnotationCardBounds;
}>;

export type BubbleRegionSnapTarget = Readonly<{
  regionId: string;
  anchor: BoundsEdgeAnchor;
  target: AnnotationCardPoint;
}>;

const distanceToRotatedBounds = (
  bounds: AnnotationCardBounds,
  point: AnnotationCardPoint,
): number => {
  const localPoint = toUnrotatedBoundsPoint(bounds, point);
  const nearest = {
    x: clamp(localPoint.x, bounds.x, bounds.x + bounds.width),
    y: clamp(localPoint.y, bounds.y, bounds.y + bounds.height),
  };
  return Math.hypot(localPoint.x - nearest.x, localPoint.y - nearest.y);
};

const createBubbleRegionSnapTarget = (
  candidate: BubbleRegionSnapCandidate,
  point: AnnotationCardPoint,
): BubbleRegionSnapTarget => {
  const anchor = getBoundsEdgeAnchor(candidate.bounds, point);
  return {
    regionId: candidate.regionId,
    anchor,
    target: getBoundsEdgePoint(candidate.bounds, anchor),
  };
};

/**
 * Resolve the closest rectangle boundary that an endpoint should follow.
 * A bound region uses a wider release range, so small pointer movements do
 * not detach and reattach the leader on adjacent mouse events.
 */
export const getBubbleRegionSnapTarget = (
  candidates: readonly BubbleRegionSnapCandidate[],
  point: AnnotationCardPoint,
  currentRegionId: string | null = null,
): BubbleRegionSnapTarget | null => {
  const boundCandidate = currentRegionId
    ? candidates.find((candidate) => candidate.regionId === currentRegionId)
    : undefined;
  if (
    boundCandidate &&
    distanceToRotatedBounds(boundCandidate.bounds, point) <=
      BUBBLE_REGION_RELEASE_DISTANCE
  ) {
    return createBubbleRegionSnapTarget(boundCandidate, point);
  }

  let closest: BubbleRegionSnapCandidate | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const distance = distanceToRotatedBounds(candidate.bounds, point);
    if (distance <= BUBBLE_REGION_SNAP_DISTANCE && distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  });

  return closest ? createBubbleRegionSnapTarget(closest, point) : null;
};

export const getAnnotationCardTextPosition = (
  card: Pick<AnnotationCardBounds, "x" | "y" | "width" | "height">,
  text?: Pick<AnnotationCardBounds, "width" | "height">,
): Readonly<{ x: number; y: number }> =>
  text
    ? {
        x: card.x + (card.width - text.width) / 2,
        y: card.y + (card.height - text.height) / 2,
      }
    : {
        x: card.x + 16,
        y: card.y + 34,
      };

const parseRgb = (color: string): readonly [number, number, number] | null => {
  const value = color.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) {
    return null;
  }
  const hex = match[1].length === 3
    ? match[1].split("").map((part) => `${part}${part}`).join("")
    : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

const channelToHex = (channel: number): string =>
  Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0");

const rgbToHsl = (
  rgb: readonly [number, number, number],
): Readonly<{ hue: number; saturation: number; lightness: number }> => {
  const [red, green, blue] = rgb.map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    delta === 0
      ? 0
      : maximum === red
        ? 60 * (((green - blue) / delta) % 6)
        : maximum === green
          ? 60 * ((blue - red) / delta + 2)
          : 60 * ((red - green) / delta + 4);
  return {
    hue: (hue + 360) % 360,
    saturation,
    lightness,
  };
};

const hslToHex = (
  hue: number,
  saturation: number,
  lightness: number,
): string => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const match = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1
      ? [chroma, match, 0]
      : section < 2
        ? [match, chroma, 0]
        : section < 3
          ? [0, chroma, match]
          : section < 4
            ? [0, match, chroma]
            : section < 5
              ? [match, 0, chroma]
              : [chroma, 0, match];
  const offset = lightness - chroma / 2;
  return `#${channelToHex((red + offset) * 255)}${channelToHex(
    (green + offset) * 255,
  )}${channelToHex((blue + offset) * 255)}`;
};

/**
 * Preserve a chosen hue without allowing an editor-style bubble to become a
 * high-saturation sticky note. Dark choices stay muted and dark so the text
 * contrast rule remains meaningful; other choices become the light, quiet B
 * palette.
 */
export const normalizeBubbleCardBackgroundColor = (color: string): string => {
  const normalized = color.trim().toLowerCase();
  if (normalized === BUBBLE_CARD_BACKGROUND_COLOR) {
    return BUBBLE_CARD_BACKGROUND_COLOR;
  }
  const rgb = parseRgb(normalized);
  if (!rgb) {
    return BUBBLE_CARD_BACKGROUND_COLOR;
  }
  const { hue, saturation, lightness } = rgbToHsl(rgb);
  // A user may already have chosen a quiet, low-saturation canvas color.
  // Keep it verbatim instead of subtly rewriting it on every scene update.
  if (saturation <= 0.36) {
    return normalized;
  }
  const isDark = lightness < 0.38;
  return hslToHex(
    hue,
    Math.min(saturation, 0.36),
    isDark ? Math.max(lightness, 0.26) : Math.max(lightness, 0.9),
  );
};

/**
 * B3 intentionally renders its one soft shadow in the host overlay. Older
 * serialized rectangle shadows are retained for B/B2 documents only.
 */
export const shouldRetireSerializedBubbleShadow = (
  visualStyle: unknown,
): boolean => visualStyle === BUBBLE_REFERENCE_STYLE_VERSION;

/**
 * A B3 leader carries the same muted surface color as its floating label.
 * Keeping this rule here makes its data responsibility explicit and keeps the
 * B/B2 synchronizer branches untouched.
 */
export const getLatestBubbleLeaderStyle = (
  backgroundColor: string,
  strokeWidth = BUBBLE_LEADER_STROKE_WIDTH,
) => ({
  strokeColor: normalizeBubbleCardBackgroundColor(backgroundColor),
  // Synchronization may update the color to follow the label surface, but it
  // must retain a line width the user already selected.
  strokeWidth,
});

/**
 * A B2 card starts with its outline matched to its opaque fill. The stored
 * default lets a later background-color change remain outline-free, while an
 * actual user-picked outline color is retained across scene synchronization.
 */
export const resolveBubbleCardOutlineStyle = (input: {
  backgroundColor: string;
  strokeColor: string;
  defaultOutlineColor?: unknown;
  outlineMode?: unknown;
}): Readonly<{
  backgroundColor: string;
  strokeColor: string;
  outlineMode: "none" | "custom";
}> => {
  const backgroundColor = normalizeBubbleCardBackgroundColor(
    input.backgroundColor,
  );
  const defaultOutlineColor =
    typeof input.defaultOutlineColor === "string"
      ? input.defaultOutlineColor
      : input.backgroundColor;
  const outlineMode =
    input.outlineMode === "custom" ||
    (input.strokeColor !== defaultOutlineColor &&
      input.strokeColor !== backgroundColor)
      ? "custom"
      : "none";
  return {
    backgroundColor,
    strokeColor:
      outlineMode === "custom" ? input.strokeColor : backgroundColor,
    outlineMode,
  };
};

const channelLuminance = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const getReadableTextColor = (backgroundColor: string): string => {
  const rgb = parseRgb(backgroundColor);
  if (!rgb) {
    return "#172554";
  }
  const luminance =
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2]);
  return luminance < 0.38 ? "#f8fafc" : "#172554";
};

/** Bubble typography follows the neutral editorial palette rather than the
 * navy used by older structured annotation cards. */
export const getBubbleReadableTextColor = (backgroundColor: string): string => {
  const rgb = parseRgb(backgroundColor);
  if (!rgb) {
    return "#334155";
  }
  const luminance =
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2]);
  return luminance < 0.38 ? "#f8fafc" : "#334155";
};

/** The B3 default is neutral charcoal, not the older blue-gray B2 tone. */
export const getCurrentBubbleReadableTextColor = (
  backgroundColor: string,
): string => {
  const rgb = parseRgb(backgroundColor);
  if (!rgb) {
    return BUBBLE_TEXT_COLOR;
  }
  const luminance =
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2]);
  return luminance < 0.38 ? "#fbfaf7" : BUBBLE_TEXT_COLOR;
};

/**
 * Keep an explicitly selected bubble text color intact. The stored default is
 * only a baseline marker, so a background change can still update untouched
 * default text for contrast without rewriting a user's muted color choice.
 */
export const resolveBubbleTextColor = (input: {
  backgroundColor: string;
  strokeColor: string;
  defaultColor?: unknown;
  getDefaultColor?: (backgroundColor: string) => string;
  /**
   * Excalidraw applies a card color operation to every element in its group.
   * When the card is the selected editing target, that propagated text color
   * is not an intentional text-color choice and must not become persistent.
   */
  forceDefaultColor?: boolean;
}): Readonly<{
  strokeColor: string;
  defaultColor: string;
}> => {
  const defaultColor = (input.getDefaultColor ?? getBubbleReadableTextColor)(
    normalizeBubbleCardBackgroundColor(input.backgroundColor),
  );
  const previousDefaultColor =
    typeof input.defaultColor === "string" ? input.defaultColor : defaultColor;
  const wasCustomized =
    !input.forceDefaultColor && input.strokeColor !== previousDefaultColor;
  return {
    strokeColor: wasCustomized ? input.strokeColor : defaultColor,
    defaultColor: wasCustomized ? previousDefaultColor : defaultColor,
  };
};

export const getAnnotationLeaderLayout = (
  selection: AnnotationCardBounds,
  card: AnnotationCardBounds,
): Readonly<{
  x: number;
  y: number;
  points: readonly [number, number][];
}> => {
  const source = getBoundsEdgePointClosestTo(card, centerOf(selection));
  const target = getBoundsEdgePointClosestTo(selection, source);

  return {
    x: source.x,
    y: source.y,
    points: [
      [0, 0],
      [target.x - source.x, target.y - source.y],
    ],
  };
};

export const getAnnotationLeaderLayoutToPoint = (
  target: AnnotationCardPoint,
  card: AnnotationCardBounds,
): Readonly<{
  x: number;
  y: number;
  points: readonly [number, number][];
}> => {
  const source = getBoundsEdgePointClosestTo(card, target);
  return {
    x: source.x,
    y: source.y,
    points: [[0, 0], [target.x - source.x, target.y - source.y]],
  };
};

export const getAnnotationLeaderLayoutFromEdgeAnchors = (
  selection: AnnotationCardBounds,
  card: AnnotationCardBounds,
  cardAnchor: BoundsEdgeAnchor,
  selectionAnchor: BoundsEdgeAnchor,
): Readonly<{
  x: number;
  y: number;
  points: readonly [number, number][];
}> => {
  const source = getBoundsEdgePoint(card, cardAnchor);
  const target = getBoundsEdgePoint(selection, selectionAnchor);
  return {
    x: source.x,
    y: source.y,
    points: [[0, 0], [target.x - source.x, target.y - source.y]],
  };
};

export const createAnnotationCardLayout = (
  selection: AnnotationCardBounds,
): Readonly<{ card: AnnotationCardBounds; textPosition: { x: number; y: number } }> => {
  const cardWidth = Math.max(260, Math.min(360, selection.width + 96));
  const card: AnnotationCardBounds = {
    x: selection.x + selection.width + 44,
    y: selection.y,
    width: cardWidth,
    height: 96,
  };

  return {
    card,
    textPosition: getAnnotationCardTextPosition(card),
  };
};

export const createAnnotationCardBoundsForText = (
  text: AnnotationCardBounds,
): AnnotationCardBounds => {
  const width = Math.max(260, text.width + 32);
  const height = Math.max(96, text.height + 52);
  return {
    x: text.x - (width - text.width) / 2,
    y: text.y - (height - text.height) / 2,
    width,
    height,
  };
};

export const createBubbleCardBounds = (
  target: AnnotationCardPoint,
): AnnotationCardBounds => ({
  x: target.x + 30,
  y: target.y - 26,
  width: 224,
  height: 56,
});

/**
 * A new B3 bubble is deliberately a low horizontal label. It only grows
 * vertically when its existing text needs more room; saved taller cards keep
 * their height unchanged.
 */
export const getBubbleCardBoundsForText = (
  card: AnnotationCardBounds,
  text: Pick<AnnotationCardBounds, "height"> | undefined,
): AnnotationCardBounds => ({
  ...card,
  height: Math.max(card.height, (text?.height ?? 0) + 24),
});

export const getAnnotationCardShadowBounds = (
  card: AnnotationCardBounds,
): AnnotationCardBounds => ({
  x: card.x + ANNOTATION_CARD_SHADOW_OFFSET,
  y: card.y + ANNOTATION_CARD_SHADOW_OFFSET,
  width: card.width,
  height: card.height,
  angle: card.angle,
});

export const getBubbleCardShadowBounds = (
  card: AnnotationCardBounds,
): AnnotationCardBounds => ({
  x: card.x + BUBBLE_CARD_SHADOW_OFFSET,
  y: card.y + BUBBLE_CARD_SHADOW_OFFSET,
  width: card.width,
  height: card.height,
  angle: card.angle,
});
