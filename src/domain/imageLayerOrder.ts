import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Move the selected image group to the front of the image layer while
 * leaving every non-image element in its original scene slot.
 *
 * This is runtime scene ordering only. It does not alter business data or
 * persisted placement order.
 */
export const bringImageLayerGroupToFront = (
  elements: readonly ExcalidrawElement[],
  imageId: string,
): readonly ExcalidrawElement[] => {
  const imageSlots: number[] = [];
  const imageElements: ExcalidrawElement[] = [];
  const selected: ExcalidrawElement[] = [];

  elements.forEach((element, index) => {
    if (element.isDeleted || element.type !== "image") return;
    imageSlots.push(index);
    imageElements.push(element);
    if (element.customData?.imageId === imageId) selected.push(element);
  });

  if (selected.length === 0) return elements;
  const remaining = imageElements.filter((element) => !selected.includes(element));
  const orderedImages = [...remaining, ...selected];
  const alreadyAtFront = selected.every(
    (element, index) =>
      imageElements[imageElements.length - selected.length + index] === element,
  );
  if (alreadyAtFront) return elements;
  const next = [...elements];
  imageSlots.forEach((slot, index) => {
    next[slot] = orderedImages[index];
  });
  return next;
};
