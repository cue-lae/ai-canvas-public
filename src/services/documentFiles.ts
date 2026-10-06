import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { BusinessState } from "../domain/types";

/** Project only reachable resources from the renderer's append-only file cache.
 * Never mutate that cache: redo may still need its bytes. Business-owned assets
 * and canonical scene references both count, including retained deleted items. */
export const documentFiles = (
  elements: readonly { id?: string; fileId?: string | null }[],
  business: Pick<BusinessState, "imageAssets">,
  cache: BinaryFiles,
): BinaryFiles => {
  const referenced = new Set<string>();
  for (const asset of Object.values(business.imageAssets)) referenced.add(asset.fileId);
  for (const element of elements) if (typeof element.fileId === "string") referenced.add(element.fileId);
  return Object.fromEntries(Object.entries(cache).filter(([id]) => referenced.has(id)));
};
