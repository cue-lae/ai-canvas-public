import type {
  AnnotationCardBounds,
  AnnotationCardPoint,
  BoundsEdgeAnchor,
} from "./annotationCard";
import {
  getBoundsEdgeAnchor,
  getBoundsEdgePointClosestTo,
  isBoundsEdgeAnchor,
} from "./annotationCard";

export const MANUAL_ANNOTATION_SNAP_TOLERANCE = 30;

/**
 * Rectangle selection creation must never inherit a bubble's opaque fill or
 * rounded surface. This is applied before Excalidraw creates the drag preview.
 */
export const createRectangleSelectionPreviewStyle = (
  cornerStyle: "sharp" | "round",
) => ({
  currentItemStrokeColor: "#0f766e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid" as const,
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: "solid" as const,
  currentItemRoughness: 0,
  currentItemRoundness: cornerStyle === "round" ? "round" : "sharp",
} as const);

export type ExplicitToolSessionElement = Readonly<{
  id: string;
  type: string;
  isDeleted?: boolean;
}>;

export type LinearArrowGeometry = Readonly<{
  x: number;
  y: number;
  points: readonly [number, number][];
}>;

export type ManualAnnotationLeaderAnchors = Readonly<{
  card: BoundsEdgeAnchor;
  selection: BoundsEdgeAnchor;
}>;

export const isManualAnnotationLeaderAnchors = (
  value: unknown,
): value is ManualAnnotationLeaderAnchors => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ManualAnnotationLeaderAnchors>;
  return (
    isBoundsEdgeAnchor(candidate.card) &&
    isBoundsEdgeAnchor(candidate.selection)
  );
};

const pointDistance = (left: AnnotationCardPoint, right: AnnotationCardPoint): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

export const isExplicitToolSessionElement = (
  element: ExplicitToolSessionElement,
  expectedType: string,
  existingElementIds: ReadonlySet<string>,
): boolean =>
  element.type === expectedType &&
  !element.isDeleted &&
  !existingElementIds.has(element.id);

export const snapManualAnnotationArrow = (input: {
  arrow: LinearArrowGeometry;
  card: AnnotationCardBounds;
  selection: AnnotationCardBounds;
  tolerance?: number;
}): Readonly<{
  x: number;
  y: number;
  points: readonly [number, number][];
  anchors: ManualAnnotationLeaderAnchors;
}> | null => {
  const first = input.arrow.points[0];
  const last = input.arrow.points[input.arrow.points.length - 1];
  if (!first || !last) {
    return null;
  }
  const start = { x: input.arrow.x + first[0], y: input.arrow.y + first[1] };
  const end = { x: input.arrow.x + last[0], y: input.arrow.y + last[1] };
  const cardStart = getBoundsEdgePointClosestTo(input.card, start);
  const selectionEnd = getBoundsEdgePointClosestTo(input.selection, end);
  const cardEnd = getBoundsEdgePointClosestTo(input.card, end);
  const selectionStart = getBoundsEdgePointClosestTo(input.selection, start);
  const tolerance = input.tolerance ?? MANUAL_ANNOTATION_SNAP_TOLERANCE;
  const forwardCardDistance = pointDistance(start, cardStart);
  const forwardSelectionDistance = pointDistance(end, selectionEnd);
  const reverseCardDistance = pointDistance(end, cardEnd);
  const reverseSelectionDistance = pointDistance(start, selectionStart);
  const forwardDistance = forwardCardDistance + forwardSelectionDistance;
  const reverseDistance = reverseCardDistance + reverseSelectionDistance;
  const forwardMatches =
    forwardCardDistance <= tolerance && forwardSelectionDistance <= tolerance;
  const reverseMatches =
    reverseCardDistance <= tolerance && reverseSelectionDistance <= tolerance;

  if (!forwardMatches && !reverseMatches) {
    return null;
  }

  const source =
    forwardMatches && (!reverseMatches || forwardDistance <= reverseDistance)
      ? cardStart
      : cardEnd;
  const target =
    forwardMatches && (!reverseMatches || forwardDistance <= reverseDistance)
      ? selectionEnd
      : selectionStart;

  return {
    x: source.x,
    y: source.y,
    points: [
      [0, 0],
      [target.x - source.x, target.y - source.y],
    ],
    anchors: {
      card: getBoundsEdgeAnchor(input.card, source),
      selection: getBoundsEdgeAnchor(input.selection, target),
    },
  };
};
