import type {
  Bounds,
  BusinessState,
  Point,
} from "./types";
import {
  activeDescriptionEntries,
  normalizeDescriptionReferenceUrl,
} from "./descriptions";
import {
  FolderMigrationError,
  migrateBusinessStateToV2,
} from "./folderScene";
import {
  quickAnnotationContextsForImage,
  type QuickAnnotationContext,
} from "../ui/quickAnnotations";

export const focusedPublishableImageFormatsLabel = "PNG、JPEG、WebP";

/**
 * Keep these browser-side limits aligned with the focused payload limits in
 * scripts/canvas-context-mcp-core.mjs. They are deliberately checked before
 * rendering the overview or contacting the local bridge.
 */
export const focusedPublishLimits = Object.freeze({
  maxImages: 4,
  maxImageBytes: 6 * 1024 * 1024,
  maxTotalImageBytes: 6 * 1024 * 1024,
});

export interface FocusedPublishLimits {
  readonly maxImages: number;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
}

export interface FocusedPublishImageInput {
  name: string;
  dataUrl: string;
}

export const isFocusedPublishableImageMimeType = (
  mimeType: string,
): boolean =>
  ["image/png", "image/jpeg", "image/webp"].includes(
    mimeType.trim().toLowerCase(),
  );

export const isFocusedAnnotationSemanticElementKind = (
  kind: unknown,
): boolean => kind === "annotation" || kind === "annotation-card";

export const dataUrlDecodedByteLength = (dataUrl: string): number | null => {
  if (typeof dataUrl !== "string") {
    return null;
  }
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 5) {
    return null;
  }
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (
    !metadata.startsWith("data:") ||
    !metadata.includes(";base64") ||
    !payload ||
    payload.length % 4 !== 0 ||
    !/^[a-z0-9+/]*={0,2}$/i.test(payload)
  ) {
    return null;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return payload.length / 4 * 3 - padding;
};

const formatMiB = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

export const getFocusedPublishPreflightError = (
  images: readonly FocusedPublishImageInput[],
  limits: FocusedPublishLimits = focusedPublishLimits,
): string | null => {
  if (images.length > limits.maxImages) {
    return `本次最多发布 ${limits.maxImages} 张重点图片；请移除 ${images.length - limits.maxImages} 张后再准备给 Codex。`;
  }

  let totalBytes = 0;
  for (const image of images) {
    const bytes = dataUrlDecodedByteLength(image.dataUrl);
    if (bytes === null) {
      return `重点图片“${image.name}”像素数据无效，无法判断发布大小。`;
    }
    if (bytes > limits.maxImageBytes) {
      return `重点图片“${image.name}”原图为 ${formatMiB(bytes)}，超过单张 ${formatMiB(limits.maxImageBytes)} 上限；请导入较小版本或移除该重点。`;
    }
    totalBytes += bytes;
  }

  if (totalBytes > limits.maxTotalImageBytes) {
    return `本次重点原图合计为 ${formatMiB(totalBytes)}，超过 ${formatMiB(limits.maxTotalImageBytes)} 上限；请减少重点图片或导入较小版本。`;
  }
  return null;
};

export interface FocusedOverviewSnapshot {
  filename: string;
  mimeType: "image/png";
  width: number;
  height: number;
  bytes: number;
}

export interface FocusedAnnotationContext {
  regionId: string;
  originalPixelBounds: Bounds;
  clippedPixelBounds: Bounds;
  normalizedCorners: Point[];
  isClipped: boolean;
  selectionVisible: boolean;
  card: {
    annotationId: string;
    text: string;
  } | null;
}

export interface FocusedImageContext {
  imageId: string;
  fileId: string;
  name: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  pixelsAvailable: true;
  visibleAnnotations: FocusedAnnotationContext[];
  quickAnnotations?: QuickAnnotationContext[];
}

export interface FocusedDescriptionContext {
  descriptionId: string;
  text: string;
  referenceUrl?: string;
  reference: {
    x: number;
    y: number;
  };
}

export interface FocusedDescriptionScopeLinkContext {
  descriptionId: string;
  regionId: string;
}

export interface FocusedDescriptionScopeContext {
  regionId: string;
  imageId: string;
  originalPixelBounds: Bounds;
  clippedPixelBounds: Bounds;
  normalizedCorners: Point[];
  isClipped: boolean;
}

export interface FocusedCanvasContext {
  format: "ai-canvas-focused-context";
  version: 1;
  generatedAt: string;
  document: {
    id: string;
    title: string;
  };
  overviewSnapshot: FocusedOverviewSnapshot;
  focusImages: FocusedImageContext[];
  descriptions?: FocusedDescriptionContext[];
  descriptionScopes?: FocusedDescriptionScopeContext[];
  descriptionScopeLinks?: FocusedDescriptionScopeLinkContext[];
}

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const addFocusedImage = (
  focusImageIds: readonly string[],
  imageId: string,
): string[] =>
  focusImageIds.includes(imageId) ? [...focusImageIds] : [...focusImageIds, imageId];

export const removeFocusedImage = (
  focusImageIds: readonly string[],
  imageId: string,
): string[] => focusImageIds.filter((candidate) => candidate !== imageId);

export const normalizeFocusedImageIds = (
  business: BusinessState,
  focusImageIds: readonly string[],
  focusFolderId?: string,
): string[] => {
  const normalized: string[] = [];
  focusImageIds.forEach((imageId) => {
    if (
      business.imageAssets[imageId] &&
      (!focusFolderId ||
        business.imageAssets[imageId].folderId === focusFolderId) &&
      !normalized.includes(imageId)
    ) {
      normalized.push(imageId);
    }
  });
  return normalized;
};

export const didFocusedImageIdsChange = (
  left: readonly string[],
  right: readonly string[],
): boolean => !sameIds(left, right);

const assertOverviewSnapshot = (
  overviewSnapshot: FocusedOverviewSnapshot,
): FocusedOverviewSnapshot => {
  if (
    !overviewSnapshot ||
    !overviewSnapshot.filename.trim() ||
    overviewSnapshot.mimeType !== "image/png" ||
    !Number.isFinite(overviewSnapshot.width) ||
    overviewSnapshot.width <= 0 ||
    !Number.isFinite(overviewSnapshot.height) ||
    overviewSnapshot.height <= 0 ||
    !Number.isFinite(overviewSnapshot.bytes) ||
    overviewSnapshot.bytes <= 0
  ) {
    throw new Error("当前视窗概览不可用。");
  }
  return overviewSnapshot;
};

export const buildFocusedCanvasContext = ({
  business,
  focusFolderId,
  focusImageIds,
  visibleRegionIds,
  visibleAnnotationRegionIds,
  overviewSnapshot,
  generatedAt = new Date().toISOString(),
}: {
  business: BusinessState;
  focusFolderId: string;
  focusImageIds: readonly string[];
  visibleRegionIds: Iterable<string>;
  visibleAnnotationRegionIds: Iterable<string>;
  overviewSnapshot: FocusedOverviewSnapshot;
  generatedAt?: string;
}): FocusedCanvasContext => {
  const scopedBusiness = migrateBusinessStateToV2(business);
  if (!scopedBusiness.folders[focusFolderId]) {
    throw new FolderMigrationError("Codex Read 缺少有效工作 scope");
  }
  const normalizedFocusImageIds = normalizeFocusedImageIds(
    scopedBusiness,
    focusImageIds,
    focusFolderId,
  );
  if (normalizedFocusImageIds.length === 0) {
    throw new Error("请先将一张或多张图片设为本次重点。");
  }

  const visibleRegions = new Set(visibleRegionIds);
  const visibleAnnotationRegions = new Set(visibleAnnotationRegionIds);
  const descriptionEntries = activeDescriptionEntries(scopedBusiness).filter(
    ({ description }) => description.folderId === focusFolderId,
  );
  const hasDescriptionMode = descriptionEntries.length > 0;
  const publishableDescriptions = descriptionEntries.filter(
    ({ description }) => Boolean(description.text.trim()),
  );
  const publishableDescriptionIds = new Set(
    publishableDescriptions.map(({ description }) => description.id),
  );
  const descriptionScopeLinks = publishableDescriptions.flatMap(
    ({ description, regionIds }) =>
      regionIds.map((regionId) => ({
        descriptionId: description.id,
        regionId,
      })),
  );
  const linkedRegionIds = [
    ...new Set(descriptionScopeLinks.map((link) => link.regionId)),
  ];
  const descriptionScopes = linkedRegionIds.map((regionId) => {
    const region = scopedBusiness.regions[regionId];
    if (
      !region?.active ||
      region.folderId !== focusFolderId ||
      !region.geometry
    ) {
      throw new Error(`说明关联的选区 ${regionId} 没有可用原图坐标。`);
    }
    return {
      regionId: region.id,
      imageId: region.imageId,
      originalPixelBounds: region.geometry.originalPixelBounds,
      clippedPixelBounds: region.geometry.clippedPixelBounds,
      normalizedCorners: region.geometry.normalizedCorners,
      isClipped: region.geometry.isClipped,
    };
  });
  const activeAnnotationsByRegion = new Map(
    hasDescriptionMode
      ? []
      : Object.values(scopedBusiness.annotations)
          .filter((annotation) => annotation.active)
          .map((annotation) => [annotation.regionId, annotation]),
  );

  return {
    format: "ai-canvas-focused-context",
    version: 1,
    generatedAt,
    document: {
      id: scopedBusiness.document.id,
      title: scopedBusiness.document.title,
    },
    overviewSnapshot: assertOverviewSnapshot(overviewSnapshot),
    ...(hasDescriptionMode
      ? {
          descriptions: publishableDescriptions.map(
            ({ description, reference }) => {
              const referenceUrl = normalizeDescriptionReferenceUrl(
                description.referenceUrl,
              );
              return {
                descriptionId: description.id,
                text: description.text.trim(),
                ...(referenceUrl ? { referenceUrl } : {}),
                reference: { ...reference.anchor },
              };
            },
          ),
          descriptionScopes,
          descriptionScopeLinks: descriptionScopeLinks.filter((link) =>
            publishableDescriptionIds.has(link.descriptionId),
          ),
        }
      : {}),
    focusImages: normalizedFocusImageIds.map((imageId) => {
      const image = scopedBusiness.imageAssets[imageId]!;
      const quickAnnotations = quickAnnotationContextsForImage(
        scopedBusiness,
        imageId,
      );
      const visibleAnnotations = Object.values(scopedBusiness.regions)
        .filter(
          (region) =>
            region.active &&
            region.folderId === focusFolderId &&
            region.imageId === imageId &&
            region.geometry !== null &&
            (visibleRegions.has(region.id) ||
              visibleAnnotationRegions.has(region.id)),
        )
        .map((region) => {
          const annotation = activeAnnotationsByRegion.get(region.id);
          const cardText = annotation?.text.trim() ?? "";
          const card =
            annotation && visibleAnnotationRegions.has(region.id) && cardText
              ? {
                  annotationId: annotation.id,
                  text: cardText,
                }
              : null;
          return {
            regionId: region.id,
            originalPixelBounds: region.geometry!.originalPixelBounds,
            clippedPixelBounds: region.geometry!.clippedPixelBounds,
            normalizedCorners: region.geometry!.normalizedCorners,
            isClipped: region.geometry!.isClipped,
            selectionVisible: visibleRegions.has(region.id),
            card,
          };
        });
      return {
        imageId: image.id,
        fileId: image.fileId,
        name: image.name,
        mimeType: image.mimeType,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        pixelsAvailable: true,
        visibleAnnotations,
        ...(quickAnnotations.length > 0 ? { quickAnnotations } : {}),
      };
    }),
  };
};
