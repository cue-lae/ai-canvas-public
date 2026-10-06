type Point = Readonly<{ x: number; y: number }>;

export interface DescriptionAnchorGestureState {
  dragging: boolean;
}

export type DescriptionAnchorGestureEvent =
  | Readonly<{
      type: "move";
      start: Point;
      current: Point;
    }>
  | Readonly<{ type: "finish" | "cancel" }>;

const DESCRIPTION_ANCHOR_DRAG_THRESHOLD = 5;
const DESCRIPTION_OVERVIEW_ZOOM_THRESHOLD = 0.55;

export const anchorGestureOpensDescription = ({
  dragged,
}: {
  dragged: boolean;
}): boolean => !dragged;

export const shouldCollapseDescriptionFrame = ({
  persistedCollapsed,
  zoom,
  editorFocused,
}: {
  persistedCollapsed: boolean;
  zoom: number;
  editorFocused: boolean;
}): boolean =>
  persistedCollapsed ||
  (zoom < DESCRIPTION_OVERVIEW_ZOOM_THRESHOLD && !editorFocused);

export const isDescriptionAnchorDrag = (
  start: Point,
  current: Point,
): boolean =>
  Math.hypot(current.x - start.x, current.y - start.y) >=
  DESCRIPTION_ANCHOR_DRAG_THRESHOLD;

/**
 * A drag never becomes a click again within one captured pointer session, even
 * if the pointer returns inside the threshold before it is released.
 */
export const reduceDescriptionAnchorGesture = (
  state: DescriptionAnchorGestureState,
  event: DescriptionAnchorGestureEvent,
): DescriptionAnchorGestureState => {
  if (event.type !== "move") {
    return { dragging: false };
  }
  return {
    dragging:
      state.dragging || isDescriptionAnchorDrag(event.start, event.current),
  };
};

export const descriptionAnchorGestureFinish = ({
  dragging,
  cancelled,
}: {
  dragging: boolean;
  cancelled: boolean;
}) => ({
  commitMove: dragging && !cancelled,
  suppressClick: dragging,
});

export const descriptionAnchorAfterPointerMove = ({
  anchorStart,
  pointerStart,
  pointerCurrent,
}: {
  anchorStart: Point;
  pointerStart: Point;
  pointerCurrent: Point;
}): Point => ({
  x: anchorStart.x + pointerCurrent.x - pointerStart.x,
  y: anchorStart.y + pointerCurrent.y - pointerStart.y,
});

export {
  DESCRIPTION_ANCHOR_DRAG_THRESHOLD,
  DESCRIPTION_OVERVIEW_ZOOM_THRESHOLD,
};
