import type {
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type Point = Readonly<{ x: number; y: number }>;

export type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type StableId = string;

export const ROOT_FOLDER_ID = "folder-root";

export interface FolderRecord {
  id: StableId;
  schemaVersion: 2;
  kind: "root" | "folder";
  name: string;
  imageAssetIds: StableId[];
  descriptionIds: StableId[];
  focusImageIds: StableId[];
  coverElementId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: StableId;
  schemaVersion: 1;
  title: string;
  imageAssetIds: StableId[];
  imagePlacementIds: StableId[];
  regionIds: StableId[];
  annotationIds: StableId[];
  descriptionIds: StableId[];
  descriptionScopeLinkIds: StableId[];
  descriptionReferenceIds: StableId[];
  aiExchangeIds: StableId[];
  quickAnnotationIds?: StableId[];
  nextQuickAnnotationOrdinal?: number;
  folderIds?: StableId[];
  updatedAt: string;
}

export interface ImageAssetRecord {
  id: StableId;
  fileId: string;
  name: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  source: "local" | "generated-benchmark";
  createdAt: string;
  folderId?: StableId;
}

export interface ImagePlacementRecord {
  id: StableId;
  imageId: StableId;
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  scale: [number, number];
  crop: ImageCropRecord | null;
  active: boolean;
  folderId?: StableId;
}

export interface ImageCropRecord {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface RegionGeometry {
  sceneCorners: Point[];
  imageLocalCorners: Point[];
  originalPixelCorners: Point[];
  normalizedCorners: Point[];
  originalPixelBounds: Bounds;
  clippedPixelBounds: Bounds;
  isClipped: boolean;
  roundTripMaxErrorPx: number;
}

export interface RegionRecord {
  id: StableId;
  imageId: StableId;
  elementId: string;
  geometry: RegionGeometry | null;
  active: boolean;
  status: "valid" | "invalid";
  error?: string;
  folderId?: StableId;
}

export interface AnnotationRecord {
  id: StableId;
  regionId: StableId;
  elementId: string;
  text: string;
  active: boolean;
}

export interface DescriptionRecord {
  id: StableId;
  text: string;
  referenceUrl?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  folderId?: StableId;
  elementId?: string;
}

export interface DescriptionScopeLinkRecord {
  id: StableId;
  descriptionId: StableId;
  regionId: StableId;
  folderId?: StableId;
}

export interface DescriptionReferenceRecord {
  id: StableId;
  descriptionId: StableId;
  anchor: Point;
  imageBinding?: {
    imageId: StableId;
    relativeX: number;
  };
  collapsed: boolean;
  active: boolean;
  folderId?: StableId;
}

export interface AIExchangeRecord {
  id: StableId;
  regionId: StableId;
  question: string;
  answer: string;
  provider: "local-mock";
  status: "completed" | "invalid";
  createdAt: string;
}

export type QuickAnnotationMode = "point" | "rectangle";

export interface QuickAnnotationRecord {
  id: StableId;
  imageId: StableId;
  mode: QuickAnnotationMode;
  anchor: Point;
  labelAnchor?: Point;
  labelSide?: "left" | "right";
  rectangle?: Bounds;
  text: string;
  ordinal: number;
  collapsed: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessState {
  schemaVersion?: 2;
  rootFolderId?: StableId;
  document: DocumentRecord;
  imageAssets: Record<StableId, ImageAssetRecord>;
  imagePlacements: Record<StableId, ImagePlacementRecord>;
  regions: Record<StableId, RegionRecord>;
  annotations: Record<StableId, AnnotationRecord>;
  descriptions: Record<StableId, DescriptionRecord>;
  descriptionScopeLinks: Record<StableId, DescriptionScopeLinkRecord>;
  descriptionReferences: Record<StableId, DescriptionReferenceRecord>;
  aiExchanges: Record<StableId, AIExchangeRecord>;
  quickAnnotations?: Record<StableId, QuickAnnotationRecord>;
  folders?: Record<StableId, FolderRecord>;
}

export interface BusinessStateV2 extends BusinessState {
  schemaVersion: 2;
  rootFolderId: StableId;
  document: DocumentRecord & {
    quickAnnotationIds: StableId[];
    nextQuickAnnotationOrdinal: number;
  };
  quickAnnotations: Record<StableId, QuickAnnotationRecord>;
  folders: Record<StableId, FolderRecord>;
}

export interface PersistedAppState {
  viewBackgroundColor: string;
  scrollX: number;
  scrollY: number;
  zoom: AppState["zoom"];
  theme: AppState["theme"];
  gridSize: number;
  gridModeEnabled: boolean;
  objectsSnapModeEnabled: boolean;
}

export interface ExcalidrawSceneSnapshot {
  elements: readonly ExcalidrawElement[];
  appState: PersistedAppState;
  files: BinaryFiles;
}

export interface P0Bundle {
  format: "ai-canvas-excalidraw-p0";
  version: 1 | 3;
  savedAt: string;
  scene: ExcalidrawSceneSnapshot;
  business: BusinessState;
}

export interface ValidationIssue {
  code:
    | "INVALID_CUSTOM_DATA"
    | "MISSING_IMAGE_ASSET"
    | "MISSING_IMAGE_ELEMENT"
    | "MISSING_IMAGE_FILE"
    | "MISSING_REGION"
    | "INVALID_GEOMETRY"
    | "FOLDER_MIGRATION_FAILED"
    | "CROSS_FOLDER_RELATION";
  message: string;
  elementId?: string;
  businessId?: string;
}

export interface ReconcileResult {
  state: BusinessStateV2;
  issues: ValidationIssue[];
}

export const createEmptyBusinessState = (
  documentId = "document-p0",
): BusinessStateV2 => {
  const now = new Date().toISOString();
  return {
  schemaVersion: 2,
  rootFolderId: ROOT_FOLDER_ID,
  document: {
    id: documentId,
    schemaVersion: 1,
    title: "AI Canvas · Excalidraw P0",
    imageAssetIds: [],
    imagePlacementIds: [],
    regionIds: [],
    annotationIds: [],
    descriptionIds: [],
    descriptionScopeLinkIds: [],
    descriptionReferenceIds: [],
    aiExchangeIds: [],
    quickAnnotationIds: [],
    nextQuickAnnotationOrdinal: 1,
    folderIds: [ROOT_FOLDER_ID],
    updatedAt: now,
  },
  imageAssets: {},
  imagePlacements: {},
  regions: {},
  annotations: {},
  descriptions: {},
  descriptionScopeLinks: {},
  descriptionReferences: {},
  aiExchanges: {},
  quickAnnotations: {},
  folders: {
    [ROOT_FOLDER_ID]: {
      id: ROOT_FOLDER_ID,
      schemaVersion: 2,
      kind: "root",
      name: "Root",
      imageAssetIds: [],
      descriptionIds: [],
      focusImageIds: [],
      createdAt: now,
      updatedAt: now,
    },
  },
};
};

export const appendUnique = (values: string[], value: string): string[] =>
  values.includes(value) ? values : [...values, value];
