/** Focus navigation owns the target; selecting a region/description must not disable it. */
export function resolveSelectionToolImageId(
  navigation: { layer: string; imageId?: string },
  selectedImageId: string | null,
  images: Readonly<Record<string, unknown>>,
): string | null {
  if (navigation.layer === "preview") return null;
  const id = navigation.layer === "image" ? navigation.imageId : selectedImageId;
  return id && Object.prototype.hasOwnProperty.call(images, id) ? id : null;
}
