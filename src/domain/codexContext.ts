import type {
  AnnotationRecord,
  Bounds,
  BusinessState,
  Point,
} from "./types";
import {
  quickAnnotationContextsForImage,
  type QuickAnnotationContext,
} from "../ui/quickAnnotations";

export const bridgePublishableImageFormatsLabel = "PNG、JPEG、WebP";

export const isBridgePublishableImageMimeType = (mimeType: string): boolean =>
  ["image/png", "image/jpeg", "image/webp"].includes(
    mimeType.trim().toLowerCase(),
  );

export interface CanvasSnapshot {
  filename: string;
  mimeType: "image/png";
  width: number;
  height: number;
  bytes: number;
}

export interface CodexVisualContext {
  format: "ai-canvas-codex-visual-context";
  version: 1;
  generatedAt: string;
  document: {
    id: string;
    title: string;
  };
  originalImage: {
    imageId: string;
    fileId: string;
    name: string;
    mimeType: string;
    naturalWidth: number;
    naturalHeight: number;
    pixelsAvailable: true;
    quickAnnotations?: QuickAnnotationContext[];
  };
  canvasSnapshot: CanvasSnapshot;
  selection:
    | {
        regionId: string;
        imageId: string;
        originalPixelBounds: Bounds;
        clippedPixelBounds: Bounds;
        normalizedCorners: Point[];
        isClipped: boolean;
        crop: {
          filename: string;
          mimeType: "image/png";
          width: number;
          height: number;
          bytes: number;
        };
      }
    | null;
  prompt:
    | {
        text: string;
        annotationId: string | null;
        saved: boolean;
      }
    | null;
}

const assertCanvasSnapshot = (
  canvasSnapshot: CanvasSnapshot,
): CanvasSnapshot => {
  if (
    !canvasSnapshot ||
    typeof canvasSnapshot.filename !== "string" ||
    !canvasSnapshot.filename.trim() ||
    canvasSnapshot.mimeType !== "image/png" ||
    !Number.isFinite(canvasSnapshot.width) ||
    canvasSnapshot.width <= 0 ||
    !Number.isFinite(canvasSnapshot.height) ||
    canvasSnapshot.height <= 0 ||
    !Number.isFinite(canvasSnapshot.bytes) ||
    canvasSnapshot.bytes <= 0
  ) {
    throw new Error("当前画布快照不可用。");
  }
  return canvasSnapshot;
};

const buildOriginalImageContext = (
  business: BusinessState,
  imageId: string,
) => {
  const image = business.imageAssets[imageId];
  if (!image) {
    throw new Error("当前原始图片不存在。");
  }
  const quickAnnotations = quickAnnotationContextsForImage(business, imageId);
  return {
    image,
    originalImage: {
      imageId: image.id,
      fileId: image.fileId,
      name: image.name,
      mimeType: image.mimeType,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      pixelsAvailable: true as const,
      ...(quickAnnotations.length > 0 ? { quickAnnotations } : {}),
    },
  };
};

export const findActiveAnnotationForRegion = (
  business: BusinessState,
  regionId: string | null,
): AnnotationRecord | null => {
  if (!regionId) {
    return null;
  }
  return (
    Object.values(business.annotations).find(
      (annotation) =>
        annotation.regionId === regionId && annotation.active,
    ) ?? null
  );
};

export const buildCodexVisualContext = ({
  business,
  imageId,
  regionId,
  question,
  crop,
  canvasSnapshot,
  generatedAt = new Date().toISOString(),
}: {
  business: BusinessState;
  imageId: string;
  regionId: string | null;
  question?: string;
  crop?: {
    clippedBounds: Bounds;
    bytes: number;
  };
  canvasSnapshot: CanvasSnapshot;
  generatedAt?: string;
}): CodexVisualContext => {
  const snapshot = assertCanvasSnapshot(canvasSnapshot);
  const { image, originalImage } = buildOriginalImageContext(business, imageId);
  const baseContext = {
    format: "ai-canvas-codex-visual-context" as const,
    version: 1 as const,
    generatedAt,
    document: {
      id: business.document.id,
      title: business.document.title,
    },
    originalImage,
    canvasSnapshot: snapshot,
  };

  if (regionId === null) {
    return {
      ...baseContext,
      selection: null,
      prompt: null,
    };
  }

  const region = business.regions[regionId];
  if (!region?.active || !region.geometry) {
    throw new Error("当前 ROI 没有可用的原图坐标。");
  }
  if (region.imageId !== image.id) {
    throw new Error("当前 ROI 与原始图片不匹配。");
  }
  if (!crop) {
    throw new Error("当前 ROI 没有可用的局部图。");
  }
  const normalizedQuestion = question?.trim() ?? "";
  if (!normalizedQuestion) {
    throw new Error("请先填写当前选区的问题或备注。");
  }
  const annotation = findActiveAnnotationForRegion(business, regionId);

  return {
    ...baseContext,
    selection: {
      regionId: region.id,
      imageId: region.imageId,
      originalPixelBounds: region.geometry.originalPixelBounds,
      clippedPixelBounds: region.geometry.clippedPixelBounds,
      normalizedCorners: region.geometry.normalizedCorners,
      isClipped: region.geometry.isClipped,
      crop: {
        filename: `${region.id}-crop.png`,
        mimeType: "image/png",
        width: crop.clippedBounds.width,
        height: crop.clippedBounds.height,
        bytes: crop.bytes,
      },
    },
    prompt: {
      text: normalizedQuestion,
      annotationId: annotation?.id ?? null,
      saved: annotation?.text.trim() === normalizedQuestion,
    },
  };
};
