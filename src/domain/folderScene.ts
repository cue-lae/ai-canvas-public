import {
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  ROOT_FOLDER_ID,
  type BusinessState,
  type BusinessStateV2,
  type FolderRecord,
} from "./types";
import {
  createImageBindingTransform,
  transformImageBoundBounds,
  transformImageBoundFreeDrawPoints,
  type ImageBindingTransform,
} from "./imageAnnotationBinding";

export const FOLDER_MIGRATION_FAILED = "FOLDER_MIGRATION_FAILED";
export const EMPTY_FOLDER_COVER_KIND = "folder-cover";

const imageIdOf = (element: ExcalidrawElement): string | null =>
  typeof element.customData?.imageId === "string"
    ? element.customData.imageId
    : null;

const regionIdOf = (element: ExcalidrawElement): string | null =>
  typeof element.customData?.regionId === "string"
    ? element.customData.regionId
    : null;

const elementBounds = (element: ExcalidrawElement) => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
});

/** Apply one native image gesture to its ROI closure from canonical scene truth. */
export const synchronizeImageBoundSceneElements = (
  incoming: readonly ExcalidrawElement[],
  previousCanonical: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => {
  const previousElementsById = new Map(
    previousCanonical.map((element) => [element.id, element] as const),
  );
  const previousImages = new Map(
    previousCanonical.flatMap((element) =>
      !element.isDeleted &&
      element.type === "image" &&
      element.customData?.kind === "image" &&
      imageIdOf(element)
        ? [[imageIdOf(element)!, element] as const]
        : [],
    ),
  );
  const transformsByImageId = new Map<string, ImageBindingTransform>();
  incoming.forEach((element) => {
    const imageId = imageIdOf(element);
    if (
      !imageId ||
      element.isDeleted ||
      element.type !== "image" ||
      element.customData?.kind !== "image"
    ) return;
    const previous = previousImages.get(imageId);
    if (!previous || previous.id !== element.id) return;
    const transform = createImageBindingTransform(previous, element);
    if (transform) transformsByImageId.set(imageId, transform);
  });
  if (transformsByImageId.size === 0) return incoming;

  const transformsByRegionId = new Map<string, ImageBindingTransform>();
  incoming.forEach((element) => {
    if (element.isDeleted || element.customData?.kind !== "region") return;
    const imageId = imageIdOf(element);
    const regionId = regionIdOf(element);
    const transform = imageId ? transformsByImageId.get(imageId) : null;
    if (regionId && transform) transformsByRegionId.set(regionId, transform);
  });

  return incoming.map((element) => {
    if (element.isDeleted) return element;
    if (element.customData?.kind === "image-shadow") {
      const imageId = imageIdOf(element);
      const transform = imageId ? transformsByImageId.get(imageId) : null;
      if (!transform) return element;
      const previousElement = previousElementsById.get(element.id);
      const sourceElement =
        previousElement &&
        !previousElement.isDeleted &&
        imageIdOf(previousElement) === imageId
          ? previousElement
          : element;
      return newElementWith(element, {
        ...transformImageBoundBounds(
          elementBounds(sourceElement),
          transform,
        ),
        locked: true,
      });
    }
    const regionId = regionIdOf(element);
    const transform = regionId ? transformsByRegionId.get(regionId) : null;
    if (!transform) return element;
    const previousElement = previousElementsById.get(element.id);
    const sourceElement =
      previousElement &&
      !previousElement.isDeleted &&
      regionIdOf(previousElement) === regionId
        ? previousElement
        : element;

    if (element.customData?.kind === "region") {
      const bounds = transformImageBoundBounds(
        elementBounds(sourceElement),
        transform,
      );
      const selectionPoints = Array.isArray(sourceElement.customData?.selectionPoints)
        ? sourceElement.customData.selectionPoints.map((point) =>
            Array.isArray(point) && point.length === 2
              ? [point[0] * transform.scaleX, point[1] * transform.scaleY]
              : point,
          )
        : null;
      if (element.type === "freedraw" && sourceElement.type === "freedraw") {
        return newElementWith(element, {
          ...bounds,
          points: transformImageBoundFreeDrawPoints(
            sourceElement.points,
            transform,
          ) as typeof element.points,
          ...(selectionPoints
            ? { customData: { ...element.customData, selectionPoints } }
            : {}),
        });
      }
      return newElementWith(element, {
        ...bounds,
        ...(selectionPoints
          ? { customData: { ...element.customData, selectionPoints } }
          : {}),
      });
    }

    if (element.customData?.kind === "annotation-card") {
      return newElementWith(
        element,
        transformImageBoundBounds(
          elementBounds(sourceElement),
          transform,
          false,
        ),
      );
    }
    return element;
  });
};

export class FolderMigrationError extends Error {
  readonly code = FOLDER_MIGRATION_FAILED;

  constructor(message: string) {
    super(message);
    this.name = "FolderMigrationError";
  }
}

const fail = (message: string): never => {
  throw new FolderMigrationError(message);
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const assertIndexedRecords = (
  label: string,
  ids: readonly string[],
  records: Readonly<Record<string, unknown>>,
): void => {
  const normalized = unique(ids);
  if (
    normalized.length !== ids.length ||
    normalized.some((id) => !records[id]) ||
    Object.keys(records).some((id) => !normalized.includes(id))
  ) {
    fail(`Document 的 ${label} 索引不闭合`);
  }
};

const folderIdOf = (value: { folderId?: string }): string | null =>
  typeof value.folderId === "string" && value.folderId.length > 0
    ? value.folderId
    : null;

const isFiniteUnit = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const assertQuickAnnotationClosure = (state: BusinessState): void => {
  const records = state.quickAnnotations ?? {};
  const ids = state.document.quickAnnotationIds ?? [];
  assertIndexedRecords("QuickAnnotation", ids, records);
  const ordinals = new Set<number>();
  let maxOrdinal = 0;
  Object.entries(records).forEach(([recordId, annotation]) => {
    if (annotation.id !== recordId) {
      fail(`QuickAnnotation ${recordId} 的稳定 id 不一致`);
    }
    if (!state.imageAssets[annotation.imageId]) {
      fail(`QuickAnnotation ${recordId} 引用未知 ImageAsset`);
    }
    if (
      !Number.isInteger(annotation.ordinal) ||
      annotation.ordinal < 1 ||
      ordinals.has(annotation.ordinal)
    ) {
      fail(`QuickAnnotation ${recordId} 的文档编号无效或重复`);
    }
    ordinals.add(annotation.ordinal);
    maxOrdinal = Math.max(maxOrdinal, annotation.ordinal);
    if (
      annotation.text !== annotation.text.trim() ||
      [...annotation.text].length < 1 ||
      [...annotation.text].length > 100
    ) {
      fail(`QuickAnnotation ${recordId} 的短文本无效`);
    }
    if (
      !isFiniteUnit(annotation.anchor.x) ||
      !isFiniteUnit(annotation.anchor.y)
    ) {
      fail(`QuickAnnotation ${recordId} 的归一化锚点无效`);
    }
    if (annotation.mode === "point") {
      if (annotation.rectangle !== undefined) {
        fail(`点 QuickAnnotation ${recordId} 不得包含矩形范围`);
      }
    } else if (annotation.mode === "rectangle") {
      const rectangle = annotation.rectangle;
      if (
        !rectangle ||
        !isFiniteUnit(rectangle.x) ||
        !isFiniteUnit(rectangle.y) ||
        !Number.isFinite(rectangle.width) ||
        !Number.isFinite(rectangle.height) ||
        rectangle.width <= 0 ||
        rectangle.height <= 0 ||
        rectangle.x + rectangle.width > 1 ||
        rectangle.y + rectangle.height > 1 ||
        !(
          Math.abs(annotation.anchor.x - rectangle.x) <= 1e-9 ||
          Math.abs(
            annotation.anchor.x - (rectangle.x + rectangle.width),
          ) <= 1e-9
        ) ||
        !(
          Math.abs(annotation.anchor.y - rectangle.y) <= 1e-9 ||
          Math.abs(
            annotation.anchor.y - (rectangle.y + rectangle.height),
          ) <= 1e-9
        )
      ) {
        fail(`矩形 QuickAnnotation ${recordId} 的归一化范围无效`);
      }
    } else {
      fail(`QuickAnnotation ${recordId} 的模式无效`);
    }
  });
  const nextOrdinal = state.document.nextQuickAnnotationOrdinal ?? 1;
  if (
    !Number.isInteger(nextOrdinal) ||
    nextOrdinal < 1 ||
    nextOrdinal <= maxOrdinal
  ) {
    fail("Document 的快速标注编号计数器无效");
  }
};

export const isBusinessStateV2 = (
  state: BusinessState,
): state is BusinessStateV2 =>
  state.schemaVersion === 2 &&
  typeof state.rootFolderId === "string" &&
  Boolean(state.folders);

const assertLegacyClosure = (state: BusinessState): void => {
  assertIndexedRecords("ImageAsset", state.document.imageAssetIds, state.imageAssets);
  assertIndexedRecords(
    "ImagePlacement",
    state.document.imagePlacementIds,
    state.imagePlacements,
  );
  assertIndexedRecords("Region", state.document.regionIds, state.regions);
  assertIndexedRecords(
    "Annotation",
    state.document.annotationIds,
    state.annotations,
  );
  assertIndexedRecords(
    "Description",
    state.document.descriptionIds,
    state.descriptions,
  );
  assertIndexedRecords(
    "DescriptionScopeLink",
    state.document.descriptionScopeLinkIds,
    state.descriptionScopeLinks,
  );
  assertIndexedRecords(
    "DescriptionReference",
    state.document.descriptionReferenceIds,
    state.descriptionReferences,
  );
  assertIndexedRecords(
    "AIExchange",
    state.document.aiExchangeIds,
    state.aiExchanges,
  );
  assertQuickAnnotationClosure(state);
  Object.values(state.imagePlacements).forEach((placement) => {
    if (!state.imageAssets[placement.imageId]) {
      fail(`ImagePlacement ${placement.id} 引用未知 ImageAsset`);
    }
  });
  Object.values(state.regions).forEach((region) => {
    if (!state.imageAssets[region.imageId]) {
      fail(`Region ${region.id} 引用未知 ImageAsset`);
    }
  });
  Object.values(state.annotations).forEach((annotation) => {
    if (!state.regions[annotation.regionId]) {
      fail(`Annotation ${annotation.id} 引用未知 Region`);
    }
  });
  Object.values(state.aiExchanges).forEach((exchange) => {
    if (!state.regions[exchange.regionId]) {
      fail(`AIExchange ${exchange.id} 引用未知 Region`);
    }
  });
  Object.values(state.descriptionScopeLinks).forEach((link) => {
    if (!state.descriptions[link.descriptionId] || !state.regions[link.regionId]) {
      fail(`DescriptionScopeLink ${link.id} 关系不闭合`);
    }
  });
  Object.values(state.descriptionReferences).forEach((reference) => {
    if (!state.descriptions[reference.descriptionId]) {
      fail(`DescriptionReference ${reference.id} 引用未知 Description`);
    }
    if (
      reference.imageBinding &&
      !state.imageAssets[reference.imageBinding.imageId]
    ) {
      fail(`DescriptionReference ${reference.id} 引用未知 ImageAsset`);
    }
  });
};

const elementOwnerFromBusiness = (
  state: BusinessStateV2,
  element: ExcalidrawElement,
): string => {
  if (element.customData?.kind === EMPTY_FOLDER_COVER_KIND) {
    const folderId = element.customData.folderId;
    if (
      typeof folderId !== "string" ||
      !state.folders[folderId] ||
      state.folders[folderId].kind !== "folder"
    ) {
      // Deleted covers are Excalidraw history tombstones. Once their Folder is
      // removed they intentionally have no live business owner, but they must
      // remain replayable in the single canonical scene.
      if (element.isDeleted) return state.rootFolderId;
      fail(`空 Folder cover ${element.id} 缺少有效 Folder owner`);
    }
    return folderId;
  }
  const imageId = element.customData?.imageId;
  if (typeof imageId === "string") {
    const image = state.imageAssets[imageId];
    if (!image && element.isDeleted) {
      const tombstoneOwner = element.customData?.folderId;
      return typeof tombstoneOwner === "string" && state.folders[tombstoneOwner]
        ? tombstoneOwner
        : state.rootFolderId;
    }
    if (!image) fail(`scene 元素 ${element.id} 引用未知 ImageAsset ${imageId}`);
    return image.folderId ?? state.rootFolderId;
  }
  const regionId = element.customData?.regionId;
  if (typeof regionId === "string") {
    const region = state.regions[regionId];
    if (!region && element.isDeleted) {
      const tombstoneOwner = element.customData?.folderId;
      return typeof tombstoneOwner === "string" && state.folders[tombstoneOwner]
        ? tombstoneOwner
        : state.rootFolderId;
    }
    if (!region) fail(`scene 元素 ${element.id} 引用未知 Region ${regionId}`);
    return region.folderId ?? state.rootFolderId;
  }
  const descriptionId = element.customData?.descriptionId;
  if (typeof descriptionId === "string") {
    const description = state.descriptions[descriptionId];
    if (!description && element.isDeleted) {
      const tombstoneOwner = element.customData?.folderId;
      return typeof tombstoneOwner === "string" && state.folders[tombstoneOwner]
        ? tombstoneOwner
        : state.rootFolderId;
    }
    if (!description) {
      fail(`scene 元素 ${element.id} 引用未知 Description ${descriptionId}`);
    }
    return description.folderId ?? state.rootFolderId;
  }
  const placement = Object.values(state.imagePlacements).find(
    (candidate) => candidate.elementId === element.id,
  );
  if (placement) {
    return placement.folderId ?? state.rootFolderId;
  }
  const region = Object.values(state.regions).find(
    (candidate) => candidate.elementId === element.id,
  );
  if (region) {
    return region.folderId ?? state.rootFolderId;
  }
  const description = Object.values(state.descriptions).find(
    (candidate) => candidate.elementId === element.id,
  );
  if (description) {
    return description.folderId ?? state.rootFolderId;
  }
  const declared = element.customData?.folderId;
  return typeof declared === "string" && declared.length > 0
    ? declared
    : state.rootFolderId;
};

export const assertFolderIntegrity = (state: BusinessStateV2): void => {
  assertIndexedRecords("ImageAsset", state.document.imageAssetIds, state.imageAssets);
  assertIndexedRecords(
    "ImagePlacement",
    state.document.imagePlacementIds,
    state.imagePlacements,
  );
  assertIndexedRecords("Region", state.document.regionIds, state.regions);
  assertIndexedRecords(
    "Annotation",
    state.document.annotationIds,
    state.annotations,
  );
  assertIndexedRecords(
    "Description",
    state.document.descriptionIds,
    state.descriptions,
  );
  assertIndexedRecords(
    "DescriptionScopeLink",
    state.document.descriptionScopeLinkIds,
    state.descriptionScopeLinks,
  );
  assertIndexedRecords(
    "DescriptionReference",
    state.document.descriptionReferenceIds,
    state.descriptionReferences,
  );
  assertIndexedRecords(
    "AIExchange",
    state.document.aiExchangeIds,
    state.aiExchanges,
  );
  assertQuickAnnotationClosure(state);
  const root = state.folders[state.rootFolderId];
  if (!root || root.kind !== "root") {
    fail("root scope 缺失或类型错误");
  }
  const folderIds = unique(state.document.folderIds ?? []);
  if (
    folderIds.length !== (state.document.folderIds ?? []).length ||
    !folderIds.includes(state.rootFolderId)
  ) {
    fail("Document Folder 索引重复或缺少 root scope");
  }
  folderIds.forEach((folderId) => {
    if (!state.folders[folderId]) {
      fail(`Document 引用未知 Folder ${folderId}`);
    }
  });
  if (
    Object.keys(state.folders).some((folderId) => !folderIds.includes(folderId))
  ) {
    fail("Folder 表包含未被 Document 索引的记录");
  }

  const indexedImages = new Map<string, string>();
  const indexedDescriptions = new Map<string, string>();
  Object.values(state.folders).forEach((folder) => {
    unique(folder.imageAssetIds).forEach((imageId) => {
      if (!state.imageAssets[imageId]) {
        fail(`Folder ${folder.id} 引用未知 ImageAsset ${imageId}`);
      }
      if (indexedImages.has(imageId)) {
        fail(`ImageAsset ${imageId} 被多个 scope 索引`);
      }
      indexedImages.set(imageId, folder.id);
    });
    unique(folder.descriptionIds).forEach((descriptionId) => {
      if (!state.descriptions[descriptionId]) {
        fail(`Folder ${folder.id} 引用未知 Description ${descriptionId}`);
      }
      if (indexedDescriptions.has(descriptionId)) {
        fail(`Description ${descriptionId} 被多个 scope 索引`);
      }
      indexedDescriptions.set(descriptionId, folder.id);
    });
  });

  Object.values(state.imageAssets).forEach((image) => {
    const owner = folderIdOf(image);
    if (!owner || !state.folders[owner] || indexedImages.get(image.id) !== owner) {
      fail(`ImageAsset ${image.id} owner 与 Folder 索引不一致`);
    }
  });
  Object.values(state.imagePlacements).forEach((placement) => {
    const image = state.imageAssets[placement.imageId];
    if (!image || folderIdOf(placement) !== folderIdOf(image)) {
      fail(`ImagePlacement ${placement.id} 未继承图片 owner`);
    }
  });
  Object.values(state.regions).forEach((region) => {
    const image = state.imageAssets[region.imageId];
    if (!image || folderIdOf(region) !== folderIdOf(image)) {
      fail(`Region ${region.id} 未继承图片 owner`);
    }
  });
  Object.values(state.descriptions).forEach((description) => {
    const owner = folderIdOf(description);
    if (
      !owner ||
      !state.folders[owner] ||
      indexedDescriptions.get(description.id) !== owner
    ) {
      fail(`Description ${description.id} owner 与 Folder 索引不一致`);
    }
  });
  Object.values(state.descriptionScopeLinks).forEach((link) => {
    const description = state.descriptions[link.descriptionId];
    const region = state.regions[link.regionId];
    if (
      !description ||
      !region ||
      folderIdOf(description) !== folderIdOf(region) ||
      folderIdOf(link) !== folderIdOf(description)
    ) {
      fail(`DescriptionScopeLink ${link.id} 跨 scope 或 owner 不闭合`);
    }
  });
  Object.values(state.descriptionReferences).forEach((reference) => {
    const description = state.descriptions[reference.descriptionId];
    const owner = description ? folderIdOf(description) : null;
    const image = reference.imageBinding
      ? state.imageAssets[reference.imageBinding.imageId]
      : null;
    if (
      !description ||
      folderIdOf(reference) !== owner ||
      (image && folderIdOf(image) !== owner)
    ) {
      fail(`DescriptionReference ${reference.id} 跨 scope 或 owner 不闭合`);
    }
  });
};

export const migrateBusinessStateToV2 = (
  input: BusinessState,
): BusinessStateV2 => {
  if (isBusinessStateV2(input)) {
    const cloned = structuredClone(input);
    const quickAnnotations = cloned.quickAnnotations ?? {};
    const quickAnnotationIds = cloned.document.quickAnnotationIds ?? [];
    const state: BusinessStateV2 = {
      ...cloned,
      document: {
        ...cloned.document,
        quickAnnotationIds,
        nextQuickAnnotationOrdinal:
          cloned.document.nextQuickAnnotationOrdinal ??
          (quickAnnotationIds.length === 0 ? 1 : Number.NaN),
      },
      quickAnnotations,
    };
    assertFolderIntegrity(state);
    return state;
  }
  assertLegacyClosure(input);
  const now = new Date().toISOString();
  const imageAssetIds = unique(input.document.imageAssetIds).filter((id) =>
    Boolean(input.imageAssets[id]),
  );
  const descriptionIds = unique(input.document.descriptionIds).filter((id) =>
    Boolean(input.descriptions[id]),
  );
  const root: FolderRecord = {
    id: ROOT_FOLDER_ID,
    schemaVersion: 2,
    kind: "root",
    name: "Root",
    imageAssetIds,
    descriptionIds,
    focusImageIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const state: BusinessStateV2 = {
    ...structuredClone(input),
    schemaVersion: 2,
    rootFolderId: ROOT_FOLDER_ID,
    document: {
      ...structuredClone(input.document),
      schemaVersion: 1,
      quickAnnotationIds: structuredClone(
        input.document.quickAnnotationIds ?? [],
      ),
      nextQuickAnnotationOrdinal:
        input.document.nextQuickAnnotationOrdinal ??
        ((input.document.quickAnnotationIds ?? []).length === 0
          ? 1
          : Number.NaN),
      folderIds: [ROOT_FOLDER_ID],
      updatedAt: now,
    },
    imageAssets: Object.fromEntries(
      Object.entries(input.imageAssets).map(([id, value]) => [
        id,
        { ...structuredClone(value), folderId: ROOT_FOLDER_ID },
      ]),
    ),
    imagePlacements: Object.fromEntries(
      Object.entries(input.imagePlacements).map(([id, value]) => [
        id,
        { ...structuredClone(value), folderId: ROOT_FOLDER_ID },
      ]),
    ),
    regions: Object.fromEntries(
      Object.entries(input.regions).map(([id, value]) => [
        id,
        { ...structuredClone(value), folderId: ROOT_FOLDER_ID },
      ]),
    ),
    descriptions: Object.fromEntries(
      Object.entries(input.descriptions).map(([id, value]) => [
        id,
        { ...structuredClone(value), folderId: ROOT_FOLDER_ID },
      ]),
    ),
    descriptionScopeLinks: Object.fromEntries(
      Object.entries(input.descriptionScopeLinks).map(([id, value]) => [
        id,
        { ...structuredClone(value), folderId: ROOT_FOLDER_ID },
      ]),
    ),
    descriptionReferences: Object.fromEntries(
      Object.entries(input.descriptionReferences).map(([id, value]) => [
        id,
        { ...structuredClone(value), folderId: ROOT_FOLDER_ID },
      ]),
    ),
    quickAnnotations: structuredClone(input.quickAnnotations ?? {}),
    folders: { [ROOT_FOLDER_ID]: root },
  };
  assertFolderIntegrity(state);
  return state;
};

export const migrateCanonicalSceneToV3 = (
  elements: readonly ExcalidrawElement[],
  business: BusinessStateV2,
): readonly ExcalidrawElement[] => {
  const legacyFolderFrames = new Map<string, string>();
  elements.forEach((element) => {
    if (
      element.type === "frame" &&
      element.customData?.kind === "folder-frame"
    ) {
      const folderId = element.customData.folderId;
      if (
        typeof folderId !== "string" ||
        !business.folders[folderId] ||
        [...legacyFolderFrames.values()].includes(folderId)
      ) {
        fail(`legacy Folder Frame ${element.id} 无法唯一迁移`);
      }
      legacyFolderFrames.set(element.id, folderId);
    }
  });
  return elements.flatMap((element) => {
    if (legacyFolderFrames.has(element.id)) return [];
    const legacyOwner = element.frameId
      ? legacyFolderFrames.get(element.frameId)
      : undefined;
    const businessOwner = elementOwnerFromBusiness(business, element);
    if (legacyOwner && legacyOwner !== businessOwner) {
      fail(`元素 ${element.id} 的 legacy Frame 与业务 owner 冲突`);
    }
    const semantic =
      typeof element.customData?.kind === "string" &&
      [
        "image",
        "image-shadow",
        "region",
        "annotation",
        "annotation-card",
        "annotation-leader",
        "ordinary-text-box",
        "description",
        EMPTY_FOLDER_COVER_KIND,
      ].includes(element.customData.kind);
    if (!semantic && !legacyOwner) return [element];
    const isFolderCover =
      element.customData?.kind === EMPTY_FOLDER_COVER_KIND;
    return [
      {
        ...element,
        ...(legacyOwner ? { frameId: null } : {}),
        ...(isFolderCover ? { locked: true } : {}),
        customData: {
          ...(element.customData ?? {}),
          folderId: businessOwner,
        },
      } as ExcalidrawElement,
    ];
  });
};

const folderCoverId = (folderId: string): string => `folder-cover:${folderId}`;

export const createEmptyFolderCover = ({
  folderId,
  x,
  y,
  width = 232,
  height = 156,
}: {
  folderId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}): ExcalidrawElement => {
  const [element] = convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id: folderCoverId(folderId),
        x,
        y,
        width,
        height,
        strokeColor: "#9ba3af",
        backgroundColor: "#ffffff",
        fillStyle: "solid",
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        locked: true,
        customData: {
          kind: EMPTY_FOLDER_COVER_KIND,
          folderId,
          schemaVersion: 3,
        },
      } as never,
    ],
    { regenerateIds: false },
  );
  return element;
};

export const createVisibleFolder = ({
  business,
  elements,
  folderId,
  name,
  x,
  y,
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  folderId: string;
  name: string;
  x: number;
  y: number;
}): { business: BusinessStateV2; elements: readonly ExcalidrawElement[] } => {
  if (business.folders[folderId]) {
    fail(`Folder ${folderId} 已存在`);
  }
  const now = new Date().toISOString();
  const cover = createEmptyFolderCover({ folderId, x, y });
  const next: BusinessStateV2 = {
    ...business,
    document: {
      ...business.document,
      folderIds: [...(business.document.folderIds ?? []), folderId],
      updatedAt: now,
    },
    folders: {
      ...business.folders,
      [folderId]: {
        id: folderId,
        schemaVersion: 2,
        kind: "folder",
        name,
        imageAssetIds: [],
        descriptionIds: [],
        focusImageIds: [],
        coverElementId: cover.id,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
  assertFolderIntegrity(next);
  return { business: next, elements: [...elements, cover] };
};

export interface DirectObjectReparentRequirements {
  imageIds: readonly string[];
  descriptionIds: readonly string[];
}

/**
 * Return every directly-owned image/description that must accompany the
 * requested objects so existing image bindings and scope links stay inside
 * one Folder. The caller decides whether to extend the selection or fail
 * closed; this helper never mutates or silently expands the move itself.
 */
export const requiredDirectObjectsForReparent = ({
  business,
  imageIds,
  descriptionIds,
}: {
  business: BusinessStateV2;
  imageIds: readonly string[];
  descriptionIds: readonly string[];
}): DirectObjectReparentRequirements => {
  const selectedImages = new Set(unique(imageIds));
  const selectedDescriptions = new Set(unique(descriptionIds));
  const closureImages = new Set(selectedImages);
  const closureDescriptions = new Set(selectedDescriptions);
  let expanded = true;
  while (expanded) {
    expanded = false;
    Object.values(business.descriptionScopeLinks).forEach((link) => {
      const region = business.regions[link.regionId];
      const imageId = region?.imageId;
      if (!imageId) return;
      if (
        closureImages.has(imageId) ||
        closureDescriptions.has(link.descriptionId)
      ) {
        if (!closureImages.has(imageId)) {
          closureImages.add(imageId);
          expanded = true;
        }
        if (!closureDescriptions.has(link.descriptionId)) {
          closureDescriptions.add(link.descriptionId);
          expanded = true;
        }
      }
    });
    Object.values(business.descriptionReferences).forEach((reference) => {
      const imageId = reference.imageBinding?.imageId;
      if (
        !imageId ||
        (!closureImages.has(imageId) &&
          !closureDescriptions.has(reference.descriptionId))
      ) {
        return;
      }
      if (!closureImages.has(imageId)) {
        closureImages.add(imageId);
        expanded = true;
      }
      if (!closureDescriptions.has(reference.descriptionId)) {
        closureDescriptions.add(reference.descriptionId);
        expanded = true;
      }
    });
  }
  return {
    imageIds: (business.document.imageAssetIds ?? []).filter(
      (id) => closureImages.has(id) && !selectedImages.has(id),
    ),
    descriptionIds: (business.document.descriptionIds ?? []).filter(
      (id) => closureDescriptions.has(id) && !selectedDescriptions.has(id),
    ),
  };
};

export const reparentDirectObjects = ({
  business,
  targetFolderId,
  imageIds,
  descriptionIds,
}: {
  business: BusinessStateV2;
  targetFolderId: string;
  imageIds: readonly string[];
  descriptionIds: readonly string[];
}): BusinessStateV2 => {
  const target = business.folders[targetFolderId];
  if (!target) {
    fail(`目标 Folder ${targetFolderId} 不存在`);
  }
  const selectedImages = unique(imageIds);
  const selectedDescriptions = unique(descriptionIds);
  selectedImages.forEach((id) => {
    if (!business.imageAssets[id]) fail(`ImageAsset ${id} 不存在`);
  });
  selectedDescriptions.forEach((id) => {
    if (!business.descriptions[id]) fail(`Description ${id} 不存在`);
  });
  const now = new Date().toISOString();
  const folders = Object.fromEntries(
    Object.entries(business.folders).map(([id, folder]) => [
      id,
      {
        ...folder,
        imageAssetIds: folder.imageAssetIds.filter(
          (imageId) => !selectedImages.includes(imageId),
        ),
        descriptionIds: folder.descriptionIds.filter(
          (descriptionId) => !selectedDescriptions.includes(descriptionId),
        ),
      },
    ]),
  ) as BusinessStateV2["folders"];
  folders[targetFolderId] = {
    ...folders[targetFolderId],
    imageAssetIds: unique([
      ...folders[targetFolderId].imageAssetIds,
      ...selectedImages,
    ]),
    descriptionIds: unique([
      ...folders[targetFolderId].descriptionIds,
      ...selectedDescriptions,
    ]),
    updatedAt: now,
  };
  const imageSet = new Set(selectedImages);
  const descriptionSet = new Set(selectedDescriptions);
  const regionIds = new Set(
    Object.values(business.regions)
      .filter((region) => imageSet.has(region.imageId))
      .map((region) => region.id),
  );
  const next: BusinessStateV2 = {
    ...business,
    document: { ...business.document, updatedAt: now },
    folders,
    imageAssets: Object.fromEntries(
      Object.entries(business.imageAssets).map(([id, value]) => [
        id,
        imageSet.has(id) ? { ...value, folderId: targetFolderId } : value,
      ]),
    ),
    imagePlacements: Object.fromEntries(
      Object.entries(business.imagePlacements).map(([id, value]) => [
        id,
        imageSet.has(value.imageId)
          ? { ...value, folderId: targetFolderId }
          : value,
      ]),
    ),
    regions: Object.fromEntries(
      Object.entries(business.regions).map(([id, value]) => [
        id,
        imageSet.has(value.imageId)
          ? { ...value, folderId: targetFolderId }
          : value,
      ]),
    ),
    descriptions: Object.fromEntries(
      Object.entries(business.descriptions).map(([id, value]) => [
        id,
        descriptionSet.has(id)
          ? { ...value, folderId: targetFolderId }
          : value,
      ]),
    ),
    descriptionReferences: Object.fromEntries(
      Object.entries(business.descriptionReferences).map(([id, value]) => [
        id,
        descriptionSet.has(value.descriptionId)
          ? { ...value, folderId: targetFolderId }
          : value,
      ]),
    ),
    descriptionScopeLinks: Object.fromEntries(
      Object.entries(business.descriptionScopeLinks).map(([id, value]) => [
        id,
        descriptionSet.has(value.descriptionId) && regionIds.has(value.regionId)
          ? { ...value, folderId: targetFolderId }
          : value,
      ]),
    ),
  };
  assertFolderIntegrity(next);
  return next;
};

export const deleteFolderDirectObjects = ({
  business,
  imageIds,
  descriptionIds,
  now = new Date().toISOString(),
}: {
  business: BusinessStateV2;
  imageIds: readonly string[];
  descriptionIds: readonly string[];
  now?: string;
}): BusinessStateV2 => {
  assertFolderIntegrity(business);
  const deletedImageIds = new Set(unique(imageIds));
  const deletedDescriptionIds = new Set(unique(descriptionIds));

  deletedImageIds.forEach((imageId) => {
    if (!business.imageAssets[imageId]) {
      fail(`待删除 ImageAsset ${imageId} 不存在`);
    }
  });
  deletedDescriptionIds.forEach((descriptionId) => {
    if (!business.descriptions[descriptionId]) {
      fail(`待删除 Description ${descriptionId} 不存在`);
    }
  });

  const deletedPlacementIds = new Set(
    Object.values(business.imagePlacements)
      .filter((placement) => deletedImageIds.has(placement.imageId))
      .map((placement) => placement.id),
  );
  const deletedRegionIds = new Set(
    Object.values(business.regions)
      .filter((region) => deletedImageIds.has(region.imageId))
      .map((region) => region.id),
  );
  const deletedAnnotationIds = new Set(
    Object.values(business.annotations)
      .filter((annotation) => deletedRegionIds.has(annotation.regionId))
      .map((annotation) => annotation.id),
  );
  const deletedExchangeIds = new Set(
    Object.values(business.aiExchanges)
      .filter((exchange) => deletedRegionIds.has(exchange.regionId))
      .map((exchange) => exchange.id),
  );
  const deletedQuickAnnotationIds = new Set(
    Object.values(business.quickAnnotations)
      .filter((annotation) => deletedImageIds.has(annotation.imageId))
      .map((annotation) => annotation.id),
  );
  const deletedReferenceIds = new Set(
    Object.values(business.descriptionReferences)
      .filter((reference) => deletedDescriptionIds.has(reference.descriptionId))
      .map((reference) => reference.id),
  );
  const deletedScopeLinkIds = new Set(
    Object.values(business.descriptionScopeLinks)
      .filter(
        (link) =>
          deletedDescriptionIds.has(link.descriptionId) ||
          deletedRegionIds.has(link.regionId),
      )
      .map((link) => link.id),
  );
  const without = <T>(
    records: Record<string, T>,
    deletedIds: ReadonlySet<string>,
  ): Record<string, T> =>
    Object.fromEntries(
      Object.entries(records).filter(([recordId]) => !deletedIds.has(recordId)),
    );

  const next: BusinessStateV2 = {
    ...business,
    document: {
      ...business.document,
      imageAssetIds: business.document.imageAssetIds.filter(
        (imageId) => !deletedImageIds.has(imageId),
      ),
      imagePlacementIds: business.document.imagePlacementIds.filter(
        (placementId) => !deletedPlacementIds.has(placementId),
      ),
      regionIds: business.document.regionIds.filter(
        (regionId) => !deletedRegionIds.has(regionId),
      ),
      annotationIds: business.document.annotationIds.filter(
        (annotationId) => !deletedAnnotationIds.has(annotationId),
      ),
      descriptionIds: business.document.descriptionIds.filter(
        (descriptionId) => !deletedDescriptionIds.has(descriptionId),
      ),
      descriptionScopeLinkIds:
        business.document.descriptionScopeLinkIds.filter(
          (linkId) => !deletedScopeLinkIds.has(linkId),
        ),
      descriptionReferenceIds:
        business.document.descriptionReferenceIds.filter(
          (referenceId) => !deletedReferenceIds.has(referenceId),
        ),
      aiExchangeIds: business.document.aiExchangeIds.filter(
        (exchangeId) => !deletedExchangeIds.has(exchangeId),
      ),
      quickAnnotationIds: business.document.quickAnnotationIds.filter(
        (annotationId) => !deletedQuickAnnotationIds.has(annotationId),
      ),
      updatedAt: now,
    },
    imageAssets: without(business.imageAssets, deletedImageIds),
    imagePlacements: without(business.imagePlacements, deletedPlacementIds),
    regions: without(business.regions, deletedRegionIds),
    annotations: without(business.annotations, deletedAnnotationIds),
    descriptions: without(business.descriptions, deletedDescriptionIds),
    descriptionScopeLinks: without(
      business.descriptionScopeLinks,
      deletedScopeLinkIds,
    ),
    descriptionReferences: Object.fromEntries(
      Object.entries(business.descriptionReferences).flatMap(
        ([referenceId, reference]) => {
          if (deletedReferenceIds.has(referenceId)) return [];
          if (
            reference.imageBinding &&
            deletedImageIds.has(reference.imageBinding.imageId)
          ) {
            const { imageBinding: _imageBinding, ...unbound } = reference;
            return [[referenceId, unbound]];
          }
          return [[referenceId, reference]];
        },
      ),
    ),
    aiExchanges: without(business.aiExchanges, deletedExchangeIds),
    quickAnnotations: without(
      business.quickAnnotations,
      deletedQuickAnnotationIds,
    ),
    folders: Object.fromEntries(
      Object.entries(business.folders).map(([folderId, folder]) => [
        folderId,
        {
          ...folder,
          imageAssetIds: folder.imageAssetIds.filter(
            (imageId) => !deletedImageIds.has(imageId),
          ),
          descriptionIds: folder.descriptionIds.filter(
            (descriptionId) => !deletedDescriptionIds.has(descriptionId),
          ),
          focusImageIds: folder.focusImageIds.filter(
            (imageId) => !deletedImageIds.has(imageId),
          ),
          updatedAt: now,
        },
      ]),
    ),
  };
  assertFolderIntegrity(next);
  return next;
};

export const removeVisibleFolderPreservingContents = ({
  business,
  elements,
  folderId,
  now = new Date().toISOString(),
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  folderId: string;
  now?: string;
}): { business: BusinessStateV2; elements: readonly ExcalidrawElement[] } => {
  assertFolderIntegrity(business);
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") {
    fail(`Folder ${folderId} 不存在或不可移除`);
  }

  const reparented = reparentDirectObjects({
    business,
    targetFolderId: business.rootFolderId,
    imageIds: folder.imageAssetIds,
    descriptionIds: folder.descriptionIds,
  });
  const stampable = elements.filter(
    (element) =>
      !(
        element.isDeleted &&
        element.customData?.kind === EMPTY_FOLDER_COVER_KIND &&
        typeof element.customData.folderId === "string" &&
        !reparented.folders[element.customData.folderId]
      ),
  );
  const stampedSubset = stampSceneFolderOwnership({
    business: reparented,
    elements: stampable,
  });
  const stampedById = new Map(stampedSubset.map((element) => [element.id, element]));
  const stamped = elements.map((element) => stampedById.get(element.id) ?? element);
  const nextBusiness: BusinessStateV2 = {
    ...reparented,
    document: {
      ...reparented.document,
      folderIds: (reparented.document.folderIds ?? []).filter(
        (candidateId) => candidateId !== folderId,
      ),
      updatedAt: now,
    },
    folders: Object.fromEntries(
      Object.entries(reparented.folders).filter(
        ([candidateId]) => candidateId !== folderId,
      ),
    ),
  };
  assertFolderIntegrity(nextBusiness);

  const withoutCover = stamped.map((element) =>
    element.id === folder.coverElementId && !element.isDeleted
      ? ({
          ...element,
          isDeleted: true,
          version: element.version + 1,
          versionNonce: element.versionNonce + 1,
          updated: Date.now(),
        } as ExcalidrawElement)
      : element,
  );
  return {
    business: nextBusiness,
    elements: withoutCover,
  };
};

export const deleteVisibleFolderWithContents = ({
  business,
  elements,
  folderId,
  now = new Date().toISOString(),
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  folderId: string;
  now?: string;
}): { business: BusinessStateV2; elements: readonly ExcalidrawElement[] } => {
  assertFolderIntegrity(business);
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") {
    fail(`Folder ${folderId} 不存在或不可删除`);
  }

  const imageIds = new Set(folder.imageAssetIds);
  const descriptionIds = new Set(folder.descriptionIds);
  const regionIds = new Set(
    Object.values(business.regions)
      .filter((region) => imageIds.has(region.imageId))
      .map((region) => region.id),
  );
  const removedFolder = removeVisibleFolderPreservingContents({
    business,
    elements,
    folderId,
    now,
  });
  const nextBusiness = deleteFolderDirectObjects({
    business: removedFolder.business,
    imageIds: [...imageIds],
    descriptionIds: [...descriptionIds],
    now,
  });
  const nextElements = removedFolder.elements.map((element) => {
    const elementImageId =
      typeof element.customData?.imageId === "string"
        ? element.customData.imageId
        : undefined;
    const elementRegionId =
      typeof element.customData?.regionId === "string"
        ? element.customData.regionId
        : undefined;
    const elementDescriptionId =
      typeof element.customData?.descriptionId === "string"
        ? element.customData.descriptionId
        : undefined;
    if (
      element.isDeleted ||
      (!elementImageId || !imageIds.has(elementImageId)) &&
        (!elementRegionId || !regionIds.has(elementRegionId)) &&
        (!elementDescriptionId || !descriptionIds.has(elementDescriptionId))
    ) {
      return element;
    }
    return newElementWith(element, { isDeleted: true });
  });
  assertFolderIntegrity(nextBusiness);
  return { business: nextBusiness, elements: nextElements };
};

export const stampSceneFolderOwnership = ({
  business,
  elements,
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
}): readonly ExcalidrawElement[] =>
  elements.map((element) => {
    const owner = elementOwnerFromBusiness(business, element);
    const semantic =
      typeof element.customData?.kind === "string" &&
      [
        "image",
        "image-shadow",
        "region",
        "annotation",
        "annotation-card",
        "annotation-leader",
        "ordinary-text-box",
        "description",
        EMPTY_FOLDER_COVER_KIND,
      ].includes(element.customData.kind);
    if (!semantic || element.customData?.folderId === owner) return element;
    return {
      ...element,
      customData: { ...(element.customData ?? {}), folderId: owner },
    } as ExcalidrawElement;
  });

export const folderSceneElementIds = (
  business: BusinessStateV2,
  folderId: string,
): Set<string> => {
  const folder = business.folders[folderId];
  if (!folder) return new Set();
  const imageIds = new Set(folder.imageAssetIds);
  const regionIds = new Set(
    Object.values(business.regions)
      .filter((region) => imageIds.has(region.imageId))
      .map((region) => region.id),
  );
  return new Set([
    ...Object.values(business.imagePlacements)
      .filter((placement) => imageIds.has(placement.imageId))
      .map((placement) => placement.elementId),
    ...Object.values(business.regions)
      .filter((region) => regionIds.has(region.id))
      .map((region) => region.elementId),
    ...Object.values(business.annotations)
      .filter((annotation) => regionIds.has(annotation.regionId))
      .map((annotation) => annotation.elementId),
    ...folder.descriptionIds.flatMap((descriptionId) => {
      const elementId = business.descriptions[descriptionId]?.elementId;
      return elementId ? [elementId] : [];
    }),
  ]);
};

export interface FolderSceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The Folder cover is persisted as canonical geometry, but its parent-canvas
 * surface is intentionally compact.  Keeping this projection derived here
 * prevents the UI hit target from becoming a second, wider representation of
 * the same Folder and leaves the stored cover untouched.
 */
export const compactFolderSurfaceBounds = (
  bounds: FolderSceneBounds,
): FolderSceneBounds => {
  // Spatial's collapsed surface is a compact portrait folder card.  Keep its
  // origin derived from the canonical cover, but use a bounded portrait
  // projection so a wide member bounds rectangle cannot turn the cover into a
  // second, oversized canvas surface.  The stored cover geometry is untouched.
  const maxWidth = 148;
  const maxHeight = 200;
  const minWidth = 112;
  const minHeight = 156;
  const scale = Math.min(1, maxWidth / bounds.width, maxHeight / bounds.height);
  const width = Math.min(maxWidth, Math.max(minWidth, bounds.width * scale));
  const height = Math.min(
    maxHeight,
    Math.max(minHeight, width / 0.74, bounds.height * scale),
  );
  return {
    x: bounds.x,
    y: bounds.y,
    width,
    height,
  };
};

export const folderSceneBounds = (
  business: BusinessStateV2,
  elements: readonly ExcalidrawElement[],
  folderId: string,
): FolderSceneBounds | null => {
  const folder = business.folders[folderId];
  if (!folder) return null;
  const cover = elements.find(
    (element) =>
      element.id === folder.coverElementId &&
      element.customData?.kind === EMPTY_FOLDER_COVER_KIND,
  );
  return cover
    ? {
        x: cover.x,
        y: cover.y,
        width: cover.width,
        height: cover.height,
      }
    : null;
};

export const synchronizeEmptyFolderCovers = ({
  business,
  elements,
  fallbackOrigin = { x: 160, y: 120 },
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  fallbackOrigin?: { x: number; y: number };
}): { business: BusinessStateV2; elements: readonly ExcalidrawElement[] } => {
  let nextElements = [...elements];
  const folders = { ...business.folders };
  let offset = 0;
  Object.values(folders).forEach((folder) => {
    if (folder.kind === "root") return;
    const isEmpty =
      folder.imageAssetIds.length === 0 && folder.descriptionIds.length === 0;
    const coverId = folder.coverElementId ?? folderCoverId(folder.id);
    const coverIndex = nextElements.findIndex((element) => element.id === coverId);
    const existing = coverIndex >= 0 ? nextElements[coverIndex] : undefined;
    if (isEmpty) {
      if (!existing) {
        const cover = createEmptyFolderCover({
          folderId: folder.id,
          x: fallbackOrigin.x + offset,
          y: fallbackOrigin.y + offset,
        });
        nextElements.push(cover);
        offset += 28;
      } else if (existing.isDeleted) {
        nextElements[coverIndex] = {
          ...existing,
          isDeleted: false,
          version: existing.version + 1,
          versionNonce: existing.versionNonce + 1,
          updated: Date.now(),
        } as ExcalidrawElement;
      }
      folders[folder.id] = { ...folder, coverElementId: coverId };
    } else {
      const retainedCover =
        existing ??
        fail(`Folder ${folder.id} 缺少可回放的 canonical cover geometry`);
      if (!retainedCover.isDeleted) {
        nextElements[coverIndex] = {
          ...retainedCover,
          isDeleted: true,
          version: retainedCover.version + 1,
          versionNonce: retainedCover.versionNonce + 1,
          updated: Date.now(),
        } as ExcalidrawElement;
      }
      folders[folder.id] = { ...folder, coverElementId: coverId };
    }
  });
  const next = { ...business, folders };
  assertFolderIntegrity(next);
  return { business: next, elements: nextElements };
};

export type FolderProjectionMode =
  | { type: "overview" }
  | {
      type: "preview";
      folderId: string;
      viewport?: FolderPreviewViewport;
      /**
       * Transient presentation exceptions: while preview content enters, the
       * canvas copies of these images are hidden so the motion layer can
       * animate them without changing canonical scene truth.
       */
      previewImageId?: string;
      previewImageIds?: readonly string[];
    }
  | { type: "folder"; folderId: string }
  | { type: "image"; folderId: string; imageId: string }
  | { type: "description"; folderId: string; descriptionId: string }
  | { type: "description-bindings"; folderId: string; descriptionId: string };

export interface FolderPreviewViewport {
  width: number;
  height: number;
  zoom: number;
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface FolderPreviewStage {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FolderPreviewPlacement extends FolderSceneBounds {
  scale: number;
  angle: number;
}

export interface FolderPreviewLayout {
  scale: number;
  dx: number;
  dy: number;
  offsetX: number;
  offsetY: number;
  clusterLeft: number;
  clusterTop: number;
  stage: FolderPreviewStage | null;
  previewCoverBounds?: FolderSceneBounds;
  slots?: readonly FolderPreviewSlot[];
  memberPlacements?: Readonly<
    Record<string, FolderPreviewPlacement>
  >;
  descriptionPlacements?: Readonly<
    Record<string, FolderPreviewPlacement>
  >;
}

/**
 * A preview-only visual slot. The image and description fields are ordered
 * layout occupants, not a persisted binding relationship.
 */
export interface FolderPreviewSlot {
  index: number;
  element?: ExcalidrawElement;
  descriptionId?: string;
  imageRect: FolderPreviewPlacement | null;
  descriptionRect: FolderPreviewPlacement | null;
}

export interface FolderSceneProjection {
  canonical: readonly ExcalidrawElement[];
  elements: readonly ExcalidrawElement[];
  hiddenElementIds: ReadonlySet<string>;
  projectedElementIds: ReadonlySet<string>;
  mode: FolderProjectionMode;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const folderPreviewClusterBounds = (
  business: BusinessStateV2,
  elements: readonly ExcalidrawElement[],
  folderId: string,
) => {
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") return null;
  const members = elements.flatMap((element) =>
    !element.isDeleted &&
    element.id !== folder.coverElementId &&
    element.customData?.kind !== "image-shadow" &&
    elementOwnerFromBusiness(business, element) === folderId
      ? [{
          left: element.x,
          top: element.y,
          right: element.x + element.width,
          bottom: element.y + element.height,
        }]
      : [],
  );
  const descriptions = folder.descriptionIds.flatMap((descriptionId) => {
    const reference = Object.values(business.descriptionReferences).find(
      (candidate) => candidate.descriptionId === descriptionId && candidate.active,
    );
    return reference
      ? [{
          left: reference.anchor.x,
          top: reference.anchor.y,
          right: reference.anchor.x + 148,
          bottom: reference.anchor.y + 196,
        }]
      : [];
  });
  const bounds = [...members, ...descriptions];
  if (bounds.length === 0) return null;
  return {
    left: Math.min(...bounds.map((bound) => bound.left)),
    top: Math.min(...bounds.map((bound) => bound.top)),
    right: Math.max(...bounds.map((bound) => bound.right)),
    bottom: Math.max(...bounds.map((bound) => bound.bottom)),
  };
};

const folderPreviewMemberBounds = (
  business: BusinessStateV2,
  elements: readonly ExcalidrawElement[],
  folderId: string,
) => {
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") return null;
  const bounds = elements.flatMap((element) =>
    !element.isDeleted &&
    element.id !== folder.coverElementId &&
    element.customData?.kind !== "image-shadow" &&
    elementOwnerFromBusiness(business, element) === folderId
      ? [{
          left: element.x,
          top: element.y,
          right: element.x + element.width,
          bottom: element.y + element.height,
        }]
      : [],
  );
  if (bounds.length === 0) return null;
  return {
    left: Math.min(...bounds.map((bound) => bound.left)),
    top: Math.min(...bounds.map((bound) => bound.top)),
    right: Math.max(...bounds.map((bound) => bound.right)),
    bottom: Math.max(...bounds.map((bound) => bound.bottom)),
  };
};

export const folderPreviewLayout = (
  business: BusinessStateV2,
  elements: readonly ExcalidrawElement[],
  folderId: string,
  viewport?: FolderPreviewViewport,
): FolderPreviewLayout => {
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") {
    return {
      scale: 1,
      dx: 0,
      dy: 0,
      offsetX: 0,
      offsetY: 0,
      clusterLeft: 0,
      clusterTop: 0,
      stage: null,
    };
  }
  const cover = elements.find(
    (element) =>
      element.id === folder.coverElementId &&
      element.customData?.kind === EMPTY_FOLDER_COVER_KIND,
  );
  if (!cover) {
    return {
      scale: 1,
      dx: 0,
      dy: 0,
      offsetX: 0,
      offsetY: 0,
      clusterLeft: 0,
      clusterTop: 0,
      stage: null,
    };
  }
  const memberCluster = folderPreviewMemberBounds(business, elements, folderId);
  const cluster =
    memberCluster ?? folderPreviewClusterBounds(business, elements, folderId);
  if (!cluster) {
    return {
      scale: 1,
      dx: 0,
      dy: 0,
      offsetX: 0,
      offsetY: 0,
      clusterLeft: 0,
      clusterTop: 0,
      stage: null,
    };
  }
  const memberOrigins = elements.flatMap((element) =>
    !element.isDeleted &&
    element.id !== folder.coverElementId &&
    element.customData?.kind !== "image-shadow" &&
    elementOwnerFromBusiness(business, element) === folderId
      ? [{ x: element.x, y: element.y }]
      : [],
  );
  const descriptionOrigins = folder.descriptionIds.flatMap((descriptionId) => {
    const reference = Object.values(business.descriptionReferences).find(
      (candidate) => candidate.descriptionId === descriptionId && candidate.active,
    );
    return reference ? [reference.anchor] : [];
  });
  const origins = [...memberOrigins, ...descriptionOrigins];
  if (origins.length === 0) {
    return {
      scale: 1,
      dx: 0,
      dy: 0,
      offsetX: 0,
      offsetY: 0,
      clusterLeft: 0,
      clusterTop: 0,
      stage: null,
    };
  }
  const minX = Math.min(...origins.map((origin) => origin.x));
  const minY = Math.min(...origins.map((origin) => origin.y));
  const surface = compactFolderSurfaceBounds({
    x: cover.x,
    y: cover.y,
    width: cover.width,
    height: cover.height,
  });
  const base = {
    dx: surface.x + surface.width + 40 - minX,
    dy: surface.y - 24 - minY,
  };
  if (!viewport || viewport.zoom <= 0) {
    return {
      scale: 1,
      ...base,
      offsetX: base.dx,
      offsetY: base.dy,
      clusterLeft: cluster.left,
      clusterTop: cluster.top,
      stage: null,
    };
  }

  const sceneLeft = -viewport.scrollX - viewport.offsetLeft / viewport.zoom;
  const sceneTop = -viewport.scrollY - viewport.offsetTop / viewport.zoom;
  const sceneRight = sceneLeft + Math.max(0, viewport.width) / viewport.zoom;
  const sceneBottom = sceneTop + Math.max(0, viewport.height) / viewport.zoom;

  // The accepted isolated prototype was measured against a 174px cover at
  // its 0.82 preview scale.  Convert those pixels once into cover-relative
  // units; from this point onward every target remains in scene coordinates.
  // viewportRect is the only scene-to-screen projection, so zoom cannot make
  // the Folder, members, gaps and ellipse drift apart.
  const referenceCoverWidth = 174 * 0.82;
  const referenceCoverHeight = (174 / 0.78) * 0.82;
  const previewCoverBounds: FolderSceneBounds = {
    x: surface.x,
    y: surface.y,
    width: surface.width * 0.9,
    height: surface.height * 0.9,
  };
  // Keep the isolated reference as the minimum visual scale. The scene is
  // projected through viewportRect exactly once; letting a smaller Folder
  // shrink this reference a second time made the formal canvas visibly smaller
  // than the accepted isolated preview.
  const unit = Math.max(1, previewCoverBounds.width / referenceCoverWidth);
  const stageWidth = previewCoverBounds.width * (571.597 / referenceCoverWidth);
  const stageHeight = previewCoverBounds.height * (349.016 / referenceCoverHeight);
  const coverToStageGap = Math.max(8, 8 * unit);
  // Keep the original right-side group clamp.  The edge case only needs a
  // smaller breathing room; changing the anchor model makes the preview able
  // to jump to the opposite side of the Folder.
  const edge = 16 * unit;
  const previewImageCount = elements.filter(
    (element) =>
      !element.isDeleted &&
      element.id !== folder.coverElementId &&
      element.customData?.kind === "image" &&
      elementOwnerFromBusiness(business, element) === folderId,
  ).length;
  const visibleImageWidth =
    previewImageCount > 0
      ? previewImageCount * 204 * unit +
        Math.max(0, previewImageCount - 1) * 6 * unit
      : 0;
  const visibleDescriptionWidth =
    folder.descriptionIds.length > 0
      ? folder.descriptionIds.length * 156 * unit +
        Math.max(0, folder.descriptionIds.length - 1) * 6 * unit
      : 0;
  // Clamp against visible members, not the transparent stage's full ellipse.
  // The old calculation reserved a large empty tail and moved edge-adjacent
  // Folders much farther inward than the user-visible preview required.
  const visibleStageWidth = Math.min(
    stageWidth,
    Math.max(204 * unit, visibleImageWidth, visibleDescriptionWidth),
  );
  const groupWidth = previewCoverBounds.width + coverToStageGap + visibleStageWidth;
  const groupHeight = Math.max(previewCoverBounds.height, stageHeight);
  const groupLeft = clamp(
    surface.x,
    sceneLeft + edge,
    Math.max(sceneLeft + edge, sceneRight - edge - groupWidth),
  );
  const groupBottom = clamp(
    surface.y + surface.height,
    sceneTop + edge + groupHeight,
    Math.max(sceneTop + edge + groupHeight, sceneBottom - edge),
  );
  previewCoverBounds.x = groupLeft;
  previewCoverBounds.y = groupBottom - previewCoverBounds.height;
  const stage: FolderPreviewStage = {
    x: previewCoverBounds.x + previewCoverBounds.width + coverToStageGap,
    y: groupBottom - stageHeight,
    width: stageWidth,
    height: stageHeight,
  };

  const memberElements = elements.filter(
    (element) =>
      !element.isDeleted &&
      element.id !== folder.coverElementId &&
      elementOwnerFromBusiness(business, element) === folderId,
  );
  const imageElements = memberElements.filter(
    (element) => element.customData?.kind === "image",
  );
  const slotCount = Math.max(1, imageElements.length, folder.descriptionIds.length);
  const imageWidth = 204 * unit;
  const imageGap = 6 * unit;
  const descriptionWidth = 156 * unit;
  const descriptionGap = 6 * unit;
  const trackGap = 15 * unit;
  const imageDimensions = imageElements.map((element) => ({
    width: imageWidth,
    height: imageWidth * (element.height / Math.max(1, element.width)),
  }));
  const descriptionHeight = (descriptionId: string): number => {
    const text = business.descriptions[descriptionId]?.text?.trim() ?? "";
    const lineCount = Math.max(1, Math.ceil(text.length / 12));
    // The accepted 230-pixel screenshot is captured at 150% display scaling.
    // Store its CSS-space equivalent so the cap follows the other preview
    // members across canvas zoom and display scaling.
    return Math.min(230 / 1.5, Math.max(89, (64 + lineCount * 18) * 1.2) * unit);
  };
  const descriptionDimensions = folder.descriptionIds.map((descriptionId) => ({
    width: descriptionWidth,
    height: descriptionHeight(descriptionId),
  }));
  const maxImageHeight = imageDimensions.reduce(
    (height, dimension) => Math.max(height, dimension.height),
    0,
  );
  const maxDescriptionHeight = descriptionDimensions.reduce(
    (height, dimension) => Math.max(height, dimension.height),
    0,
  );
  // Start the first image fully inside the visible stage. The previous
  // percentage-only anchor let the enlarged reference image cross the stage's
  // left edge as soon as the formal canvas stopped shrinking it.
  const firstSlotX = stage.x + imageWidth / 2 + Math.max(8, 8 * unit);
  const startAngle = -Math.PI / 2;
  const ellipseRadiusX = Math.max(stage.width * 2.1, 1200 * unit);
  const ellipseRadiusY = clamp(stage.height * 0.34, 180 * unit, 260 * unit);
  const descriptionFirstY = clamp(
    stage.y + stage.height * 0.75,
    stage.y + maxDescriptionHeight / 2,
    stage.y + stage.height - maxDescriptionHeight / 2,
  );
  const imageBottom = descriptionFirstY - maxDescriptionHeight / 2 - trackGap;
  const imageFirstY = imageBottom - maxImageHeight / 2;
  const ellipseCenterX = firstSlotX - ellipseRadiusX * Math.cos(startAngle);
  const imageEllipseCenterY = imageFirstY - ellipseRadiusY * Math.sin(startAngle);
  const descriptionEllipseCenterY =
    descriptionFirstY - ellipseRadiusY * Math.sin(startAngle);

  type SlotGeometry = FolderPreviewPlacement & {
    centerX: number;
    centerY: number;
    projectedWidth: number;
  };
  const makeSlotTargets = (
    dimensions: readonly Readonly<{ width: number; height: number }>[],
    centerY: number,
    gap: number,
    alignBottom: boolean,
  ): SlotGeometry[] => {
    const targetCount = Math.min(6, dimensions.length);
    const targets: SlotGeometry[] = [];
    let theta = startAngle;
    const geometryAt = (
      angleOnEllipse: number,
      dimension: Readonly<{ width: number; height: number }>,
    ): SlotGeometry => {
      const tangentAngle = Math.atan2(
        ellipseRadiusY * Math.cos(angleOnEllipse),
        -ellipseRadiusX * Math.sin(angleOnEllipse),
      );
      const centerX = ellipseCenterX + ellipseRadiusX * Math.cos(angleOnEllipse);
      const trackCenterY = centerY + ellipseRadiusY * Math.sin(angleOnEllipse);
      const alignedCenterY = alignBottom
        ? trackCenterY + (maxImageHeight - dimension.height) / 2
        : trackCenterY;
      return {
        x: centerX - dimension.width / 2,
        y: alignedCenterY - dimension.height / 2,
        width: dimension.width,
        height: dimension.height,
        scale: 1,
        angle: tangentAngle,
        centerX,
        centerY: alignedCenterY,
        projectedWidth:
          Math.abs(dimension.width * Math.cos(tangentAngle)) +
          Math.abs(dimension.height * Math.sin(tangentAngle)),
      };
    };
    for (let index = 0; index < targetCount; index += 1) {
      const dimension = dimensions[index];
      if (index > 0) {
        const previous = targets[index - 1];
        const targetLeft = previous.centerX + previous.projectedWidth / 2 + gap;
        let low = theta + 0.0001;
        let high = Math.min(theta + Math.PI / 3, Math.PI / 2 - 0.01);
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const middle = (low + high) / 2;
          const candidate = geometryAt(middle, dimension);
          const candidateLeft = candidate.centerX - candidate.projectedWidth / 2;
          if (candidateLeft < targetLeft) low = middle;
          else high = middle;
        }
        theta = high;
      }
      targets.push(geometryAt(theta, dimension));
    }
    return targets;
  };

  const imageTargets = makeSlotTargets(
    imageDimensions,
    imageEllipseCenterY,
    imageGap,
    true,
  );
  const descriptionTargets = makeSlotTargets(
    descriptionDimensions,
    descriptionEllipseCenterY,
    descriptionGap,
    false,
  );
  const memberPlacements: Record<string, FolderPreviewPlacement> = {};
  const descriptionPlacements: Record<string, FolderPreviewPlacement> = {};
  const imagePlacementById = new Map<
    string,
    Readonly<{ source: ExcalidrawElement; target: FolderPreviewPlacement }>
  >();

  imageElements.forEach((element, index) => {
    const target = imageTargets[index];
    if (!target) return;
    const scale = target.width / Math.max(1, element.width);
    const placement = { ...target, scale };
    memberPlacements[element.id] = placement;
    const imageId = imageIdOf(element);
    if (imageId) imagePlacementById.set(imageId, { source: element, target: placement });
  });
  memberElements.forEach((element) => {
    if (memberPlacements[element.id]) return;
    const imageId = imageIdOf(element);
    const imagePlacement = imageId ? imagePlacementById.get(imageId) : undefined;
    if (!imagePlacement) return;
    const { source, target } = imagePlacement;
    const rotation = target.angle - source.angle;
    const scale = target.scale;
    const sourceCenter = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const elementCenter = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    };
    const relativeX = (elementCenter.x - sourceCenter.x) * scale;
    const relativeY = (elementCenter.y - sourceCenter.y) * scale;
    const rotatedX = relativeX * Math.cos(rotation) - relativeY * Math.sin(rotation);
    const rotatedY = relativeX * Math.sin(rotation) + relativeY * Math.cos(rotation);
    const targetCenter = {
      x: target.x + target.width / 2 + rotatedX,
      y: target.y + target.height / 2 + rotatedY,
    };
    memberPlacements[element.id] = {
      x: targetCenter.x - (element.width * scale) / 2,
      y: targetCenter.y - (element.height * scale) / 2,
      width: element.width * scale,
      height: element.height * scale,
      scale,
      angle: element.angle + rotation,
    };
  });
  folder.descriptionIds.forEach((descriptionId, index) => {
    const target = descriptionTargets[index];
    if (target) descriptionPlacements[descriptionId] = target;
  });

  const slots: FolderPreviewSlot[] = Array.from({ length: slotCount }, (_, index) => ({
    index,
    element: imageElements[index],
    descriptionId: folder.descriptionIds[index],
    imageRect: imageTargets[index] ?? null,
    descriptionRect: descriptionTargets[index] ?? null,
  }));
  const firstElement = imageElements[0];
  const firstPlacement = firstElement ? memberPlacements[firstElement.id] : undefined;
  const fitScale = firstPlacement?.scale ?? 1;
  const offsetX = firstElement && firstPlacement
    ? firstPlacement.x - firstElement.x * fitScale
    : base.dx;
  const offsetY = firstElement && firstPlacement
    ? firstPlacement.y - firstElement.y * fitScale
    : base.dy;
  return {
    scale: fitScale,
    dx: offsetX + cluster.left * (fitScale - 1),
    dy: offsetY + cluster.top * (fitScale - 1),
    offsetX,
    offsetY,
    clusterLeft: cluster.left,
    clusterTop: cluster.top,
    stage,
    previewCoverBounds,
    slots,
    memberPlacements,
    descriptionPlacements,
  };
};

export const folderPreviewTranslation = (
  business: BusinessStateV2,
  elements: readonly ExcalidrawElement[],
  folderId: string,
  viewport?: FolderPreviewViewport,
): Readonly<{ dx: number; dy: number }> => {
  const layout = folderPreviewLayout(business, elements, folderId, viewport);
  return { dx: layout.dx, dy: layout.dy };
};

const projectPreviewElement = (
  element: ExcalidrawElement,
  layout: FolderPreviewLayout,
): ExcalidrawElement => {
  const placement = layout.memberPlacements?.[element.id];
  if (placement) {
    const next = {
      ...element,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      angle: placement.angle,
      ...(element.type === "text" && typeof element.fontSize === "number"
        ? { fontSize: element.fontSize * placement.scale }
        : {}),
    } as ExcalidrawElement & { points?: readonly Readonly<[number, number]>[] };
    if (Array.isArray(next.points)) {
      next.points = next.points.map(([x, y]) => [
        x * placement.scale,
        y * placement.scale,
      ] as const);
    }
    const customData = next.customData;
    if (Array.isArray(customData?.selectionPoints)) {
      return {
        ...next,
        customData: {
          ...customData,
          selectionPoints: customData.selectionPoints.map((point) =>
            Array.isArray(point) && point.length === 2
              ? [point[0] * placement.scale, point[1] * placement.scale]
              : point,
          ),
        },
      } as ExcalidrawElement;
    }
    return next;
  }
  if (layout.scale === 1 && layout.offsetX === layout.dx && layout.offsetY === layout.dy) {
    return {
      ...element,
      x: element.x + layout.dx,
      y: element.y + layout.dy,
    } as ExcalidrawElement;
  }
  const next = {
    ...element,
    x: element.x * layout.scale + layout.offsetX,
    y: element.y * layout.scale + layout.offsetY,
    width: element.width * layout.scale,
    height: element.height * layout.scale,
    ...(element.type === "text" && typeof element.fontSize === "number"
      ? { fontSize: element.fontSize * layout.scale }
      : {}),
  } as ExcalidrawElement & { points?: readonly Readonly<[number, number]>[] };
  if (Array.isArray(next.points)) {
    next.points = next.points.map(([x, y]) => [x * layout.scale, y * layout.scale] as const);
  }
  const customData = next.customData;
  if (Array.isArray(customData?.selectionPoints)) {
    return {
      ...next,
      customData: {
        ...customData,
        selectionPoints: customData.selectionPoints.map((point) =>
          Array.isArray(point) && point.length === 2
            ? [point[0] * layout.scale, point[1] * layout.scale]
            : point,
        ),
      },
    } as ExcalidrawElement;
  }
  return next as ExcalidrawElement;
};

const withoutProjectionRuntimeMetadata = (element: ExcalidrawElement) => {
  const {
    index: _index,
    version: _version,
    versionNonce: _versionNonce,
    updated: _updated,
    ...comparable
  } = element;
  return comparable;
};

export const stabilizeFolderProjectionRuntimeMetadata = (
  projection: FolderSceneProjection,
  rendered: readonly ExcalidrawElement[],
): FolderSceneProjection => {
  const renderedById = new Map(rendered.map((element) => [element.id, element]));
  let changed = false;
  const elements = projection.elements.map((element) => {
    if (!projection.projectedElementIds.has(element.id)) return element;
    const current = renderedById.get(element.id);
    if (
      !current ||
      JSON.stringify(withoutProjectionRuntimeMetadata(current)) !==
        JSON.stringify(withoutProjectionRuntimeMetadata(element))
    ) {
      return element;
    }
    if (
      current.index === element.index &&
      current.version === element.version &&
      current.versionNonce === element.versionNonce &&
      current.updated === element.updated
    ) {
      return element;
    }
    changed = true;
    return {
      ...element,
      index: current.index,
      version: current.version,
      versionNonce: current.versionNonce,
      updated: current.updated,
    } as ExcalidrawElement;
  });
  return changed ? { ...projection, elements } : projection;
};

export const projectFolderScene = (
  canonical: readonly ExcalidrawElement[],
  business: BusinessStateV2,
  mode: FolderProjectionMode,
): FolderSceneProjection => {
  const hiddenElementIds = new Set<string>();
  const projectedElementIds = new Set<string>();
  const previewLayout =
    mode.type === "preview"
      ? folderPreviewLayout(
          business,
          canonical,
          mode.folderId,
          mode.viewport,
        )
      : {
          scale: 1,
          dx: 0,
          dy: 0,
          offsetX: 0,
          offsetY: 0,
          clusterLeft: 0,
          clusterTop: 0,
          stage: null,
        };
  const elements = canonical.map((element) => {
    const owner = elementOwnerFromBusiness(business, element);
    const elementImageId =
      typeof element.customData?.imageId === "string"
        ? element.customData.imageId
        : typeof element.customData?.regionId === "string"
          ? business.regions[element.customData.regionId]?.imageId
          : undefined;
    const elementDescriptionId =
      typeof element.customData?.descriptionId === "string"
        ? element.customData.descriptionId
        : undefined;
    if (
      !element.isDeleted &&
      element.customData?.kind === EMPTY_FOLDER_COVER_KIND
    ) {
      hiddenElementIds.add(element.id);
      projectedElementIds.add(element.id);
      return { ...element, opacity: 0, locked: true } as ExcalidrawElement;
    }
    // Image shadows are rendered by the transient canvas overlay. Keep any
    // legacy scene companions inert so they cannot appear as a purple edge.
    if (!element.isDeleted && element.customData?.kind === "image-shadow") {
      hiddenElementIds.add(element.id);
      projectedElementIds.add(element.id);
      return { ...element, opacity: 0, locked: true } as ExcalidrawElement;
    }
    const visible =
      mode.type === "overview"
        ? owner === business.rootFolderId
        : mode.type === "preview"
          ? owner === business.rootFolderId || owner === mode.folderId
          : mode.type === "folder"
            ? owner === mode.folderId &&
              element.customData?.kind !== EMPTY_FOLDER_COVER_KIND
            : mode.type === "image"
              ? owner === mode.folderId && elementImageId === mode.imageId
              : mode.type === "description"
                ? owner === mode.folderId &&
                  elementDescriptionId === mode.descriptionId
                : owner === mode.folderId &&
                  (elementDescriptionId === undefined ||
                    elementDescriptionId === mode.descriptionId);
    if (element.isDeleted) return element;
    if (mode.type === "preview" && owner === business.rootFolderId) {
      projectedElementIds.add(element.id);
      return {
        ...element,
        opacity: Math.min(element.opacity, 40),
        locked: true,
      } as ExcalidrawElement;
    }
    if (mode.type === "preview" && owner === mode.folderId) {
      projectedElementIds.add(element.id);
      if (
        element.type === "image" &&
        ((mode.previewImageId && elementImageId === mode.previewImageId) ||
          mode.previewImageIds?.includes(elementImageId ?? ""))
      ) {
        return {
          ...projectPreviewElement(element, previewLayout),
          opacity: 0,
          locked: true,
        } as ExcalidrawElement;
      }
      return {
        ...projectPreviewElement(element, previewLayout),
        locked: true,
      } as ExcalidrawElement;
    }
    if (mode.type === "image") {
      projectedElementIds.add(element.id);
      const isOtherImageSelection =
        element.customData?.kind === "region" &&
        elementImageId !== undefined &&
        elementImageId !== mode.imageId;
      if (owner !== mode.folderId || isOtherImageSelection) {
        hiddenElementIds.add(element.id);
        return { ...element, opacity: 0, locked: true } as ExcalidrawElement;
      }
      return { ...element, locked: true } as ExcalidrawElement;
    }
    if (visible) return element;
    hiddenElementIds.add(element.id);
    projectedElementIds.add(element.id);
    return { ...element, opacity: 0, locked: true } as ExcalidrawElement;
  });
  const topmost = (element: ExcalidrawElement): boolean => {
    const owner = elementOwnerFromBusiness(business, element);
    if (mode.type === "preview") return owner === mode.folderId;
    if (mode.type !== "image") return false;
    const imageId =
      typeof element.customData?.imageId === "string"
        ? element.customData.imageId
        : typeof element.customData?.regionId === "string"
          ? business.regions[element.customData.regionId]?.imageId
          : undefined;
    return owner === mode.folderId && imageId === mode.imageId;
  };
  const orderedElements =
    mode.type === "preview" || mode.type === "image"
      ? [
          ...elements.filter((element) => !topmost(element)),
          ...elements.filter(topmost),
        ]
      : elements;
  return {
    canonical,
    elements: orderedElements,
    hiddenElementIds,
    projectedElementIds,
    mode,
  };
};

export const visibleFolderSceneElements = (
  canonical: readonly ExcalidrawElement[],
  business: BusinessStateV2,
  mode: FolderProjectionMode,
): readonly ExcalidrawElement[] => {
  const projection = projectFolderScene(canonical, business, mode);
  return projection.elements.filter(
    (element) => !projection.hiddenElementIds.has(element.id),
  );
};

export const deprojectFolderSceneChange = (
  incoming: readonly ExcalidrawElement[],
  projection: FolderSceneProjection,
): readonly ExcalidrawElement[] => {
  const canonicalById = new Map(
    projection.canonical.map((element) => [element.id, element]),
  );
  const incomingById = new Map(incoming.map((element) => [element.id, element]));
  const isFocusedImageRegion = (element: ExcalidrawElement): boolean =>
    projection.mode.type === "image" &&
    element.customData?.kind === "region" &&
    imageIdOf(element) === projection.mode.imageId;
  const deprojected = projection.canonical.flatMap((canonical) => {
    const changed = incomingById.get(canonical.id);
    if (projection.projectedElementIds.has(canonical.id)) {
      if (changed && isFocusedImageRegion(canonical)) {
        return [
          {
            ...changed,
            opacity: canonical.opacity,
            locked: canonical.locked,
          } as ExcalidrawElement,
        ];
      }
      return [canonical];
    }
    if (changed) return [changed];
    return canonical.isDeleted ? [canonical] : [];
  });
  const canonicalIds = new Set(canonicalById.keys());
  const newlyCreated = incoming.filter(
    (element) =>
      !canonicalIds.has(element.id) &&
      projection.mode.type !== "preview" &&
      (projection.mode.type !== "image" || isFocusedImageRegion(element)),
  );
  return [...deprojected, ...newlyCreated];
};

export const moveFolderScene = ({
  business,
  elements,
  folderId,
  dx,
  dy,
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  folderId: string;
  dx: number;
  dy: number;
}): readonly ExcalidrawElement[] => {
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") {
    fail(`Folder ${folderId} 不存在或不可移动`);
  }
  return elements.map((element) =>
    elementOwnerFromBusiness(business, element) === folderId ||
    element.id === folder.coverElementId
      ? ({ ...element, x: element.x + dx, y: element.y + dy } as ExcalidrawElement)
      : element,
  );
};

export const moveFolderContents = ({
  business,
  elements,
  folderId,
  dx,
  dy,
}: {
  business: BusinessStateV2;
  elements: readonly ExcalidrawElement[];
  folderId: string;
  dx: number;
  dy: number;
}): { business: BusinessStateV2; elements: readonly ExcalidrawElement[] } => {
  const folder = business.folders[folderId];
  if (!folder || folder.kind !== "folder") {
    fail(`Folder ${folderId} 不存在或不可移动`);
  }
  const descriptionIds = new Set(folder.descriptionIds);
  const movedBusiness: BusinessStateV2 = {
    ...business,
    document: { ...business.document, updatedAt: new Date().toISOString() },
    descriptionReferences: Object.fromEntries(
      Object.entries(business.descriptionReferences).map(([id, reference]) => [
        id,
        descriptionIds.has(reference.descriptionId)
          ? {
              ...reference,
              anchor: {
                x: reference.anchor.x + dx,
                y: reference.anchor.y + dy,
              },
            }
          : reference,
      ]),
    ),
  };
  assertFolderIntegrity(movedBusiness);
  return {
    business: movedBusiness,
    elements: moveFolderScene({ business, elements, folderId, dx, dy }),
  };
};
