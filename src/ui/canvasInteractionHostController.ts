import {
  classifyCanvasPointerIntent,
  shouldDismissCanvasMenuOnPointerDown,
  shouldPromoteMarquee,
  type CanvasPointerSessionKind,
} from "./canvasPointerArbitration";
import {
  marqueeSelectionMode,
  normalizeMarqueeRect,
  selectCanvasObjectsInMarquee,
  type CanvasMarqueeSelectionMode,
  type CanvasObjectSelectionCandidate,
} from "./canvasObjectSelection";
import {
  routeCanvasKeyboardEvent,
  type CanvasNativeToolShortcut,
} from "./canvasKeyboardRouter";
import type {
  CanvasShortcutId,
  CanvasShortcutPreferences,
} from "./canvasShortcutPreferences";
import {
  EMPTY_CANVAS_SELECTION,
  createCanvasSelection,
  hasCanvasSelection,
  type CanvasSelection,
} from "./canvasSelection";
import { classifyGlobalHistorySceneChange } from "./globalHistorySceneSync";
import {
  mergeGlobalHistorySources,
  type GlobalHistorySource,
} from "../domain/globalHistoryTimeline";
import type {
  CanvasInteractionRuntime,
  CanvasInteractionSnapshot,
  CanvasMarqueeViewportRect,
} from "./canvasInteractionRuntime";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export interface CanvasPointerLike {
  button: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  target?: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface CanvasRootLike {
  getBoundingClientRect(): { left: number; top: number };
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
}

export interface CanvasNativePointerInput {
  activeToolType: string;
  hitElement: {
    type?: string;
    isDeleted?: boolean;
    customData?: Record<string, unknown>;
  } | null | undefined;
  resize?: { handleType?: unknown; isResizing?: boolean } | null;
  hasControlledImageSelection?: boolean;
}

export type SelectionToolMenuKeyAction =
  | { type: "open"; focusIndex: number }
  | { type: "move"; focusIndex: number }
  | { type: "close" }
  | null;

export const resolveSelectionToolMenuKey = ({
  key,
  currentIndex,
  optionCount,
}: Readonly<{
  key: string;
  currentIndex: number;
  optionCount: number;
}>): SelectionToolMenuKeyAction => {
  if (key === "Escape") return { type: "close" };
  if (optionCount <= 0) return null;
  if (
    key !== "ArrowRight" &&
    key !== "ArrowDown" &&
    key !== "ArrowLeft" &&
    key !== "ArrowUp"
  ) {
    return null;
  }
  const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  if (currentIndex < 0) {
    return {
      type: "open",
      focusIndex: direction > 0 ? 0 : optionCount - 1,
    };
  }
  return {
    type: "move",
    focusIndex: (currentIndex + direction + optionCount) % optionCount,
  };
};

export const resolveCanvasImageEntryId = (input: {
  selectedCanvasImageId: string | null;
  selectedPlacementImageId: string | null;
  selectedNativeImageId?: string | null;
}): string | null =>
  input.selectedNativeImageId ??
  input.selectedCanvasImageId ??
  input.selectedPlacementImageId ??
  null;

/** Resolve a shared pure translation for selected native image elements. */
export const resolveUniformImageTranslation = (
  before: readonly ExcalidrawElement[],
  after: readonly ExcalidrawElement[],
  imageIds: readonly string[],
): { dx: number; dy: number } | null => {
  const selectedImageIds = [...new Set(imageIds)];
  if (selectedImageIds.length === 0) return null;
  let translation: { dx: number; dy: number } | null = null;
  for (const imageId of selectedImageIds) {
    const previous = before.find(
      (element) =>
        !element.isDeleted &&
        element.type === "image" &&
        element.customData?.imageId === imageId,
    );
    const current = after.find(
      (element) =>
        !element.isDeleted &&
        element.type === "image" &&
        element.customData?.imageId === imageId,
    );
    if (!previous || !current || previous.type !== "image" || current.type !== "image") {
      return null;
    }
    const previousShape = JSON.stringify({
      width: previous.width,
      height: previous.height,
      angle: previous.angle,
      scale: previous.scale,
      crop: previous.crop,
    });
    const currentShape = JSON.stringify({
      width: current.width,
      height: current.height,
      angle: current.angle,
      scale: current.scale,
      crop: current.crop,
    });
    if (previousShape !== currentShape) return null;
    const next = { dx: current.x - previous.x, dy: current.y - previous.y };
    if (!Number.isFinite(next.dx) || !Number.isFinite(next.dy)) return null;
    if (
      translation &&
      (Math.abs(translation.dx - next.dx) > 0.01 ||
        Math.abs(translation.dy - next.dy) > 0.01)
    ) {
      return null;
    }
    translation = next;
  }
  return translation;
};

export const hitTestCanvasImageEntry = (
  point: Readonly<{ x: number; y: number }>,
  candidates: readonly Readonly<{
    imageId: string;
    bounds: Readonly<{
      left: number;
      top: number;
      right: number;
      bottom: number;
    }>;
  }>[],
): string | null =>
  [...candidates]
    .reverse()
    .find(
      ({ bounds }) =>
        point.x >= bounds.left &&
        point.x <= bounds.right &&
        point.y >= bounds.top &&
        point.y <= bounds.bottom,
    )?.imageId ?? null;

export const fitImportedImageToViewport = (input: {
  naturalWidth: number;
  naturalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  maxWidthRatio?: number;
  maxHeightRatio?: number;
}) => {
  const maxWidth = Math.max(
    1,
    input.viewportWidth * (input.maxWidthRatio ?? 0.342),
  );
  const maxHeight = Math.max(
    1,
    input.viewportHeight * (input.maxHeightRatio ?? 0.456),
  );
  const scale = Math.min(
    1,
    maxWidth / Math.max(1, input.naturalWidth),
    maxHeight / Math.max(1, input.naturalHeight),
  );
  return {
    scale,
    width: input.naturalWidth * scale,
    height: input.naturalHeight * scale,
  };
};

/** Do not turn a transient zero panel rect into a one-pixel scene image. */
export const resolveMeasuredViewportSize = (input: {
  viewportWidth?: number;
  viewportHeight?: number;
  fallbackWidth: number;
  fallbackHeight: number;
}) => ({
  width:
    Number.isFinite(input.viewportWidth) && (input.viewportWidth ?? 0) > 0
      ? input.viewportWidth!
      : Math.max(1, input.fallbackWidth),
  height:
    Number.isFinite(input.viewportHeight) && (input.viewportHeight ?? 0) > 0
      ? input.viewportHeight!
      : Math.max(1, input.fallbackHeight),
});

export const imageDetailViewportPlan = (input: {
  viewportWidth: number;
  viewportHeight: number;
  statusPanelLeft?: number;
  statusPanelGap?: number;
}) => {
  const statusPanelGap = Math.max(0, input.statusPanelGap ?? 0);
  const rightBoundary =
    input.statusPanelLeft === undefined
      ? input.viewportWidth
      : Math.max(
          0,
          Math.min(input.viewportWidth, input.statusPanelLeft - statusPanelGap),
        );
  return {
    // Fit against the viewport that exists when focus mode opens rather than
    // preserving the image's import-time scale. Keep a small visual margin;
    // Excalidraw expects this factor to stay within 0.1..1.
    viewportZoomFactor: 0.88,
    canvasOffsets: {
      left: 0,
      top: 0,
      right: Math.max(0, input.viewportWidth - rightBoundary),
      bottom: 0,
    },
  };
};

export const shouldClaimCanvasImageDoubleClick = (input: {
  layer: string;
  selectedCanvasImageId: string | null;
}): boolean =>
  (input.layer === "overview" || input.layer === "folder") &&
  input.selectedCanvasImageId !== null;

export const shouldBlockPreviewPan = (input: {
  layer: string;
  button: number;
}): boolean => input.layer === "preview" && input.button === 1;

export const attachFolderPreviewWheelGuard = (
  panel: HTMLElement,
  isPreview: () => boolean,
): (() => void) => {
  const onWheel = (event: WheelEvent) => {
    if (!isPreview()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  panel.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => panel.removeEventListener("wheel", onWheel, { capture: true });
};

export interface CanvasPointerControllerPort<Scene> {
  getCanvasRoot: () => CanvasRootLike | null;
  getMarqueeCandidates: () => readonly CanvasObjectSelectionCandidate[];
  onBlankClick: () => void;
  onMarqueeSelection: (selection: CanvasSelection) => void;
  onMarqueeBounds?: (bounds: Readonly<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>, mode: CanvasMarqueeSelectionMode) => boolean;
  onNativeImage: (input: CanvasNativePointerInput) => void;
  onNativeElement: () => void;
  onSynchronizeTransient: () => void;
  onBlockedFreedraw: () => void;
  isCanvasMenuOpen: () => boolean;
  isInsideMenu: (target: EventTarget | null | undefined) => boolean;
  applyMenuAction: (action: "outside-pointerdown" | "marquee-start") => void;
  setMarqueeRect: (rect: CanvasMarqueeViewportRect | null) => void;
  getActiveToolType: () => string | null;
  onNativeImageGestureStart: () => void;
  onNativeGestureCancel: () => boolean;
}

export const createCanvasPointerController = <Scene>(
  runtime: Pick<
    CanvasInteractionRuntime<unknown, Scene>,
    "canvasPointerSessionRef" | "updateCanvasSelection"
  >,
  port: CanvasPointerControllerPort<Scene>,
) => {
  const clear = () => {
    const session = runtime.canvasPointerSessionRef.current;
    if (session.kind !== "idle" && session.root.hasPointerCapture(session.pointerId)) {
      session.root.releasePointerCapture(session.pointerId);
    }
    runtime.canvasPointerSessionRef.current = { kind: "idle" };
    port.setMarqueeRect(null);
  };
  const begin = (event: CanvasPointerLike) => {
    const root = port.getCanvasRoot();
    if (!root || event.button !== 0) return;
    root.setPointerCapture(event.pointerId);
    runtime.canvasPointerSessionRef.current = {
      kind: "pending-marquee",
      pointerId: event.pointerId,
      root: root as HTMLElement,
      start: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    port.applyMenuAction("marquee-start");
  };
  return {
    clear,
    onAppPointerDown(event: CanvasPointerLike) {
      if (
        port.isCanvasMenuOpen() &&
        shouldDismissCanvasMenuOnPointerDown({ insideMenu: port.isInsideMenu(event.target) })
      ) {
        port.applyMenuAction("outside-pointerdown");
      }
    },
    onCanvasPointerDown(event: CanvasPointerLike) {
      port.onSynchronizeTransient();
      if (port.getActiveToolType() === "freedraw") {
        event.preventDefault();
        event.stopPropagation();
        port.onBlockedFreedraw();
      }
    },
    onMove(event: CanvasPointerLike) {
      const session = runtime.canvasPointerSessionRef.current;
      if (session.kind === "idle" || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const current = { x: event.clientX, y: event.clientY };
      session.current = current;
      if (session.kind === "pending-marquee" && shouldPromoteMarquee({ start: session.start, current })) {
        session.kind = "marquee";
        session.moved = true;
      }
      if (session.kind === "marquee") {
        const marquee = normalizeMarqueeRect(session.start, current);
        const bounds = session.root.getBoundingClientRect();
        port.setMarqueeRect({
          left: marquee.left - bounds.left,
          top: marquee.top - bounds.top,
          width: marquee.right - marquee.left,
          height: marquee.bottom - marquee.top,
          mode: marqueeSelectionMode(session.start, current),
        });
      }
    },
    onUp(event: CanvasPointerLike) {
      const session = runtime.canvasPointerSessionRef.current;
      if (session.kind === "idle" || session.pointerId !== event.pointerId) return;
      const didMarquee = session.kind === "marquee" && session.moved;
      const start = session.start;
      const end = { x: event.clientX, y: event.clientY };
      const marquee = didMarquee
        ? normalizeMarqueeRect(start, end)
        : null;
      const mode = didMarquee ? marqueeSelectionMode(start, end) : null;
      clear();
      if (!didMarquee) {
        runtime.updateCanvasSelection(EMPTY_CANVAS_SELECTION);
        port.onBlankClick();
        return;
      }
      if (marquee && mode && port.onMarqueeBounds?.(marquee, mode)) {
        runtime.updateCanvasSelection(EMPTY_CANVAS_SELECTION);
        return;
      }
      const selection = createCanvasSelection(selectCanvasObjectsInMarquee(
        marquee!,
        port.getMarqueeCandidates(),
        mode!,
      ));
      runtime.updateCanvasSelection(selection);
      port.onMarqueeSelection(selection);
    },
    onCancel(event: CanvasPointerLike) {
      const session = runtime.canvasPointerSessionRef.current;
      const pointerSessionCancelled =
        session.kind !== "idle" && session.pointerId === event.pointerId;
      if (pointerSessionCancelled) clear();
      const nativeGestureCancelled = port.onNativeGestureCancel();
      return { pointerSessionCancelled, nativeGestureCancelled };
    },
    onNativePointerDown(input: CanvasNativePointerInput, event: CanvasPointerLike) {
      const intent = classifyCanvasPointerIntent(input);
      if (intent === "native-image") {
        port.onNativeImageGestureStart();
        port.onNativeImage(input);
      } else if (intent === "native-element") {
        port.onNativeElement();
      } else if (intent === "host-marquee") {
        begin(event);
      }
      return intent;
    },
    beginHostMarquee: begin,
  };
};

export const createCanvasSelectionController = (port: {
  selection: () => CanvasSelection;
  synchronizeTransient: () => void;
  deleteBusiness: (selection: CanvasSelection) => void;
  deleteScene: (selection: CanvasSelection) => void;
  afterDelete: (selection: CanvasSelection) => void;
  clearSelection: () => void;
}) => ({
  deleteSelection() {
    const selection = port.selection();
    if (!hasCanvasSelection(selection)) return false;
    port.synchronizeTransient();
    port.deleteBusiness(selection);
    port.deleteScene(selection);
    port.afterDelete(selection);
    port.clearSelection();
    return true;
  },
});

export const createCanvasKeyboardController = (port: {
  selection: () => CanvasSelection;
  menuOpen: () => boolean;
  pointerSession: () => CanvasPointerSessionKind;
  pendingTool: () => boolean;
  pendingSelectionTool: () => boolean;
  shortcutPreferences: () => CanvasShortcutPreferences;
  editableTarget: (target: EventTarget | null) => boolean;
  textEntryTarget?: (target: EventTarget | null) => boolean;
  blockedShortcut: (code: string, key: string) => boolean;
  allowDeleteFromEditableTarget?: (
    target: EventTarget | null,
    selection: CanvasSelection,
  ) => boolean;
  hasEnterTarget: () => boolean;
  hasFolderDeleteTarget: () => boolean;
  hasTemporaryLayer?: () => boolean;
  undo: () => void; redo: () => void; removeSelection: () => void;
  enterSelection: () => void;
  removeFolder: () => void;
  closeMenu: () => void; cancelPointer: () => void; cancelTool: () => void;
  activateNativeTool: (tool: CanvasNativeToolShortcut) => void;
  runCanvasShortcut: (shortcut: CanvasShortcutId) => void;
  blockNativeTool: () => void;
  exitTemporaryLayer?: () => void;
  handleOverlayKeyDown?: (event: KeyboardEvent) => boolean;
  copyContent?: () => void;
  selectAllContent?: () => void;
  clipboardTarget?: (target: EventTarget | null) => boolean;
  clipboardBlocked?: (reason: "busy" | "cut") => void;
}) => ({
  onKeyDown(event: KeyboardEvent) {
    if (port.handleOverlayKeyDown?.(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.isComposing) return;
    const selection = port.selection();
    const action = routeCanvasKeyboardEvent({
      key: event.key, editableTarget: port.editableTarget(event.target),
      textEntryTarget: port.textEntryTarget?.(event.target) ?? port.editableTarget(event.target), selection,
      allowDeleteFromEditableTarget: port.allowDeleteFromEditableTarget?.(event.target, selection) ?? false,
      code: event.code,
      menuOpen: port.menuOpen(), pointerSession: port.pointerSession(), hasPendingTool: port.pendingTool(),
      pendingSelectionTool: port.pendingSelectionTool(),
      shortcutPreferences: port.shortcutPreferences(),
      blockedNativeToolShortcut:
        !event.ctrlKey && !event.altKey && !event.metaKey &&
        port.blockedShortcut(event.code, event.key),
      hasEnterTarget: port.hasEnterTarget(), hasFolderDeleteTarget: port.hasFolderDeleteTarget(),
      hasTemporaryLayer: port.hasTemporaryLayer?.() ?? false, ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey, metaKey: event.metaKey, altKey: event.altKey,
      repeat: event.repeat,
      clipboardEnabled: !!port.copyContent,
      selectionCommandsEnabled: !!port.selectAllContent,
      clipboardTarget: port.clipboardTarget?.(event.target) ?? true,
    });
    if (!action) return;
    const controlledShortcut =
      action.type === "history-undo" ||
      action.type === "history-redo" ||
      action.type === "run-canvas-shortcut" ||
      action.type === "activate-native-tool-shortcut" || action.type === "copy-content" || action.type === "clipboard-blocked" || action.type === "select-all-content";
    const mustBlockNativeTool = action.type === "block-native-tool-shortcut";
    if (event.defaultPrevented && !controlledShortcut && !mustBlockNativeTool) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (action.type === "history-undo") port.undo();
    else if (action.type === "copy-content") port.copyContent?.();
    else if (action.type === "select-all-content") port.selectAllContent?.();
    else if (action.type === "clipboard-blocked") port.clipboardBlocked?.(action.reason);
    else if (action.type === "history-redo") port.redo();
    else if (action.type === "delete-selection") port.removeSelection();
    else if (action.type === "delete-folder") port.removeFolder();
    else if (action.type === "enter-selection") port.enterSelection();
    else if (action.type === "close-menu") port.closeMenu();
    else if (action.type === "cancel-pointer-session") port.cancelPointer();
    else if (action.type === "cancel-pending-tool") port.cancelTool();
    else if (action.type === "exit-temporary-layer") port.exitTemporaryLayer?.();
    else if (action.type === "run-canvas-shortcut") port.runCanvasShortcut(action.shortcut);
    else if (action.type === "activate-native-tool-shortcut") port.activateNativeTool(action.tool);
    else if (action.type === "block-native-tool-shortcut") port.blockNativeTool();
  },
});

export const createCanvasHistoryController = <Business, Scene>(
  runtime: Pick<CanvasInteractionRuntime<Business, Scene>,
    "globalHistoryRef" | "pendingGlobalHistoryCommitRef" | "globalHistoryReplayGateRef" |
    "nativeHistoryGestureBarrierRef" | "globalHistoryScenePreviewRef">,
  port: {
    capture: () => CanvasInteractionSnapshot<Business, Scene>;
    apply: (snapshot: CanvasInteractionSnapshot<Business, Scene>) => void;
    setStatus: (message: string) => void;
    schedule: (callback: () => void) => number;
    cancelSchedule: (timer: number) => void;
  },
) => {
  const flush = () => {
    const pending = runtime.pendingGlobalHistoryCommitRef.current;
    if (!pending || runtime.globalHistoryReplayGateRef.current.active || runtime.nativeHistoryGestureBarrierRef.current.active) return;
    runtime.pendingGlobalHistoryCommitRef.current = null;
    if (pending.timer !== null) port.cancelSchedule(pending.timer);
    runtime.globalHistoryRef.current.commit({ after: port.capture(), source: pending.source, operation: pending.operation });
  };
  const queue = (source: GlobalHistorySource, operation: string) => {
    if (runtime.globalHistoryReplayGateRef.current.active || runtime.globalHistoryRef.current.isReplaying) return;
    runtime.globalHistoryRef.current.synchronize(port.capture());
    const pending = runtime.pendingGlobalHistoryCommitRef.current;
    if (pending?.timer !== null && pending?.timer !== undefined) port.cancelSchedule(pending.timer);
    const next = pending ? { source: mergeGlobalHistorySources(pending.source, source), operation: pending.operation === operation ? operation : `${pending.operation}+${operation}`, timer: null as number | null } : { source, operation, timer: null as number | null };
    next.timer = runtime.nativeHistoryGestureBarrierRef.current.active ? null : port.schedule(flush);
    runtime.pendingGlobalHistoryCommitRef.current = next;
  };
  return {
    flush,
    queue,
    replay(direction: "undo" | "redo") {
      flush();
      const entry = direction === "undo" ? runtime.globalHistoryRef.current.undo(port.apply) : runtime.globalHistoryRef.current.redo(port.apply);
      port.setStatus(entry ? `${direction === "undo" ? "已撤销" : "已重做"}：${entry.operation}` : direction === "undo" ? "没有可撤销的画布操作。" : "没有可重做的画布操作。");
    },
    finishSceneChange(before: readonly ExcalidrawElement[], after: readonly ExcalidrawElement[]) {
      const replaying = runtime.globalHistoryReplayGateRef.current.active;
      runtime.globalHistoryReplayGateRef.current.observeScene(after as unknown as Scene);
      const nativeGestureActive = runtime.nativeHistoryGestureBarrierRef.current.active;
      const nativeGestureChanged =
        runtime.nativeHistoryGestureBarrierRef.current.hasSceneChange(
          after as unknown as Scene,
        );
      const source =
        classifyGlobalHistorySceneChange(before as never, after as never) ??
        (nativeGestureActive && nativeGestureChanged ? "mixed" : null);
      const completeNativeGesture = runtime.nativeHistoryGestureBarrierRef.current.observeScene(after as unknown as Scene);
      if (source && !runtime.globalHistoryScenePreviewRef.current && !replaying) {
        queue(
          source,
          nativeGestureActive && source === "mixed" ? "image-move" : "scene-change",
        );
      }
      if (!replaying && completeNativeGesture) flush();
      return { replaying, source, completeNativeGesture };
    },
    beginNativeGesture(scene: Scene) { runtime.nativeHistoryGestureBarrierRef.current.begin("image-transform", scene); },
    finishNativeGesture(scene: Scene | null) {
      if (scene === null) {
        runtime.nativeHistoryGestureBarrierRef.current.cancel();
        return false;
      }
      const completeNativeGesture = runtime.nativeHistoryGestureBarrierRef.current.pointerUp(scene);
      if (completeNativeGesture) flush();
      return completeNativeGesture;
    },
    synchronize() { runtime.globalHistoryRef.current.synchronize(port.capture()); },
    synchronizeTransient() { runtime.globalHistoryRef.current.synchronizeTransient(port.capture()); },
    beginReplay(scene: Scene) { runtime.globalHistoryReplayGateRef.current.begin(scene); },
  };
};

export const createDescriptionRuntimeAdapter = (port: {
  clearSelection: () => void;
  synchronizeTransient: () => void;
  moveStart: () => void;
  flush: () => void;
}) => ({
  clearVisualSelection: port.clearSelection,
  onAnchorDragStart: () => { port.synchronizeTransient(); port.moveStart(); },
  onAnchorMoveCommitted: port.flush,
});
