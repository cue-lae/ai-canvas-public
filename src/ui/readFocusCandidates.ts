import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { normalizeFocusedImageIds } from "../domain/focusedPublish";
import type { SceneElementLike } from "../domain/reconcile";
import type { BusinessState, ImageAssetRecord } from "../domain/types";

export interface ReadFocusCandidate {
  imageId: string;
  name: string;
  dataURL: string | null;
  unavailableReason: string | null;
}

interface ReadFocusCandidatesInput {
  business: BusinessState;
  /** The actual publication scope, including Root while previewing a folder. */
  folderId: string;
  elements: readonly SceneElementLike[];
  files: Readonly<BinaryFiles>;
  focusedImageIds: readonly string[];
}

/**
 * Derive presentation rows without changing focus, ownership, scene or indices.
 * Restored focus is deliberately normalized by the existing domain rule only.
 */
export const deriveReadFocusCandidates = ({
  business,
  folderId,
  elements,
  files,
  focusedImageIds,
}: ReadFocusCandidatesInput): ReadFocusCandidate[] => {
  const folder = business.folders?.[folderId];
  const imageIds = folder?.id === folderId ? folder.imageAssetIds : [];
  const indexedImageIds = new Set(imageIds);
  const selectedImageIds = normalizeFocusedImageIds(
    business,
    focusedImageIds,
    folderId,
  );
  const rows: ReadFocusCandidate[] = [];
  const seen = new Set<string>();
  const elementsById = new Map<string, SceneElementLike[]>();
  const imagesByAssetId = new Map<string, SceneElementLike[]>();
  for (const element of elements) {
    const sameId = elementsById.get(element.id) ?? [];
    sameId.push(element);
    elementsById.set(element.id, sameId);
    if (
      !element.isDeleted && element.type === "image" &&
      element.customData?.kind === "image" &&
      typeof element.customData.imageId === "string"
    ) {
      const assetId = element.customData.imageId;
      const images = imagesByAssetId.get(assetId) ?? [];
      images.push(element);
      imagesByAssetId.set(assetId, images);
    }
  }
  const placementsByAssetId = new Map<
    string,
    BusinessState["imagePlacements"][string][]
  >();
  for (const placement of Object.values(business.imagePlacements)) {
    if (!placement.active) continue;
    const placements = placementsByAssetId.get(placement.imageId) ?? [];
    placements.push(placement);
    placementsByAssetId.set(placement.imageId, placements);
  }

  const sceneUnavailableReason = (
    imageId: string,
    asset: ImageAssetRecord,
  ): string | null => {
    if (asset.id !== imageId) return "图片登记不一致，无法加入重点。";
    const placements = placementsByAssetId.get(imageId) ?? [];
    if (placements.length !== 1) return "图片缺少唯一的存活实例。";
    const placement = placements[0];
    if (
      business.imagePlacements[placement.id] !== placement ||
      placement.folderId !== folderId
    ) return "图片实例归属与当前范围不一致。";

    const images = imagesByAssetId.get(imageId) ?? [];
    const image = images[0];
    if (
      images.length !== 1 || image.id !== placement.elementId ||
      elementsById.get(image.id)?.length !== 1
    ) return "图片缺少唯一的画布原始实例。";
    if (
      image.customData?.placementId !== placement.id ||
      (image.customData?.folderId !== undefined &&
        image.customData.folderId !== folderId) ||
      image.fileId !== asset.fileId
    ) return "图片实例归属与原图登记不一致。";
    return null;
  };

  const appendRow = (imageId: string, restoredFocus: boolean): void => {
    if (seen.has(imageId)) return;
    const asset = business.imageAssets[imageId];
    if (!asset || asset.folderId !== folderId) return;
    const sceneReason = sceneUnavailableReason(imageId, asset);
    // Only existing focus may retain a missing or ambiguous canonical instance.
    if (sceneReason && !restoredFocus) return;
    seen.add(imageId);
    const dataURL = files[asset.fileId]?.dataURL;
    const pixels = typeof dataURL === "string" && dataURL.trim() ? dataURL : null;
    rows.push({
      imageId,
      name: asset.name,
      dataURL: pixels,
      unavailableReason:
        (!indexedImageIds.has(imageId) ? "图片不在当前范围索引中。" : null) ??
        sceneReason ??
        (pixels ? null : "原图数据缺失，无法加入重点。"),
    });
  };

  const selected = new Set(selectedImageIds);
  imageIds.forEach((imageId) => appendRow(imageId, selected.has(imageId)));
  // Appending anomalies in existing focus order keeps the normal index stable.
  selectedImageIds.forEach((imageId) => appendRow(imageId, true));
  return rows;
};
