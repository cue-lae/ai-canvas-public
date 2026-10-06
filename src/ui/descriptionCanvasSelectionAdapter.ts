import type { CanvasSelection } from "./canvasSelection";

/** The only V9 selection projection consumed by the pure description overlay. */
export const selectedDescriptionIdsForOverlay = (
  canvasSelection: CanvasSelection,
): ReadonlySet<string> => new Set(canvasSelection.descriptionIds);
