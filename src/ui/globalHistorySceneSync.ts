import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { GlobalHistorySource } from "../domain/globalHistoryTimeline";

export type NativeHistoryGestureKind = "image-transform";

interface NativeHistoryGesture<Scene> {
  kind: NativeHistoryGestureKind;
  initialScene: Scene;
  lastObservedScene: Scene;
  observationGeneration: number;
  pointerUpExpectedScene: Scene | null;
  pointerUpObservationGeneration: number | null;
}

export class NativeGestureHistoryBarrier<Scene> {
  private gesture: NativeHistoryGesture<Scene> | null = null;

  constructor(
    private readonly cloneScene: (scene: Scene) => Scene,
    private readonly scenesEqual: (left: Scene, right: Scene) => boolean,
  ) {}

  get active(): boolean {
    return this.gesture !== null;
  }

  hasSceneChange(scene: Scene): boolean {
    return Boolean(
      this.gesture &&
        !this.scenesEqual(this.gesture.initialScene, scene),
    );
  }

  begin(kind: NativeHistoryGestureKind, initialScene: Scene): void {
    this.gesture = {
      kind,
      initialScene: this.cloneScene(initialScene),
      lastObservedScene: this.cloneScene(initialScene),
      observationGeneration: 0,
      pointerUpExpectedScene: null,
      pointerUpObservationGeneration: null,
    };
  }

  observeScene(scene: Scene): boolean {
    if (!this.gesture) {
      return false;
    }
    this.gesture.observationGeneration += 1;
    this.gesture.lastObservedScene = this.cloneScene(scene);
    return this.completeIfReady();
  }

  pointerUp(expectedFinalScene: Scene): boolean {
    if (!this.gesture) {
      return false;
    }
    if (this.scenesEqual(this.gesture.initialScene, expectedFinalScene)) {
      this.gesture = null;
      return false;
    }
    if (
      this.gesture.observationGeneration > 0 &&
      this.scenesEqual(this.gesture.lastObservedScene, expectedFinalScene)
    ) {
      this.gesture = null;
      return true;
    }
    this.gesture.pointerUpExpectedScene = this.cloneScene(expectedFinalScene);
    this.gesture.pointerUpObservationGeneration =
      this.gesture.observationGeneration;
    return false;
  }

  cancel(): void {
    this.gesture = null;
  }

  private completeIfReady(): boolean {
    if (
      !this.gesture?.pointerUpExpectedScene ||
      this.gesture.pointerUpObservationGeneration === null ||
      this.gesture.observationGeneration <=
        this.gesture.pointerUpObservationGeneration ||
      !this.scenesEqual(
        this.gesture.lastObservedScene,
        this.gesture.pointerUpExpectedScene,
      )
    ) {
      return false;
    }
    this.gesture = null;
    return true;
  }
}

export class AsyncHistoryReplayGate<Scene> {
  private expectedScene: Scene | null = null;

  constructor(
    private readonly cloneScene: (scene: Scene) => Scene,
    private readonly scenesEqual: (left: Scene, right: Scene) => boolean,
  ) {}

  get active(): boolean {
    return this.expectedScene !== null;
  }

  begin(expectedScene: Scene): void {
    this.expectedScene = this.cloneScene(expectedScene);
  }

  observeScene(scene: Scene): boolean {
    if (!this.expectedScene || !this.scenesEqual(this.expectedScene, scene)) {
      return false;
    }
    this.expectedScene = null;
    return true;
  }
}

const persistentElement = (element: ExcalidrawElement): string =>
  JSON.stringify(element);

export const classifyGlobalHistorySceneChange = (
  before: readonly ExcalidrawElement[],
  after: readonly ExcalidrawElement[],
): GlobalHistorySource | null => {
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));
  const changed = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changedElements = [...changed].flatMap((id) => {
    const previous = beforeById.get(id);
    const next = afterById.get(id);
    return !previous || !next || persistentElement(previous) !== persistentElement(next)
      ? [next ?? previous]
      : [];
  }).filter((element): element is ExcalidrawElement => Boolean(element));
  if (changedElements.length === 0) {
    return null;
  }
  if (changedElements.some((element) => element.type === "image")) {
    return "mixed";
  }
  if (changedElements.every((element) => Boolean(element.customData?.kind))) {
    return "host";
  }
  return null;
};
