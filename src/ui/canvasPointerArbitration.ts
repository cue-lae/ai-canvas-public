export type CanvasPointerSessionKind =
  | "idle"
  | "pending-marquee"
  | "marquee"
  | "moving";

export type CanvasPointerIntent =
  | "native-image"
  | "native-element"
  | "host-marquee"
  | "none";

export interface CanvasPointerHit {
  type?: string;
  isDeleted?: boolean;
}

export interface CanvasPointerResizeState {
  handleType?: unknown;
  isResizing?: boolean;
}

/**
 * This is deliberately conservative: only a selection-tool pointer that did
 * not hit any native element may enter the host marquee path.
 */
export const classifyCanvasPointerIntent = ({
  activeToolType,
  hitElement,
  resize,
  hasControlledImageSelection = false,
}: {
  activeToolType: string;
  hitElement: CanvasPointerHit | null | undefined;
  resize?: CanvasPointerResizeState | null;
  hasControlledImageSelection?: boolean;
}): CanvasPointerIntent => {
  if (activeToolType !== "selection") {
    return "none";
  }
  if (Boolean(resize?.handleType) || resize?.isResizing) {
    return hasControlledImageSelection ? "native-image" : "native-element";
  }
  if (!hitElement || hitElement.isDeleted) {
    return "host-marquee";
  }
  return hitElement.type === "image" ? "native-image" : "native-element";
};

export const shouldPromoteMarquee = ({
  start,
  current,
  threshold = 6,
}: {
  start: Readonly<{ x: number; y: number }>;
  current: Readonly<{ x: number; y: number }>;
  threshold?: number;
}): boolean => Math.hypot(current.x - start.x, current.y - start.y) >= threshold;

export const shouldDismissCanvasMenuOnPointerDown = ({
  insideMenu,
}: {
  insideMenu: boolean;
}): boolean => !insideMenu;
