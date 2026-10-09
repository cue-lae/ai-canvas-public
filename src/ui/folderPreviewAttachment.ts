import type { CSSProperties } from "react";

export interface FolderPreviewAttachmentMotion {
  sourceRect: Readonly<{ left: number; top: number }>;
  imageIds: ReadonlySet<string>;
  targets?: ReadonlyMap<string, Readonly<{ left: number; top: number; width: number; height: number }>>;
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
  return {
    transformBox: "view-box",
    transformOrigin: local ? "0px 0px" : `${target.left}px ${target.top}px`,
    "--folder-motion-closed-transform": `translate(${motion.sourceRect.left - target.left}px, ${motion.sourceRect.top - target.top}px) scale(.42)`,
  } as CSSProperties;
}
