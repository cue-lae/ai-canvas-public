export interface CanvasSelection {
  /** Stable business IDs, never transient Excalidraw image element IDs. */
  imagePlacementIds: readonly string[];
  regionIds: readonly string[];
  descriptionIds: readonly string[];
}

export interface CanvasImagePlacementSelectionSource {
  id: string;
  elementId: string;
  active: boolean;
}

export const EMPTY_CANVAS_SELECTION: CanvasSelection = {
  imagePlacementIds: [],
  regionIds: [],
  descriptionIds: [],
};

const unique = (ids: readonly string[]): readonly string[] =>
  [...new Set(ids)];

export const createCanvasSelection = (
  selection: Partial<CanvasSelection> = {},
): CanvasSelection => ({
  imagePlacementIds: unique(selection.imagePlacementIds ?? []),
  regionIds: unique(selection.regionIds ?? []),
  descriptionIds: unique(selection.descriptionIds ?? []),
});

export const hasCanvasSelection = (selection: CanvasSelection): boolean =>
  selection.imagePlacementIds.length > 0 ||
  selection.regionIds.length > 0 ||
  selection.descriptionIds.length > 0;

/**
 * The Excalidraw selectedElementIds object is only a rendering projection of
 * CanvasSelection. Raw native selection never flows back through this helper.
 */
export const projectCanvasSelectionToNativeElementIds = (
  selection: CanvasSelection,
  imagePlacements: readonly CanvasImagePlacementSelectionSource[],
): Readonly<Record<string, true>> => {
  const placementElementIds = new Map(
    imagePlacements
      .filter((placement) => placement.active)
      .map((placement) => [placement.id, placement.elementId]),
  );
  const elementIds = new Set<string>();
  selection.imagePlacementIds.forEach((placementId) => {
    const elementId = placementElementIds.get(placementId);
    if (elementId) {
      elementIds.add(elementId);
    }
  });
  return Object.fromEntries(
    [...elementIds].map((elementId) => [elementId, true] as const),
  );
};

export const canvasSelectionsEqual = (
  left: CanvasSelection,
  right: CanvasSelection,
): boolean =>
  left.imagePlacementIds.length === right.imagePlacementIds.length &&
  left.regionIds.length === right.regionIds.length &&
  left.descriptionIds.length === right.descriptionIds.length &&
  left.imagePlacementIds.every((id, index) => id === right.imagePlacementIds[index]) &&
  left.regionIds.every((id, index) => id === right.regionIds[index]) &&
  left.descriptionIds.every((id, index) => id === right.descriptionIds[index]);

export const nativeSelectionMirrorsEqual = (
  left: Readonly<Record<string, boolean>>,
  right: Readonly<Record<string, true>>,
): boolean => {
  const leftIds = Object.keys(left).filter((id) => left[id]);
  const rightIds = Object.keys(right).filter((id) => right[id]);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id) => right[id] === true)
  );
};
