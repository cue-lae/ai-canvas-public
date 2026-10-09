import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { DescriptionRegionBindingLabel } from "./descriptionPresentation";
import {
  SELECTION_BADGE_VISUALS,
  horizontalSelectionBadgeLayout,
  selectHighestScreenPoint,
} from "./selectionBindingBadge";
import { selectionOrdinalBadgeLayout } from "./selectionOrdinalBadge";
import { folderPreviewAttachmentAttributes, folderPreviewAttachmentStyle, type FolderPreviewAttachmentMotion } from "./folderPreviewAttachment";
import { releaseSelectionToolFocus } from "./selectionToolFocus";
import { removeLastSelectionPathAnchor } from "./selectionPathDraft";
import {
  ellipseScenePoints,
  higherImageElementsFor,
  rotatedRectScenePoints,
} from "./selectionOcclusion";
import {
  clampScenePointToElementBounds,
  circleCreationEndPoint,
  ellipseHandleScenePoints,
  getSelectionElements,
  isScenePointInsideElementBounds,
  selectionKindOf,
  selectionScenePoints,
  type SelectionElementLike,
  type SelectionKind,
} from "./selectionGeometry";

export interface SelectionCanvasViewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
}

interface SelectionCanvasOverlayProps {
  elements: readonly ExcalidrawElement[];
  selectedRegionIds?: ReadonlySet<string>;
  highlightedRegionIds?: ReadonlySet<string>;
  onSelectRegionFromBadge?: (regionId: string) => void;
  regionBindings?: ReadonlyMap<
    string,
    readonly DescriptionRegionBindingLabel[]
  >;
  regionNumbers?: ReadonlyMap<string, number>;
  activeDescriptionId?: string | null;
  readOnly?: boolean;
  interactionDisabled?: boolean;
  creationTool: SelectionKind | null;
  creationImageId: string | null;
  viewport: SelectionCanvasViewport;
  previewMotion?: FolderPreviewAttachmentMotion | null;
  maxHandleDiameterPx?: number;
  onCreateSelection: (
    kind: SelectionKind,
    scenePoints: readonly Readonly<{ x: number; y: number }>[],
  ) => void;
  onCreationRejected: () => void;
  onRegisterPathDraftUndo?: (
    undo: (() => number | null) | null,
  ) => void;
  onSelectRegion: (regionId: string) => void;
  onMoveRegion: (
    regionId: string,
    delta: Readonly<{ x: number; y: number }>,
    commit: boolean,
  ) => void;
  onVertexChange: (
    regionId: string,
    index: number,
    point: Readonly<{ x: number; y: number }>,
    commit: boolean,
    constrainToRectangle: boolean,
  ) => void;
  onEllipseChange: (
    regionId: string,
    edge: "top" | "right" | "bottom" | "left",
    point: Readonly<{ x: number; y: number }>,
    commit: boolean,
    constrainToCircle: boolean,
  ) => void;
  onActivateDescription?: (descriptionId: string) => void;
}

type ScenePoint = Readonly<{ x: number; y: number }>;

interface SelectionDrag {
  pointerId: number;
  regionId: string;
  imageId: string;
  mode: "move" | "vertex" | "ellipse";
  lastScenePoint: ScenePoint;
  constrainToRectangle?: boolean;
  index?: number;
  edge?: "top" | "right" | "bottom" | "left";
}

interface CreationDrag {
  pointerId: number;
  kind: "rectangle" | "ellipse";
  start: ScenePoint;
  current: ScenePoint;
  rawCurrent?: ScenePoint;
}

const coordinateState = (viewport: SelectionCanvasViewport) => ({
  zoom: { value: viewport.zoom } as AppState["zoom"],
  offsetLeft: viewport.offsetLeft,
  offsetTop: viewport.offsetTop,
  scrollX: viewport.scrollX,
  scrollY: viewport.scrollY,
});

const sceneToPanel = (
  point: ScenePoint,
  viewport: SelectionCanvasViewport,
  bounds: Readonly<{ left: number; top: number }>,
) => {
  const viewportPoint = sceneCoordsToViewportCoords(
    { sceneX: point.x, sceneY: point.y },
    coordinateState(viewport),
  );
  return {
    x: viewportPoint.x - bounds.left,
    y: viewportPoint.y - bounds.top,
  };
};

const pathData = (points: readonly ScenePoint[], closed: boolean) => {
  if (points.length === 0) {
    return "";
  }
  return `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")}${closed ? " Z" : ""}`;
};

const ellipseCenter = (element: SelectionElementLike) => ({
  x: element.x + element.width / 2,
  y: element.y + element.height / 2,
});

const boxPoints = (start: ScenePoint, end: ScenePoint): readonly ScenePoint[] => {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
};

const closedPathData = (points: readonly ScenePoint[]) =>
  `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")} Z`;

export const SELECTION_HANDLE_DIAMETER_AT_100_PERCENT_PX = 6;
export const SELECTION_HANDLE_MAX_DIAMETER_PX = 14;
const selectionHandleDiameterForZoom = (zoom: number) =>
  zoom <= 1
    ? SELECTION_HANDLE_DIAMETER_AT_100_PERCENT_PX * zoom
    : Math.min(
        SELECTION_HANDLE_DIAMETER_AT_100_PERCENT_PX * Math.sqrt(zoom),
        SELECTION_HANDLE_MAX_DIAMETER_PX,
      );

const selectionHandleRadiusForZoom = (
  zoom: number,
  maxDiameterPx = Number.POSITIVE_INFINITY,
) =>
  Math.min(selectionHandleDiameterForZoom(zoom), maxDiameterPx) / 2;

export const SelectionCanvasOverlay = ({
  elements,
  selectedRegionIds = new Set<string>(),
  highlightedRegionIds = new Set<string>(),
  onSelectRegionFromBadge,
  regionBindings = new Map(),
  regionNumbers = new Map(),
  activeDescriptionId = null,
  readOnly = false,
  interactionDisabled = false,
  creationTool,
  creationImageId,
  viewport,
  previewMotion = null,
  maxHandleDiameterPx,
  onCreateSelection,
  onCreationRejected,
  onRegisterPathDraftUndo,
  onSelectRegion,
  onMoveRegion,
  onVertexChange,
  onEllipseChange,
  onActivateDescription,
}: SelectionCanvasOverlayProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<SelectionDrag | null>(null);
  const creationDragRef = useRef<CreationDrag | null>(null);
  const [panelBounds, setPanelBounds] = useState({ left: 0, top: 0 });
  const [pathDraft, setPathDraft] = useState<readonly ScenePoint[]>([]);
  const pathDraftRef = useRef<readonly ScenePoint[]>([]);
  const [draftCursor, setDraftCursor] = useState<ScenePoint | null>(null);
  const [boxDraft, setBoxDraft] = useState<CreationDrag | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const selections = useMemo(
    () =>
      getSelectionElements(
        elements as unknown as readonly SelectionElementLike[],
      ),
    [elements],
  );
  const imageById = useMemo(
    () =>
      new Map(
        elements.flatMap((element) =>
          !element.isDeleted &&
          element.type === "image" &&
          typeof element.customData?.imageId === "string"
            ? [[element.customData.imageId, element as unknown as SelectionElementLike]]
            : [],
        ),
      ),
    [elements],
  );
  const creationImage = creationImageId
    ? imageById.get(creationImageId) ?? null
    : null;

  useEffect(() => {
    const updateShift = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || event.repeat) return;
      const constrained = event.type === "keydown";
      const drag = draggingRef.current;
      if (drag?.mode === "ellipse" && drag.edge) {
        onEllipseChange(drag.regionId, drag.edge, drag.lastScenePoint, false, constrained);
      }
      const creation = creationDragRef.current;
      if (creation?.kind === "ellipse" && creationImage) {
        const point = creation.rawCurrent ?? creation.current;
        const next = { ...creation, current: constrained
          ? circleCreationEndPoint(creation.start, point, creationImage) : point };
        creationDragRef.current = next;
        setBoxDraft(next);
      }
    };
    window.addEventListener("keydown", updateShift);
    window.addEventListener("keyup", updateShift);
    return () => {
      window.removeEventListener("keydown", updateShift);
      window.removeEventListener("keyup", updateShift);
    };
  }, [creationImage, onEllipseChange]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const update = () => {
      const bounds = root.getBoundingClientRect();
      setPanelBounds((current) =>
        current.left === bounds.left && current.top === bounds.top
          ? current
          : { left: bounds.left, top: bounds.top },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    pathDraftRef.current = [];
    setPathDraft([]);
    setDraftCursor(null);
    setBoxDraft(null);
    creationDragRef.current = null;
  }, [creationImageId, creationTool]);

  const undoLastPathAnchor = useCallback((): number | null => {
    const current = pathDraftRef.current;
    if (current.length === 0) {
      return null;
    }
    const next = removeLastSelectionPathAnchor(current);
    pathDraftRef.current = next;
    setPathDraft(next);
    if (next.length === 0) {
      setDraftCursor(null);
    }
    return next.length;
  }, []);

  useEffect(() => {
    if (creationTool !== "path" || !onRegisterPathDraftUndo) {
      onRegisterPathDraftUndo?.(null);
      return;
    }
    onRegisterPathDraftUndo(undoLastPathAnchor);
    return () => onRegisterPathDraftUndo(null);
  }, [creationTool, onRegisterPathDraftUndo, undoLastPathAnchor]);

  const pointerToScene = (event: ReactPointerEvent<SVGElement>) =>
    viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      coordinateState(viewport),
    );

  const stopBindingPointer = (event: ReactPointerEvent<SVGGElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const selectRegionFromBadge = onSelectRegionFromBadge ?? onSelectRegion;

  const activateBadgeOnKeyDown = (
    event: React.KeyboardEvent<SVGGElement>,
    activate: () => void,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    activate();
  };

  const pointForImage = (imageId: string, point: ScenePoint): ScenePoint => {
    const image = imageById.get(imageId);
    return image ? clampScenePointToElementBounds(point, image) : point;
  };

  const updateSelectionDrag = (
    event: ReactPointerEvent<SVGElement>,
    commit: boolean,
  ) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const rawPoint = pointerToScene(event);
    const point =
      drag.mode === "move" ? rawPoint : pointForImage(drag.imageId, rawPoint);
    if (drag.mode === "move") {
      onMoveRegion(
        drag.regionId,
        {
          x: point.x - drag.lastScenePoint.x,
          y: point.y - drag.lastScenePoint.y,
        },
        commit,
      );
      drag.lastScenePoint = point;
    } else if (drag.mode === "vertex" && drag.index !== undefined) {
      onVertexChange(
        drag.regionId,
        drag.index,
        point,
        commit,
        drag.constrainToRectangle === true,
      );
    } else if (drag.mode === "ellipse" && drag.edge) {
      drag.lastScenePoint = point;
      onEllipseChange(drag.regionId, drag.edge, point, commit, event.shiftKey);
    }
    if (commit) {
      draggingRef.current = null;
      setIsDraggingSelection(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const startSelectionDrag = (
    event: ReactPointerEvent<SVGElement>,
    drag: Omit<SelectionDrag, "pointerId" | "lastScenePoint">,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const captureTarget = event.currentTarget.ownerSVGElement ?? event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    const rawPoint = pointerToScene(event);
    const point =
      drag.mode === "move" ? rawPoint : pointForImage(drag.imageId, rawPoint);
    draggingRef.current = {
      ...drag,
      pointerId: event.pointerId,
      lastScenePoint: point,
    };
    setIsDraggingSelection(true);
    onSelectRegion(drag.regionId);
  };

  const closePathDraft = (event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (pathDraft.length < 3) {
      return;
    }
    onCreateSelection("path", pathDraft);
    pathDraftRef.current = [];
    setPathDraft([]);
    setDraftCursor(null);
  };

  const handleCreationPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!creationTool || !creationImage) {
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      releaseSelectionToolFocus(document.activeElement);
    }
    event.preventDefault();
    event.stopPropagation();
    const rawPoint = pointerToScene(event);
    if (!isScenePointInsideElementBounds(rawPoint, creationImage)) {
      onCreationRejected();
      return;
    }
    if (creationTool === "path") {
      setPathDraft((current) => {
        const next = [...current, rawPoint];
        pathDraftRef.current = next;
        return next;
      });
      setDraftCursor(rawPoint);
      return;
    }
    const drag: CreationDrag = {
      pointerId: event.pointerId,
      kind: creationTool,
      start: rawPoint,
      current: rawPoint,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    creationDragRef.current = drag;
    setBoxDraft(drag);
  };

  const handleOverlayPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || interactionDisabled) return;
    if (creationTool) {
      handleCreationPointerDown(event);
      return;
    }
    const target = (event.target as SVGElement).closest<SVGElement>(
      "[data-selection-drag]",
    );
    const regionId = target?.dataset.regionId;
    const imageId = target?.dataset.imageId;
    const mode = target?.dataset.selectionDrag;
    if (
      !target ||
      !regionId ||
      !imageId ||
      (mode !== "move" && mode !== "vertex" && mode !== "ellipse")
    ) {
      return;
    }
    if (!selectedRegionIds.has(regionId)) {
      event.preventDefault();
      event.stopPropagation();
      onSelectRegion(regionId);
      return;
    }
    startSelectionDrag(event, {
      regionId,
      imageId,
      mode,
      ...(mode === "vertex"
        ? { index: Number(target.dataset.selectionIndex) }
        : {}),
      ...(mode === "ellipse"
        ? {
            edge: target.dataset.selectionEdge as
              | "top"
              | "right"
              | "bottom"
              | "left",
          }
        : {}),
      ...(mode === "vertex" ? { constrainToRectangle: event.shiftKey } : {}),
    });
  };

  const handleCreationPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!creationTool || !creationImage) {
      return;
    }
    const point = clampScenePointToElementBounds(
      pointerToScene(event),
      creationImage,
    );
    if (creationTool === "path") {
      if (pathDraft.length > 0) {
        setDraftCursor(point);
      }
      return;
    }
    const drag = creationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const next = { ...drag, rawCurrent: point, current: drag.kind === "ellipse" && event.shiftKey
      ? circleCreationEndPoint(drag.start, point, creationImage) : point };
    creationDragRef.current = next;
    setBoxDraft(next);
  };

  const handleCreationPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = creationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const rawCurrent = creationImage
      ? clampScenePointToElementBounds(pointerToScene(event), creationImage)
      : drag.current;
    const current = drag.kind === "ellipse" && event.shiftKey && creationImage
      ? circleCreationEndPoint(drag.start, rawCurrent, creationImage) : rawCurrent;
    creationDragRef.current = null;
    setBoxDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      Math.abs(current.x - drag.start.x) < 4 ||
      Math.abs(current.y - drag.start.y) < 4
    ) {
      onCreationRejected();
      return;
    }
    onCreateSelection(drag.kind, [drag.start, current]);
  };

  const cancelCreationDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = creationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    creationDragRef.current = null;
    setBoxDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const draftBoxPoints = boxDraft
    ? boxPoints(boxDraft.start, boxDraft.current).map((point) =>
        sceneToPanel(point, viewport, panelBounds),
      )
    : [];
  const panelPathDraft = pathDraft.map((point) =>
    sceneToPanel(point, viewport, panelBounds),
  );
  const panelDraftCursor = draftCursor
    ? sceneToPanel(draftCursor, viewport, panelBounds)
    : null;
  const draftAnchorRadius = selectionHandleRadiusForZoom(
    viewport.zoom,
    maxHandleDiameterPx,
  );
  const draftStartAnchorRadius = draftAnchorRadius + 1;
  const draftStartHitRadius = Math.max(8, draftStartAnchorRadius);
  const bindingBadgeRows = useMemo(
    () =>
      selections.map((selection) => {
        const scenePoints = selectionScenePoints(selection.element);
        const points = scenePoints.map((point) =>
          sceneToPanel(point, viewport, panelBounds),
        );
        const kind = selectionKindOf(selection.element) as SelectionKind;
        const ellipseHandles = ellipseHandleScenePoints(selection.element);
        const anchorCandidates =
          kind === "ellipse"
            ? Object.values(ellipseHandles).map((point) =>
                sceneToPanel(point, viewport, panelBounds),
              )
            : points;
        const ordinalNode = selectHighestScreenPoint(anchorCandidates);
        if (!ordinalNode) {
          return null;
        }
        const ordinal = selectionOrdinalBadgeLayout({
          number: regionNumbers.get(selection.regionId) ?? 0,
          node: ordinalNode,
          zoom: viewport.zoom,
          nodeRadius: selectionHandleRadiusForZoom(
            viewport.zoom,
            maxHandleDiameterPx,
          ),
        });
        const bindings = regionBindings.get(selection.regionId) ?? [];
        return {
          regionId: selection.regionId,
          imageId: selection.imageId,
          ordinal,
          bindings,
          selected: selectedRegionIds.has(selection.regionId),
          highlighted: highlightedRegionIds.has(selection.regionId),
          dragging:
            isDraggingSelection &&
            draggingRef.current?.regionId === selection.regionId,
        };
      }).filter((row): row is NonNullable<typeof row> => row !== null),
    [
      highlightedRegionIds,
      isDraggingSelection,
      maxHandleDiameterPx,
      panelBounds,
      regionBindings,
      regionNumbers,
      selectedRegionIds,
      selections,
      viewport,
    ],
  );
  const selectionOcclusionMasks = useMemo(() => {
    const masks = new Map<
      string,
      {
        id: string;
        badgeId: string;
        selectionPath: string;
        coverPaths: readonly string[];
      }
    >();
    selections.forEach((selection, index) => {
      const element = selection.element;
      const kind = selectionKindOf(element);
      if (!kind) return;
      const higherImages = higherImageElementsFor(
        elements,
        selection.imageId,
      );
      if (higherImages.length === 0) return;
      const selectionPointsScene =
        kind === "ellipse"
          ? ellipseScenePoints(element)
          : selectionScenePoints(element);
      const selectionPoints = selectionPointsScene.map((point) =>
        sceneToPanel(point, viewport, panelBounds),
      );
      const coverPaths = higherImages.map((image) => {
        const imagePoints = rotatedRectScenePoints(image).map((point) =>
          sceneToPanel(point, viewport, panelBounds),
        );
        return closedPathData(imagePoints);
      });
      masks.set(selection.regionId, {
        id: `selection-occlusion-${index}`,
        badgeId: `selection-badge-occlusion-${index}`,
        selectionPath: closedPathData(selectionPoints),
        coverPaths,
      });
    });
    return masks;
  }, [elements, panelBounds, selections, viewport]);

  return (
    <div
      className={`selection-canvas-overlay ${creationTool ? "is-creating" : ""} ${
        isDraggingSelection ? "is-dragging" : ""
      }`}
      data-dragging-selection={isDraggingSelection ? "true" : "false"}
      ref={rootRef}
      data-creation-tool={creationTool ?? "none"}
      data-read-only={readOnly}
      data-interaction-disabled={interactionDisabled}
    >
      <svg
        className="selection-canvas-overlay__svg selection-canvas-overlay__draft-layer"
        width="100%"
        height="100%"
        role="presentation"
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={(event) =>
          draggingRef.current
            ? updateSelectionDrag(event, false)
            : handleCreationPointerMove(event)
        }
        onPointerUp={(event) =>
          draggingRef.current
            ? updateSelectionDrag(event, true)
            : handleCreationPointerUp(event)
        }
        onPointerCancel={(event) =>
          draggingRef.current
            ? updateSelectionDrag(event, true)
            : cancelCreationDrag(event)
        }
      >


        {creationTool === "path" && panelPathDraft.length > 0 && (
          <g className="selection-canvas-overlay__draft">
            <path
              className="selection-canvas-overlay__draft-shape"
              d={pathData(
                panelDraftCursor
                  ? [...panelPathDraft, panelDraftCursor]
                  : panelPathDraft,
                false,
              )}
            />
            {pathDraft.length >= 3 && panelPathDraft[0] ? (
              <circle
                className="selection-canvas-overlay__draft-anchor-hit"
                cx={panelPathDraft[0].x}
                cy={panelPathDraft[0].y}
                r={draftStartHitRadius}
                onPointerDown={closePathDraft}
              />
            ) : null}
            {panelPathDraft.map((point, index) => (
              <circle
                key={`draft-${index}`}
                className={`selection-canvas-overlay__draft-anchor ${
                  index === 0 && pathDraft.length >= 3 ? "is-closable" : ""
                }`}
                cx={point.x}
                cy={point.y}
                r={index === 0 ? draftStartAnchorRadius : draftAnchorRadius}
                onPointerDown={index === 0 ? closePathDraft : undefined}
              />
            ))}
          </g>
        )}

        {boxDraft?.kind === "rectangle" && (
          <path
            className="selection-canvas-overlay__draft-shape"
            d={pathData(draftBoxPoints, true)}
          />
        )}
        {boxDraft?.kind === "ellipse" && draftBoxPoints.length === 4 && (
          <ellipse
            className="selection-canvas-overlay__draft-shape"
            cx={(draftBoxPoints[0].x + draftBoxPoints[2].x) / 2}
            cy={(draftBoxPoints[0].y + draftBoxPoints[2].y) / 2}
            rx={Math.abs(draftBoxPoints[2].x - draftBoxPoints[0].x) / 2}
            ry={Math.abs(draftBoxPoints[2].y - draftBoxPoints[0].y) / 2}
          />
        )}
      </svg>
        {selections.map((selection) => {
          const element = selection.element;
          const kind = selectionKindOf(element) as SelectionKind;
          const selected = selectedRegionIds.has(selection.regionId);
          const highlighted = highlightedRegionIds.has(selection.regionId);
          const dragging =
            isDraggingSelection &&
            draggingRef.current?.regionId === selection.regionId;
          const scenePoints = selectionScenePoints(element);
          const points = scenePoints.map((point) =>
            sceneToPanel(point, viewport, panelBounds),
          );
          const previewMotionActive = previewMotion?.imageIds.has(selection.imageId) ?? false;
          const previewMotionStyle = folderPreviewAttachmentStyle(
            previewMotion, selection.imageId, { left: 0, top: 0 },
          );
          const center = sceneToPanel(
            ellipseCenter(element),
            viewport,
            panelBounds,
          );
          const ellipseHandles = ellipseHandleScenePoints(element);
          const occlusionMask = selectionOcclusionMasks.get(
            selection.regionId,
          );

          return (
            <svg
              key={selection.regionId}
              className={`selection-canvas-overlay__svg selection-canvas-overlay__region-layer${
                selected && !creationTool && !readOnly && !interactionDisabled ? " is-active" : ""
              }`}
              data-region-layer={selection.regionId}
              width="100%" height="100%" role="presentation"
              onPointerDown={handleOverlayPointerDown}
              onPointerMove={(event) => updateSelectionDrag(event, false)}
              onPointerUp={(event) => updateSelectionDrag(event, true)}
              onPointerCancel={(event) => updateSelectionDrag(event, true)}
            >
              {occlusionMask ? (
                <defs>
                  <mask id={occlusionMask.id} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
                    <rect width="100%" height="100%" fill="black" />
                    <path d={occlusionMask.selectionPath} fill="white" />
                    {occlusionMask.coverPaths.map((path, index) => (
                      <path key={`${occlusionMask.id}-cover-${index}`} d={path} fill="black" />
                    ))}
                  </mask>
                </defs>
              ) : null}
            <g
              key={selection.regionId}
              className={`selection-canvas-overlay__selection ${
                selected ? "is-selected" : ""
              } ${highlighted ? "is-description-linked" : ""} ${
                dragging ? "is-dragging" : ""
              } ${previewMotionActive ? "is-preview-motion" : ""}`}
              style={previewMotionStyle}
              {...folderPreviewAttachmentAttributes(previewMotion, selection.imageId)}
              data-selection-kind={kind}
              data-canvas-object="region"
              data-region-id={selection.regionId}
            >
              {kind === "ellipse" ? (
                <ellipse
                  className="selection-canvas-overlay__shape"
                  cx={center.x}
                  cy={center.y}
                  rx={(element.width * viewport.zoom) / 2}
                  ry={(element.height * viewport.zoom) / 2}
                  transform={`rotate(${(element.angle * 180) / Math.PI} ${center.x} ${center.y})`}
                  mask={
                    occlusionMask ? `url(#${occlusionMask.id})` : undefined
                  }
                  data-selection-drag="move"
                  data-region-id={selection.regionId}
                  data-image-id={selection.imageId}
                />
              ) : (
                <path
                  className="selection-canvas-overlay__shape"
                  d={pathData(points, true)}
                  mask={
                    occlusionMask ? `url(#${occlusionMask.id})` : undefined
                  }
                  data-selection-drag="move"
                  data-region-id={selection.regionId}
                  data-image-id={selection.imageId}
                />
              )}
              {selected &&
                (kind === "ellipse"
                  ? (Object.entries(ellipseHandles) as [
                      "top" | "right" | "bottom" | "left",
                      ScenePoint,
                    ][]).map(([edge, point]) => {
                      const position = sceneToPanel(point, viewport, panelBounds);
                      return (
                        <circle
                          key={edge}
                          className={`selection-canvas-overlay__handle ${
                            highlighted ? "is-description-linked" : ""
                          }`}
                          cx={position.x}
                          cy={position.y}
                          r={selectionHandleRadiusForZoom(
                            viewport.zoom,
                            maxHandleDiameterPx,
                          )}
                          data-selection-drag="ellipse"
                          data-region-id={selection.regionId}
                          data-image-id={selection.imageId}
                          data-selection-edge={edge}
                        />
                      );
                    })
                  : points.map((point, index) => (
                      <circle
                        key={`${selection.regionId}-${index}`}
                        className={`selection-canvas-overlay__handle ${
                          highlighted ? "is-description-linked" : ""
                        }`}
                        cx={point.x}
                        cy={point.y}
                        r={selectionHandleRadiusForZoom(
                          viewport.zoom,
                          maxHandleDiameterPx,
                        )}
                        data-selection-drag="vertex"
                        data-region-id={selection.regionId}
                        data-image-id={selection.imageId}
                        data-selection-index={index}
                      />
                    )))}
            </g>
            </svg>
          );
        })}
      <svg
        className="selection-canvas-overlay__binding-layer"
        width="100%"
        height="100%"
      >
        {selectionOcclusionMasks.size > 0 ? (
          <defs>
            {[...selectionOcclusionMasks.values()].map((mask) => (
              <mask
                key={mask.badgeId}
                id={mask.badgeId}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="100%"
                height="100%"
              >
                <rect width="100%" height="100%" fill="white" />
                {mask.coverPaths.map((path, index) => (
                  <path
                    key={`${mask.badgeId}-cover-${index}`}
                    d={path}
                    fill="black"
                  />
                ))}
              </mask>
            ))}
          </defs>
        ) : null}
        {bindingBadgeRows.map((row) => {
            const layout = horizontalSelectionBadgeLayout({
              ordinal: row.ordinal,
              bindings: row.bindings,
              scale: row.ordinal.scale,
            });
            const previewMotionActive =
              previewMotion?.imageIds.has(row.imageId) ?? false;
            const previewMotionStyle = folderPreviewAttachmentStyle(
              previewMotion, row.imageId, { left: 0, top: 0 },
            );
            const badgeOcclusionMask = selectionOcclusionMasks.get(row.regionId);
            return (
              <g
                key={row.regionId}
                className={`selection-canvas-overlay__badge-group${
                  previewMotionActive ? " is-preview-motion" : ""
                }`}
                style={previewMotionStyle}
                {...folderPreviewAttachmentAttributes(previewMotion, row.imageId)}
                data-region-id={row.regionId}
                aria-label={layout.segments.map((segment) => segment.text).join("｜")}
                mask={
                  badgeOcclusionMask
                    ? `url(#${badgeOcclusionMask.badgeId})`
                    : undefined
                }
              >
                <rect
                  className={`selection-canvas-overlay__badge-group-surface ${
                    row.highlighted ? "is-description-linked" : ""
                  }`}
                  x={layout.left}
                  y={layout.top}
                  width={layout.width}
                  height={layout.height}
                  rx={
                    SELECTION_BADGE_VISUALS.descriptionRadius * layout.scale
                  }
                  aria-hidden="true"
                />
                {layout.separatorXs.map((x) => (
                  <circle
                    className="selection-canvas-overlay__badge-group-dot"
                    key={`${row.regionId}-separator-${x}`}
                    cx={x}
                    cy={layout.centerY}
                    r={1.25 * layout.scale}
                    aria-hidden="true"
                  />
                ))}
                {layout.segments.map((segment) => {
                  const isRegion = segment.kind === "region";
                  const isCurrent =
                    !isRegion && segment.id === activeDescriptionId;
                  const activate = () => {
                    if (readOnly || interactionDisabled || creationTool) return;
                    if (isRegion) {
                      selectRegionFromBadge(row.regionId);
                    } else {
                      onActivateDescription?.(segment.id);
                    }
                  };
                  const segmentClass = isRegion
                    ? `selection-canvas-overlay__ordinal-badge is-region ${
                        row.selected ? "is-selected" : ""
                      } ${row.highlighted ? "is-description-linked" : ""} ${
                        row.dragging ? "is-dragging" : ""
                      }`
                    : "selection-canvas-overlay__description-badge is-description";
                  return (
                    <g
                      className={`${segmentClass} ${
                        isCurrent ? "is-current" : ""
                      }`}
                      data-description-id={isRegion ? undefined : segment.id}
                      data-selection-segment={isRegion ? "region" : "description"}
                      key={`${row.regionId}-${segment.kind}-${segment.id}`}
                      role="button"
                      tabIndex={readOnly || interactionDisabled || creationTool ? -1 : 0}
                      aria-label={
                        isRegion
                          ? `选择${segment.text}`
                          : `切换到${segment.text}`
                      }
                      onPointerDown={stopBindingPointer}
                      onPointerUp={stopBindingPointer}
                      onPointerCancel={stopBindingPointer}
                      onKeyDown={(event) =>
                        activateBadgeOnKeyDown(event, activate)
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        activate();
                      }}
                    >
                      <rect
                        x={segment.left}
                        y={segment.top}
                        width={segment.width}
                        height={segment.height}
                        rx={
                          SELECTION_BADGE_VISUALS.descriptionRadius *
                          layout.scale
                        }
                      />
                      <text
                        x={segment.centerX}
                        y={segment.centerY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontSize:
                            SELECTION_BADGE_VISUALS.fontSize * layout.scale,
                        }}
                      >
                        {segment.text}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
      </svg>
    </div>
  );
};

export type { SelectionCanvasOverlayProps };
