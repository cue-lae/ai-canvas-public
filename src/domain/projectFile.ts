import type {
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  createEmptyBusinessState,
  type BusinessState,
  type P0Bundle,
  type PersistedAppState,
} from "./types";
import {
  FolderMigrationError,
  migrateBusinessStateToV2,
  migrateCanonicalSceneToV3,
} from "./folderScene";

const AI_CANVAS_PROJECT_FORMAT = "ai-canvas-project";

interface AiCanvasProjectMetadata {
  format: typeof AI_CANVAS_PROJECT_FORMAT;
  version: 3;
  savedAt: string;
  business: BusinessState;
  focusImageIds: string[];
  focusFolderId: string;
}

interface AiCanvasProjectFile {
  type: "excalidraw";
  version: 2;
  source: "ai-canvas";
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  files: BinaryFiles;
  aiCanvas: AiCanvasProjectMetadata;
}

export interface ParsedAiCanvasProject {
  bundle: P0Bundle;
  focusImageIds: string[];
  focusFolderId: string;
  sourceFormat: "ai-canvas-project" | "legacy-p0" | "excalidraw";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const defaultAppState = (): PersistedAppState => ({
  viewBackgroundColor: "#f7f5f0",
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 } as PersistedAppState["zoom"],
  theme: "light",
  gridSize: 20,
  gridModeEnabled: false,
  objectsSnapModeEnabled: false,
});

const parsedAppState = (value: unknown): PersistedAppState => {
  const defaults = defaultAppState();
  if (!isRecord(value)) {
    return defaults;
  }
  return {
    ...defaults,
    ...(typeof value.viewBackgroundColor === "string"
      ? { viewBackgroundColor: value.viewBackgroundColor }
      : {}),
    ...(typeof value.scrollX === "number" ? { scrollX: value.scrollX } : {}),
    ...(typeof value.scrollY === "number" ? { scrollY: value.scrollY } : {}),
    ...(isRecord(value.zoom) && typeof value.zoom.value === "number"
      ? { zoom: value.zoom as PersistedAppState["zoom"] }
      : {}),
    ...(value.theme === "dark" || value.theme === "light"
      ? { theme: value.theme }
      : {}),
    ...(typeof value.gridSize === "number" ? { gridSize: value.gridSize } : {}),
    ...(typeof value.gridModeEnabled === "boolean"
      ? { gridModeEnabled: value.gridModeEnabled }
      : {}),
    ...(typeof value.objectsSnapModeEnabled === "boolean"
      ? { objectsSnapModeEnabled: value.objectsSnapModeEnabled }
      : {}),
  };
};

export const serializeAiCanvasProjectFile = (
  bundle: P0Bundle,
  focusImageIds: readonly string[],
  focusFolderId: string,
): string => {
  const business = migrateBusinessStateToV2(bundle.business);
  const folder = business.folders[focusFolderId];
  if (!folder) {
    throw new FolderMigrationError("保存时缺少明确有效的工作 scope");
  }
  const normalizedFocusImageIds = [...new Set(focusImageIds)];
  if (
    normalizedFocusImageIds.some(
      (imageId) => business.imageAssets[imageId]?.folderId !== focusFolderId,
    )
  ) {
    throw new FolderMigrationError("重点图片不属于当前工作 scope");
  }
  const project: AiCanvasProjectFile = {
    type: "excalidraw",
    version: 2,
    source: "ai-canvas",
    elements: migrateCanonicalSceneToV3(bundle.scene.elements, business),
    appState: bundle.scene.appState,
    files: bundle.scene.files,
    aiCanvas: {
      format: AI_CANVAS_PROJECT_FORMAT,
      version: 3,
      savedAt: bundle.savedAt,
      business,
      focusImageIds: normalizedFocusImageIds,
      focusFolderId,
    },
  };
  return JSON.stringify(project, null, 2);
};

export const parseAiCanvasProjectFile = (
  serialized: string,
): ParsedAiCanvasProject => {
  const value: unknown = JSON.parse(serialized);
  if (!isRecord(value)) {
    throw new Error("项目文件不是有效的 JSON 对象");
  }
  if (
    value.format === "ai-canvas-excalidraw-p0" &&
    value.version === 1 &&
    isRecord(value.scene) &&
    isRecord(value.business)
  ) {
    const business = migrateBusinessStateToV2(
      value.business as unknown as BusinessState,
    );
    return {
      bundle: {
        ...(value as unknown as P0Bundle),
        version: 3,
        scene: {
          ...(value.scene as unknown as P0Bundle["scene"]),
          elements: migrateCanonicalSceneToV3(
            (value.scene as unknown as P0Bundle["scene"]).elements,
            business,
          ),
        },
        business,
      },
      focusImageIds: [],
      focusFolderId: business.rootFolderId,
      sourceFormat: "legacy-p0",
    };
  }
  if (value.type !== "excalidraw" || !Array.isArray(value.elements)) {
    throw new Error("不是可编辑的 Excalidraw／AI Canvas 项目文件");
  }
  const metadata = isRecord(value.aiCanvas) ? value.aiCanvas : null;
  const isAiCanvasProject =
    metadata?.format === AI_CANVAS_PROJECT_FORMAT &&
    (metadata.version === 1 || metadata.version === 3) &&
    isRecord(metadata.business);
  if (metadata && !isAiCanvasProject) {
    throw new FolderMigrationError("AI Canvas metadata 损坏或版本不受支持");
  }
  const savedAt =
    isAiCanvasProject && typeof metadata.savedAt === "string"
      ? metadata.savedAt
      : new Date().toISOString();
  const files = isRecord(value.files) ? value.files : {};
  const business = isAiCanvasProject
    ? migrateBusinessStateToV2(metadata.business as unknown as BusinessState)
    : createEmptyBusinessState("opened-excalidraw");
  if (
    isAiCanvasProject &&
    metadata.version === 3 &&
    (value.elements as unknown[]).some(
      (element) =>
        isRecord(element) &&
        isRecord(element.customData) &&
        element.customData.kind === "folder-frame",
    )
  ) {
    throw new FolderMigrationError("v3 项目仍包含 legacy Folder Frame");
  }
  const focusFolderId =
    isAiCanvasProject &&
    typeof metadata.focusFolderId === "string" &&
    business.folders[metadata.focusFolderId]
      ? metadata.focusFolderId
      : business.rootFolderId;
  const focusImageIds =
    isAiCanvasProject && Array.isArray(metadata.focusImageIds)
      ? metadata.focusImageIds.filter(
          (id): id is string =>
            typeof id === "string" &&
            business.imageAssets[id]?.folderId === focusFolderId,
        )
      : [];
  return {
    bundle: {
      format: "ai-canvas-excalidraw-p0",
      version: 3,
      savedAt,
      scene: {
        elements: isAiCanvasProject
          ? migrateCanonicalSceneToV3(
              value.elements as unknown as readonly ExcalidrawElement[],
              business,
            )
          : (value.elements as unknown as readonly ExcalidrawElement[]),
        appState: parsedAppState(value.appState),
        files: files as BinaryFiles,
      },
      business,
    },
    focusImageIds,
    focusFolderId,
    sourceFormat: isAiCanvasProject ? "ai-canvas-project" : "excalidraw",
  };
};

export const aiCanvasProjectFilename = (savedAt = new Date()): string =>
  `AI-Canvas-${savedAt.toISOString().slice(0, 19).replaceAll(":", "-")}.excalidraw`;
