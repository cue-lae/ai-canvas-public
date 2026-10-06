import type { CanvasSelection } from "./canvasSelection";

export type ContextInformationSelection =
  | { kind: "image"; imageId: string }
  | { kind: "description"; descriptionId: string }
  | {
      kind: "selection";
      imageCount: number;
      regionCount: number;
      descriptionCount: number;
    }
  | { kind: "folder" };

export const resolveContextInformationSelection = (input: {
  selection: CanvasSelection;
  imageIdByPlacementId: Readonly<Record<string, string | undefined>>;
  imageLayerId: string | null;
  selectedRegionImageId: string | null;
}): ContextInformationSelection => {
  const { selection } = input;
  const selectedObjectCount =
    selection.imagePlacementIds.length +
    selection.regionIds.length +
    selection.descriptionIds.length;

  if (selectedObjectCount > 1) {
    return {
      kind: "selection",
      imageCount: selection.imagePlacementIds.length,
      regionCount: selection.regionIds.length,
      descriptionCount: selection.descriptionIds.length,
    };
  }

  const descriptionId = selection.descriptionIds[0];
  if (descriptionId) return { kind: "description", descriptionId };

  if (selection.regionIds.length === 1) {
    return {
      kind: "selection",
      imageCount: selection.imagePlacementIds.length,
      regionCount: 1,
      descriptionCount: selection.descriptionIds.length,
    };
  }

  const placementId = selection.imagePlacementIds[0];
  const selectedImageId = placementId
    ? input.imageIdByPlacementId[placementId]
    : undefined;
  const selectedRegionImageId =
    selection.regionIds.length === 1 ? input.selectedRegionImageId : null;
  const imageId = selectedImageId ?? input.imageLayerId ?? selectedRegionImageId;
  return imageId ? { kind: "image", imageId } : { kind: "folder" };
};
