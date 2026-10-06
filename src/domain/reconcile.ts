import type {
  BusinessState,
  BusinessStateV2,
  ImageAssetRecord,
  ImageCropRecord,
  ReconcileResult,
  ValidationIssue,
} from "./types";
import { appendUnique } from "./types";
import { calculateRegionGeometry } from "./geometry";
import { normalizeDescriptionBusinessState } from "./descriptions";
import {
  assertFolderIntegrity,
  isBusinessStateV2,
  migrateBusinessStateToV2,
} from "./folderScene";

const ANNOTATION_CARD_PLACEHOLDER = "双击此处输入修改指令";

export interface SceneElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  isDeleted: boolean;
  scale?: readonly [number, number];
  crop?: ImageCropRecord | null;
  fileId?: string | null;
  text?: string;
  customData?: Record<string, unknown>;
}

const stringData = (
  element: SceneElementLike,
  key: string,
): string | null => {
  const value = element.customData?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const pushIssue = (
  issues: ValidationIssue[],
  issue: ValidationIssue,
): void => {
  if (
    !issues.some(
      (candidate) =>
        candidate.code === issue.code &&
        candidate.elementId === issue.elementId &&
        candidate.businessId === issue.businessId,
    )
  ) {
    issues.push(issue);
  }
};

const cloneState = (state: BusinessState): BusinessStateV2 => {
  const normalized = migrateBusinessStateToV2(
    normalizeDescriptionBusinessState(migrateBusinessStateToV2(state)),
  );
  return {
    ...normalized,
    document: {
      ...normalized.document,
      imageAssetIds: [...normalized.document.imageAssetIds],
      imagePlacementIds: [...normalized.document.imagePlacementIds],
      regionIds: [...normalized.document.regionIds],
      annotationIds: [...normalized.document.annotationIds],
      descriptionIds: [...normalized.document.descriptionIds],
      descriptionScopeLinkIds: [
        ...normalized.document.descriptionScopeLinkIds,
      ],
      descriptionReferenceIds: [
        ...normalized.document.descriptionReferenceIds,
      ],
      aiExchangeIds: [...normalized.document.aiExchangeIds],
    },
    imageAssets: { ...normalized.imageAssets },
    imagePlacements: { ...normalized.imagePlacements },
    regions: { ...normalized.regions },
    annotations: { ...normalized.annotations },
    descriptions: { ...normalized.descriptions },
    descriptionScopeLinks: { ...normalized.descriptionScopeLinks },
    descriptionReferences: { ...normalized.descriptionReferences },
    aiExchanges: { ...normalized.aiExchanges },
    folders: Object.fromEntries(
      Object.entries(normalized.folders).map(([id, folder]) => [
        id,
        {
          ...folder,
          imageAssetIds: [...folder.imageAssetIds],
          descriptionIds: [...folder.descriptionIds],
          focusImageIds: [...folder.focusImageIds],
        },
      ]),
    ),
  };
};

const imageTransform = (
  element: SceneElementLike,
  asset: ImageAssetRecord,
) => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
  angle: element.angle,
  scaleX: element.scale?.[0] ?? 1,
  scaleY: element.scale?.[1] ?? 1,
  crop: element.crop ?? null,
  naturalWidth: asset.naturalWidth,
  naturalHeight: asset.naturalHeight,
});

export const reconcileBusinessState = (
  previous: BusinessState,
  elements: readonly SceneElementLike[],
  fileIds: ReadonlySet<string> = new Set(),
): ReconcileResult => {
  const next = cloneState(previous);
  const issues: ValidationIssue[] = [];
  const liveElements = elements.filter((element) => !element.isDeleted);
  const imageElementsByImageId = new Map<string, SceneElementLike>();

  Object.values(next.imagePlacements).forEach((placement) => {
    next.imagePlacements[placement.id] = { ...placement, active: false };
  });
  Object.values(next.regions).forEach((region) => {
    next.regions[region.id] = { ...region, active: false };
  });
  Object.values(next.annotations).forEach((annotation) => {
    next.annotations[annotation.id] = { ...annotation, active: false };
  });

  for (const element of liveElements) {
    if (element.type !== "image" || element.customData?.kind !== "image") {
      continue;
    }

    const imageId = stringData(element, "imageId");
    const placementId = stringData(element, "placementId");
    if (!imageId || !placementId) {
      pushIssue(issues, {
        code: "INVALID_CUSTOM_DATA",
        message: `图片元素 ${element.id} 缺少稳定 imageId 或 placementId`,
        elementId: element.id,
      });
      continue;
    }

    const asset = next.imageAssets[imageId];
    if (!asset) {
      pushIssue(issues, {
        code: "MISSING_IMAGE_ASSET",
        message: `图片元素 ${element.id} 引用不存在的 ImageAsset ${imageId}`,
        elementId: element.id,
        businessId: imageId,
      });
      continue;
    }

    const declaredFolderId = stringData(element, "folderId");
    if (
      isBusinessStateV2(next) &&
      declaredFolderId !== null &&
      declaredFolderId !== asset.folderId
    ) {
      pushIssue(issues, {
        code: "CROSS_FOLDER_RELATION",
        message: `图片元素 ${element.id} 的 scope 与业务 owner 不一致`,
        elementId: element.id,
        businessId: imageId,
      });
    }

    if (!element.fileId || (fileIds.size > 0 && !fileIds.has(element.fileId))) {
      pushIssue(issues, {
        code: "MISSING_IMAGE_FILE",
        message: `图片 ${imageId} 缺少可用的 Excalidraw 文件数据`,
        elementId: element.id,
        businessId: imageId,
      });
    }

    imageElementsByImageId.set(imageId, element);
    next.imagePlacements[placementId] = {
      id: placementId,
      imageId,
      elementId: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      angle: element.angle,
      scale: [
        element.scale?.[0] === -1 ? -1 : 1,
        element.scale?.[1] === -1 ? -1 : 1,
      ],
      crop: element.crop ?? null,
      active: true,
      ...(asset.folderId ? { folderId: asset.folderId } : {}),
    };
    next.document.imagePlacementIds = appendUnique(
      next.document.imagePlacementIds,
      placementId,
    );
  }

  for (const element of liveElements) {
    if (
      (element.type !== "rectangle" && element.type !== "freedraw") ||
      element.customData?.kind !== "region"
    ) {
      continue;
    }

    const regionId = stringData(element, "regionId");
    const imageId = stringData(element, "imageId");
    if (!regionId || !imageId) {
      pushIssue(issues, {
        code: "INVALID_CUSTOM_DATA",
        message: `标注选区元素 ${element.id} 缺少稳定 regionId 或 imageId`,
        elementId: element.id,
      });
      continue;
    }
    next.document.regionIds = appendUnique(
      next.document.regionIds,
      regionId,
    );

    const imageElement = imageElementsByImageId.get(imageId);
    const asset = next.imageAssets[imageId];
    if (!imageElement || !asset) {
      next.regions[regionId] = {
        id: regionId,
        imageId,
        elementId: element.id,
        geometry: null,
        active: true,
        status: "invalid",
        error: `标注选区引用的图片 ${imageId} 不存在`,
        ...(asset?.folderId ? { folderId: asset.folderId } : {}),
      };
      pushIssue(issues, {
        code: "MISSING_IMAGE_ELEMENT",
        message: `标注选区 ${regionId} 引用的图片 ${imageId} 不存在`,
        elementId: element.id,
        businessId: imageId,
      });
      continue;
    }

    try {
      const geometry = calculateRegionGeometry(
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          angle: element.angle,
          scaleX: element.scale?.[0] ?? 1,
          scaleY: element.scale?.[1] ?? 1,
        },
        imageTransform(imageElement, asset),
      );
      next.regions[regionId] = {
        id: regionId,
        imageId,
        elementId: element.id,
        geometry,
        active: true,
        status: "valid",
        ...(asset.folderId ? { folderId: asset.folderId } : {}),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "未知坐标转换错误";
      next.regions[regionId] = {
        id: regionId,
        imageId,
        elementId: element.id,
        geometry: null,
        active: true,
        status: "invalid",
        error: message,
        ...(asset.folderId ? { folderId: asset.folderId } : {}),
      };
      pushIssue(issues, {
        code: "INVALID_GEOMETRY",
        message: `标注选区 ${regionId} 坐标无效：${message}`,
        elementId: element.id,
        businessId: regionId,
      });
    }
  }

  for (const element of liveElements) {
    if (element.type !== "text" || element.customData?.kind !== "annotation") {
      continue;
    }
    const annotationId = stringData(element, "annotationId");
    const regionId = stringData(element, "regionId");
    if (!annotationId || !regionId) {
      pushIssue(issues, {
        code: "INVALID_CUSTOM_DATA",
        message: `文字元素 ${element.id} 缺少 annotationId 或 regionId`,
        elementId: element.id,
      });
      continue;
    }
    next.document.annotationIds = appendUnique(
      next.document.annotationIds,
      annotationId,
    );
    if (!next.regions[regionId]) {
      pushIssue(issues, {
        code: "MISSING_REGION",
        message: `文字标注 ${annotationId} 引用不存在的 ROI ${regionId}`,
        elementId: element.id,
        businessId: regionId,
      });
    }
    next.annotations[annotationId] = {
      id: annotationId,
      regionId,
      elementId: element.id,
      text:
        element.customData?.placeholder === "true" &&
        element.text === ANNOTATION_CARD_PLACEHOLDER
          ? ""
          : (element.text ?? next.annotations[annotationId]?.text ?? ""),
      active: true,
    };
  }

  Object.values(next.aiExchanges).forEach((exchange) => {
    if (!next.regions[exchange.regionId]) {
      next.aiExchanges[exchange.id] = {
        ...exchange,
        status: "invalid",
      };
      pushIssue(issues, {
        code: "MISSING_REGION",
        message: `模拟 AI 回答 ${exchange.id} 引用不存在的 ROI ${exchange.regionId}`,
        businessId: exchange.regionId,
      });
    } else {
      next.aiExchanges[exchange.id] = {
        ...exchange,
        status: "completed",
      };
    }
  });

  next.document.updatedAt = new Date().toISOString();
  if (isBusinessStateV2(next) && issues.every((issue) => issue.code !== "CROSS_FOLDER_RELATION")) {
    assertFolderIntegrity(next);
  }
  return { state: next, issues };
};
