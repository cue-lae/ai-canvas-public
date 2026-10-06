import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  GlobalHistoryTimeline,
  type GlobalHistorySnapshot,
  type GlobalHistorySource,
} from "../domain/globalHistoryTimeline";
import {
  AsyncHistoryReplayGate,
  NativeGestureHistoryBarrier,
} from "./globalHistorySceneSync";
import {
  EMPTY_CANVAS_SELECTION,
  canvasSelectionsEqual,
  type CanvasSelection,
} from "./canvasSelection";
import {
  createCanvasMenuActionHandler,
  type CanvasMenuAction,
} from "./canvasMenuState";
import type { CanvasMarqueeSelectionMode } from "./canvasObjectSelection";

export interface HostMarqueePointerSession {
  kind: "pending-marquee" | "marquee";
  pointerId: number;
  root: HTMLElement;
  start: Readonly<{ x: number; y: number }>;
  current: Readonly<{ x: number; y: number }>;
  moved: boolean;
}

export type CanvasPointerSession =
  | { kind: "idle" }
  | HostMarqueePointerSession;

export interface CanvasMarqueeViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
  mode: CanvasMarqueeSelectionMode;
}

export interface PendingGlobalHistoryCommit {
  source: GlobalHistorySource;
  operation: string;
  timer: number | null;
}

export type CanvasInteractionSnapshot<Business, Scene> = GlobalHistorySnapshot<
  Business,
  Scene,
  CanvasSelection
>;

export interface CanvasInteractionRuntime<Business, Scene> {
  canvasSelection: CanvasSelection;
  canvasSelectionRef: MutableRefObject<CanvasSelection>;
  updateCanvasSelection: (selection: CanvasSelection) => void;
  isCanvasMenuOpen: boolean;
  setIsCanvasMenuOpen: Dispatch<SetStateAction<boolean>>;
  applyCanvasMenuAction: (action: CanvasMenuAction) => void;
  canvasPointerSessionRef: MutableRefObject<CanvasPointerSession>;
  canvasMarqueeRect: CanvasMarqueeViewportRect | null;
  setCanvasMarqueeRect: Dispatch<SetStateAction<CanvasMarqueeViewportRect | null>>;
  globalHistoryRef: MutableRefObject<
    GlobalHistoryTimeline<CanvasInteractionSnapshot<Business, Scene>>
  >;
  pendingGlobalHistoryCommitRef: MutableRefObject<PendingGlobalHistoryCommit | null>;
  globalHistoryReplayGateRef: MutableRefObject<AsyncHistoryReplayGate<Scene>>;
  nativeHistoryGestureBarrierRef: MutableRefObject<NativeGestureHistoryBarrier<Scene>>;
  globalHistoryScenePreviewRef: MutableRefObject<boolean>;
}

export type CanvasHistoryRuntime<Business, Scene> = Pick<
  CanvasInteractionRuntime<Business, Scene>,
  | "globalHistoryRef"
  | "pendingGlobalHistoryCommitRef"
  | "globalHistoryReplayGateRef"
  | "nativeHistoryGestureBarrierRef"
  | "globalHistoryScenePreviewRef"
>;

export type CanvasPointerRuntime<Scene> = Pick<
  CanvasInteractionRuntime<unknown, Scene>,
  "canvasPointerSessionRef" | "updateCanvasSelection"
>;

export const createCanvasHistoryRuntime = <Business, Scene>(input: CanvasHistoryRuntime<Business, Scene>): CanvasHistoryRuntime<Business, Scene> => input;

export const createCanvasPointerRuntime = <Scene>(input: CanvasPointerRuntime<Scene>): CanvasPointerRuntime<Scene> => input;

/**
 * Runtime-only host assembly for V9 interaction state. It deliberately has no
 * dependency on themes, project files, publishing, or description business
 * data; those remain injected by App through ordinary callbacks.
 */
export const useCanvasInteractionRuntime = <Business, Scene>(input: {
  cloneSnapshot: (
    snapshot: CanvasInteractionSnapshot<Business, Scene>,
  ) => CanvasInteractionSnapshot<Business, Scene>;
  snapshotsEqual: (
    left: CanvasInteractionSnapshot<Business, Scene>,
    right: CanvasInteractionSnapshot<Business, Scene>,
  ) => boolean;
  cloneScene: (scene: Scene) => Scene;
  scenesEqual: (left: Scene, right: Scene) => boolean;
}): CanvasInteractionRuntime<Business, Scene> => {
  const [canvasSelection, setCanvasSelection] = useState<CanvasSelection>(
    EMPTY_CANVAS_SELECTION,
  );
  const [isCanvasMenuOpen, setIsCanvasMenuOpen] = useState(false);
  const [canvasMarqueeRect, setCanvasMarqueeRect] =
    useState<CanvasMarqueeViewportRect | null>(null);
  const canvasSelectionRef = useRef<CanvasSelection>(EMPTY_CANVAS_SELECTION);
  const canvasPointerSessionRef = useRef<CanvasPointerSession>({ kind: "idle" });
  const globalHistoryRef = useRef(
    new GlobalHistoryTimeline<CanvasInteractionSnapshot<Business, Scene>>(
      input.cloneSnapshot,
      input.snapshotsEqual,
    ),
  );
  const pendingGlobalHistoryCommitRef =
    useRef<PendingGlobalHistoryCommit | null>(null);
  const globalHistoryReplayGateRef = useRef(
    new AsyncHistoryReplayGate(input.cloneScene, input.scenesEqual),
  );
  const nativeHistoryGestureBarrierRef = useRef(
    new NativeGestureHistoryBarrier(input.cloneScene, input.scenesEqual),
  );
  const globalHistoryScenePreviewRef = useRef(false);
  const updateCanvasSelection = useCallback((next: CanvasSelection) => {
    canvasSelectionRef.current = next;
    setCanvasSelection((current) =>
      canvasSelectionsEqual(current, next) ? current : next,
    );
  }, []);
  const applyCanvasMenuAction = useMemo(
    () => createCanvasMenuActionHandler(setIsCanvasMenuOpen),
    [],
  );

  return {
    canvasSelection,
    canvasSelectionRef,
    updateCanvasSelection,
    isCanvasMenuOpen,
    setIsCanvasMenuOpen,
    applyCanvasMenuAction,
    canvasPointerSessionRef,
    canvasMarqueeRect,
    setCanvasMarqueeRect,
    globalHistoryRef,
    pendingGlobalHistoryCommitRef,
    globalHistoryReplayGateRef,
    nativeHistoryGestureBarrierRef,
    globalHistoryScenePreviewRef,
  };
};
