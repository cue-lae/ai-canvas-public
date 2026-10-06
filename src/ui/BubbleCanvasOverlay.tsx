import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawEllipseElement,
  ExcalidrawRectangleElement,
} from "@excalidraw/excalidraw/element/types";
import {
  BUBBLE_CARD_KIND,
  BUBBLE_LEADER_KIND,
  BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION,
  BUBBLE_REFERENCE_STYLE_VERSION,
  BUBBLE_TARGET_DOT_KIND,
} from "../excalidraw/scene";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface BubbleCanvasViewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
}

interface BubbleCard {
  id: string;
  bubbleId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  visualStyle: string;
}

interface BubbleAnchor {
  bubbleId: string;
  x: number;
  y: number;
}

interface BubbleOverlayState {
  cards: readonly BubbleCard[];
  anchors: readonly BubbleAnchor[];
}

const isCanvasImage = (element: ExcalidrawElement): boolean =>
  !element.isDeleted &&
  element.type === "image" &&
  // Folder preview temporarily projects the canonical image at its final
  // target with opacity 0 while the DOM motion layer carries the image and
  // its shadow. Do not let this overlay paint a target-sized shadow before
  // the moving image arrives; that reads as a white rectangle in the gap.
  (typeof element.opacity !== "number" || element.opacity > 0) &&
  element.customData?.kind !== "image-shadow";

const currentBubbleStyle = (element: ExcalidrawElement): string | null =>
  element.customData?.bubbleVisualStyle === BUBBLE_REFERENCE_STYLE_VERSION ||
  element.customData?.bubbleVisualStyle ===
    BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION
    ? element.customData.bubbleVisualStyle
    : null;

const currentBubbleId = (element: ExcalidrawElement): string | null =>
  currentBubbleStyle(element) &&
  typeof element.customData?.bubbleId === "string"
    ? element.customData.bubbleId
    : null;

export const getBubbleOverlayState = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
): BubbleOverlayState => {
  const cards = new Map<
    string,
    Readonly<{ element: ExcalidrawRectangleElement; visualStyle: string }>
  >();
  const leaders = new Map<string, ExcalidrawArrowElement>();
  const dots = new Map<string, ExcalidrawEllipseElement>();

  elements.forEach((element) => {
    if (element.isDeleted) {
      return;
    }
    const bubbleId = currentBubbleId(element);
    const visualStyle = currentBubbleStyle(element);
    if (!bubbleId || !visualStyle) {
      return;
    }
    if (
      element.type === "rectangle" &&
      element.customData?.kind === BUBBLE_CARD_KIND
    ) {
      cards.set(bubbleId, { element, visualStyle });
    } else if (
      element.type === "arrow" &&
      element.customData?.kind === BUBBLE_LEADER_KIND
    ) {
      leaders.set(bubbleId, element as ExcalidrawArrowElement);
    } else if (
      element.type === "ellipse" &&
      element.customData?.kind === BUBBLE_TARGET_DOT_KIND
    ) {
      dots.set(bubbleId, element);
    }
  });

  return {
    cards: [...cards.entries()].map(([bubbleId, card]) => ({
      id: card.element.id,
      bubbleId,
      x: card.element.x,
      y: card.element.y,
      width: card.element.width,
      height: card.element.height,
      angle: card.element.angle,
      visualStyle: card.visualStyle,
    })),
    anchors: [...leaders.entries()].flatMap(([bubbleId, leader]) => {
      const dot = dots.get(bubbleId);
      return dot && selectedElementIds[leader.id]
        ? [
            {
              bubbleId,
              x: dot.x + dot.width / 2,
              y: dot.y + dot.height / 2,
            },
          ]
        : [];
    }),
  };
};

const coordinateState = (viewport: BubbleCanvasViewport) => ({
  zoom: { value: viewport.zoom } as AppState["zoom"],
  offsetLeft: viewport.offsetLeft,
  offsetTop: viewport.offsetTop,
  scrollX: viewport.scrollX,
  scrollY: viewport.scrollY,
});

const scenePointToPanelPoint = (
  point: Readonly<{ x: number; y: number }>,
  viewport: BubbleCanvasViewport,
  panelBounds: Readonly<{ left: number; top: number }>,
): Readonly<{ x: number; y: number }> => {
  const viewportPoint = sceneCoordsToViewportCoords(
    { sceneX: point.x, sceneY: point.y },
    coordinateState(viewport),
  );
  return {
    x: viewportPoint.x - panelBounds.left,
    y: viewportPoint.y - panelBounds.top,
  };
};

interface BubbleCanvasOverlayProps {
  elements: readonly ExcalidrawElement[];
  selectedElementIds: Readonly<Record<string, boolean>>;
  viewport: BubbleCanvasViewport;
  onAnchorChange: (
    bubbleId: string,
    target: Readonly<{ x: number; y: number }>,
    commit: boolean,
  ) => void;
}

interface DraggingAnchor {
  pointerId: number;
  bubbleId: string;
}

/**
 * This host layer deliberately stays outside Excalidraw's scene: its soft
 * shadows and legacy bubble anchors are never serialized or published. Grid
 * rendering belongs exclusively to Excalidraw's native grid.
 */
export const BubbleCanvasOverlay = ({
  elements,
  selectedElementIds,
  viewport,
  onAnchorChange,
}: BubbleCanvasOverlayProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingAnchorRef = useRef<DraggingAnchor | null>(null);
  const [panelBounds, setPanelBounds] = useState({ left: 0, top: 0 });
  const { cards, anchors } = useMemo(
    () => getBubbleOverlayState(elements, selectedElementIds),
    [elements, selectedElementIds],
  );
  const imageElements = useMemo(
    () => elements.filter(isCanvasImage),
    [elements],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const updateBounds = () => {
      const bounds = root.getBoundingClientRect();
      setPanelBounds((current) =>
        current.left === bounds.left && current.top === bounds.top
          ? current
          : { left: bounds.left, top: bounds.top },
      );
    };

    updateBounds();
    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(root);
    window.addEventListener("resize", updateBounds);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, []);

  const pointerToScene = (event: ReactPointerEvent<HTMLButtonElement>) =>
    viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      coordinateState(viewport),
    );

  const startAnchorDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    bubbleId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingAnchorRef.current = { pointerId: event.pointerId, bubbleId };
    onAnchorChange(bubbleId, pointerToScene(event), false);
  };

  const moveAnchor = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragging = draggingAnchorRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId) {
      return;
    }
    onAnchorChange(dragging.bubbleId, pointerToScene(event), false);
  };

  const finishAnchorDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragging = draggingAnchorRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId) {
      return;
    }
    draggingAnchorRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onAnchorChange(dragging.bubbleId, pointerToScene(event), true);
  };

  return (
    <div className="bubble-canvas-overlay" ref={rootRef}>
      {cards.map((card) => {
        const origin = scenePointToPanelPoint(card, viewport, panelBounds);
        const width = card.width * viewport.zoom;
        const height = card.height * viewport.zoom;
        return (
          <div
            className="bubble-canvas-overlay__shadow"
            key={card.id}
            style={{
              left: origin.x,
              top: origin.y,
              width,
              height,
              borderRadius: Math.max(5, Math.min(9, 7 * viewport.zoom)),
              boxShadow:
                card.visualStyle === BUBBLE_REFERENCE_STYLE_VERSION
                  ? `0 ${Math.max(2, 3 * viewport.zoom)}px ${Math.max(
                      6,
                      8 * viewport.zoom,
                    )}px rgba(54, 60, 69, 0.16)`
                  : `0 ${Math.max(2, 3 * viewport.zoom)}px ${Math.max(
                      7,
                      10 * viewport.zoom,
                    )}px rgba(51, 65, 85, 0.16)`,
              transform: `rotate(${card.angle}rad)`,
            }}
            aria-hidden="true"
          />
        );
      })}
      {imageElements.map((image) => {
        const origin = scenePointToPanelPoint(image, viewport, panelBounds);
        const width = image.width * viewport.zoom;
        const height = image.height * viewport.zoom;
        return (
          <div
            className="bubble-canvas-overlay__image-shadow"
            key={`image-shadow-${image.id}`}
            style={{
              left: origin.x,
              top: origin.y,
              width,
              height,
              boxShadow: `0 ${Math.max(4, 12 * viewport.zoom)}px ${Math.max(
                12,
                30 * viewport.zoom,
              )}px rgba(51, 42, 70, 0.16)`,
              transform: `rotate(${image.angle}rad)`,
            }}
            aria-hidden="true"
          />
        );
      })}
      {anchors.map((anchor) => {
        const point = scenePointToPanelPoint(anchor, viewport, panelBounds);
        return (
          <button
            className="bubble-canvas-overlay__anchor"
            key={anchor.bubbleId}
            style={{ left: point.x, top: point.y }}
            type="button"
            aria-label="拖动批注气泡引线目标端"
            onPointerDown={(event) => startAnchorDrag(event, anchor.bubbleId)}
            onPointerMove={moveAnchor}
            onPointerUp={finishAnchorDrag}
            onPointerCancel={finishAnchorDrag}
          />
        );
      })}
    </div>
  );
};
