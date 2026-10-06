import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ROOT_FOLDER_ID, type FolderRecord } from "../domain/types";
import { createFolderPreviewAnimator } from "./folderPreviewMotion";
import { observeCanvasCardShadows } from "./canvasCardShadowVisibility";
import type {
  FolderPreviewPlacement,
  FolderPreviewStage,
  FolderSceneBounds,
} from "../domain/folderScene";

export type FolderNavigationState =
  | { layer: "overview"; selectedFolderId: string | null }
  | { layer: "preview"; selectedFolderId: string }
  | { layer: "folder"; selectedFolderId: string }
  | { layer: "image"; selectedFolderId: string; imageId: string }
  | { layer: "description"; selectedFolderId: string; descriptionId: string };

export interface FolderViewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface FolderWorkspaceItem {
  folder: FolderRecord;
  bounds: FolderSceneBounds;
  previewImageUrl?: string;
}

export interface FolderDropImagePreview {
  id: string;
  imageUrl: string;
  bounds: FolderSceneBounds;
  angle: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

export interface FolderDescriptionItem {
  id: string;
  folderId: string;
  label: string;
  text: string;
  anchor: Readonly<{ x: number; y: number }>;
  previewScale?: number;
  previewWidth?: number;
  previewHeight?: number;
  previewAngle?: number;
}

export interface FolderPreviewMotionState {
  folderId: string;
  images: readonly {
    id: string;
    imageUrl: string;
    target: FolderPreviewPlacement;
  }[];
  descriptions: readonly {
    id: string;
    label: string;
    text: string;
    target: {
      x: number;
      y: number;
      width: number;
      height: number;
      scale: number;
      angle?: number;
    };
  }[];
}

interface ViewportScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FocusEnvironmentRect {
  id: "top" | "right" | "bottom" | "left";
  left: number;
  top: number;
  width: number;
  height: number;
}

export const overlappingDescriptionIds = (
  focusRect: ViewportScreenRect,
  descriptionRects: readonly Readonly<{ id: string } & ViewportScreenRect>[],
): ReadonlySet<string> =>
  new Set(
    descriptionRects
      .filter(
        (rect) =>
          rect.left < focusRect.right &&
          rect.right > focusRect.left &&
          rect.top < focusRect.bottom &&
          rect.bottom > focusRect.top,
      )
      .map((rect) => rect.id),
  );

export const focusEnvironmentRects = (
  focusRect: Readonly<{ left: number; top: number; width: number; height: number }>,
  viewportBounds: Readonly<{ width: number; height: number }>,
): readonly FocusEnvironmentRect[] => {
  const viewportWidth = Math.max(0, viewportBounds.width);
  const viewportHeight = Math.max(0, viewportBounds.height);
  const left = Math.max(0, Math.min(viewportWidth, focusRect.left));
  const top = Math.max(0, Math.min(viewportHeight, focusRect.top));
  const right = Math.max(
    left,
    Math.min(viewportWidth, focusRect.left + focusRect.width),
  );
  const bottom = Math.max(
    top,
    Math.min(viewportHeight, focusRect.top + focusRect.height),
  );
  const rects: FocusEnvironmentRect[] = [
    { id: "top", left: 0, top: 0, width: viewportWidth, height: top },
    {
      id: "right",
      left: right,
      top,
      width: viewportWidth - right,
      height: bottom - top,
    },
    {
      id: "bottom",
      left: 0,
      top: bottom,
      width: viewportWidth,
      height: viewportHeight - bottom,
    },
    { id: "left", left: 0, top, width: left, height: bottom - top },
  ];
  return rects.filter((rect) => rect.width > 0 && rect.height > 0);
};

export const viewportRect = (
  bounds: FolderSceneBounds,
  viewport: FolderViewport,
  panelBounds: Readonly<{ left: number; top: number }>,
) => ({
  left:
    (bounds.x + viewport.scrollX) * viewport.zoom +
    viewport.offsetLeft -
    panelBounds.left,
  top:
    (bounds.y + viewport.scrollY) * viewport.zoom +
    viewport.offsetTop -
    panelBounds.top,
  width: bounds.width * viewport.zoom,
  height: bounds.height * viewport.zoom,
});

export const folderDropTargetAtViewportPoint = (
  point: Readonly<{ clientX: number; clientY: number }>,
  viewport: FolderViewport,
  items: readonly FolderWorkspaceItem[],
): string | null => {
  const zoom = Math.max(0.0001, viewport.zoom);
  const scenePoint = {
    x: (point.clientX - viewport.offsetLeft) / zoom - viewport.scrollX,
    y: (point.clientY - viewport.offsetTop) / zoom - viewport.scrollY,
  };
  return (
    [...items]
      .reverse()
      .find(
        ({ bounds }) =>
          scenePoint.x >= bounds.x &&
          scenePoint.x <= bounds.x + bounds.width &&
          scenePoint.y >= bounds.y &&
          scenePoint.y <= bounds.y + bounds.height,
      )?.folder.id ?? null
  );
};

// Defer the single-click preview long enough for the browser to classify a
// second click as a double-click. Dragging still commits immediately; this
// only applies to a click-like Folder pointer release.
const FOLDER_DOUBLE_CLICK_WINDOW_MS = 100;

export const FolderWorkspace = ({
  navigation,
  items,
  descriptions,
  focusImageBounds = null,
  previewStage = null,
  previewCoverBounds = null,
  previewMotion = null,
  previewClosing = false,
  onPreviewClosed,
  onPreviewReopen,
  selectedDescriptionIds = [],
  imageDropPreviews = [],
  folderDropTargetId = null,
  folderDropSuccessId = null,
  viewport,
  disabled = false,
  hasImageSelection = false,
  onSelectFolder,
  onEnterFolder,
  onMoveFolder,
  onBeginCanvasPan,
  onDeleteFolder,
  onUngroupFolder,
  onSelectDescription,
  onMoveDescription,
  onMoveDescriptions = () => false,
  onMoveCanvasSelection,
  onCancelCanvasSelectionMove,
  onFolderDropTargetChange = () => undefined,
}: {
  navigation: FolderNavigationState;
  items: readonly FolderWorkspaceItem[];
  descriptions: readonly FolderDescriptionItem[];
  focusImageBounds?: FolderSceneBounds | null;
  previewStage?: FolderPreviewStage | null;
  previewCoverBounds?: FolderSceneBounds | null;
  previewMotion?: FolderPreviewMotionState | null;
  previewClosing?: boolean;
  onPreviewClosed?: () => void;
  onPreviewReopen?: () => void;
  selectedDescriptionIds?: readonly string[];
  imageDropPreviews?: readonly FolderDropImagePreview[];
  folderDropTargetId?: string | null;
  folderDropSuccessId?: string | null;
  viewport: FolderViewport;
  disabled?: boolean;
  hasImageSelection?: boolean;
  onSelectFolder: (folderId: string) => void;
  onEnterFolder: (folderId: string) => void;
  onMoveFolder: (folderId: string, dx: number, dy: number) => void;
  onBeginCanvasPan?: () => ((dx: number, dy: number) => void) | null;
  onDeleteFolder: (folderId: string) => void;
  onUngroupFolder: (folderId: string) => void;
  onSelectDescription: (descriptionId: string) => void;
  onMoveDescription: (
    descriptionId: string,
    dx: number,
    dy: number,
    targetFolderId: string | null,
  ) => boolean | void;
  onMoveDescriptions?: (
    descriptionIds: readonly string[],
    dx: number,
    dy: number,
  ) => boolean | void;
  onMoveCanvasSelection?: (
    descriptionIds: readonly string[],
    dx: number,
    dy: number,
    commit: boolean,
  ) => boolean | void;
  onCancelCanvasSelectionMove?: (
    descriptionIds: readonly string[],
  ) => boolean | void;
  onFolderDropTargetChange?: (
    folderId: string | null,
    draggedDescriptionId?: string | null,
  ) => void;
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const animatorRef = useRef<ReturnType<typeof createFolderPreviewAnimator> | null>(null);
  if (!animatorRef.current) animatorRef.current = createFolderPreviewAnimator();
  const onPreviewClosedRef = useRef(onPreviewClosed);
  onPreviewClosedRef.current = onPreviewClosed;
  const [managementFolderId, setManagementFolderId] = useState<string | null>(null);
  useEffect(() => () => animatorRef.current?.dispose(), []);
  useEffect(() => {
    if (!managementFolderId) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-folder-preview-actions]")) setManagementFolderId(null);
    };
    window.addEventListener("pointerdown", dismiss, true);
    return () => window.removeEventListener("pointerdown", dismiss, true);
  }, [managementFolderId]);
  useEffect(() => { setManagementFolderId(null); }, [navigation.layer, navigation.selectedFolderId, previewClosing]);
  const middlePanRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    element: HTMLButtonElement;
    previousCursor: string;
    pan: (dx: number, dy: number) => void;
  } | null>(null);
  const clearMiddlePan = () => {
    const pan = middlePanRef.current;
    if (!pan) return;
    middlePanRef.current = null;
    pan.element.style.cursor = pan.previousCursor;
    if (pan.element.hasPointerCapture(pan.pointerId)) pan.element.releasePointerCapture(pan.pointerId);
  };
  useEffect(() => {
    window.addEventListener("blur", clearMiddlePan);
    return () => {
      window.removeEventListener("blur", clearMiddlePan);
      clearMiddlePan();
    };
  }, []);
  useLayoutEffect(() => {
    if (disabled || navigation.layer !== "overview") clearMiddlePan();
  }, [disabled, navigation.layer]);
  const dragRef = useRef<{
    folderId: string;
    pointerId: number;
    startLeft: number;
    startTop: number;
    grabOffsetX: number;
    grabOffsetY: number;
    element: HTMLButtonElement;
    frame: number | null;
    pendingDx: number;
    pendingDy: number;
  } | null>(null);
  const descriptionDragRef = useRef<{
    descriptionIds: readonly string[];
    pointerId: number;
    originX: number;
    originY: number;
    elements: readonly HTMLButtonElement[];
    frame: number | null;
    pendingDx: number;
    pendingDy: number;
    mixedSelectionPreview: boolean;
  } | null>(null);
  const committedFolderDragRef = useRef<{
    folderId: string;
    targetX: number;
    targetY: number;
    element: HTMLButtonElement;
  } | null>(null);
  const committedDescriptionDragRef = useRef<{
    descriptionId: string;
    targetX: number;
    targetY: number;
    element: HTMLButtonElement;
  } | null>(null);
  const pendingFolderSelectRef = useRef<number | null>(null);
  const clearPendingFolderSelect = () => {
    if (pendingFolderSelectRef.current !== null) {
      window.clearTimeout(pendingFolderSelectRef.current);
      pendingFolderSelectRef.current = null;
    }
  };
  useEffect(() => clearPendingFolderSelect, []);
  const [panelBounds, setPanelBounds] = useState({
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    width: 0,
    height: 0,
  });
  const [focusOccludedDescriptionIds, setFocusOccludedDescriptionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const shadowVisibilityRef = useRef<ReturnType<typeof observeCanvasCardShadows> | null>(null);
  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const visibility = observeCanvasCardShadows(rootRef.current);
    shadowVisibilityRef.current = visibility;
    return () => {
      shadowVisibilityRef.current = null;
      visibility.dispose();
    };
  }, []);
  useLayoutEffect(() => { shadowVisibilityRef.current?.sync(); });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateBounds = () => {
      const bounds = root.getBoundingClientRect();
      setPanelBounds((current) =>
        current.left === bounds.left &&
        current.top === bounds.top &&
        current.width === bounds.width &&
        current.height === bounds.height
          ? current
          : {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
            },
      );
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(root);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || navigation.layer !== "image" || !focusImageBounds) {
      setFocusOccludedDescriptionIds((current) =>
        current.size === 0 ? current : new Set(),
      );
      return;
    }

    const updateOcclusion = () => {
      const target = viewportRect(
        focusImageBounds,
        viewport,
        root.getBoundingClientRect(),
      );
      const rootBounds = root.getBoundingClientRect();
      const focusRect = {
        left: rootBounds.left + target.left,
        top: rootBounds.top + target.top,
        right: rootBounds.left + target.left + target.width,
        bottom: rootBounds.top + target.top + target.height,
      };
      const next = overlappingDescriptionIds(
        focusRect,
        Array.from(
          root.querySelectorAll<HTMLElement>("[data-description-id]"),
        ).flatMap((element) => {
          const id = element.dataset.descriptionId;
          if (!id) return [];
          const bounds = element.getBoundingClientRect();
          return [{
            id,
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
          }];
        }),
      );
      setFocusOccludedDescriptionIds((current) => {
        if (
          current.size === next.size &&
          [...current].every((id) => next.has(id))
        ) {
          return current;
        }
        return next;
      });
    };

    updateOcclusion();
    const observer = new ResizeObserver(updateOcclusion);
    observer.observe(root);
    root
      .querySelectorAll<HTMLElement>("[data-description-id]")
      .forEach((element) => observer.observe(element));
    window.addEventListener("resize", updateOcclusion);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOcclusion);
    };
  }, [descriptions, focusImageBounds, navigation.layer, viewport]);

  useLayoutEffect(() => {
    const pending = committedFolderDragRef.current;
    if (!pending) return;
    const item = items.find(({ folder }) => folder.id === pending.folderId);
    if (
      item &&
      Math.abs(item.bounds.x - pending.targetX) < 0.01 &&
      Math.abs(item.bounds.y - pending.targetY) < 0.01
    ) {
      pending.element.style.transform = "";
      committedFolderDragRef.current = null;
    }
  }, [items]);

  useLayoutEffect(() => {
    const pending = committedDescriptionDragRef.current;
    if (!pending) return;
    const description = descriptions.find(
      ({ id }) => id === pending.descriptionId,
    );
    if (
      description &&
      Math.abs(description.anchor.x - pending.targetX) < 0.01 &&
      Math.abs(description.anchor.y - pending.targetY) < 0.01
    ) {
      pending.element.style.transform = "";
      pending.element.style.transition = "";
      pending.element.classList.remove("is-dragging");
      committedDescriptionDragRef.current = null;
    }
  }, [descriptions]);

  useEffect(() => {
    if (navigation.layer !== "preview") return;
      const descriptionDrag = descriptionDragRef.current;
      if (descriptionDrag) {
      if (descriptionDrag.frame !== null) {
        cancelAnimationFrame(descriptionDrag.frame);
      }
      clearDescriptionDragVisuals(descriptionDrag);
      descriptionDragRef.current = null;
    }
  }, [navigation.layer]);

  useEffect(
    () => () => {
      const folderDrag = dragRef.current;
      if (folderDrag && folderDrag.frame !== null) {
        cancelAnimationFrame(folderDrag.frame);
      }
      const descriptionDrag = descriptionDragRef.current;
      if (descriptionDrag && descriptionDrag.frame !== null) {
        cancelAnimationFrame(descriptionDrag.frame);
      }
    },
    [],
  );

  const scheduleTransform = (
    drag: {
      element: HTMLButtonElement;
      frame: number | null;
      pendingDx: number;
      pendingDy: number;
    },
    dx: number,
    dy: number,
  ) => {
    drag.pendingDx = dx;
    drag.pendingDy = dy;
    if (drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      drag.element.style.transform = `translate3d(${drag.pendingDx}px, ${drag.pendingDy}px, 0)`;
    });
  };

  const flushTransform = (drag: {
    element: HTMLButtonElement;
    frame: number | null;
    pendingDx: number;
    pendingDy: number;
  }) => {
    if (drag.frame !== null) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }
    drag.element.style.transform = `translate3d(${drag.pendingDx}px, ${drag.pendingDy}px, 0)`;
  };

  const flushGroupTransform = (drag: {
    elements: readonly HTMLButtonElement[];
    frame: number | null;
    pendingDx: number;
    pendingDy: number;
  }) => {
    if (drag.frame !== null) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }
    drag.elements.forEach((element) => {
      element.style.transform = `translate3d(${drag.pendingDx}px, ${drag.pendingDy}px, 0)`;
    });
  };

  const clearDescriptionDragVisuals = (drag: {
    elements: readonly HTMLButtonElement[];
  }) => {
    drag.elements.forEach((element) => {
      element.style.transform = "";
      element.style.transition = "";
      element.classList.remove("is-dragging");
    });
  };

  const clearGroupTransform = (drag: {
    elements: readonly HTMLButtonElement[];
  }) => {
    drag.elements.forEach((element) => {
      element.style.transform = "";
    });
  };

  const scheduleGroupTransform = (
    drag: {
      elements: readonly HTMLButtonElement[];
      frame: number | null;
      pendingDx: number;
      pendingDy: number;
    },
    dx: number,
    dy: number,
  ) => {
    drag.pendingDx = dx;
    drag.pendingDy = dy;
    if (drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      drag.elements.forEach((element) => {
        element.style.transform = `translate3d(${drag.pendingDx}px, ${drag.pendingDy}px, 0)`;
      });
    });
  };

  const beginDrag = (
    folderId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (disabled || navigation.layer !== "overview" || event.button !== 0) return;
    clearPendingFolderSelect();
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      folderId,
      pointerId: event.pointerId,
      startLeft: bounds.left,
      startTop: bounds.top,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      element: event.currentTarget,
      frame: null,
      pendingDx: 0,
      pendingDy: 0,
    };
    event.currentTarget.style.transform = "translate3d(0, 0, 0)";
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetLeft = event.clientX - drag.grabOffsetX;
    const targetTop = event.clientY - drag.grabOffsetY;
    scheduleTransform(
      drag,
      targetLeft - drag.startLeft,
      targetTop - drag.startTop,
    );
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetLeft = event.clientX - drag.grabOffsetX;
    const targetTop = event.clientY - drag.grabOffsetY;
    const dx = targetLeft - drag.startLeft;
    const dy = targetTop - drag.startTop;
    drag.pendingDx = dx;
    drag.pendingDy = dy;
    flushTransform(drag);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (Math.hypot(dx, dy) >= 3) {
      const item = items.find(({ folder }) => folder.id === drag.folderId);
      if (item) {
        committedFolderDragRef.current = {
          folderId: drag.folderId,
          targetX: item.bounds.x + dx / viewport.zoom,
          targetY: item.bounds.y + dy / viewport.zoom,
          element: drag.element,
        };
      }
      onMoveFolder(drag.folderId, dx / viewport.zoom, dy / viewport.zoom);
    } else {
      clearPendingFolderSelect();
      const folderId = drag.folderId;
      pendingFolderSelectRef.current = window.setTimeout(() => {
        pendingFolderSelectRef.current = null;
        onSelectFolder(folderId);
      }, FOLDER_DOUBLE_CLICK_WINDOW_MS);
      drag.element.style.transform = "";
    }
  };

  const showFolderCards =
    navigation.layer === "overview" ||
    navigation.layer === "preview" ||
    (navigation.layer === "image" &&
      navigation.selectedFolderId === ROOT_FOLDER_ID);
  const focusRect =
    navigation.layer === "image" && focusImageBounds
      ? viewportRect(focusImageBounds, viewport, panelBounds)
      : null;
  const environmentRects =
    focusRect && panelBounds.width > 0 && panelBounds.height > 0
      ? focusEnvironmentRects(focusRect, panelBounds)
      : [];
  const previewStageRect =
    navigation.layer === "preview" && previewStage
      ? viewportRect(previewStage, viewport, panelBounds)
      : null;
  const visibleDescriptions =
    navigation.layer === "image"
      ? descriptions.filter(
          (description) =>
            description.folderId === navigation.selectedFolderId,
        )
      : descriptions;
  const draggedDescriptionId =
    descriptionDragRef.current?.descriptionIds[0] ?? null;
  const liftedDescriptionIds = folderDropTargetId
    ? draggedDescriptionId
      ? selectedDescriptionIds.includes(draggedDescriptionId)
        ? selectedDescriptionIds
        : [draggedDescriptionId]
      : selectedDescriptionIds
    : [];
  const activePreviewMotion =
    navigation.layer === "preview" &&
    previewMotion?.folderId === navigation.selectedFolderId
      ? previewMotion
      : null;
  const motionFolder = activePreviewMotion
    ? items.find(({ folder }) => folder.id === activePreviewMotion.folderId)
    : undefined;
  const motionSourceRect =
    activePreviewMotion && motionFolder
      ? viewportRect(
          motionFolder.bounds,
          viewport,
          panelBounds,
        )
      : null;
  const previewGeometryKey = JSON.stringify([
    previewCoverBounds, activePreviewMotion?.folderId,
    activePreviewMotion?.images.map(({ id, target }) => [id, target]),
    activePreviewMotion?.descriptions.map(({ id, target }) => [id, target]),
    viewport, panelBounds,
  ]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || navigation.layer !== "preview") {
      animatorRef.current?.dispose();
      return;
    }
    animatorRef.current?.play(root, previewClosing, () => onPreviewClosedRef.current?.(),
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, [navigation.layer, navigation.selectedFolderId, previewClosing, previewGeometryKey]);

  return (
    <div
      ref={rootRef}
      className="folder-workspace-layer"
      data-folder-layer={navigation.layer}
      aria-label="文件夹工作区"
    >
      {showFolderCards &&
        items
          .map(({ folder, bounds, previewImageUrl }) => {
          const selected = navigation.selectedFolderId === folder.id;
          const baseRect = viewportRect(bounds, viewport, panelBounds);
          const previewTargetRect =
            selected && navigation.layer === "preview" && previewCoverBounds
              ? viewportRect(previewCoverBounds, viewport, panelBounds)
              : null;
          // Keep the Folder's own box as the animation surface and shrink it
          // around its center. Changing width/height and position at the same
          // time made the cover feel like it snapped to a new card; the
          // isolated reference instead moves and scales one continuous cover.
          const previewScale = previewTargetRect
            ? Math.min(
                previewTargetRect.width / Math.max(1, baseRect.width),
                previewTargetRect.height / Math.max(1, baseRect.height),
              )
            : 1;
          const rect = previewTargetRect
            ? {
                left:
                  previewTargetRect.left +
                  (previewTargetRect.width - baseRect.width) / 2,
                top:
                  previewTargetRect.top +
                  (previewTargetRect.height - baseRect.height) / 2,
                width: baseRect.width,
                height: baseRect.height,
              }
            : baseRect;
          const previewContext = navigation.layer === "preview" && !selected;
          const focusContext = navigation.layer === "image";
          const focusOccluded =
            focusContext &&
            focusRect !== null &&
            rect.left < focusRect.left + focusRect.width &&
            rect.left + rect.width > focusRect.left &&
            rect.top < focusRect.top + focusRect.height &&
            rect.top + rect.height > focusRect.top;
          if (focusOccluded) return null;
          return (
            <div
              key={folder.id}
              className={`folder-workspace-item${selected ? " is-selected" : ""}${folderDropTargetId === folder.id ? " is-drop-target" : ""}${folderDropSuccessId === folder.id ? " is-drop-success" : ""}${previewContext ? " is-preview-context" : ""}${focusContext ? " is-focus-context" : ""}`}
              data-folder-preview-state={
                navigation.layer === "preview"
                  ? selected
                    ? "selected"
                    : "context"
                  : undefined
              }
              data-canvas-object="folder"
              data-folder-id={folder.id}
              data-folder-motion={selected && navigation.layer === "preview" ? "cover" : undefined}
              style={{
                left: baseRect.left,
                top: baseRect.top,
                width: rect.width,
                height: rect.height,
                "--folder-scene-scale": viewport.zoom,
                transform: previewTargetRect
                  ? `translate(${rect.left - baseRect.left}px, ${rect.top - baseRect.top}px) scale(${previewScale})`
                  : undefined,
                transition: previewTargetRect ? "opacity 160ms ease" : undefined,
                "--folder-motion-open-transform": `translate(${rect.left - baseRect.left}px, ${rect.top - baseRect.top}px) scale(${previewScale})`,
                "--folder-motion-closed-transform": "translate(0px, 0px) scale(1)",
              } as CSSProperties}
            >
              <button
                type="button"
                className="folder-workspace-hit-target"
                aria-label={`${folder.name}，单击预览，双击进入`}
                aria-disabled={previewContext || focusContext || undefined}
                tabIndex={previewContext || focusContext ? -1 : undefined}
                onClick={() => { if (selected && previewClosing) onPreviewReopen?.(); }}
                onPointerDown={(event) => {
                  if (middlePanRef.current || dragRef.current) return;
                  if (event.button === 1) {
                    if (disabled || navigation.layer !== "overview") return;
                    const pan = onBeginCanvasPan?.();
                    if (!pan) return;
                    event.preventDefault();
                    event.stopPropagation();
                    clearPendingFolderSelect();
                    middlePanRef.current = {
                      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
                      element: event.currentTarget, previousCursor: event.currentTarget.style.cursor, pan,
                    };
                    event.currentTarget.style.cursor = "grabbing";
                    event.currentTarget.setPointerCapture(event.pointerId);
                    return;
                  }
                  if (!focusContext) beginDrag(folder.id, event);
                }}
                onPointerMove={(event) => {
                  const pan = middlePanRef.current;
                  if (pan?.pointerId === event.pointerId) {
                    event.preventDefault();
                    event.stopPropagation();
                    pan.pan(event.clientX - pan.startX, event.clientY - pan.startY);
                    return;
                  }
                  moveDrag(event);
                }}
                onPointerUp={(event) => {
                  const pan = middlePanRef.current;
                  if (pan?.pointerId === event.pointerId) {
                    event.preventDefault();
                    event.stopPropagation();
                    pan.pan(event.clientX - pan.startX, event.clientY - pan.startY);
                    clearMiddlePan();
                    return;
                  }
                  finishDrag(event);
                }}
                onLostPointerCapture={clearMiddlePan}
                onAuxClick={(event) => {
                  if (event.button === 1 && navigation.layer === "overview") {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onPointerCancel={() => {
                  clearMiddlePan();
                  if (dragRef.current) {
                    if (dragRef.current.frame !== null) {
                      cancelAnimationFrame(dragRef.current.frame);
                    }
                    dragRef.current.element.style.transform = "";
                  }
                  dragRef.current = null;
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  clearPendingFolderSelect();
                  if (!focusContext) onEnterFolder(folder.id);
                }}
              >
                <span className="folder-workspace-cover" aria-hidden="true">
                  {previewImageUrl && navigation.layer !== "image" ? (
                    <img src={previewImageUrl} alt="" />
                  ) : null}
                </span>
                <span className="folder-workspace-kicker" aria-hidden="true">
                  Folder
                </span>
                <span className="folder-workspace-label">
                  <strong>{folder.name}</strong>
                  {folderDropTargetId === folder.id ? (
                    <small className="folder-workspace-drop-prompt-text">
                      收进 Folder
                    </small>
                  ) : (
                    <small>
                      {folder.imageAssetIds.length} 张图片 · {folder.descriptionIds.length}{" "}
                      条说明
                    </small>
                  )}
                </span>
                {folderDropTargetId === folder.id ? (
                  <>
                    {imageDropPreviews.length > 0 ? (
                      <span
                        className="folder-drop-image-preview-tray"
                        data-preview-count={imageDropPreviews.length}
                        aria-hidden="true"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(imageDropPreviews.length, 2)}, minmax(0, 1fr))`,
                          gridTemplateRows: `repeat(${Math.ceil(imageDropPreviews.length / 2)}, minmax(0, 1fr))`,
                        }}
                      >
                        {imageDropPreviews.map((preview) => (
                          <span
                            key={preview.id}
                            className="folder-drop-image-preview-cell"
                          >
                            <img
                              src={preview.imageUrl}
                              alt=""
                              style={{
                                opacity: preview.opacity * 0.95,
                                transform: `rotate(${preview.angle}rad) scale(${preview.scaleX}, ${preview.scaleY})`,
                              }}
                            />
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </button>
              {selected && navigation.layer === "preview" ? (
                <div data-folder-preview-actions className={`folder-workspace-preview-actions${
                  viewport.zoom < 0.7 ? " is-low-zoom" : ""
                }`} style={{ visibility: previewClosing ? "hidden" : undefined }}>
                  <button
                    type="button"
                    className="folder-workspace-enter"
                    aria-label={`${folder.name}，进入完整文件夹`}
                    onClick={() => onEnterFolder(folder.id)}
                  >
                    进入
                  </button>
                  <button type="button" className="folder-workspace-more"
                    aria-label={`${folder.name}，更多管理操作`} aria-haspopup="menu"
                    aria-expanded={managementFolderId === folder.id}
                    onClick={() => setManagementFolderId((current) => current === folder.id ? null : folder.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") { event.preventDefault(); setManagementFolderId(folder.id); }
                      if (event.key === "Escape") { event.preventDefault(); setManagementFolderId(null); }
                    }}>⋯</button>
                  {managementFolderId === folder.id ? (
                    <div className="folder-preview-management" role="menu" aria-label="文件夹管理"
                      onKeyDown={(event) => {
                        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                        if (event.key === "Escape") {
                          event.preventDefault(); event.stopPropagation();
                          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(".folder-workspace-more")?.focus();
                          setManagementFolderId(null);
                        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                          event.preventDefault();
                          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
                          buttons[next]?.focus();
                        }
                      }}>
                      {folder.imageAssetIds.length + folder.descriptionIds.length > 0 ? (
                      <button
                        type="button" role="menuitem" autoFocus
                        className="folder-workspace-ungroup"
                        onClick={() => { setManagementFolderId(null); onUngroupFolder(folder.id); }}
                      >
                        解组
                      </button>
                      ) : null}
                      <button type="button" role="menuitem" className="folder-workspace-remove"
                        autoFocus={folder.imageAssetIds.length + folder.descriptionIds.length === 0}
                        onClick={() => { setManagementFolderId(null); onDeleteFolder(folder.id); }}>删除</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
          })}

      {previewStageRect ? (
        <div
          className="folder-workspace-preview-stage"
          aria-hidden="true"
          style={{
            left: previewStageRect.left,
            top: previewStageRect.top,
            width: previewStageRect.width,
            height: previewStageRect.height,
          }}
        />
      ) : null}

      {(navigation.layer === "overview" ||
        navigation.layer === "preview" ||
        navigation.layer === "folder" ||
        navigation.layer === "image") &&
        visibleDescriptions.map((description) => {
          const focusOccluded = focusOccludedDescriptionIds.has(description.id);
          const left =
            (description.anchor.x + viewport.scrollX) * viewport.zoom +
            viewport.offsetLeft -
            panelBounds.left;
          const top =
            (description.anchor.y + viewport.scrollY) * viewport.zoom +
            viewport.offsetTop -
            panelBounds.top;
          return (
            <button
              key={description.id}
              type="button"
              className={`folder-description-item${
                !description.text.trim() &&
                Math.abs(viewport.zoom - 1) < 1e-6 &&
                navigation.layer !== "preview"
                  ? " is-empty-at-100"
                  : ""
              }${
                viewport.zoom < 0.3 && navigation.layer !== "preview"
                  ? " is-low-zoom"
                  : ""
              }${
                navigation.layer === "preview" && viewport.zoom < 0.7
                  ? " is-preview-low-zoom"
                  : ""
              }${
                selectedDescriptionIds.includes(description.id)
                  ? " is-canvas-selected"
                  : ""
              }${
                liftedDescriptionIds.includes(description.id)
                  ? " is-drop-preview"
                  : ""
              }${
                navigation.layer === "preview" &&
                description.folderId === navigation.selectedFolderId
                  ? " is-preview-member"
                  : navigation.layer === "preview"
                    ? " is-preview-context"
                    : navigation.layer === "image"
                      ? " is-focus-context"
                    : ""
              }`}
              data-canvas-object="description"
              data-description-id={description.id}
              data-focus-occluded={focusOccluded || undefined}
              aria-hidden={focusOccluded || undefined}
              disabled={
                disabled ||
                navigation.layer === "preview" ||
                navigation.layer === "image"
              }
              style={{
                left,
                top,
                "--folder-object-scale": Math.max(
                  0.1,
                  (description.previewScale ?? 0.9) *
                    (navigation.layer === "preview" ? 1 : viewport.zoom),
                ),
                "--folder-preview-width": description.previewWidth
                  ? `${description.previewWidth * viewport.zoom}px`
                  : undefined,
                "--folder-preview-height": description.previewHeight
                  ? `${description.previewHeight * viewport.zoom}px`
                  : undefined,
                rotate:
                  navigation.layer === "preview" &&
                  typeof description.previewAngle === "number"
                    ? `${description.previewAngle}rad`
                    : undefined,
                opacity:
                  navigation.layer === "preview" &&
                  description.folderId !== navigation.selectedFolderId
                    ? 0.4
                    : navigation.layer === "image"
                      ? focusOccluded
                        ? 0
                        : 1
                    : 1,
                visibility:
                  focusOccluded ||
                  (activePreviewMotion?.descriptions.some(
                    ({ id }) => id === description.id,
                  ) ?? false)
                    ? "hidden"
                    : undefined,
              } as CSSProperties}
              onPointerDown={(event) => {
                if (
                  disabled ||
                  navigation.layer === "preview" ||
                  navigation.layer === "image" ||
                  event.button !== 0
                ) return;
                if (
                  hasImageSelection &&
                  !selectedDescriptionIds.includes(description.id)
                ) {
                  onSelectDescription(description.id);
                }
                const dragDescriptionIds = selectedDescriptionIds.includes(description.id)
                  ? visibleDescriptions
                      .filter(
                        (candidate) =>
                          candidate.folderId === description.folderId &&
                          selectedDescriptionIds.includes(candidate.id),
                      )
                      .map((candidate) => candidate.id)
                  : [description.id];
                const dragElements = Array.from(
                  rootRef.current?.querySelectorAll<HTMLButtonElement>(
                    '[data-description-id]',
                  ) ?? [],
                ).filter((element) =>
                  dragDescriptionIds.includes(element.dataset.descriptionId ?? ""),
                );
                descriptionDragRef.current = {
                  descriptionIds: dragDescriptionIds,
                  pointerId: event.pointerId,
                  originX: event.clientX,
                  originY: event.clientY,
                  elements: dragElements,
                  frame: null,
                  pendingDx: 0,
                  pendingDy: 0,
                  mixedSelectionPreview: false,
                };
                onFolderDropTargetChange(null);
                dragElements.forEach((element) => {
                  element.classList.add("is-dragging");
                  element.style.transition = "none";
                  element.style.transform = "translate3d(0, 0, 0)";
                });
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (
                  navigation.layer === "preview" ||
                  navigation.layer === "image"
                ) return;
                const drag = descriptionDragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const moved = Math.hypot(
                  event.clientX - drag.originX,
                  event.clientY - drag.originY,
                );
                onFolderDropTargetChange(
                  moved >= 3 && description.folderId === ROOT_FOLDER_ID
                    ? folderDropTargetAtViewportPoint(event, viewport, items)
                    : null,
                  description.id,
                );
                const dx = event.clientX - drag.originX;
                const dy = event.clientY - drag.originY;
                const targetFolderId =
                  moved >= 3 && description.folderId === ROOT_FOLDER_ID
                    ? folderDropTargetAtViewportPoint(event, viewport, items)
                    : null;
                const mixedHandled =
                  moved >= 3 &&
                  onMoveCanvasSelection?.(
                    drag.descriptionIds,
                    dx / viewport.zoom,
                    dy / viewport.zoom,
                    false,
                  ) === true;
                if (mixedHandled) {
                  clearGroupTransform(drag);
                } else {
                  scheduleGroupTransform(drag, dx, dy);
                }
                drag.mixedSelectionPreview =
                  drag.mixedSelectionPreview || mixedHandled;
              }}
              onPointerUp={(event) => {
                if (navigation.layer === "preview") return;
                const drag = descriptionDragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const dx = event.clientX - drag.originX;
                const dy = event.clientY - drag.originY;
                drag.pendingDx = dx;
                drag.pendingDy = dy;
                flushGroupTransform(drag);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                descriptionDragRef.current = null;
                if (Math.hypot(dx, dy) >= 3) {
                  const targetFolderId =
                    description.folderId === ROOT_FOLDER_ID
                      ? folderDropTargetAtViewportPoint(event, viewport, items)
                      : null;
                  const mixedCommitted =
                    !targetFolderId &&
                    drag.mixedSelectionPreview &&
                    onMoveCanvasSelection?.(
                      drag.descriptionIds,
                      dx / viewport.zoom,
                      dy / viewport.zoom,
                      true,
                    ) === true;
                  const committed =
                    mixedCommitted ||
                    (drag.descriptionIds.length > 1 && !targetFolderId
                      ? onMoveDescriptions(
                          drag.descriptionIds,
                          dx / viewport.zoom,
                          dy / viewport.zoom,
                        ) !== false
                      : onMoveDescription(
                          drag.descriptionIds[0]!,
                          dx / viewport.zoom,
                          dy / viewport.zoom,
                          targetFolderId,
                        ) !== false);
                  if (mixedCommitted) {
                    clearDescriptionDragVisuals(drag);
                  }
                  if (committed && drag.descriptionIds.length === 1) {
                    const item = descriptions.find(
                      ({ id }) => id === drag.descriptionIds[0],
                    );
                    if (item) {
                      committedDescriptionDragRef.current = {
                        descriptionId: drag.descriptionIds[0]!,
                        targetX: item.anchor.x + dx / viewport.zoom,
                        targetY: item.anchor.y + dy / viewport.zoom,
                        element: drag.elements[0]!,
                      };
                    }
                  } else if (committed) {
                    clearDescriptionDragVisuals(drag);
                  } else {
                    clearDescriptionDragVisuals(drag);
                  }
                } else {
                  onSelectDescription(drag.descriptionIds[0]!);
                  clearDescriptionDragVisuals(drag);
                }
                onFolderDropTargetChange(null);
              }}
              onPointerCancel={() => {
                if (descriptionDragRef.current) {
                  if (descriptionDragRef.current.mixedSelectionPreview) {
                    onCancelCanvasSelectionMove?.(
                      descriptionDragRef.current.descriptionIds,
                    );
                  }
                  if (descriptionDragRef.current.frame !== null) {
                    cancelAnimationFrame(descriptionDragRef.current.frame);
                  }
                  clearDescriptionDragVisuals(descriptionDragRef.current);
                }
                descriptionDragRef.current = null;
                onFolderDropTargetChange(null);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                onSelectDescription(description.id);
              }}
            >
              <strong>{description.label}</strong>
              <span>{description.text.trim() || "空白说明"}</span>
            </button>
          );
        })}

      {activePreviewMotion && motionSourceRect ? (
        <div
          className={`folder-preview-motion-layer${viewport.zoom < 0.7 ? " is-low-zoom" : ""}`}
          aria-label="文件夹只读预览内容"
          onPointerDown={(event) => { event.stopPropagation(); }}
          onDoubleClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            if (!previewClosing) onEnterFolder(activePreviewMotion.folderId);
          }}
        >
          {activePreviewMotion.images.map((image, index) => {
            const target = viewportRect(image.target, viewport, panelBounds);
            return (
              <img
                key={image.id}
                className="folder-preview-motion-image"
                data-folder-motion="member"
                data-folder-motion-index={index}
                src={image.imageUrl}
                draggable={false}
                alt=""
                style={{
                  // Keep the target aspect ratio from the first frame. The
                  // old source-sized box letterboxed the image during entry,
                  // then changed geometry again when the animation settled.
                  left: target.left,
                  top: target.top,
                  width: target.width,
                  height: target.height,
                  "--folder-motion-closed-transform": `translate(${motionSourceRect.left - target.left}px, ${motionSourceRect.top - target.top}px) scale(.42)`,
                  "--folder-motion-start-dx": `${motionSourceRect.left - target.left}px`,
                  "--folder-motion-start-dy": `${motionSourceRect.top - target.top}px`,
                  rotate:
                    typeof image.target.angle === "number"
                      ? `${image.target.angle}rad`
                      : undefined,
                } as CSSProperties}
              />
            );
          })}
          {activePreviewMotion.descriptions.map((description, index) => {
            const target = viewportRect(
              {
                x: description.target.x,
                y: description.target.y,
                width: description.target.width,
                height: description.target.height,
              },
              viewport,
              panelBounds,
            );
            return (
              <div
                key={description.id}
                className="folder-preview-motion-description"
                data-folder-motion="member"
                data-folder-motion-index={index}
                style={{
                  left: target.left,
                  top: target.top,
                  width: target.width,
                  height: target.height,
                  "--folder-motion-closed-transform": `translate(${motionSourceRect.left - target.left}px, ${motionSourceRect.top - target.top}px) scale(.42)`,
                  "--folder-motion-start-dx": `${motionSourceRect.left - target.left}px`,
                  "--folder-motion-start-dy": `${motionSourceRect.top - target.top}px`,
                  rotate:
                    typeof description.target.angle === "number"
                      ? `${description.target.angle}rad`
                      : undefined,
                } as CSSProperties}
              >
                <strong>{description.label}</strong>
                <span>{description.text.trim() || "空白说明"}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {environmentRects.length > 0 ? (
        <div className="image-focus-environment" aria-hidden="true">
          {environmentRects.map((rect) => (
            <span
              key={rect.id}
              data-focus-environment-segment={rect.id}
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
