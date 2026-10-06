import type {
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";

export const CANVAS_SNAPSHOT_MIME_TYPE = "image/png";
export const DEFAULT_CANVAS_SNAPSHOT_MAX_DIMENSION = 2048;
export const DEFAULT_CANVAS_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;
export const CANVAS_SNAPSHOT_ATTEMPT_DIMENSIONS = [
  2048,
  1792,
  1536,
  1280,
  1024,
  768,
  512,
] as const;

const CANVAS_SNAPSHOT_EXPORT_PADDING = 24;
const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

type SnapshotAppState = Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;

export interface CanvasSnapshotCanvas {
  width: number;
  height: number;
  toDataURL(mimeType?: string): string;
}

export interface CanvasSnapshotExporter {
  (options: {
    elements: readonly NonDeleted<ExcalidrawElement>[];
    appState?: SnapshotAppState;
    files: BinaryFiles | null;
    maxWidthOrHeight?: number;
    exportPadding?: number;
    exportingFrame?: ExcalidrawFrameLikeElement | null;
  }): Promise<CanvasSnapshotCanvas>;
}

export interface CanvasSnapshot {
  dataUrl: string;
  mimeType: typeof CANVAS_SNAPSHOT_MIME_TYPE;
  width: number;
  height: number;
  bytes: number;
}

export interface CanvasViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CanvasSnapshotError extends Error {
  readonly code:
    | "EMPTY_SCENE"
    | "INVALID_SNAPSHOT_LIMIT"
    | "INVALID_SNAPSHOT_DIMENSIONS"
    | "INVALID_VIEWPORT_BOUNDS"
    | "SNAPSHOT_DIMENSION_LIMIT_EXCEEDED"
    | "INVALID_SNAPSHOT_DATA_URL"
    | "SNAPSHOT_BYTE_LIMIT_EXCEEDED";

  constructor(
    code: CanvasSnapshotError["code"],
    message: string,
  ) {
    super(message);
    this.name = "CanvasSnapshotError";
    this.code = code;
  }
}

const assertPositiveSafeInteger = (label: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CanvasSnapshotError(
      "INVALID_SNAPSHOT_LIMIT",
      `${label}必须是正整数。`,
    );
  }
};

const createViewportExportFrame = (
  viewportBounds: CanvasViewportBounds,
): ExcalidrawFrameLikeElement => {
  const { x, y, width, height } = viewportBounds;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw new CanvasSnapshotError(
      "INVALID_VIEWPORT_BOUNDS",
      "当前视窗边界不可用。",
    );
  }
  return {
    id: "ai-canvas-publish-viewport",
    type: "frame",
    name: null,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 0,
    strokeStyle: "solid",
    roundness: null,
    roughness: 0,
    opacity: 0,
    seed: 0,
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: true,
  } as ExcalidrawFrameLikeElement;
};

const getNonDeletedElements = (
  elements: readonly ExcalidrawElement[],
): NonDeleted<ExcalidrawElement>[] =>
  elements.filter(
    (element): element is NonDeleted<ExcalidrawElement> => !element.isDeleted,
  );

const bytesFromPngDataUrl = (dataUrl: string): number => {
  const match = PNG_DATA_URL_PATTERN.exec(dataUrl);
  const encoded = match?.[1];
  if (!encoded || encoded.length % 4 !== 0) {
    throw new CanvasSnapshotError(
      "INVALID_SNAPSHOT_DATA_URL",
      "画布快照未生成有效的 PNG data URL。",
    );
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
};

const snapshotAttemptDimensions = (maxDimension: number): readonly number[] => [
  maxDimension,
  ...CANVAS_SNAPSHOT_ATTEMPT_DIMENSIONS.filter(
    (dimension) => dimension < maxDimension,
  ),
];

const loadPublicCanvasExporter = async (): Promise<CanvasSnapshotExporter> => {
  const module = await import("@excalidraw/excalidraw");
  return module.exportToCanvas as CanvasSnapshotExporter;
};

export const createCanvasSnapshot = async ({
  elements,
  appState,
  files,
  maxDimension = DEFAULT_CANVAS_SNAPSHOT_MAX_DIMENSION,
  maxBytes = DEFAULT_CANVAS_SNAPSHOT_MAX_BYTES,
  exportCanvas,
  viewportBounds,
}: {
  elements: readonly ExcalidrawElement[];
  appState?: SnapshotAppState;
  files: BinaryFiles | null;
  maxDimension?: number;
  maxBytes?: number;
  exportCanvas?: CanvasSnapshotExporter;
  viewportBounds?: CanvasViewportBounds;
}): Promise<CanvasSnapshot> => {
  assertPositiveSafeInteger("画布快照最长边上限", maxDimension);
  assertPositiveSafeInteger("画布快照字节上限", maxBytes);

  const visibleElements = getNonDeletedElements(elements);
  if (visibleElements.length === 0) {
    throw new CanvasSnapshotError(
      "EMPTY_SCENE",
      "当前画布没有可渲染的元素，无法生成画布快照。",
    );
  }

  const renderCanvas = exportCanvas ?? (await loadPublicCanvasExporter());
  const exportingFrame = viewportBounds
    ? createViewportExportFrame(viewportBounds)
    : null;
  const exportOptions = {
    elements: visibleElements,
    appState,
    files,
    exportPadding: CANVAS_SNAPSHOT_EXPORT_PADDING,
    exportingFrame,
  };
  const attempts = snapshotAttemptDimensions(maxDimension);
  for (const attemptDimension of attempts) {
    const canvas = await renderCanvas({
      ...exportOptions,
      maxWidthOrHeight: attemptDimension,
    });
    if (
      !Number.isSafeInteger(canvas.width) ||
      !Number.isSafeInteger(canvas.height) ||
      canvas.width <= 0 ||
      canvas.height <= 0
    ) {
      throw new CanvasSnapshotError(
        "INVALID_SNAPSHOT_DIMENSIONS",
        "画布快照没有有效的输出尺寸。",
      );
    }
    if (Math.max(canvas.width, canvas.height) > attemptDimension) {
      throw new CanvasSnapshotError(
        "SNAPSHOT_DIMENSION_LIMIT_EXCEEDED",
        `画布快照最长边超过 ${attemptDimension}px 上限。`,
      );
    }

    const dataUrl = canvas.toDataURL(CANVAS_SNAPSHOT_MIME_TYPE);
    const bytes = bytesFromPngDataUrl(dataUrl);
    if (bytes <= maxBytes) {
      return {
        dataUrl,
        mimeType: CANVAS_SNAPSHOT_MIME_TYPE,
        width: canvas.width,
        height: canvas.height,
        bytes,
      };
    }
  }

  throw new CanvasSnapshotError(
    "SNAPSHOT_BYTE_LIMIT_EXCEEDED",
    `画布快照在最小 ${attempts.at(-1)}px 降采样后仍超过 ${maxBytes} 字节上限。请缩小当前视窗或减少可见内容。`,
  );
};
