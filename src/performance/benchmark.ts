import {
  CaptureUpdateAction,
  newElementWith,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawRectangleElement,
} from "@excalidraw/excalidraw/element/types";
import {
  appendUnique,
  createEmptyBusinessState,
  type BusinessState,
  type P0Bundle,
} from "../domain/types";
import { reconcileBusinessState } from "../domain/reconcile";
import {
  createImageElement,
  createRegionElement,
  stableId,
} from "../excalidraw/scene";
import {
  createBenchmarkImage,
  createBinaryFileData,
} from "../services/imageProcessing";
import {
  loadP0Bundle,
  sanitizeAppState,
  saveP0Bundle,
  serializedSizeBytes,
} from "../services/persistence";

export interface FrameStats {
  frames: number;
  meanFrameMs: number;
  p95FrameMs: number;
  approximateFps: number;
  framesOver33Ms: number;
}

export interface PerformanceBenchmarkResult {
  measuredAt: string;
  browser: string;
  imageCount: number;
  imagePixelSize: string;
  roiCount: number;
  seedSceneMs: number;
  serializedBytes: number;
  serializeMs: number;
  saveMs: number;
  loadFromStorageMs: number;
  restoreSceneMs: number;
  panZoom: FrameStats;
  roiEdit: FrameStats;
  heapBeforeMb: number | null;
  heapAfterMb: number | null;
  heapDeltaMb: number | null;
}

export interface SeedBenchmarkResult {
  business: BusinessState;
  seedSceneMs: number;
}

const nextFrame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame(resolve));

const memoryMb = (): number | null => {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  return typeof memory?.usedJSHeapSize === "number"
    ? memory.usedJSHeapSize / 1024 / 1024
    : null;
};

const frameStats = (durations: number[]): FrameStats => {
  const sorted = [...durations].sort((a, b) => a - b);
  const mean =
    durations.reduce((sum, duration) => sum + duration, 0) /
    Math.max(1, durations.length);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return {
    frames: durations.length,
    meanFrameMs: mean,
    p95FrameMs: p95,
    approximateFps: mean > 0 ? 1000 / mean : 0,
    framesOver33Ms: durations.filter((duration) => duration > 33.3).length,
  };
};

export const seedBenchmarkScene = async (
  api: ExcalidrawImperativeAPI,
): Promise<SeedBenchmarkResult> => {
  const started = performance.now();
  api.resetScene();
  const generated = await Promise.all([
    createBenchmarkImage("4K · A", 205),
    createBenchmarkImage("4K · B", 26),
    createBenchmarkImage("4K · C", 142),
  ]);
  let business = createEmptyBusinessState("document-benchmark");
  const files: BinaryFileData[] = [];
  const elements: ExcalidrawElement[] = [];
  const imageIds: string[] = [];
  let firstRegionElementId = "";

  generated.forEach((image, index) => {
    const imageId = stableId("image");
    const placementId = stableId("placement");
    const fileId = stableId("file");
    const element = createImageElement({
      fileId,
      imageId,
      placementId,
      x: index * 850,
      y: index % 2 === 0 ? 0 : 520,
      width: 768,
      height: 432,
      angle: [0, 0.08, -0.06][index],
    });
    imageIds.push(imageId);
    files.push(createBinaryFileData(fileId, image));
    elements.push(element);
    business.imageAssets[imageId] = {
      id: imageId,
      fileId,
      name: `benchmark-${index + 1}-3840x2160.png`,
      mimeType: "image/png",
      naturalWidth: 3840,
      naturalHeight: 2160,
      source: "generated-benchmark",
      createdAt: new Date().toISOString(),
    };
    business.document.imageAssetIds = appendUnique(
      business.document.imageAssetIds,
      imageId,
    );
    business.document.imagePlacementIds = appendUnique(
      business.document.imagePlacementIds,
      placementId,
    );
  });

  for (let index = 0; index < 100; index += 1) {
    const imageIndex = index % imageIds.length;
    const column = Math.floor(index / imageIds.length) % 8;
    const row = Math.floor(index / (imageIds.length * 8));
    const imageElement = elements[imageIndex];
    const regionId = stableId("region");
    const regionElement = createRegionElement({
      imageId: imageIds[imageIndex],
      regionId,
      x: imageElement.x + 34 + column * 82,
      y: imageElement.y + 30 + row * 78,
      width: 66,
      height: 52,
    });
    if (index === 0) {
      firstRegionElementId = regionElement.id;
    }
    elements.push(regionElement);
    business.regions[regionId] = {
      id: regionId,
      imageId: imageIds[imageIndex],
      elementId: regionElement.id,
      geometry: null,
      active: true,
      status: "valid",
    };
    business.document.regionIds = appendUnique(
      business.document.regionIds,
      regionId,
    );
  }

  api.addFiles(files);
  api.updateScene({
    elements,
    appState: {
      scrollX: 40,
      scrollY: 40,
      zoom: { value: 0.7 } as AppState["zoom"],
      selectedElementIds: firstRegionElementId
        ? { [firstRegionElementId]: true }
        : {},
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  await nextFrame();
  await nextFrame();

  business = reconcileBusinessState(
    business,
    elements,
    new Set(files.map((file) => file.id)),
  ).state;

  return {
    business,
    seedSceneMs: performance.now() - started,
  };
};

const measurePanZoom = async (
  api: ExcalidrawImperativeAPI,
): Promise<FrameStats> => {
  const initial = api.getAppState();
  const durations: number[] = [];
  let previous = await nextFrame();
  for (let index = 0; index < 60; index += 1) {
    api.updateScene({
      appState: {
        scrollX: initial.scrollX + Math.sin(index / 7) * 160,
        scrollY: initial.scrollY + Math.cos(index / 8) * 90,
        zoom: {
          value: 0.62 + (index % 12) * 0.015,
        } as AppState["zoom"],
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    const current = await nextFrame();
    durations.push(current - previous);
    previous = current;
  }
  api.updateScene({
    appState: {
      scrollX: initial.scrollX,
      scrollY: initial.scrollY,
      zoom: initial.zoom,
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return frameStats(durations);
};

const measureRoiEdit = async (
  api: ExcalidrawImperativeAPI,
): Promise<FrameStats> => {
  const originalElements = api.getSceneElements();
  const target = originalElements.find(
    (element) =>
      element.type === "rectangle" &&
      element.customData?.kind === "region",
  ) as ExcalidrawRectangleElement | undefined;
  if (!target) {
    return frameStats([]);
  }

  const durations: number[] = [];
  let currentElements = originalElements;
  let previous = await nextFrame();
  for (let index = 0; index < 30; index += 1) {
    currentElements = currentElements.map((element) =>
      element.id === target.id
        ? newElementWith(element, {
            x: target.x + Math.sin(index / 4) * 24,
            y: target.y + Math.cos(index / 5) * 14,
          })
        : element,
    );
    api.updateScene({
      elements: currentElements,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    const current = await nextFrame();
    durations.push(current - previous);
    previous = current;
  }
  api.updateScene({
    elements: originalElements,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return frameStats(durations);
};

export const runPerformanceBenchmark = async (
  api: ExcalidrawImperativeAPI,
  business: BusinessState,
  seedSceneMs: number,
): Promise<PerformanceBenchmarkResult> => {
  const heapBeforeMb = memoryMb();
  const scene = {
    elements: api.getSceneElementsIncludingDeleted(),
    appState: sanitizeAppState(api.getAppState()),
    files: api.getFiles(),
  };
  const bundle: P0Bundle = {
    format: "ai-canvas-excalidraw-p0",
    version: 1,
    savedAt: new Date().toISOString(),
    scene,
    business,
  };

  const serializeStarted = performance.now();
  const serializedBytes = serializedSizeBytes(bundle);
  const serializeMs = performance.now() - serializeStarted;

  const saveStarted = performance.now();
  await saveP0Bundle(bundle);
  const saveMs = performance.now() - saveStarted;

  const loadStarted = performance.now();
  const loaded = await loadP0Bundle();
  const loadFromStorageMs = performance.now() - loadStarted;
  if (!loaded) {
    throw new Error("性能基准保存后未能从 IndexedDB 读取数据");
  }

  const restoreStarted = performance.now();
  api.addFiles(Object.values(loaded.scene.files));
  api.updateScene({
    elements: loaded.scene.elements,
    appState: loaded.scene.appState,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  await nextFrame();
  await nextFrame();
  const restoreSceneMs = performance.now() - restoreStarted;

  const panZoom = await measurePanZoom(api);
  const roiEdit = await measureRoiEdit(api);
  const firstRegion = api.getSceneElements().find(
    (element) =>
      element.type === "rectangle" &&
      element.customData?.kind === "region",
  );
  if (firstRegion) {
    api.updateScene({
      appState: {
        selectedElementIds: { [firstRegion.id]: true },
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
  const heapAfterMb = memoryMb();

  return {
    measuredAt: new Date().toISOString(),
    browser: navigator.userAgent,
    imageCount: Object.keys(business.imageAssets).length,
    imagePixelSize: "3840 × 2160",
    roiCount: Object.keys(business.regions).length,
    seedSceneMs,
    serializedBytes,
    serializeMs,
    saveMs,
    loadFromStorageMs,
    restoreSceneMs,
    panZoom,
    roiEdit,
    heapBeforeMb,
    heapAfterMb,
    heapDeltaMb:
      heapBeforeMb !== null && heapAfterMb !== null
        ? heapAfterMb - heapBeforeMb
        : null,
  };
};
