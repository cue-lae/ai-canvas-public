import type {
  BusinessState,
  DescriptionRecord,
  DescriptionReferenceRecord,
  DescriptionScopeLinkRecord,
  DocumentRecord,
  Point,
} from "./types";
import type { DescriptionImageBinding } from "./descriptionImageBinding";
import {
  followDescriptionImageBinding,
  type DescriptionBindingImageFrame,
} from "./descriptionImageBinding";
import {
  FolderMigrationError,
  isBusinessStateV2,
} from "./folderScene";

type LegacyDescriptionState = BusinessState & {
  document: DocumentRecord & Partial<Pick<
    DocumentRecord,
    "descriptionIds" | "descriptionScopeLinkIds" | "descriptionReferenceIds"
  >>;
  descriptions?: Record<string, DescriptionRecord>;
  descriptionScopeLinks?: Record<string, DescriptionScopeLinkRecord>;
  descriptionReferences?: Record<string, DescriptionReferenceRecord>;
};

const orderedExistingIds = (
  preferred: readonly string[] | undefined,
  records: Readonly<Record<string, unknown>>,
): string[] => {
  const recordIds = Object.keys(records);
  return [
    ...new Set([
      ...(preferred ?? []).filter((id) => Object.hasOwn(records, id)),
      ...recordIds,
    ]),
  ];
};

export const normalizeDescriptionBusinessState = (
  input: BusinessState,
): BusinessState => {
  const legacy = input as LegacyDescriptionState;
  const descriptions = { ...(legacy.descriptions ?? {}) };
  const descriptionScopeLinks = Object.fromEntries(
    Object.entries(legacy.descriptionScopeLinks ?? {}).filter(
      ([, link]) =>
        Boolean(descriptions[link.descriptionId]) &&
        Boolean(input.regions[link.regionId]),
    ),
  );
  const descriptionReferences = Object.fromEntries(
    Object.entries(legacy.descriptionReferences ?? {}).filter(([, reference]) =>
      Boolean(descriptions[reference.descriptionId]),
    ),
  );

  if (isBusinessStateV2(input)) {
    Object.values(descriptionScopeLinks).forEach((link) => {
      const description = descriptions[link.descriptionId];
      const region = input.regions[link.regionId];
      if (
        !description ||
        !region ||
        !description.folderId ||
        description.folderId !== region.folderId ||
        link.folderId !== description.folderId
      ) {
        throw new FolderMigrationError(
          `DescriptionScopeLink ${link.id} 必须连接同一 scope`,
        );
      }
    });
    Object.values(descriptionReferences).forEach((reference) => {
      const description = descriptions[reference.descriptionId];
      const image = reference.imageBinding
        ? input.imageAssets[reference.imageBinding.imageId]
        : null;
      if (
        !description ||
        reference.folderId !== description.folderId ||
        (image && image.folderId !== description.folderId)
      ) {
        throw new FolderMigrationError(
          `DescriptionReference ${reference.id} 必须留在 Description scope`,
        );
      }
    });
  }

  return {
    ...input,
    document: {
      ...input.document,
      descriptionIds: orderedExistingIds(
        legacy.document.descriptionIds,
        descriptions,
      ),
      descriptionScopeLinkIds: orderedExistingIds(
        legacy.document.descriptionScopeLinkIds,
        descriptionScopeLinks,
      ),
      descriptionReferenceIds: orderedExistingIds(
        legacy.document.descriptionReferenceIds,
        descriptionReferences,
      ),
    },
    descriptions,
    descriptionScopeLinks,
    descriptionReferences,
  };
};

export const createDescription = (
  input: BusinessState,
  {
    descriptionId,
    referenceId,
    anchor,
    folderId,
    now = new Date().toISOString(),
  }: {
    descriptionId: string;
    referenceId: string;
    anchor: Point;
    folderId?: string;
    now?: string;
  },
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const ownerId = folderId ?? state.rootFolderId;
  if (
    isBusinessStateV2(state) &&
    (!ownerId || !state.folders[ownerId])
  ) {
    throw new FolderMigrationError("说明必须创建在有效 root/Folder scope 内");
  }
  const folders = isBusinessStateV2(state)
    ? {
        ...state.folders,
        [ownerId as string]: {
          ...state.folders[ownerId as string],
          descriptionIds: [
            ...state.folders[ownerId as string].descriptionIds,
            descriptionId,
          ],
          updatedAt: now,
        },
      }
    : state.folders;
  return {
    ...state,
    document: {
      ...state.document,
      descriptionIds: [...state.document.descriptionIds, descriptionId],
      descriptionReferenceIds: [
        ...state.document.descriptionReferenceIds,
        referenceId,
      ],
      updatedAt: now,
    },
    descriptions: {
      ...state.descriptions,
      [descriptionId]: {
        id: descriptionId,
        text: "",
        active: true,
        createdAt: now,
        updatedAt: now,
        ...(ownerId ? { folderId: ownerId } : {}),
      },
    },
    descriptionReferences: {
      ...state.descriptionReferences,
      [referenceId]: {
        id: referenceId,
        descriptionId,
        anchor,
        collapsed: false,
        active: true,
        ...(ownerId ? { folderId: ownerId } : {}),
      },
    },
    ...(folders ? { folders } : {}),
  };
};

export const setDescriptionText = (
  input: BusinessState,
  descriptionId: string,
  text: string,
  now = new Date().toISOString(),
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const description = state.descriptions[descriptionId];
  if (!description) {
    return state;
  }
  return {
    ...state,
    document: { ...state.document, updatedAt: now },
    descriptions: {
      ...state.descriptions,
      [descriptionId]: { ...description, text, updatedAt: now },
    },
  };
};

export const setDescriptionReferenceUrl = (
  input: BusinessState,
  descriptionId: string,
  referenceUrl: string,
  now = new Date().toISOString(),
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const description = state.descriptions[descriptionId];
  if (!description) {
    return state;
  }
  const nextDescription = { ...description, updatedAt: now };
  if (referenceUrl.length > 0) {
    nextDescription.referenceUrl = referenceUrl;
  } else {
    delete nextDescription.referenceUrl;
  }
  return {
    ...state,
    document: { ...state.document, updatedAt: now },
    descriptions: {
      ...state.descriptions,
      [descriptionId]: nextDescription,
    },
  };
};

export const normalizeDescriptionReferenceUrl = (
  value: string | undefined,
): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 2_048) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
};

export const descriptionRegionIds = (
  input: BusinessState,
  descriptionId: string,
): string[] => {
  const state = normalizeDescriptionBusinessState(input);
  return [
    ...new Set(
      state.document.descriptionScopeLinkIds.flatMap((linkId) => {
        const link = state.descriptionScopeLinks[linkId];
        return link?.descriptionId === descriptionId &&
          state.regions[link.regionId]?.active
          ? [link.regionId]
          : [];
      }),
    ),
  ];
};

export const toggleDescriptionScope = (
  input: BusinessState,
  {
    descriptionId,
    regionId,
    linkId,
  }: { descriptionId: string; regionId: string; linkId: string },
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  if (!state.descriptions[descriptionId] || !state.regions[regionId]?.active) {
    return state;
  }
  const description = state.descriptions[descriptionId];
  const region = state.regions[regionId];
  if (
    isBusinessStateV2(state) &&
    (!description.folderId || description.folderId !== region.folderId)
  ) {
    throw new FolderMigrationError(
      "说明与选区不在同一 scope，不能建立关联",
    );
  }
  const existing = Object.values(state.descriptionScopeLinks).find(
    (link) =>
      link.descriptionId === descriptionId && link.regionId === regionId,
  );
  if (existing) {
    const links = { ...state.descriptionScopeLinks };
    delete links[existing.id];
    return {
      ...state,
      document: {
        ...state.document,
        descriptionScopeLinkIds:
          state.document.descriptionScopeLinkIds.filter(
            (candidate) => candidate !== existing.id,
          ),
      },
      descriptionScopeLinks: links,
    };
  }
  return {
    ...state,
    document: {
      ...state.document,
      descriptionScopeLinkIds: [
        ...state.document.descriptionScopeLinkIds,
        linkId,
      ],
    },
    descriptionScopeLinks: {
      ...state.descriptionScopeLinks,
      [linkId]: {
        id: linkId,
        descriptionId,
        regionId,
        ...(description.folderId ? { folderId: description.folderId } : {}),
      },
    },
  };
};

export const setDescriptionReferenceCollapsed = (
  input: BusinessState,
  descriptionId: string,
  collapsed: boolean,
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const reference = Object.values(state.descriptionReferences).find(
    (candidate) =>
      candidate.descriptionId === descriptionId && candidate.active,
  );
  if (!reference) {
    return state;
  }
  return {
    ...state,
    descriptionReferences: {
      ...state.descriptionReferences,
      [reference.id]: { ...reference, collapsed },
    },
  };
};

export const expandOnlyDescriptionReference = (
  input: BusinessState,
  descriptionId: string,
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const references = Object.fromEntries(
    Object.entries(state.descriptionReferences).map(([referenceId, reference]) => [
      referenceId,
      reference.active
        ? { ...reference, collapsed: reference.descriptionId !== descriptionId }
        : reference,
    ]),
  );
  return { ...state, descriptionReferences: references };
};

export const expandDescriptionReference = (
  input: BusinessState,
  descriptionId: string,
): BusinessState =>
  setDescriptionReferenceCollapsed(input, descriptionId, false);

export const moveDescriptionReference = (
  input: BusinessState,
  descriptionId: string,
  anchor: Point,
  imageBinding: DescriptionImageBinding | null = null,
  now = new Date().toISOString(),
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const reference = Object.values(state.descriptionReferences).find(
    (candidate) =>
      candidate.descriptionId === descriptionId && candidate.active,
  );
  if (!reference) {
    return state;
  }
  if (imageBinding && isBusinessStateV2(state)) {
    const description = state.descriptions[descriptionId];
    const image = state.imageAssets[imageBinding.imageId];
    if (!description || !image || description.folderId !== image.folderId) {
      throw new FolderMigrationError(
        "说明与图片不在同一 scope，不能建立关联",
      );
    }
  }
  return {
    ...state,
    document: { ...state.document, updatedAt: now },
    descriptionReferences: {
      ...state.descriptionReferences,
      [reference.id]: {
        ...reference,
        anchor,
        ...(imageBinding ? { imageBinding } : { imageBinding: undefined }),
      },
    },
  };
};

/**
 * Translate descriptions that participate in a mixed native-image selection.
 *
 * Bound descriptions are already advanced by
 * `reconcileDescriptionImageBindings` when their selected image moves. Those
 * references are left untouched here. A selected unbound description (or one
 * bound to an image outside the native selection) is translated explicitly;
 * clearing its old binding prevents the next reconciliation frame from
 * snapping it back to the unrelated image.
 */
export const translateSelectedDescriptionReferences = (
  before: BusinessState,
  after: BusinessState,
  descriptionIds: readonly string[],
  delta: Point,
  now = new Date().toISOString(),
): BusinessState => {
  if (
    descriptionIds.length === 0 ||
    (Math.abs(delta.x) <= 0.01 && Math.abs(delta.y) <= 0.01)
  ) {
    return normalizeDescriptionBusinessState(after);
  }
  const beforeState = normalizeDescriptionBusinessState(before);
  let next = normalizeDescriptionBusinessState(after);
  const selected = new Set(descriptionIds);
  for (const reference of Object.values(next.descriptionReferences)) {
    if (!selected.has(reference.descriptionId) || !reference.active) {
      continue;
    }
    const beforeReference = Object.values(beforeState.descriptionReferences).find(
      (candidate) =>
        candidate.descriptionId === reference.descriptionId && candidate.active,
    );
    if (!beforeReference) {
      continue;
    }
    const automaticDelta = {
      x: reference.anchor.x - beforeReference.anchor.x,
      y: reference.anchor.y - beforeReference.anchor.y,
    };
    if (
      Math.abs(automaticDelta.x - delta.x) <= 0.01 &&
      Math.abs(automaticDelta.y - delta.y) <= 0.01
    ) {
      continue;
    }
    next = moveDescriptionReference(
      next,
      reference.descriptionId,
      {
        x: reference.anchor.x + delta.x,
        y: reference.anchor.y + delta.y,
      },
      null,
      now,
    );
  }
  return next;
};

export const deleteDescription = (
  input: BusinessState,
  descriptionId: string,
  now = new Date().toISOString(),
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  if (!state.descriptions[descriptionId]) {
    return state;
  }
  const descriptions = { ...state.descriptions };
  delete descriptions[descriptionId];
  const referenceIds = state.document.descriptionReferenceIds.filter(
    (referenceId) =>
      state.descriptionReferences[referenceId]?.descriptionId === descriptionId,
  );
  const linkIds = state.document.descriptionScopeLinkIds.filter(
    (linkId) =>
      state.descriptionScopeLinks[linkId]?.descriptionId === descriptionId,
  );
  const descriptionReferences = { ...state.descriptionReferences };
  referenceIds.forEach((referenceId) => delete descriptionReferences[referenceId]);
  const descriptionScopeLinks = { ...state.descriptionScopeLinks };
  linkIds.forEach((linkId) => delete descriptionScopeLinks[linkId]);
  const folders = isBusinessStateV2(state)
    ? Object.fromEntries(
        Object.entries(state.folders).map(([folderId, folder]) => [
          folderId,
          {
            ...folder,
            descriptionIds: folder.descriptionIds.filter(
              (candidate) => candidate !== descriptionId,
            ),
          },
        ]),
      )
    : state.folders;
  return {
    ...state,
    document: {
      ...state.document,
      descriptionIds: state.document.descriptionIds.filter(
        (candidate) => candidate !== descriptionId,
      ),
      descriptionReferenceIds: state.document.descriptionReferenceIds.filter(
        (candidate) => !referenceIds.includes(candidate),
      ),
      descriptionScopeLinkIds: state.document.descriptionScopeLinkIds.filter(
        (candidate) => !linkIds.includes(candidate),
      ),
      updatedAt: now,
    },
    descriptions,
    descriptionReferences,
    descriptionScopeLinks,
    ...(folders ? { folders } : {}),
  };
};

export const removeRegionSelection = (
  input: BusinessState,
  regionId: string,
  now = new Date().toISOString(),
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const region = state.regions[regionId];
  if (!region) {
    return state;
  }
  const linkIds = state.document.descriptionScopeLinkIds.filter(
    (linkId) => state.descriptionScopeLinks[linkId]?.regionId === regionId,
  );
  const descriptionScopeLinks = { ...state.descriptionScopeLinks };
  linkIds.forEach((linkId) => delete descriptionScopeLinks[linkId]);
  return {
    ...state,
    document: {
      ...state.document,
      descriptionScopeLinkIds: state.document.descriptionScopeLinkIds.filter(
        (candidate) => !linkIds.includes(candidate),
      ),
      updatedAt: now,
    },
    regions: {
      ...state.regions,
      [regionId]: { ...region, active: false },
    },
    annotations: Object.fromEntries(
      Object.entries(state.annotations).map(([annotationId, annotation]) => [
        annotationId,
        annotation.regionId === regionId
          ? { ...annotation, active: false }
          : annotation,
      ]),
    ),
    descriptionScopeLinks,
  };
};

/** Applies image deletion as one business mutation: regions become inactive
 * and every shared DescriptionScopeLink referencing them is removed. */
export const removeImageSelections = (
  input: BusinessState,
  imageId: string,
  now = new Date().toISOString(),
): BusinessState =>
  Object.values(normalizeDescriptionBusinessState(input).regions)
    .filter((region) => region.active && region.imageId === imageId)
    .reduce(
      (state, region) => removeRegionSelection(state, region.id, now),
      normalizeDescriptionBusinessState(input),
    );

/** Keeps anchor placement derived from the current live image frames. A frame
 * disappearing unbinds the reference while retaining its last canvas point. */
export const reconcileDescriptionImageBindings = (
  input: BusinessState,
  images: readonly DescriptionBindingImageFrame[],
): BusinessState => {
  const state = normalizeDescriptionBusinessState(input);
  const imageById = new Map(images.map((image) => [image.imageId, image]));
  const references = Object.fromEntries(
    Object.entries(state.descriptionReferences).map(([referenceId, reference]) => {
      if (!reference.imageBinding) {
        return [referenceId, reference];
      }
      const image = imageById.get(reference.imageBinding.imageId);
      if (!image) {
        const { imageBinding: _binding, ...unbound } = reference;
        return [referenceId, unbound];
      }
      const anchor = followDescriptionImageBinding(reference.imageBinding, image);
      return [referenceId, anchor ? { ...reference, anchor } : reference];
    }),
  );
  return { ...state, descriptionReferences: references };
};

export const activeDescriptionEntries = (input: BusinessState) => {
  const state = normalizeDescriptionBusinessState(input);
  return state.document.descriptionIds.flatMap((descriptionId) => {
    const description = state.descriptions[descriptionId];
    const reference = Object.values(state.descriptionReferences).find(
      (candidate) =>
        candidate.descriptionId === descriptionId && candidate.active,
    );
    return description?.active && reference
      ? [
          {
            description,
            reference,
            regionIds: descriptionRegionIds(state, descriptionId),
          },
        ]
      : [];
  });
};
