import {
  formatBadgeNumber,
  ordinalBadgeWidth,
  SELECTION_BADGE_VISUALS,
  selectionBadgeScaleForZoom,
} from "./selectionBindingBadge";

export interface SelectionOrdinalBadgeLayout {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  scale: number;
}

/** Positions the label from one exposed highest anchor, without scanning shape geometry. */
export const selectionOrdinalBadgeLayout = ({
  number,
  node,
  zoom = 1,
  nodeRadius = SELECTION_BADGE_VISUALS.nodeRadius,
}: {
  number: number;
  node: Readonly<{ x: number; y: number }>;
  zoom?: number;
  nodeRadius?: number;
}): SelectionOrdinalBadgeLayout => {
  const text = formatBadgeNumber(number);
  const scale = selectionBadgeScaleForZoom(zoom);
  const width = ordinalBadgeWidth(number, scale);
  const height = SELECTION_BADGE_VISUALS.height * scale;
  const left =
    node.x - SELECTION_BADGE_VISUALS.nodeCenterOffset * scale - width;
  const bottom =
    node.y -
    nodeRadius -
    SELECTION_BADGE_VISUALS.anchorGap * scale;
  const top = bottom - height;

  return {
    text,
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    scale,
  };
};
