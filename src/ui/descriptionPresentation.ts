import { activeDescriptionEntries } from "../domain/descriptions";
import type { BusinessState } from "../domain/types";

export interface DescriptionCanvasItem {
  id: string;
  number: number;
  text: string;
  referenceUrl?: string;
  anchor: Readonly<{ x: number; y: number }>;
  collapsed: boolean;
  regionIds: readonly string[];
}

export interface DescriptionCanvasScope {
  regionId: string;
  number: number;
  imageId: string;
  imageNumber: number;
  thumbnailUrl?: string;
}

export interface DescriptionCanvasScopeGroup {
  imageId: string;
  imageNumber: number;
  thumbnailUrl?: string;
  scopes: readonly DescriptionCanvasScope[];
}

export interface DescriptionRegionBindingLabel {
  id: string;
  number: number;
}

/** Host-only selection geometry is adapted into this small description DTO. */
export interface DescriptionScopeCandidate extends DescriptionCanvasScope {}

export interface DescriptionCanvasPresentation {
  items: readonly DescriptionCanvasItem[];
  scopes: readonly DescriptionCanvasScope[];
  scopeGroups: readonly DescriptionCanvasScopeGroup[];
  regionBindings: ReadonlyMap<string, readonly DescriptionRegionBindingLabel[]>;
  boundRegionIds: ReadonlySet<string>;
  filledDescriptionCount: number;
  canvasLevelDescriptionCount: number;
  descriptionScopeLinkCount: number;
}

/**
 * Pure description presentation data. It intentionally receives geometry as a
 * DTO so it remains independent from host coordination concerns.
 */
export const createDescriptionCanvasPresentation = (
  business: BusinessState,
  scopeCandidates: readonly DescriptionScopeCandidate[],
): DescriptionCanvasPresentation => {
  const entries = activeDescriptionEntries(business);
  const items = entries.map(
    ({ description, reference, regionIds }, index) => ({
      id: description.id,
      number: index + 1,
      text: description.text,
      referenceUrl: description.referenceUrl,
      anchor: reference.anchor,
      collapsed: reference.collapsed,
      regionIds,
    }),
  );
  const descriptionScopeLinkCount = items.reduce(
    (count, item) => count + item.regionIds.length,
    0,
  );

  const scopeGroups = new Map<string, DescriptionCanvasScopeGroup>();
  scopeCandidates.forEach((scope) => {
    const existing = scopeGroups.get(scope.imageId);
    if (existing) {
      scopeGroups.set(scope.imageId, { ...existing, scopes: [...existing.scopes, scope] });
      return;
    }
    scopeGroups.set(scope.imageId, {
      imageId: scope.imageId,
      imageNumber: scope.imageNumber,
      thumbnailUrl: scope.thumbnailUrl,
      scopes: [scope],
    });
  });
  const numberByDescriptionId = new Map(items.map((item) => [item.id, item.number]));
  const regionBindings = new Map<string, DescriptionRegionBindingLabel[]>();
  Object.values(business.descriptionScopeLinks).forEach((link) => {
    const number = numberByDescriptionId.get(link.descriptionId);
    if (!number) return;
    regionBindings.set(link.regionId, [
      ...(regionBindings.get(link.regionId) ?? []),
      { id: link.descriptionId, number },
    ]);
  });

  return {
    items,
    scopes: scopeCandidates,
    scopeGroups: [...scopeGroups.values()].sort((left, right) => left.imageNumber - right.imageNumber),
    regionBindings,
    boundRegionIds: new Set(
      Object.values(business.descriptionScopeLinks).map((link) => link.regionId),
    ),
    filledDescriptionCount: items.filter((item) => Boolean(item.text.trim()))
      .length,
    canvasLevelDescriptionCount: items.filter((item) => item.regionIds.length === 0)
      .length,
    descriptionScopeLinkCount,
  };
};
