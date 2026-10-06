import { createEmptyBusinessState } from "../domain/types";
import { DEFAULT_CANVAS_THEME_ID } from "./canvasThemeContract";

export const createCanvasSessionResetState = () => ({
  business: createEmptyBusinessState(),
  selectedImageId: null as string | null,
  selectedCanvasImageId: null as string | null,
  selectedRegionId: null as string | null,
  activeDescriptionId: null as string | null,
  focusImageIds: [] as string[],
  codexContext: null,
  canvasTheme: DEFAULT_CANVAS_THEME_ID,
});
