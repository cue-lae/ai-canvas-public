import { DescriptionCanvasOverlay } from "./DescriptionCanvasOverlay";
import type { DescriptionCanvasOverlayProps } from "./DescriptionCanvasOverlay";
import type { CanvasSelection } from "./canvasSelection";
import { selectedDescriptionIdsForOverlay } from "./descriptionCanvasSelectionAdapter";

/**
 * Host adapter for V9's controlled CanvasSelection projection. The description
 * component itself remains unaware of selection ownership and history.
 */
export interface DescriptionCanvasOverlayAdapterProps
  extends Omit<DescriptionCanvasOverlayProps, "selectedDescriptionIds"> {
  canvasSelection: CanvasSelection;
}

export const DescriptionCanvasOverlayAdapter = ({
  canvasSelection,
  ...descriptionProps
}: DescriptionCanvasOverlayAdapterProps) => (
  <DescriptionCanvasOverlay
    {...descriptionProps}
    selectedDescriptionIds={selectedDescriptionIdsForOverlay(canvasSelection)}
  />
);
