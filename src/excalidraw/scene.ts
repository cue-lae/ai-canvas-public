import {
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawArrowElement,
  ExcalidrawEllipseElement,
  ExcalidrawImageElement,
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  FileId,
} from "@excalidraw/excalidraw/element/types";
import {
  ANNOTATION_CARD_PLACEHOLDER,
  ANNOTATION_CARD_FONT_FAMILY,
  ANNOTATION_CARD_ROUNDNESS,
  BUBBLE_CARD_BACKGROUND_COLOR,
  BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY,
  BUBBLE_CARD_KIND,
  BUBBLE_CARD_OUTLINE_MODE_KEY,
  BUBBLE_CARD_PLACEHOLDER,
  BUBBLE_CARD_SHADOW_COLOR,
  BUBBLE_CARD_SHADOW_OPACITY,
  BUBBLE_LEGACY_REFERENCE_STYLE_VERSION,
  BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION,
  BUBBLE_LEADER_KIND,
  BUBBLE_LEADER_COLOR,
  BUBBLE_LEADER_STROKE_WIDTH,
  BUBBLE_REFERENCE_STYLE_VERSION,
  BUBBLE_SHADOW_KIND,
  BUBBLE_TARGET_DOT_KIND,
  BUBBLE_TARGET_DOT_COLOR,
  BUBBLE_TARGET_DOT_FILL,
  BUBBLE_TARGET_DOT_SIZE,
  BUBBLE_TEXT_DEFAULT_COLOR_KEY,
  BUBBLE_TEXT_KIND,
  createAnnotationCardLayout,
  createBubbleCardBounds,
  createOrdinaryTextBoxBounds,
  getAnnotationCardGroupId,
  getBoundsEdgePoint,
  getAnnotationCardShadowBounds,
  getAnnotationCardTextPosition,
  getAnnotationLeaderLayout,
  getAnnotationLeaderLayoutToPoint,
  getBubbleCardBoundsForText,
  getBubbleCardShadowBounds,
  getBubbleCardGroupId,
  getCurrentBubbleReadableTextColor,
  getLatestBubbleLeaderStyle,
  getBubbleReadableTextColor,
  getBubbleRegionSnapTarget,
  getOrdinaryTextBoxGroupId,
  getReadableTextColor,
  getRegionRoundness,
  isBoundsEdgeAnchor,
  normalizeBubbleCardBackgroundColor,
  resolveBubbleTextColor,
  resolveBubbleCardOutlineStyle,
  shouldRetireSerializedBubbleShadow,
  shouldTreatBubbleTargetDotAsManualMove,
  ORDINARY_TEXT_BOX_KIND,
  normalizeAnnotationCardGroupIds,
  type AnnotationCardBounds,
  type BoundsEdgeAnchor,
  type RegionCornerStyle,
} from "./annotationCard";

export {
  ANNOTATION_CARD_PLACEHOLDER,
  ANNOTATION_CARD_FONT_FAMILY,
  ANNOTATION_CARD_ROUNDNESS,
  BUBBLE_CARD_KIND,
  BUBBLE_CARD_PLACEHOLDER,
  BUBBLE_CARD_BACKGROUND_COLOR,
  BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY,
  BUBBLE_CARD_SHADOW_COLOR,
  BUBBLE_CARD_SHADOW_OPACITY,
  BUBBLE_LEADER_KIND,
  BUBBLE_LEADER_COLOR,
  BUBBLE_LEADER_STROKE_WIDTH,
  BUBBLE_REFERENCE_STYLE_VERSION,
  BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION,
  BUBBLE_LEGACY_REFERENCE_STYLE_VERSION,
  BUBBLE_SHADOW_KIND,
  BUBBLE_TARGET_DOT_KIND,
  BUBBLE_TARGET_DOT_COLOR,
  BUBBLE_TARGET_DOT_FILL,
  BUBBLE_TARGET_DOT_SIZE,
  BUBBLE_TEXT_KIND,
  createAnnotationCardBoundsForText,
  createBubbleCardBounds,
  createOrdinaryTextBoxBounds,
  getAnnotationCardTextPosition,
  getAnnotationCardGroupId,
  getAnnotationCardShadowBounds,
  getAnnotationLeaderLayout,
  getAnnotationLeaderLayoutFromEdgeAnchors,
  getAnnotationLeaderLayoutToPoint,
  getBubbleCardShadowBounds,
  getBubbleCardGroupId,
  getBubbleReadableTextColor,
  getOrdinaryTextBoxGroupId,
  getReadableTextColor,
  getRegionRoundness,
  normalizeBubbleCardBackgroundColor,
  resolveBubbleCardOutlineStyle,
  normalizeAnnotationCardGroupIds,
  ORDINARY_TEXT_BOX_KIND,
  type AnnotationCardBounds,
  type BoundsEdgeAnchor,
  type RegionCornerStyle,
} from "./annotationCard";

export const stableId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID()}`;

const hasGroupId = (
  groupIds: readonly string[],
  groupId: string,
): boolean => groupIds.includes(groupId);

const withGroupId = (
  groupIds: readonly string[],
  groupId: string,
): readonly string[] =>
  hasGroupId(groupIds, groupId) ? groupIds : [...groupIds, groupId];

export const createOrdinaryTextBoxElements = (
  text: ExcalidrawTextElement,
): Readonly<{
  frame: ExcalidrawRectangleElement;
  text: ExcalidrawTextElement;
}> => {
  const groupId = getOrdinaryTextBoxGroupId(text.id);
  const bounds = createOrdinaryTextBoxBounds(text);
  const [frame] = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      strokeColor: "#475569",
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      roundness: ANNOTATION_CARD_ROUNDNESS,
      groupIds: [groupId],
      customData: {
        kind: ORDINARY_TEXT_BOX_KIND,
        textId: text.id,
      },
    },
  ]);

  return {
    frame: frame as ExcalidrawRectangleElement,
    text: newElementWith(text, {
      ...getAnnotationCardTextPosition(bounds, text),
      strokeColor: getReadableTextColor("#ffffff"),
      groupIds: withGroupId(text.groupIds, groupId),
    }) as ExcalidrawTextElement,
  };
};

const ordinaryTextBoxTextId = (element: ExcalidrawElement): string | null =>
  element.customData?.kind === ORDINARY_TEXT_BOX_KIND &&
  typeof element.customData.textId === "string"
    ? element.customData.textId
    : null;

const hasOrdinaryTextBoxGroup = (element: ExcalidrawTextElement): boolean =>
  element.groupIds.includes(getOrdinaryTextBoxGroupId(element.id));

export const synchronizeOrdinaryTextBoxElements = (
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => {
  const textsById = new Map<string, ExcalidrawTextElement>();
  const frameTextIds = new Set<string>();

  elements.forEach((element) => {
    if (!element.isDeleted && element.type === "text") {
      textsById.set(element.id, element);
    }
    if (!element.isDeleted) {
      const textId = ordinaryTextBoxTextId(element);
      if (textId) {
        frameTextIds.add(textId);
      }
    }
  });

  return elements.flatMap((element) => {
    const textId = ordinaryTextBoxTextId(element);
    if (textId) {
      const text = textsById.get(textId);
      if (!text) {
        return [newElementWith(element, { isDeleted: true })];
      }
      const groupId = getOrdinaryTextBoxGroupId(text.id);
      const bounds = createOrdinaryTextBoxBounds(text);
      const groupIds = withGroupId(element.groupIds, groupId);
      if (
        element.x === bounds.x &&
        element.y === bounds.y &&
        element.width === bounds.width &&
        element.height === bounds.height &&
        groupIds === element.groupIds
      ) {
        return [element];
      }
      return [newElementWith(element, { ...bounds, groupIds })];
    }

    if (
      !element.isDeleted &&
      element.type === "text" &&
      (hasOrdinaryTextBoxGroup(element) || frameTextIds.has(element.id))
    ) {
      const groupId = getOrdinaryTextBoxGroupId(element.id);
      const text = hasOrdinaryTextBoxGroup(element)
        ? element
        : (newElementWith(element, {
            groupIds: withGroupId(element.groupIds, groupId),
          }) as ExcalidrawTextElement);
      if (frameTextIds.has(element.id)) {
        return [text];
      }
      const boxed = createOrdinaryTextBoxElements(text);
      return [boxed.frame, boxed.text];
    }

    return [element];
  });
};

const bubbleIdOf = (element: ExcalidrawElement): string | null =>
  typeof element.customData?.bubbleId === "string"
    ? element.customData.bubbleId
    : null;

const bubbleTargetOf = (
  element: ExcalidrawElement,
): Readonly<{ x: number; y: number }> | null =>
  typeof element.customData?.targetX === "number" &&
  Number.isFinite(element.customData.targetX) &&
  typeof element.customData?.targetY === "number" &&
  Number.isFinite(element.customData.targetY)
    ? { x: element.customData.targetX, y: element.customData.targetY }
    : null;

const bubbleTargetRegionIdOf = (element: ExcalidrawElement): string | null =>
  typeof element.customData?.targetRegionId === "string"
    ? element.customData.targetRegionId
    : null;

const bubbleTargetRegionAnchorOf = (
  element: ExcalidrawElement,
): BoundsEdgeAnchor | null =>
  isBoundsEdgeAnchor(element.customData?.targetRegionAnchor)
    ? element.customData.targetRegionAnchor
    : null;

const isReferenceBBubble = (element: ExcalidrawElement): boolean =>
  element.customData?.bubbleVisualStyle === BUBBLE_REFERENCE_STYLE_VERSION ||
  element.customData?.bubbleVisualStyle ===
    BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION ||
  element.customData?.bubbleVisualStyle === BUBBLE_LEGACY_REFERENCE_STYLE_VERSION;

const isCurrentReferenceBBubble = (element: ExcalidrawElement): boolean =>
  element.customData?.bubbleVisualStyle === BUBBLE_REFERENCE_STYLE_VERSION ||
  element.customData?.bubbleVisualStyle ===
    BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION;

const isLatestReferenceBBubble = (element: ExcalidrawElement): boolean =>
  element.customData?.bubbleVisualStyle === BUBBLE_REFERENCE_STYLE_VERSION;

const elementBounds = (element: ExcalidrawElement): AnnotationCardBounds => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  angle: element.angle,
});

const withoutGroupId = (
  groupIds: readonly string[],
  groupId: string,
): readonly string[] => {
  const nextGroupIds = groupIds.filter((candidate) => candidate !== groupId);
  return nextGroupIds.length === groupIds.length ? groupIds : nextGroupIds;
};

const sameBounds = (
  element: Pick<ExcalidrawElement, "x" | "y" | "width" | "height" | "angle">,
  bounds: AnnotationCardBounds,
): boolean =>
  element.x === bounds.x &&
  element.y === bounds.y &&
  element.width === bounds.width &&
  element.height === bounds.height &&
  element.angle === (bounds.angle ?? 0);

const bubbleLeaderLayout = (
  leader: ExcalidrawArrowElement,
  card: AnnotationCardBounds,
  regions: ReadonlyMap<string, ExcalidrawRectangleElement>,
  targetOverride?: Readonly<{ x: number; y: number }>,
) => {
  if (targetOverride) {
    return getAnnotationLeaderLayoutToPoint(targetOverride, card);
  }
  const targetRegionId = bubbleTargetRegionIdOf(leader);
  const targetRegion = targetRegionId ? regions.get(targetRegionId) : null;
  if (targetRegion) {
    const anchor = bubbleTargetRegionAnchorOf(leader);
    if (anchor) {
      return getAnnotationLeaderLayoutToPoint(
        getBoundsEdgePoint(elementBounds(targetRegion), anchor),
        card,
      );
    }
    return getAnnotationLeaderLayout(elementBounds(targetRegion), card);
  }
  const target = bubbleTargetOf(leader);
  return target ? getAnnotationLeaderLayoutToPoint(target, card) : null;
};

const leaderTargetPoint = (layout: {
  x: number;
  y: number;
  points: readonly [number, number][];
}): Readonly<{ x: number; y: number }> => ({
  x: layout.x + layout.points[1][0],
  y: layout.y + layout.points[1][1],
});

const targetDotCenter = (
  dot: Pick<ExcalidrawEllipseElement, "x" | "y" | "width" | "height">,
): Readonly<{ x: number; y: number }> => ({
  x: dot.x + dot.width / 2,
  y: dot.y + dot.height / 2,
});

export const createBubbleAnnotationElements = (input: {
  bubbleId: string;
  target: Readonly<{ x: number; y: number }>;
  text?: string;
  card?: AnnotationCardBounds;
  selection?: AnnotationCardBounds;
  targetRegionId?: string;
}): Readonly<{
  leader: ExcalidrawArrowElement;
  targetDot: ExcalidrawEllipseElement;
  card: ExcalidrawRectangleElement;
  text: ExcalidrawTextElement;
}> => {
  const card = input.card ?? createBubbleCardBounds(input.target);
  const backgroundColor = BUBBLE_CARD_BACKGROUND_COLOR;
  const leader = input.selection
    ? getAnnotationLeaderLayout(input.selection, card)
    : getAnnotationLeaderLayoutToPoint(input.target, card);
  const leaderTarget = {
    x: leader.x + leader.points[1][0],
    y: leader.y + leader.points[1][1],
  };
  const groupId = getBubbleCardGroupId(input.bubbleId);
  const text = input.text?.trim() ? input.text : BUBBLE_CARD_PLACEHOLDER;
  const [leaderElement, targetDotElement, cardElement, textElement] =
    convertToExcalidrawElements([
      {
        type: "arrow",
        x: leader.x,
        y: leader.y,
        points: leader.points,
        startArrowhead: null,
        endArrowhead: null,
        strokeColor: backgroundColor,
        strokeWidth: BUBBLE_LEADER_STROKE_WIDTH,
        strokeStyle: "solid",
        roughness: 0,
        customData: {
          kind: BUBBLE_LEADER_KIND,
          bubbleId: input.bubbleId,
          bubbleVisualStyle: BUBBLE_REFERENCE_STYLE_VERSION,
          targetX: input.target.x,
          targetY: input.target.y,
          ...(input.targetRegionId
            ? { targetRegionId: input.targetRegionId }
            : {}),
        },
      },
      {
        type: "ellipse",
        x: leaderTarget.x - BUBBLE_TARGET_DOT_SIZE / 2,
        y: leaderTarget.y - BUBBLE_TARGET_DOT_SIZE / 2,
        width: BUBBLE_TARGET_DOT_SIZE,
        height: BUBBLE_TARGET_DOT_SIZE,
        strokeColor: BUBBLE_TARGET_DOT_COLOR,
        backgroundColor: BUBBLE_TARGET_DOT_FILL,
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        customData: {
          kind: BUBBLE_TARGET_DOT_KIND,
          bubbleId: input.bubbleId,
          bubbleVisualStyle: BUBBLE_REFERENCE_STYLE_VERSION,
        },
      },
      {
        type: "rectangle",
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
        angle: card.angle ?? 0,
        strokeColor: backgroundColor,
        backgroundColor,
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        roundness: ANNOTATION_CARD_ROUNDNESS,
        groupIds: [groupId],
        customData: {
          kind: BUBBLE_CARD_KIND,
          bubbleId: input.bubbleId,
          bubbleVisualStyle: BUBBLE_REFERENCE_STYLE_VERSION,
          [BUBBLE_CARD_OUTLINE_MODE_KEY]: "none",
          [BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY]: backgroundColor,
        },
      },
      {
        type: "text",
        text,
        x: card.x,
        y: card.y,
        fontSize: 18,
        fontFamily: ANNOTATION_CARD_FONT_FAMILY,
        strokeColor: getCurrentBubbleReadableTextColor(backgroundColor),
        groupIds: [groupId],
        customData: {
          kind: BUBBLE_TEXT_KIND,
          bubbleId: input.bubbleId,
          bubbleVisualStyle: BUBBLE_REFERENCE_STYLE_VERSION,
          placeholder: input.text?.trim() ? "false" : "true",
          [BUBBLE_TEXT_DEFAULT_COLOR_KEY]: getCurrentBubbleReadableTextColor(
            backgroundColor,
          ),
        },
      },
    ]);
  const renderedCard = cardElement as ExcalidrawRectangleElement;
  const renderedText = textElement as ExcalidrawTextElement;

  return {
    leader: leaderElement as ExcalidrawArrowElement,
    targetDot: targetDotElement as ExcalidrawEllipseElement,
    card: renderedCard,
    text: newElementWith(renderedText, {
      ...getAnnotationCardTextPosition(renderedCard, renderedText),
      groupIds: withGroupId(renderedText.groupIds, groupId),
    }) as ExcalidrawTextElement,
  };
};

export const synchronizeBubbleAnnotationElements = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>> = {},
): readonly ExcalidrawElement[] => {
  const cards = new Map<string, ExcalidrawRectangleElement>();
  const texts = new Map<string, ExcalidrawTextElement>();
  const leaders = new Map<string, ExcalidrawArrowElement>();
  const targetDots = new Map<string, ExcalidrawEllipseElement>();
  const regions = new Map<string, ExcalidrawRectangleElement>();

  elements.forEach((element) => {
    if (element.isDeleted) {
      return;
    }
    const bubbleId = bubbleIdOf(element);
    if (
      element.customData?.kind === "region" &&
      element.type === "rectangle" &&
      typeof element.customData.regionId === "string"
    ) {
      regions.set(element.customData.regionId, element);
    }
    if (!bubbleId) {
      return;
    }
    if (element.customData?.kind === BUBBLE_CARD_KIND && element.type === "rectangle") {
      cards.set(bubbleId, element);
    } else if (element.customData?.kind === BUBBLE_TEXT_KIND && element.type === "text") {
      texts.set(bubbleId, element);
    } else if (element.customData?.kind === BUBBLE_LEADER_KIND && element.type === "arrow") {
      leaders.set(bubbleId, element as ExcalidrawArrowElement);
    } else if (
      element.customData?.kind === BUBBLE_TARGET_DOT_KIND &&
      element.type === "ellipse"
    ) {
      targetDots.set(bubbleId, element as ExcalidrawEllipseElement);
    }
  });

  // Give the leader and text positioning code the same grown B3 card bounds
  // during this synchronization pass, rather than waiting for a second change
  // event after wrapped text increases the label height.
  cards.forEach((card, bubbleId) => {
    const text = texts.get(bubbleId);
    if (!text || !isLatestReferenceBBubble(card)) {
      return;
    }
    const bounds = getBubbleCardBoundsForText(card, text);
    if (!sameBounds(card, bounds)) {
      cards.set(
        bubbleId,
        newElementWith(card, bounds) as ExcalidrawRectangleElement,
      );
    }
  });

  /**
   * A dot is deliberately not grouped with the label. If the selected dot has
   * moved away from the computed endpoint, that is a direct user retargeting
   * gesture. Resolve it through the same rectangle snap/release path used by
   * the host handle, then save either a bound edge anchor or a fixed point.
   */
  const regionCandidates = [...regions.entries()].map(([regionId, region]) => ({
    regionId,
    bounds: elementBounds(region),
  }));
  const manualTargets = new Map<
    string,
    Readonly<{
      target: Readonly<{ x: number; y: number }>;
      targetRegionId?: string;
      targetRegionAnchor?: BoundsEdgeAnchor;
    }>
  >();
  targetDots.forEach((dot, bubbleId) => {
    const text = texts.get(bubbleId);
    if (
      !isReferenceBBubble(dot) ||
      !shouldTreatBubbleTargetDotAsManualMove({
        dotSelected: Boolean(selectedElementIds[dot.id]),
        cardSelected: Boolean(selectedElementIds[cards.get(bubbleId)?.id ?? ""]),
        textSelected: Boolean(selectedElementIds[text?.id ?? ""]),
      })
    ) {
      return;
    }
    const card = cards.get(bubbleId);
    const leader = leaders.get(bubbleId);
    if (!card || !leader) {
      return;
    }
    const layout = bubbleLeaderLayout(leader, card, regions);
    if (!layout) {
      return;
    }
    const expected = leaderTargetPoint(layout);
    const actual = targetDotCenter(dot);
    if (Math.hypot(actual.x - expected.x, actual.y - expected.y) > 0.5) {
      const snapped = getBubbleRegionSnapTarget(
        regionCandidates,
        actual,
        bubbleTargetRegionIdOf(leader),
      );
      manualTargets.set(
        bubbleId,
        snapped
          ? {
              target: snapped.target,
              targetRegionId: snapped.regionId,
              targetRegionAnchor: snapped.anchor,
            }
          : { target: actual },
      );
    }
  });

  return elements.map((element) => {
    const bubbleId = bubbleIdOf(element);
    if (!bubbleId) {
      return element;
    }
    const card = cards.get(bubbleId);
    const text = texts.get(bubbleId);
    const leader = leaders.get(bubbleId);
    const kind = element.customData?.kind;
    const usesReferenceBStyle = isReferenceBBubble(element);
    const usesCurrentReferenceBStyle = isCurrentReferenceBBubble(element);
    const usesLatestReferenceBStyle = isLatestReferenceBBubble(element);
    const cardIsUsable = Boolean(card && text && !card.isDeleted && !text.isDeleted);

    if (kind === BUBBLE_CARD_KIND && element.type === "rectangle") {
      if (!text || text.isDeleted) {
        return newElementWith(element, { isDeleted: true });
      }
      const groupId = getBubbleCardGroupId(bubbleId);
      const groupIds = withGroupId(element.groupIds, groupId);
      const cardBounds = usesLatestReferenceBStyle
        ? getBubbleCardBoundsForText(element, text)
        : element;
      if (usesCurrentReferenceBStyle) {
        const { backgroundColor, strokeColor, outlineMode } =
          resolveBubbleCardOutlineStyle({
            backgroundColor: element.backgroundColor,
            strokeColor: element.strokeColor,
            defaultOutlineColor:
              element.customData?.[BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY],
            outlineMode: element.customData?.[BUBBLE_CARD_OUTLINE_MODE_KEY],
          });
        const customDataNeedsUpdate =
          element.customData?.[BUBBLE_CARD_OUTLINE_MODE_KEY] !== outlineMode ||
          element.customData?.[BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY] !==
            backgroundColor;
        if (
          sameBounds(element, cardBounds) &&
          element.backgroundColor === backgroundColor &&
          element.strokeColor === strokeColor &&
          element.opacity === 100 &&
          element.fillStyle === "solid" &&
          element.roundness?.type === ANNOTATION_CARD_ROUNDNESS.type &&
          !customDataNeedsUpdate &&
          groupIds === element.groupIds
        ) {
          return element;
        }
        return newElementWith(element, {
          ...cardBounds,
          backgroundColor,
          strokeColor,
          opacity: 100,
          fillStyle: "solid",
          roundness: ANNOTATION_CARD_ROUNDNESS,
          groupIds,
          customData: {
            ...element.customData,
            [BUBBLE_CARD_OUTLINE_MODE_KEY]: outlineMode,
            [BUBBLE_CARD_DEFAULT_OUTLINE_COLOR_KEY]: backgroundColor,
          },
        });
      }
      const backgroundColor = usesReferenceBStyle
        ? normalizeBubbleCardBackgroundColor(element.backgroundColor)
        : element.backgroundColor;
      const strokeColor = usesReferenceBStyle
        ? backgroundColor
        : element.strokeColor;
      const strokeWidth = usesReferenceBStyle ? 1 : 2;
      if (
        element.backgroundColor === backgroundColor &&
        element.strokeColor === strokeColor &&
        element.strokeWidth === strokeWidth &&
        element.fillStyle === "solid" &&
        element.roughness === 0 &&
        element.roundness?.type === ANNOTATION_CARD_ROUNDNESS.type &&
        groupIds === element.groupIds
      ) {
        return element;
      }
      return newElementWith(element, {
        backgroundColor,
        strokeColor,
        fillStyle: "solid",
        strokeWidth,
        roughness: 0,
        roundness: ANNOTATION_CARD_ROUNDNESS,
        groupIds,
      });
    }

    if (kind === BUBBLE_TEXT_KIND && element.type === "text") {
      if (!card || card.isDeleted) {
        return newElementWith(element, { isDeleted: true });
      }
      const groupId = getBubbleCardGroupId(bubbleId);
      const groupIds = withGroupId(element.groupIds, groupId);
      const position = getAnnotationCardTextPosition(card, element);
      const bubbleTextStyle = usesCurrentReferenceBStyle
        ? resolveBubbleTextColor({
            backgroundColor: card.backgroundColor,
            strokeColor: element.strokeColor,
            defaultColor: element.customData?.[BUBBLE_TEXT_DEFAULT_COLOR_KEY],
            getDefaultColor: usesLatestReferenceBStyle
              ? getCurrentBubbleReadableTextColor
              : getBubbleReadableTextColor,
            forceDefaultColor:
              usesLatestReferenceBStyle && Boolean(selectedElementIds[card.id]),
          })
        : null;
      const strokeColor = bubbleTextStyle
        ? bubbleTextStyle.strokeColor
        : usesReferenceBStyle
          ? getBubbleReadableTextColor(
              normalizeBubbleCardBackgroundColor(card.backgroundColor),
            )
          : getReadableTextColor(card.backgroundColor);
      const customData = bubbleTextStyle
        ? {
            ...element.customData,
            [BUBBLE_TEXT_DEFAULT_COLOR_KEY]: bubbleTextStyle.defaultColor,
          }
        : element.customData;
      const customDataNeedsUpdate =
        Boolean(bubbleTextStyle) &&
        element.customData?.[BUBBLE_TEXT_DEFAULT_COLOR_KEY] !==
          bubbleTextStyle?.defaultColor;
      if (
        element.x === position.x &&
        element.y === position.y &&
        element.strokeColor === strokeColor &&
        element.fontFamily === ANNOTATION_CARD_FONT_FAMILY &&
        !customDataNeedsUpdate &&
        groupIds === element.groupIds
      ) {
        return element;
      }
      return newElementWith(element, {
        ...position,
        strokeColor,
        fontFamily: ANNOTATION_CARD_FONT_FAMILY,
        groupIds,
        customData,
      });
    }

    if (kind === BUBBLE_SHADOW_KIND && element.type === "rectangle") {
      // B3 uses the host overlay as its only shadow. Old B/B2 scenes can
      // contain a serialized rectangle shadow, which otherwise leaves a
      // white under-frame when the card fill changes.
      if (
        shouldRetireSerializedBubbleShadow(
          element.customData?.bubbleVisualStyle,
        )
      ) {
        return newElementWith(element, { isDeleted: true });
      }
      if (!cardIsUsable || !card) {
        return newElementWith(element, { isDeleted: true });
      }
      const bounds = usesReferenceBStyle
        ? getBubbleCardShadowBounds(card)
        : getAnnotationCardShadowBounds(card);
      const opacity = element.opacity;
      const shadowColor = element.backgroundColor;
      if (
        sameBounds(element, bounds) &&
        element.opacity === opacity &&
        element.strokeColor === shadowColor &&
        element.backgroundColor === shadowColor &&
        element.locked &&
        element.roundness?.type === ANNOTATION_CARD_ROUNDNESS.type
      ) {
        return element;
      }
      return newElementWith(element, {
        ...bounds,
        strokeColor: shadowColor,
        backgroundColor: shadowColor,
        opacity,
        locked: true,
        roundness: ANNOTATION_CARD_ROUNDNESS,
      });
    }

    if (kind === BUBBLE_LEADER_KIND && element.type === "arrow") {
      if (!cardIsUsable || !card) {
        return newElementWith(element, { isDeleted: true });
      }
      const manualTarget = manualTargets.get(bubbleId);
      const layout = bubbleLeaderLayout(
        element as ExcalidrawArrowElement,
        card,
        regions,
        manualTarget?.target,
      );
      if (!layout) {
        return newElementWith(element, { isDeleted: true });
      }
      const end = layout.points[1];
      const currentEnd = element.points[1];
      const groupIds = withoutGroupId(element.groupIds, getBubbleCardGroupId(bubbleId));
      const latestLeaderStyle = usesLatestReferenceBStyle
        ? getLatestBubbleLeaderStyle(card.backgroundColor, element.strokeWidth)
        : null;
      const strokeColor = latestLeaderStyle
        ? latestLeaderStyle.strokeColor
        : usesCurrentReferenceBStyle
        ? element.strokeColor
        : usesReferenceBStyle
        ? BUBBLE_LEADER_COLOR
        : element.strokeColor;
      const strokeWidth = latestLeaderStyle
        ? latestLeaderStyle.strokeWidth
        : usesCurrentReferenceBStyle
        ? element.strokeWidth
        : usesReferenceBStyle
          ? BUBBLE_LEADER_STROKE_WIDTH
          : 1;
      const customData = manualTarget
        ? (() => {
            const {
              targetRegionId: _targetRegionId,
              targetRegionAnchor: _targetRegionAnchor,
              ...savedTarget
            } = element.customData ?? {};
            return {
              ...savedTarget,
              targetX: manualTarget.target.x,
              targetY: manualTarget.target.y,
              ...(manualTarget.targetRegionId
                ? {
                    targetRegionId: manualTarget.targetRegionId,
                    targetRegionAnchor: manualTarget.targetRegionAnchor,
                  }
                : {}),
            };
          })()
        : element.customData;
      if (
        element.x === layout.x &&
        element.y === layout.y &&
        currentEnd?.[0] === end[0] &&
        currentEnd?.[1] === end[1] &&
        element.strokeColor === strokeColor &&
        element.strokeWidth === strokeWidth &&
        element.endArrowhead === null &&
        element.startArrowhead === null &&
        !manualTarget &&
        groupIds === element.groupIds
      ) {
        return element;
      }
      return newElementWith(element, {
        ...layout,
        strokeColor,
        strokeWidth,
        ...(usesCurrentReferenceBStyle
          ? {}
          : {
              strokeStyle: "solid",
              roughness: 0,
            }),
        startArrowhead: null,
        endArrowhead: null,
        groupIds,
        customData,
      });
    }

    if (kind === BUBBLE_TARGET_DOT_KIND && element.type === "ellipse") {
      const manualTarget = manualTargets.get(bubbleId);
      const layout =
        leader && card
          ? bubbleLeaderLayout(leader, card, regions, manualTarget?.target)
          : null;
      if (!layout || leader?.isDeleted) {
        return newElementWith(element, { isDeleted: true });
      }
      const target = leaderTargetPoint(layout);
      const size = usesLatestReferenceBStyle
        ? BUBBLE_TARGET_DOT_SIZE
        : usesCurrentReferenceBStyle
          ? element.width
          : 6;
      const x = target.x - size / 2;
      const y = target.y - size / 2;
      const strokeColor = usesLatestReferenceBStyle
        ? BUBBLE_TARGET_DOT_COLOR
        : element.strokeColor;
      const backgroundColor = usesLatestReferenceBStyle
        ? BUBBLE_TARGET_DOT_FILL
        : element.backgroundColor;
      if (
        element.x === x &&
        element.y === y &&
        element.width === size &&
        element.height === size &&
        element.strokeColor === strokeColor &&
        element.backgroundColor === backgroundColor
      ) {
        return element;
      }
      return newElementWith(element, {
        x,
        y,
        width: size,
        height: size,
        strokeColor,
        backgroundColor,
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
      });
    }

    return element;
  });
};

/**
 * The host-owned endpoint handle calls this instead of moving the card group.
 * It binds only when the dot is dragged into a rectangle's snap range; otherwise
 * it saves the exact fixed target point while keeping the leader and dot aligned.
 */
export const retargetBubbleAnnotationElements = (
  elements: readonly ExcalidrawElement[],
  bubbleId: string,
  target: Readonly<{ x: number; y: number }>,
): readonly ExcalidrawElement[] => {
  const card = elements.find(
    (element): element is ExcalidrawRectangleElement =>
      !element.isDeleted &&
      element.type === "rectangle" &&
      element.customData?.kind === BUBBLE_CARD_KIND &&
      bubbleIdOf(element) === bubbleId &&
      isCurrentReferenceBBubble(element),
  );
  const leader = elements.find(
    (element): element is ExcalidrawArrowElement =>
      !element.isDeleted &&
      element.type === "arrow" &&
      element.customData?.kind === BUBBLE_LEADER_KIND &&
      bubbleIdOf(element) === bubbleId &&
      isCurrentReferenceBBubble(element),
  );
  const targetDot = elements.find(
    (element): element is ExcalidrawEllipseElement =>
      !element.isDeleted &&
      element.type === "ellipse" &&
      element.customData?.kind === BUBBLE_TARGET_DOT_KIND &&
      bubbleIdOf(element) === bubbleId &&
      isCurrentReferenceBBubble(element),
  );
  if (!card || !leader || !targetDot) {
    return elements;
  }

  const regions = elements.flatMap((element) =>
    !element.isDeleted &&
    element.type === "rectangle" &&
    element.customData?.kind === "region" &&
    typeof element.customData.regionId === "string"
      ? [
          {
            regionId: element.customData.regionId,
            bounds: elementBounds(element),
          },
        ]
      : [],
  );
  const snapped = getBubbleRegionSnapTarget(
    regions,
    target,
    bubbleTargetRegionIdOf(leader),
  );
  const nextTarget = snapped?.target ?? target;
  const layout = getAnnotationLeaderLayoutToPoint(nextTarget, card);
  const {
    targetRegionId: _targetRegionId,
    targetRegionAnchor: _targetRegionAnchor,
    ...leaderCustomData
  } = leader.customData ?? {};
  return elements.map((element) => {
    if (element.id === leader.id) {
      return newElementWith(leader, {
        ...layout,
        customData: {
          ...leaderCustomData,
          targetX: nextTarget.x,
          targetY: nextTarget.y,
          ...(snapped
            ? {
                targetRegionId: snapped.regionId,
                targetRegionAnchor: snapped.anchor,
              }
            : {}),
        },
      });
    }
    if (element.id === targetDot.id) {
      return newElementWith(targetDot, {
        x: nextTarget.x - targetDot.width / 2,
        y: nextTarget.y - targetDot.height / 2,
      });
    }
    return element;
  });
};

export const createImageElement = (input: {
  fileId: string;
  imageId: string;
  placementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}): ExcalidrawImageElement => {
  const [element] = convertToExcalidrawElements([
    {
      type: "image",
      fileId: input.fileId as FileId,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      angle: input.angle ?? 0,
      status: "saved",
      scale: [1, 1],
      crop: null,
      customData: {
        kind: "image",
        imageId: input.imageId,
        placementId: input.placementId,
      },
    },
  ]);
  return element as ExcalidrawImageElement;
};

/**
 * A persisted, locked visual companion for an imported image.
 *
 * Excalidraw image elements do not expose a native shadow field.  Keeping the
 * shadow as a scene rectangle lets it follow the same canonical scene
 * coordinate chain as the image without changing the image asset or export
 * semantics.  The companion is deliberately tagged with the image identity
 * but is not a business ImagePlacement.
 */
export const createImageShadowElement = (input: {
  imageId: string;
  placementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}): ExcalidrawRectangleElement => {
  // The image itself is opaque, so a 2px/12% companion is effectively hidden
  // at normal canvas zoom. Keep the effect subtle, but leave enough exposed
  // edge to make the depth cue readable in the real canvas.
  const shadowOffset = 8;
  const [element] = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: input.x + shadowOffset,
      y: input.y + shadowOffset,
      width: input.width,
      height: input.height,
      angle: input.angle ?? 0,
      strokeColor: BUBBLE_CARD_SHADOW_COLOR,
      backgroundColor: BUBBLE_CARD_SHADOW_COLOR,
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: Math.max(BUBBLE_CARD_SHADOW_OPACITY, 24),
      locked: true,
      customData: {
        kind: "image-shadow",
        imageId: input.imageId,
        placementId: input.placementId,
      },
    },
  ]);
  return element as ExcalidrawRectangleElement;
};

export const createRegionElement = (input: {
  imageId: string;
  regionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  cornerStyle?: RegionCornerStyle;
}): ExcalidrawRectangleElement => {
  const [element] = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      angle: input.angle ?? 0,
      strokeColor: "#dc4c3e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      roundness: getRegionRoundness(input.cornerStyle),
      opacity: 100,
      customData: {
        kind: "region",
        imageId: input.imageId,
        regionId: input.regionId,
      },
    },
  ]);
  return element as ExcalidrawRectangleElement;
};

export const createAnnotationElement = (input: {
  annotationId: string;
  regionId: string;
  text: string;
  x: number;
  y: number;
}): ExcalidrawTextElement => {
  const [element] = convertToExcalidrawElements([
    {
      type: "text",
      text: input.text,
      x: input.x,
      y: input.y,
      fontSize: 18,
      strokeColor: "#2b2a27",
      customData: {
        kind: "annotation",
        annotationId: input.annotationId,
        regionId: input.regionId,
      },
    },
  ]);
  return element as ExcalidrawTextElement;
};

export const createAnnotationCardElements = (input: {
  annotationId: string;
  regionId: string;
  selection: AnnotationCardBounds;
  text?: string;
  card?: AnnotationCardBounds;
}): Readonly<{
  card: ExcalidrawRectangleElement;
  text: ExcalidrawTextElement;
  leader: ExcalidrawArrowElement;
}> => {
  const defaultLayout = createAnnotationCardLayout(input.selection);
  const card = input.card ?? defaultLayout.card;
  const textPosition = input.card
    ? getAnnotationCardTextPosition(card)
    : defaultLayout.textPosition;
  const text = input.text?.trim()
    ? input.text
    : ANNOTATION_CARD_PLACEHOLDER;
  const groupId = getAnnotationCardGroupId(input.annotationId);
  const leader = getAnnotationLeaderLayout(input.selection, card);
  const [leaderElement, cardElement, textElement] =
    convertToExcalidrawElements([
      {
        type: "arrow",
        x: leader.x,
        y: leader.y,
        points: leader.points,
        endArrowhead: "arrow",
        strokeColor: "#0f766e",
        strokeWidth: 2,
        roughness: 0,
        customData: {
          kind: "annotation-leader",
          annotationId: input.annotationId,
          regionId: input.regionId,
        },
      },
      {
        type: "rectangle",
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
        strokeColor: "#0f766e",
        backgroundColor: "#ecfeff",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        roundness: ANNOTATION_CARD_ROUNDNESS,
        groupIds: [groupId],
        customData: {
          kind: "annotation-card",
          annotationId: input.annotationId,
          regionId: input.regionId,
        },
      },
      {
        type: "text",
        text,
        x: textPosition.x,
        y: textPosition.y,
        fontSize: 18,
        fontFamily: ANNOTATION_CARD_FONT_FAMILY,
        strokeColor: input.text?.trim() ? "#172554" : "#64748b",
        groupIds: [groupId],
        customData: {
          kind: "annotation",
          annotationId: input.annotationId,
          regionId: input.regionId,
          placeholder: input.text?.trim() ? "false" : "true",
        },
      },
    ]);

  const renderedCard = cardElement as ExcalidrawRectangleElement;
  const renderedText = textElement as ExcalidrawTextElement;
  return {
    card: renderedCard,
    text: newElementWith(renderedText, {
      ...getAnnotationCardTextPosition(renderedCard, renderedText),
      strokeColor: getReadableTextColor(renderedCard.backgroundColor),
      groupIds: withGroupId(renderedText.groupIds, groupId),
    }) as ExcalidrawTextElement,
    leader: leaderElement as ExcalidrawArrowElement,
  };
};
