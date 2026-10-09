import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { localPointToScene, scenePointToLocal } from "../domain/geometry";
import type {
  Bounds,
  Point,
  QuickAnnotationRecord,
} from "../domain/types";
import type { SelectionCanvasViewport } from "./SelectionCanvasOverlay";
import { folderPreviewAttachmentAttributes, folderPreviewAttachmentStyle } from "./folderPreviewAttachment";
import { resizeQuickAnnotationBounds, withQuickAnnotationBounds } from "./quickAnnotations";
import { quickAnnotationPreviewLabelFits } from "./quickAnnotationPreview";
import { resolveQuickAnnotationConnector, type ConnectorSide } from "./quickAnnotationConnector";

type ImageElement = ExcalidrawElement & { type: "image" };

interface QuickAnnotationOverlayProps {
  elements: readonly ExcalidrawElement[];
  annotations: readonly QuickAnnotationRecord[];
  active: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  nextOrdinal: number;
  selectedId: string | null;
  viewport: SelectionCanvasViewport;
  previewMotion?: Readonly<{
    sourceRect: Readonly<{ left: number; top: number }>;
    imageIds: ReadonlySet<string>;
    targets?: ReadonlyMap<string, Readonly<{ left: number; top: number; width: number; height: number }>>;
  }> | null;
  onCreate: (
    input: { labelAnchor?: Point; labelSide?: "left" | "right" } & (
      | { imageId: string; mode: "point"; anchor: Point; text: string }
      | { imageId: string; mode: "rectangle"; anchor: Point; rectangle: Bounds; text: string }),
  ) => void;
  onSelect: (annotationId: string | null) => void;
  onSetCollapsed: (annotationId: string, collapsed: boolean) => void;
  onSetText: (annotationId: string, text: string) => void;
  onMove: (annotationId: string, delta: Point, labelAnchor: Point, labelSide: "left" | "right") => void;
  onMoveLabel: (annotationId: string, labelAnchor: Point, labelSide: "left" | "right") => void;
  onResize: (annotationId: string, rectangle: Bounds, labelAnchor: Point, labelSide: "left" | "right") => void;
}

interface CreationDrag {
  pointerId: number;
  imageId: string;
  startClient: Point;
  startLocal: Point;
  currentLocal: Point;
}

interface PendingInput {
  imageId: string;
  mode: "point" | "rectangle";
  anchor: Point;
  rectangle?: Bounds;
}

interface MoveDrag {
  pointerId: number;
  annotationId: string;
  imageId: string;
  startLocal: Point;
  currentLocal: Point;
  labelAnchor: Point;
  labelSide: "left" | "right";
}

interface LabelMoveDrag {
  pointerId: number;
  annotationId: string;
  imageId: string;
  startClient: Point;
  startPointerLocal: Point;
  startLabelLocal: Point;
  currentLabelLocal: Point;
  labelSide: "left" | "right";
}

interface ResizeDrag {
  pointerId: number;
  annotation: QuickAnnotationRecord;
  corner: number;
  segmentBounds: Bounds;
  currentBounds: Bounds;
  start: Point;
  proportional: boolean;
  labelAnchor: Point;
  labelSide: "left" | "right";
  target: SVGElement;
  currentPointer: Point;
}

const defaultLabelOffset = (
  mode: "point" | "rectangle",
  anchor: Point,
  rectangle?: Bounds,
  panelX = 0,
): Point => {
  const x = panelX > 400 ? -80 : 80;
  if (mode !== "rectangle" || !rectangle) return { x, y: -53 };
  return {
    x,
    y: Math.abs(anchor.y - rectangle.y) < 1e-9 ? -53 : 27,
  };
};

const connectorPath = (anchor: Point, label: Point): string => {
  const target = { x: label.x, y: label.y + 13 };
  const direction = Math.sign(target.x - anchor.x) || 1;
  const span = Math.abs(target.x - anchor.x);
  return `M ${anchor.x} ${anchor.y} C ${anchor.x + direction * span * 0.55} ${anchor.y}, ${target.x - direction * span * 0.55} ${target.y}, ${target.x} ${target.y}`;
};

const coordinateState = (viewport: SelectionCanvasViewport) => ({
  zoom: { value: viewport.zoom } as AppState["zoom"],
  offsetLeft: viewport.offsetLeft,
  offsetTop: viewport.offsetTop,
  scrollX: viewport.scrollX,
  scrollY: viewport.scrollY,
});

const imageTransform = (image: ImageElement) => ({
  x: image.x,
  y: image.y,
  width: image.width,
  height: image.height,
  angle: image.angle,
  scaleX: image.scale?.[0],
  scaleY: image.scale?.[1],
});

const sceneToPanel = (
  point: Point,
  viewport: SelectionCanvasViewport,
  bounds: Readonly<{ left: number; top: number }>,
): Point => {
  const viewportPoint = sceneCoordsToViewportCoords(
    { sceneX: point.x, sceneY: point.y },
    coordinateState(viewport),
  );
  return { x: viewportPoint.x - bounds.left, y: viewportPoint.y - bounds.top };
};

const normalizedToScene = (point: Point, image: ImageElement): Point =>
  localPointToScene(
    { x: point.x * image.width, y: point.y * image.height },
    imageTransform(image),
  );

const localToNormalized = (point: Point, image: ImageElement): Point => ({
  x: Math.min(1, Math.max(0, point.x / image.width)),
  y: Math.min(1, Math.max(0, point.y / image.height)),
});

const clampLocal = (point: Point, image: ImageElement): Point => ({
  x: Math.min(image.width, Math.max(0, point.x)),
  y: Math.min(image.height, Math.max(0, point.y)),
});

const insideImage = (point: Point, image: ImageElement): boolean => {
  const local = scenePointToLocal(point, imageTransform(image));
  return (
    local.x >= 0 &&
    local.x <= image.width &&
    local.y >= 0 &&
    local.y <= image.height
  );
};

const rectangleFromLocals = (
  start: Point,
  end: Point,
  image: ImageElement,
): Bounds => {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return {
    x: left / image.width,
    y: top / image.height,
    width: (right - left) / image.width,
    height: (bottom - top) / image.height,
  };
};

const translatedAnnotation = (
  annotation: QuickAnnotationRecord,
  delta: Point,
): QuickAnnotationRecord => {
  if (annotation.mode === "point") {
    return {
      ...annotation,
      anchor: {
        x: Math.min(1, Math.max(0, annotation.anchor.x + delta.x)),
        y: Math.min(1, Math.max(0, annotation.anchor.y + delta.y)),
      },
    };
  }
  const rectangle = annotation.rectangle!;
  const x = Math.min(Math.max(0, rectangle.x + delta.x), 1 - rectangle.width);
  const y = Math.min(Math.max(0, rectangle.y + delta.y), 1 - rectangle.height);
  return {
    ...annotation,
    anchor: {
      x: annotation.anchor.x + (x - rectangle.x),
      y: annotation.anchor.y + (y - rectangle.y),
    },
    rectangle: { ...rectangle, x, y },
  };
};

export const QuickAnnotationOverlay = ({
  elements,
  annotations,
  active,
  readOnly = false,
  disabled = false,
  nextOrdinal,
  selectedId,
  viewport,
  previewMotion = null,
  onCreate,
  onSelect,
  onSetCollapsed,
  onSetText,
  onMove,
  onMoveLabel,
  onResize,
}: QuickAnnotationOverlayProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const labelElementsRef = useRef(new Map<string, HTMLDivElement>());
  const [connectorLayouts, setConnectorLayouts] = useState<ReadonlyMap<string, {
    side: ConnectorSide; path: string;
  }>>(new Map());
  const [, refreshLabelSizes] = useState(0);
  const [overflowingPreviewLabels, setOverflowingPreviewLabels] = useState<ReadonlySet<string>>(new Set());
  const creationRef = useRef<CreationDrag | null>(null);
  const moveRef = useRef<MoveDrag | null>(null);
  const labelMoveRef = useRef<LabelMoveDrag | null>(null);
  const resizeRef = useRef<ResizeDrag | null>(null);
  const [resizePreview, setResizePreview] = useState<QuickAnnotationRecord | null>(null);
  useEffect(() => {
    const onResizeKey = (event: KeyboardEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        resizeRef.current = null;
        setResizePreview(null);
        if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
      } else if (event.key === "Shift") {
        drag.segmentBounds = drag.currentBounds;
        drag.start = drag.currentPointer;
        drag.proportional = event.type === "keydown";
      }
    };
    window.addEventListener("keydown", onResizeKey, true);
    window.addEventListener("keyup", onResizeKey, true);
    return () => {
      window.removeEventListener("keydown", onResizeKey, true);
      window.removeEventListener("keyup", onResizeKey, true);
    };
  }, []);
  const suppressBadgeClickRef = useRef(false);
  const committedInputRef = useRef(false);
  const [panelBounds, setPanelBounds] = useState({ left: 0, top: 0 });
  const [creationDraft, setCreationDraft] = useState<CreationDrag | null>(null);
  const [pendingInput, setPendingInput] = useState<PendingInput | null>(null);
  const [inputText, setInputText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movePreview, setMovePreview] = useState<{
    annotationId: string;
    delta: Point;
    labelAnchor: Point;
    labelSide: "left" | "right";
  } | null>(null);
  const [labelPreview, setLabelPreview] = useState<{
    annotationId: string;
    labelAnchor: Point;
    labelSide: "left" | "right";
  } | null>(null);
  const [cursorPreview, setCursorPreview] = useState<{
    point: Point;
    overImage: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (!readOnly && !disabled) return;
    const root = rootRef.current;
    const pointerIds = [creationRef.current?.pointerId, moveRef.current?.pointerId,
      labelMoveRef.current?.pointerId, resizeRef.current?.pointerId];
    root?.querySelectorAll<Element>("*").forEach((element) => {
      pointerIds.forEach((id) => {
        if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
      });
    });
    creationRef.current = null;
    moveRef.current = null;
    labelMoveRef.current = null;
    resizeRef.current = null;
    setCreationDraft(null);
    setPendingInput(null);
    setEditingId(null);
    setInputText("");
    setCursorPreview(null);
    setMovePreview(null);
    setLabelPreview(null);
    setResizePreview(null);
  }, [readOnly, disabled]);

  const images = useMemo(
    () =>
      elements.filter(
        (element): element is ImageElement =>
          !element.isDeleted &&
          element.type === "image" &&
          typeof element.customData?.imageId === "string",
      ),
    [elements],
  );
  const imageById = useMemo(
    () =>
      new Map(
        images.map((image) => [image.customData!.imageId as string, image]),
      ),
    [images],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const rect = root.getBoundingClientRect();
      setPanelBounds({ left: rect.left, top: rect.top });
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
    if (active) return;
    creationRef.current = null;
    setCreationDraft(null);
    setPendingInput(null);
    setEditingId(null);
    setInputText("");
    setCursorPreview(null);
  }, [active]);

  const pointerToScene = (event: ReactPointerEvent<SVGSVGElement>): Point =>
    viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      coordinateState(viewport),
    );

  const resolveLabelLayout = (
    annotation: Pick<QuickAnnotationRecord, "anchor" | "mode" | "rectangle" | "labelAnchor" | "labelSide">,
    image: ImageElement,
  ) => {
    const anchor = sceneToPanel(normalizedToScene(annotation.anchor, image), viewport, panelBounds);
    const offset = defaultLabelOffset(annotation.mode, annotation.anchor, annotation.rectangle, anchor.x);
    const panel = annotation.labelAnchor
      ? sceneToPanel(normalizedToScene(annotation.labelAnchor, image), viewport, panelBounds)
      : { x: anchor.x + offset.x, y: anchor.y + offset.y };
    const scene = viewportCoordsToSceneCoords(
      { clientX: panel.x + panelBounds.left, clientY: panel.y + panelBounds.top }, coordinateState(viewport),
    );
    const local = scenePointToLocal(scene, imageTransform(image));
    return {
      panel,
      normalized: { x: local.x / image.width, y: local.y / image.height },
      side: annotation.labelSide ?? (panel.x < anchor.x ? "left" as const : "right" as const),
    };
  };

  useLayoutEffect(() => {
    if (!readOnly) {
      setOverflowingPreviewLabels((current) => current.size ? new Set() : current);
      return;
    }
    const measure = () => {
      const next = new Set<string>();
      annotations.forEach((annotation) => {
        const image = imageById.get(annotation.imageId);
        const label = labelElementsRef.current.get(annotation.id);
        if (!image || !label) return;
        const layout = resolveLabelLayout(annotation, image);
        const scene = normalizedToScene(layout.normalized, image);
        if (!quickAnnotationPreviewLabelFits(imageTransform(image), scene, layout.side,
          label.offsetWidth, label.offsetHeight, viewport.zoom)) next.add(annotation.id);
      });
      setOverflowingPreviewLabels((current) => current.size === next.size &&
        [...current].every((id) => next.has(id)) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    labelElementsRef.current.forEach((label) => observer.observe(label));
    return () => observer.disconnect();
  }, [readOnly, annotations, imageById, viewport, panelBounds]);

  const submitInput = () => {
    if (readOnly || disabled) return;
    if (committedInputRef.current) return;
    const text = inputText.trim();
    if (!text) {
      setPendingInput(null);
      setEditingId(null);
      setInputText("");
      return;
    }
    committedInputRef.current = true;
    if (editingId) {
      onSetText(editingId, text);
    } else if (pendingInput) {
      const image = imageById.get(pendingInput.imageId);
      if (!image) return;
      const initialLayout = resolveLabelLayout(pendingInput, image);
      const labelPlacement = { labelAnchor: initialLayout.normalized, labelSide: initialLayout.side };
      onCreate(
        pendingInput.mode === "point"
          ? {
              imageId: pendingInput.imageId,
              mode: "point",
              anchor: pendingInput.anchor,
              text,
              ...labelPlacement,
            }
          : {
              imageId: pendingInput.imageId,
              mode: "rectangle",
              anchor: pendingInput.anchor,
              rectangle: pendingInput.rectangle!,
              text,
              ...labelPlacement,
            },
      );
    }
    setPendingInput(null);
    setEditingId(null);
    setInputText("");
    queueMicrotask(() => {
      committedInputRef.current = false;
    });
  };

  const handleCreationPointerDown = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (readOnly || !active || disabled || pendingInput || editingId) return;
    const scene = pointerToScene(event);
    const image = [...images].reverse().find((candidate) => insideImage(scene, candidate));
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(null);
    const local = clampLocal(
      scenePointToLocal(scene, imageTransform(image)),
      image,
    );
    const draft: CreationDrag = {
      pointerId: event.pointerId,
      imageId: image.customData!.imageId as string,
      startClient: { x: event.clientX, y: event.clientY },
      startLocal: local,
      currentLocal: local,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    creationRef.current = draft;
    setCreationDraft(draft);
  };

  const handleCreationPointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (readOnly || disabled) return;
    const draft = creationRef.current;
    if (!draft || draft.pointerId !== event.pointerId) {
      if (active && !pendingInput && !editingId) {
        const scene = pointerToScene(event);
        setCursorPreview({
          point: {
            x: event.clientX - panelBounds.left,
            y: event.clientY - panelBounds.top,
          },
          overImage: images.some((candidate) => insideImage(scene, candidate)),
        });
      }
      return;
    }
    const image = imageById.get(draft.imageId);
    if (!image) return;
    const local = clampLocal(
      scenePointToLocal(pointerToScene(event), imageTransform(image)),
      image,
    );
    const next = { ...draft, currentLocal: local };
    creationRef.current = next;
    setCreationDraft(next);
  };

  const finishCreation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || disabled) return;
    const draft = creationRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    const image = imageById.get(draft.imageId);
    creationRef.current = null;
    setCreationDraft(null);
    setCursorPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!image) return;
    const distance = Math.hypot(
      event.clientX - draft.startClient.x,
      event.clientY - draft.startClient.y,
    );
    committedInputRef.current = false;
    setInputText("");
    if (distance < 4) {
      setPendingInput({
        imageId: draft.imageId,
        mode: "point",
        anchor: localToNormalized(draft.startLocal, image),
      });
      return;
    }
    const rectangle = rectangleFromLocals(
      draft.startLocal,
      draft.currentLocal,
      image,
    );
    if (rectangle.width <= 0 || rectangle.height <= 0) return;
    setPendingInput({
      imageId: draft.imageId,
      mode: "rectangle",
      anchor: localToNormalized(draft.startLocal, image),
      rectangle,
    });
  };

  const cancelCreation = (event: ReactPointerEvent<SVGSVGElement>) => {
    const draft = creationRef.current;
    if (!draft || draft.pointerId !== event.pointerId) return;
    creationRef.current = null;
    setCreationDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startMove = (
    event: ReactPointerEvent<SVGElement>,
    annotation: QuickAnnotationRecord,
  ) => {
    if (readOnly || disabled) return;
    const image = imageById.get(annotation.imageId);
    if (!image) return;
    setCursorPreview(null);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scene = viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      coordinateState(viewport),
    );
    const local = scenePointToLocal(scene, imageTransform(image));
    const layout = resolveLabelLayout(annotation, image);
    moveRef.current = {
      pointerId: event.pointerId,
      annotationId: annotation.id,
      imageId: annotation.imageId,
      startLocal: local,
      currentLocal: local,
      labelAnchor: layout.normalized,
      labelSide: layout.side,
    };
    setMovePreview({ annotationId: annotation.id, delta: { x: 0, y: 0 }, labelAnchor: layout.normalized, labelSide: layout.side });
    onSelect(annotation.id);
  };

  const updateMove = (event: ReactPointerEvent<SVGElement>) => {
    if (readOnly || disabled) return;
    const drag = moveRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const image = imageById.get(drag.imageId);
    if (!image) return;
    const scene = viewportCoordsToSceneCoords(
      { clientX: event.clientX, clientY: event.clientY },
      coordinateState(viewport),
    );
    const local = scenePointToLocal(scene, imageTransform(image));
    drag.currentLocal = local;
    setMovePreview({
      annotationId: drag.annotationId,
      labelAnchor: drag.labelAnchor,
      labelSide: drag.labelSide,
      delta: {
        x: (local.x - drag.startLocal.x) / image.width,
        y: (local.y - drag.startLocal.y) / image.height,
      },
    });
  };

  const finishMove = (event: ReactPointerEvent<SVGElement>) => {
    if (readOnly || disabled) return;
    const drag = moveRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const image = imageById.get(drag.imageId);
    moveRef.current = null;
    setMovePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!image) return;
    const delta = {
      x: (drag.currentLocal.x - drag.startLocal.x) / image.width,
      y: (drag.currentLocal.y - drag.startLocal.y) / image.height,
    };
    if (delta.x !== 0 || delta.y !== 0) {
      onMove(drag.annotationId, delta, drag.labelAnchor, drag.labelSide);
    }
  };

  const cancelMove = (event: ReactPointerEvent<SVGElement>) => {
    const drag = moveRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    moveRef.current = null;
    setMovePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const moveLabel = (event: ReactPointerEvent<HTMLButtonElement>, annotation: QuickAnnotationRecord) => {
    if (readOnly || disabled) return;
    const image = imageById.get(annotation.imageId);
    if (!image) return;
    setCursorPreview(null);
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scene = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, coordinateState(viewport));
    const startPointerLocal = scenePointToLocal(scene, imageTransform(image));
    const anchorPanel = sceneToPanel(normalizedToScene(annotation.anchor, image), viewport, panelBounds);
    const offset = defaultLabelOffset(annotation.mode, annotation.anchor, annotation.rectangle, anchorPanel.x);
    const labelPanel = annotation.labelAnchor
      ? sceneToPanel(normalizedToScene(annotation.labelAnchor, image), viewport, panelBounds)
      : { x: anchorPanel.x + offset.x, y: anchorPanel.y + offset.y };
    const labelScene = viewportCoordsToSceneCoords(
      { clientX: labelPanel.x + panelBounds.left, clientY: labelPanel.y + panelBounds.top },
      coordinateState(viewport),
    );
    const startLabelLocal = scenePointToLocal(labelScene, imageTransform(image));
    const labelSide = resolveLabelLayout(annotation, image).side;
    labelMoveRef.current = {
      pointerId: event.pointerId,
      annotationId: annotation.id,
      imageId: annotation.imageId,
      startClient: { x: event.clientX, y: event.clientY },
      startPointerLocal,
      startLabelLocal,
      currentLabelLocal: startLabelLocal,
      labelSide,
    };
    onSelect(annotation.id);
  };

  const moveLabelUpdate = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnly || disabled) return;
    const drag = labelMoveRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const image = imageById.get(drag.imageId);
    if (!image) return;
    const scene = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, coordinateState(viewport));
    const pointerLocal = scenePointToLocal(scene, imageTransform(image));
    drag.currentLabelLocal = {
      x: drag.startLabelLocal.x + pointerLocal.x - drag.startPointerLocal.x,
      y: drag.startLabelLocal.y + pointerLocal.y - drag.startPointerLocal.y,
    };
    setLabelPreview({
      annotationId: drag.annotationId,
      labelSide: drag.labelSide,
      labelAnchor: {
        x: drag.currentLabelLocal.x / image.width,
        y: drag.currentLabelLocal.y / image.height,
      },
    });
  };

  const moveLabelFinish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnly || disabled) return;
    const drag = labelMoveRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const image = imageById.get(drag.imageId);
    labelMoveRef.current = null;
    setLabelPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (image && Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) >= 3) {
      suppressBadgeClickRef.current = true;
      onMoveLabel(drag.annotationId, {
        x: drag.currentLabelLocal.x / image.width,
        y: drag.currentLabelLocal.y / image.height,
      }, drag.labelSide);
    }
  };

  const cancelLabelMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (labelMoveRef.current?.pointerId !== event.pointerId) return;
    labelMoveRef.current = null;
    setLabelPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const resizePointer = (event: ReactPointerEvent<SVGElement>, image: ImageElement): Point => {
    const scene = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, coordinateState(viewport));
    const local = scenePointToLocal(scene, imageTransform(image));
    return { x: local.x / image.width, y: local.y / image.height };
  };

  const startResize = (event: ReactPointerEvent<SVGElement>, annotation: QuickAnnotationRecord, corner: number) => {
    if (readOnly || disabled) return;
    const image = imageById.get(annotation.imageId);
    if (!image || !annotation.rectangle || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    const layout = resolveLabelLayout(annotation, image);
    resizeRef.current = {
      pointerId: event.pointerId, annotation, corner,
      segmentBounds: annotation.rectangle, currentBounds: annotation.rectangle,
      start: resizePointer(event, image), proportional: event.shiftKey,
      labelAnchor: layout.normalized, labelSide: layout.side,
      target: event.currentTarget, currentPointer: resizePointer(event, image),
    };
    setCursorPreview(null);
    setResizePreview({ ...annotation, labelAnchor: layout.normalized, labelSide: layout.side });
    onSelect(annotation.id);
  };

  const updateResize = (event: ReactPointerEvent<SVGElement>) => {
    if (readOnly || disabled) return;
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const image = imageById.get(drag.annotation.imageId);
    if (!image) return;
    const pointer = resizePointer(event, image);
    if (drag.proportional !== event.shiftKey) {
      drag.segmentBounds = drag.currentBounds;
      drag.start = pointer;
      drag.proportional = event.shiftKey;
    }
    drag.currentPointer = pointer;
    drag.currentBounds = resizeQuickAnnotationBounds(
      drag.segmentBounds, drag.corner,
      { x: pointer.x - drag.start.x, y: pointer.y - drag.start.y }, drag.proportional,
      { x: 4 / (image.width * viewport.zoom), y: 4 / (image.height * viewport.zoom) },
    );
    setResizePreview(withQuickAnnotationBounds({ ...drag.annotation, labelAnchor: drag.labelAnchor, labelSide: drag.labelSide }, drag.currentBounds));
  };

  const finishResize = (event: ReactPointerEvent<SVGElement>) => {
    if (readOnly || disabled) return;
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateResize(event);
    resizeRef.current = null;
    setResizePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const previous = drag.annotation.rectangle!;
    if (Math.abs(previous.x - drag.currentBounds.x) + Math.abs(previous.y - drag.currentBounds.y) +
        Math.abs(previous.width - drag.currentBounds.width) + Math.abs(previous.height - drag.currentBounds.height) > 1e-10) {
      onResize(drag.annotation.id, drag.currentBounds, drag.labelAnchor, drag.labelSide);
    }
  };

  const cancelResize = (event: ReactPointerEvent<SVGElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    resizeRef.current = null;
    setResizePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const renderedAnnotations = annotations.flatMap((annotation) => {
    const image = imageById.get(annotation.imageId);
    if (!image || !annotation.active) return [];
    if (resizePreview?.id === annotation.id) return [[resizePreview, image] as const];
    const previewDelta =
      movePreview?.annotationId === annotation.id
        ? movePreview.delta
        : { x: 0, y: 0 };
    const translated = translatedAnnotation(
      movePreview?.annotationId === annotation.id
        ? { ...annotation, labelAnchor: movePreview.labelAnchor, labelSide: movePreview.labelSide }
        : annotation,
      previewDelta,
    );
    return [[
      labelPreview?.annotationId === annotation.id
        ? { ...translated, labelAnchor: labelPreview.labelAnchor, labelSide: labelPreview.labelSide }
        : translated,
      image,
    ] as const];
  });

  // Measure after layout and update the connector before paint. Stored labelSide
  // remains the text alignment reference, independent from the visible line end.
  useLayoutEffect(() => {
    const next = new Map<string, { side: ConnectorSide; path: string }>();
    if (!readOnly) renderedAnnotations.forEach(([annotation, image]) => {
      const element = labelElementsRef.current.get(annotation.id);
      if (!element || element.offsetWidth === 0) return;
      const layout = resolveLabelLayout(annotation, image);
      const anchor = sceneToPanel(normalizedToScene(annotation.anchor, image), viewport, panelBounds);
      next.set(annotation.id, resolveQuickAnnotationConnector(anchor, {
        x: layout.panel.x - (layout.side === "left" ? element.offsetWidth : 0),
        y: layout.panel.y,
        width: element.offsetWidth,
        height: element.offsetHeight,
      }, connectorLayouts.get(annotation.id)?.side));
    });
    if (next.size !== connectorLayouts.size || [...next].some(([id, layout]) => {
      const previous = connectorLayouts.get(id);
      return previous?.side !== layout.side || previous?.path !== layout.path;
    })) setConnectorLayouts(next);
  });

  useLayoutEffect(() => {
    if (readOnly) return;
    const observer = new ResizeObserver(() => refreshLabelSizes((revision) => revision + 1));
    labelElementsRef.current.forEach((label) => observer.observe(label));
    return () => observer.disconnect();
  }, [annotations, readOnly]);

  const previewMotionStyleFor = (imageId: string, image: ImageElement) => {
    if (!previewMotion?.imageIds.has(imageId)) return undefined;
    const point = sceneToPanel({ x: image.x, y: image.y }, viewport, panelBounds);
    return folderPreviewAttachmentStyle(previewMotion, imageId, { left: point.x, top: point.y });
  };

  const previewLabelIsInsideImage = (annotation: QuickAnnotationRecord, image: ImageElement) => {
    const label = resolveLabelLayout(annotation, image).normalized;
    return Boolean(
      label &&
        !overflowingPreviewLabels.has(annotation.id) &&
        label.x >= 0 &&
        label.x <= 1 &&
        label.y >= 0 &&
        label.y <= 1,
    );
  };

  const pendingImage = pendingInput
    ? imageById.get(pendingInput.imageId) ?? null
    : null;
  const pendingPanelPoint = pendingInput && pendingImage
    ? sceneToPanel(
        normalizedToScene(pendingInput.anchor, pendingImage),
        viewport,
        panelBounds,
      )
    : null;
  const draftBadgePoint = creationDraft
    ? (() => {
        const image = imageById.get(creationDraft.imageId);
        if (!image) return null;
        return sceneToPanel(
          normalizedToScene(
            localToNormalized(creationDraft.startLocal, image),
            image,
          ),
          viewport,
          panelBounds,
        );
      })()
    : null;
  const draftLabelOffset = creationDraft
    ? (() => {
        const image = imageById.get(creationDraft.imageId);
        if (!image) return { x: 80, y: -53 };
        const rectangle = rectangleFromLocals(creationDraft.startLocal, creationDraft.currentLocal, image);
        return defaultLabelOffset(
          "rectangle",
          localToNormalized(creationDraft.startLocal, image),
          rectangle,
          draftBadgePoint?.x,
        );
      })()
    : { x: 80, y: -53 };
  const pendingLabelOffset = pendingInput
    ? defaultLabelOffset(pendingInput.mode, pendingInput.anchor, pendingInput.rectangle, pendingPanelPoint?.x)
    : { x: 80, y: -53 };
  const pendingLabelPoint = pendingPanelPoint
    ? { x: pendingPanelPoint.x + pendingLabelOffset.x, y: pendingPanelPoint.y + pendingLabelOffset.y }
    : null;
  const pendingRectangle = pendingInput?.mode === "rectangle"
    ? pendingInput.rectangle
    : null;
  const pendingRectangleCorners = pendingRectangle && pendingImage
    ? [
        { x: pendingRectangle.x, y: pendingRectangle.y },
        { x: pendingRectangle.x + pendingRectangle.width, y: pendingRectangle.y },
        { x: pendingRectangle.x + pendingRectangle.width, y: pendingRectangle.y + pendingRectangle.height },
        { x: pendingRectangle.x, y: pendingRectangle.y + pendingRectangle.height },
      ].map((point) =>
        sceneToPanel(normalizedToScene(point, pendingImage), viewport, panelBounds),
      )
    : null;

  // Stable keyed wrappers retain capture and editing nodes while only z-index changes.
  const renderAnnotationRange = (entry: (typeof renderedAnnotations)[number]) => {
    const rangeAnnotations = [entry];
    return (<>
        {rangeAnnotations.map(([annotation, image]) => {
          if (readOnly) return null;
          const anchor = sceneToPanel(
            normalizedToScene(annotation.anchor, image),
            viewport,
            panelBounds,
          );
          const offset = defaultLabelOffset(annotation.mode, annotation.anchor, annotation.rectangle, anchor.x);
          const labelPoint = annotation.labelAnchor
            ? sceneToPanel(normalizedToScene(annotation.labelAnchor, image), viewport, panelBounds)
            : { x: anchor.x + offset.x, y: anchor.y + offset.y };
          return (
            <path
              key={`connector-${annotation.id}`}
              className={`quick-annotation-overlay__connector${previewMotion?.imageIds.has(annotation.imageId) ? " quick-annotation-preview-motion" : ""}`}
              style={previewMotionStyleFor(annotation.imageId, image)}
              {...folderPreviewAttachmentAttributes(previewMotion, annotation.imageId)}
              d={connectorLayouts.get(annotation.id)?.path ?? connectorPath(anchor, labelPoint)}
            />
          );
        })}
        {rangeAnnotations.map(([annotation, image]) => {
          const anchor = sceneToPanel(normalizedToScene(annotation.anchor, image), viewport, panelBounds);
          return (
            <g key={`anchor-${annotation.id}`}
              className={previewMotion?.imageIds.has(annotation.imageId) ? "quick-annotation-preview-motion" : undefined}
              style={previewMotionStyleFor(annotation.imageId, image)}
              {...folderPreviewAttachmentAttributes(previewMotion, annotation.imageId)}>
              {!readOnly && annotation.mode === "point" ? (
                <g className="quick-annotation-overlay__anchor-target" aria-hidden="true">
                  <circle cx={anchor.x} cy={anchor.y} r="5" />
                </g>
              ) : null}
              {!readOnly ? (
                <circle className="quick-annotation-overlay__anchor" cx={anchor.x} cy={anchor.y} r={annotation.mode === "point" ? 2 : 3} />
              ) : null}
              {annotation.mode === "point" && !readOnly ? (
                <circle className="quick-annotation-overlay__point-hit" cx={anchor.x} cy={anchor.y} r="9"
                  aria-label={`移动快速标注 Q${annotation.ordinal} 定位点`}
                  onPointerDown={(event) => startMove(event, annotation)}
                  onPointerMove={updateMove} onPointerUp={finishMove} onPointerCancel={cancelMove} />
              ) : null}
            </g>
          );
        })}
        {rangeAnnotations.map(([annotation, image]) => {
          if (annotation.mode !== "rectangle" || !annotation.rectangle) return null;
          const rectangle = annotation.rectangle;
          const corners = [
            { x: rectangle.x, y: rectangle.y },
            { x: rectangle.x + rectangle.width, y: rectangle.y },
            { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
            { x: rectangle.x, y: rectangle.y + rectangle.height },
          ].map((point) =>
            sceneToPanel(normalizedToScene(point, image), viewport, panelBounds),
          );
          const outline = `${corners.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")} Z`;
          return (
            <g key={`rect-${annotation.id}`}
              className={previewMotion?.imageIds.has(annotation.imageId) ? "quick-annotation-preview-motion" : undefined}
              style={previewMotionStyleFor(annotation.imageId, image)}
              {...folderPreviewAttachmentAttributes(previewMotion, annotation.imageId)}>
            <path
              className={`quick-annotation-overlay__rectangle${!readOnly && selectedId === annotation.id ? " is-selected" : ""}`}
              d={outline}
            />
            {!readOnly && <>
            <path className="quick-annotation-overlay__range-hit" d={outline}
              aria-label={`移动快速标注 Q${annotation.ordinal} 矩形范围`}
              onPointerDown={(event) => startMove(event, annotation)}
              onPointerMove={updateMove} onPointerUp={finishMove} onPointerCancel={cancelMove} />
              <path className="quick-annotation-overlay__interior-hit" d={outline}
                aria-label={`移动快速标注 Q${annotation.ordinal} 内部范围`}
                onPointerDown={(event) => {
                  if (readOnly || disabled) return;
                  if (selectedId === annotation.id) {
                    startMove(event, annotation);
                  } else {
                    event.preventDefault();
                    event.stopPropagation();
                    setCursorPreview(null);
                    onSelect(annotation.id);
                  }
                }}
                onPointerMove={updateMove} onPointerUp={finishMove} onPointerCancel={cancelMove} />
            {corners.map((corner, index) => {
              const shortArm = (other: Point) => {
                const length = Math.hypot(other.x - corner.x, other.y - corner.y);
                const scale = length > 0 ? Math.min(16, 12 * viewport.zoom) / length : 0;
                return { x: corner.x + (other.x - corner.x) * scale, y: corner.y + (other.y - corner.y) * scale };
              };
              const before = shortArm(corners[(index + 3) % 4]);
              const after = shortArm(corners[(index + 1) % 4]);
              return (
              <g key={index} className="quick-annotation-overlay__corner">
              {selectedId === annotation.id ? <path className="quick-annotation-overlay__corner-hint"
                d={`M ${before.x} ${before.y} L ${corner.x} ${corner.y} L ${after.x} ${after.y}`} /> : null}
              <circle className="quick-annotation-overlay__resize-hit"
                cx={corner.x} cy={corner.y} r="9" tabIndex={-1}
                style={{ cursor: index % 2 === 0 ? "nwse-resize" : "nesw-resize" }}
                aria-label={`缩放快速标注 Q${annotation.ordinal} 角${index + 1}`}
                onPointerDown={(event) => startResize(event, annotation, index)}
                onPointerMove={updateResize} onPointerUp={finishResize} onPointerCancel={cancelResize}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || !resizeRef.current) return;
                  event.preventDefault(); event.stopPropagation();
                  const pointerId = resizeRef.current.pointerId;
                  resizeRef.current = null; setResizePreview(null);
                  if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
                }} />
              </g>
              );
            })}
            </>}
            </g>
          );
        })}
    </>);
  };

  return (
    <div
      ref={rootRef}
      className={`quick-annotation-overlay${active && !readOnly ? " is-creating" : ""}${readOnly ? " is-readonly" : ""}`}
      style={{ "--quick-annotation-corner-scale": viewport.zoom } as CSSProperties}
      data-interaction-disabled={disabled}
      aria-label="快速标注覆盖层"
    >
      <svg
        className="quick-annotation-overlay__svg"
        onPointerDown={handleCreationPointerDown}
        onPointerMove={handleCreationPointerMove}
        onPointerUp={finishCreation}
        onPointerCancel={cancelCreation}
        onPointerLeave={() => {
          if (!creationRef.current) setCursorPreview(null);
        }}
      >
        {(() => {
          const anchor = draftBadgePoint ?? pendingPanelPoint ??
            (cursorPreview?.overImage ? cursorPreview.point : null);
          if (!anchor) return null;
          const offset = draftBadgePoint ? draftLabelOffset : pendingPanelPoint
            ? pendingLabelOffset
            : defaultLabelOffset("point", { x: 0, y: 0 }, undefined, anchor.x);
          const label = { x: anchor.x + offset.x, y: anchor.y + offset.y };
          const showPointTarget = !creationDraft && pendingInput?.mode !== "rectangle";
          return (
            <>
              <path className="quick-annotation-overlay__connector is-preview" d={connectorPath(anchor, label)} />
              {showPointTarget ? (
                <g className="quick-annotation-overlay__anchor-target" aria-hidden="true">
                  <circle cx={anchor.x} cy={anchor.y} r="5" />
                </g>
              ) : null}
              <circle className="quick-annotation-overlay__anchor" cx={anchor.x} cy={anchor.y} r={showPointTarget ? 2 : 3} />
            </>
          );
        })()}
        {creationDraft && (() => {
          const image = imageById.get(creationDraft.imageId);
          if (!image) return null;
          const rectangle = rectangleFromLocals(
            creationDraft.startLocal,
            creationDraft.currentLocal,
            image,
          );
          const corners = [
            { x: rectangle.x, y: rectangle.y },
            { x: rectangle.x + rectangle.width, y: rectangle.y },
            { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
            { x: rectangle.x, y: rectangle.y + rectangle.height },
          ].map((point) =>
            sceneToPanel(normalizedToScene(point, image), viewport, panelBounds),
          );
          return (
            <path
              className="quick-annotation-overlay__draft"
              d={`${corners.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")} Z`}
            />
          );
        })()}
        {pendingRectangleCorners ? (
          <path
            className="quick-annotation-overlay__draft"
            d={`${pendingRectangleCorners.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")} Z`}
          />
        ) : null}

      </svg>

      {renderedAnnotations.map((entry) => (
        <svg key={entry[0].id}
          className={`quick-annotation-overlay__svg quick-annotation-overlay__range-layer${
            !readOnly && !active && !disabled && selectedId === entry[0].id ? " is-active" : ""
          }`}
          data-quick-range-layer={entry[0].id}
          role="presentation">
          {renderAnnotationRange(entry)}
        </svg>
      ))}

      {active && !readOnly && !pendingInput && !editingId && (draftBadgePoint || cursorPreview) ? (
        <div
          className={`quick-annotation-overlay__cursor-badge${
            !creationDraft && cursorPreview && !cursorPreview.overImage
              ? " is-disabled"
              : ""
          }`}
          style={{
            left: (draftBadgePoint ?? cursorPreview!.point).x,
            top: (draftBadgePoint ?? cursorPreview!.point).y,
            transform: (() => {
              const offset = draftBadgePoint
                ? draftLabelOffset
                : defaultLabelOffset("point", { x: 0, y: 0 }, undefined, cursorPreview?.point.x);
              return `translate(${offset.x}px, ${offset.y}px)${offset.x < 0 ? " translateX(-100%)" : ""}`;
            })(),
          }}
          aria-hidden="true"
        >
          Q{nextOrdinal}
        </div>
      ) : null}

        {renderedAnnotations.map(([annotation, image]) => {
          if (readOnly) {
            const point = sceneToPanel(
              normalizedToScene(annotation.anchor, image),
              viewport,
              panelBounds,
            );
            const target = previewMotion?.targets?.get(annotation.imageId);
            const marker = (
              <span
                className="quick-annotation-overlay__preview-marker"
                style={{ left: point.x - 6, top: point.y - 6 }}
                aria-hidden="true"
              />
            );
            if (!target || !previewMotion?.imageIds.has(annotation.imageId)) {
              return <span key={`preview-marker-${annotation.id}`}>{marker}</span>;
            }
            return (
              <span
                key={`preview-marker-${annotation.id}`}
                className="quick-annotation-overlay__preview-marker-motion quick-annotation-preview-motion"
                style={{
                  left: target.left,
                  top: target.top,
                  width: target.width,
                  height: target.height,
                  ...folderPreviewAttachmentStyle(previewMotion, annotation.imageId, target, true),
                } as CSSProperties}
                {...folderPreviewAttachmentAttributes(previewMotion, annotation.imageId)}
                aria-hidden="true"
              >
                <span
                  className="quick-annotation-overlay__preview-marker"
                  style={{
                    left: point.x - target.left - 6,
                    top: point.y - target.top - 6,
                  }}
                  aria-hidden="true"
                />
              </span>
            );
          }
          const hiddenInPreview = readOnly && !previewLabelIsInsideImage(annotation, image);
        const point = sceneToPanel(
          normalizedToScene(annotation.anchor, image),
          viewport,
          panelBounds,
        );
        const offset = defaultLabelOffset(annotation.mode, annotation.anchor, annotation.rectangle, point.x);
        const labelPoint = annotation.labelAnchor
          ? sceneToPanel(normalizedToScene(annotation.labelAnchor, image), viewport, panelBounds)
          : { x: point.x + offset.x, y: point.y + offset.y };
        return (
          <div key={annotation.id}
            className={`quick-annotation-overlay__label-layer${previewMotion?.imageIds.has(annotation.imageId) ? " quick-annotation-preview-motion" : ""}`}
            style={previewMotionStyleFor(annotation.imageId, image)}
              {...folderPreviewAttachmentAttributes(previewMotion, annotation.imageId)}>
          <div
            ref={(element) => {
              if (element) labelElementsRef.current.set(annotation.id, element);
              else labelElementsRef.current.delete(annotation.id);
            }}
            className={`quick-annotation-overlay__item is-${annotation.mode}${!readOnly && selectedId === annotation.id ? " is-selected" : ""}${editingId === annotation.id ? " is-editing" : ""}`}
            style={{ left: labelPoint.x, top: labelPoint.y, visibility: hiddenInPreview ? "hidden" : undefined, transform: resolveLabelLayout(annotation, image).side === "left" ? "translateX(-100%)" : "none" }}
          >
            <button
              type="button"
              className="quick-annotation-overlay__badge"
              disabled={readOnly || disabled}
              aria-label={`快速标注 Q${annotation.ordinal}${annotation.collapsed ? "，展开文本" : "，收拢文本"}`}
              aria-pressed={!annotation.collapsed}
              onPointerDown={(event) => moveLabel(event, annotation)}
              onPointerMove={moveLabelUpdate}
              onPointerUp={moveLabelFinish}
              onPointerCancel={cancelLabelMove}
              onClick={(event) => {
                if (readOnly || disabled) return;
                event.stopPropagation();
                if (suppressBadgeClickRef.current) {
                  suppressBadgeClickRef.current = false;
                  return;
                }
                onSelect(annotation.id);
                onSetCollapsed(annotation.id, !annotation.collapsed);
              }}
            >
              Q{annotation.ordinal}
            </button>
            {!annotation.collapsed ? (
              <div className="quick-annotation-overlay__text-slot">
              <button
                type="button"
                className="quick-annotation-overlay__text"
                disabled={readOnly || disabled || editingId === annotation.id}
                aria-hidden={editingId === annotation.id || undefined}
                onPointerDown={(event) => moveLabel(event, annotation)}
                onPointerMove={moveLabelUpdate}
                onPointerUp={moveLabelFinish}
                onPointerCancel={cancelLabelMove}
                onClick={(event) => {
                  if (readOnly || disabled) return;
                  event.stopPropagation();
                  if (suppressBadgeClickRef.current) {
                    suppressBadgeClickRef.current = false;
                    return;
                  }
                  onSelect(annotation.id);
                }}
                onDoubleClick={(event) => {
                  if (readOnly || disabled) return;
                  event.stopPropagation();
                  committedInputRef.current = false;
                  setEditingId(annotation.id);
                  setInputText(annotation.text);
                }}
              >
                {annotation.text}
              </button>
              {!readOnly && !disabled && editingId === annotation.id ? (
                <input
                  autoFocus
                  className="quick-annotation-overlay__input"
                  aria-label="编辑快速标注"
                  value={inputText}
                  onChange={(event) => {
                    if ([...event.target.value].length <= 100) setInputText(event.target.value);
                  }}
                  onBlur={submitInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitInput();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      committedInputRef.current = true;
                      setPendingInput(null);
                      setEditingId(null);
                      setInputText("");
                      queueMicrotask(() => { committedInputRef.current = false; });
                    }
                  }}
                />
              ) : null}
              </div>
            ) : null}
          </div>
          </div>
        );
      })}

      {!readOnly && !disabled && pendingInput && pendingLabelPoint ? (
        <div
          className="quick-annotation-overlay__pending-entry"
          style={{ left: pendingLabelPoint.x, top: pendingLabelPoint.y, transform: pendingLabelOffset.x < 0 ? "translateX(-100%)" : "none" }}
        >
          <div className={`quick-annotation-overlay__pending-badge is-${pendingInput.mode}`} aria-hidden="true">Q{nextOrdinal}</div>
          <input
            autoFocus
            className="quick-annotation-overlay__input"
            aria-label="输入快速标注"
            value={inputText}
            onChange={(event) => { if ([...event.target.value].length <= 100) setInputText(event.target.value); }}
            onBlur={submitInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); submitInput(); }
              else if (event.key === "Escape") {
                event.preventDefault();
                committedInputRef.current = true;
                setPendingInput(null);
                setInputText("");
                queueMicrotask(() => { committedInputRef.current = false; });
              }
            }}
          />
        </div>
      ) : null}

    </div>
  );
};
