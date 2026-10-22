import type { CSSProperties } from "react";

export type FolderPreviewAttachmentTarget = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
}>;

export interface FolderPreviewAttachmentMotion {
  sourceRect: Readonly<{ left: number; top: number }>;
  imageIds: ReadonlySet<string>;
  targets?: ReadonlyMap<string, FolderPreviewAttachmentTarget>;
}

/** Correction is available only for a complete target belonging to this motion. */
export function folderPreviewAttachmentTarget(
  motion: FolderPreviewAttachmentMotion | null,
  imageId: string,
): FolderPreviewAttachmentTarget | undefined {
  if (!motion?.imageIds.has(imageId)) return undefined;
  const target = motion.targets?.get(imageId);
  if (!target || ![target.left, target.top, target.width, target.height, target.angle ?? 0].every(Number.isFinite) ||
      target.width <= 0 || target.height <= 0) return undefined;
  return target;
}

/** Undo the projected center rotation inside the image's unchanged CSS motion. */
export function folderPreviewAttachmentCounterRotation(
  motion: FolderPreviewAttachmentMotion | null,
  imageId: string,
): string | undefined {
  const target = folderPreviewAttachmentTarget(motion, imageId);
  if (!target) return undefined;
  return `rotate(${-(target.angle ?? 0) * 180 / Math.PI} ${target.left + target.width / 2} ${target.top + target.height / 2})`;
}

/** HTML markers use the same inverse rotation in a real, image-sized local box. */
export function folderPreviewAttachmentLocalCounterStyle(
  motion: FolderPreviewAttachmentMotion | null,
  imageId: string,
): CSSProperties | undefined {
  const target = folderPreviewAttachmentTarget(motion, imageId);
  if (!target) return undefined;
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: target.width,
    height: target.height,
    transformOrigin: `${target.width / 2}px ${target.height / 2}px`,
    transform: `rotate(${-(target.angle ?? 0)}rad)`,
  };
}

export const folderPreviewAttachmentAttributes = (
  motion: FolderPreviewAttachmentMotion | null,
  imageId: string,
) => motion?.imageIds.has(imageId) ? {
  "data-folder-motion": "member",
  "data-folder-motion-index": [...motion.imageIds].indexOf(imageId),
  "data-folder-motion-image-id": imageId,
} : {};

/** Geometry already uses panel coordinates. Scale about the owning image, never a region/badge. */
export function folderPreviewAttachmentStyle(
  motion: FolderPreviewAttachmentMotion | null,
  imageId: string,
  fallback: Readonly<{ left: number; top: number }>,
  local = false,
): CSSProperties | undefined {
  if (!motion?.imageIds.has(imageId)) return undefined;
  const target = motion.targets?.get(imageId) ?? fallback;
  const rotationTarget = folderPreviewAttachmentTarget(motion, imageId);
  return {
    transformBox: "view-box",
    transformOrigin: local ? "0px 0px" : `${target.left}px ${target.top}px`,
    ...(rotationTarget ? { rotate: `${rotationTarget.angle ?? 0}rad` } : {}),
    "--folder-motion-closed-transform": `translate(${motion.sourceRect.left - target.left}px, ${motion.sourceRect.top - target.top}px) scale(.42)`,
  } as CSSProperties;
}
