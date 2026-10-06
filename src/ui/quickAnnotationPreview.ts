import { scenePointToLocal } from "../domain/geometry";
import type { Point } from "../domain/types";

/** Check the complete screen-aligned label, including left-anchored text. */
export const quickAnnotationPreviewLabelFits = (
  image: Parameters<typeof scenePointToLocal>[1],
  labelScene: Point,
  side: "left" | "right",
  width: number,
  height: number,
  zoom: number,
): boolean => {
  const left = labelScene.x - (side === "left" ? width / zoom : 0);
  const right = left + width / zoom;
  const top = labelScene.y;
  const bottom = top + height / zoom;
  return [{ x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom }].every((point) => {
    const local = scenePointToLocal(point, image);
    return local.x >= -0.01 && local.y >= -0.01 &&
      local.x <= image.width + 0.01 && local.y <= image.height + 0.01;
  });
};
