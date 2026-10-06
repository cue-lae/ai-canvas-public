import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";
import {
  createEmptyBusinessState,
  type BusinessState,
} from "./types";
import {
  FOLDER_MIGRATION_FAILED,
  compactFolderSurfaceBounds,
  createVisibleFolder,
  deleteFolderDirectObjects,
  deleteVisibleFolderWithContents,
  deprojectFolderSceneChange,
  folderSceneBounds,
  folderPreviewLayout,
  folderPreviewTranslation,
  migrateBusinessStateToV2,
  migrateCanonicalSceneToV3,
  moveFolderScene,
  moveFolderContents,
  projectFolderScene,
  stabilizeFolderProjectionRuntimeMetadata,
  synchronizeImageBoundSceneElements,
  removeVisibleFolderPreservingContents,
  requiredDirectObjectsForReparent,
  reparentDirectObjects,
  synchronizeEmptyFolderCovers,
  visibleFolderSceneElements,
} from "./folderScene";
import { createDescription, toggleDescriptionScope } from "./descriptions";
import { createQuickAnnotation } from "../ui/quickAnnotations";

const imageElement = (id: string, folderId = "folder-root") =>
  convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id,
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        customData: { kind: "image", imageId: "image1", folderId },
      } as never,
    ],
    { regenerateIds: false },
  )[0];

const nativeImageElement = (id: string, folderId = "folder-root") =>
  convertToExcalidrawElements(
    [
      {
        type: "image",
        id,
        fileId: "file1",
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        customData: {
          kind: "image",
          imageId: "image1",
          placementId: "placement1",
          folderId,
        },
      } as never,
    ],
    { regenerateIds: false },
  )[0];

const imageShadowElement = (id: string, folderId = "folder-root") =>
  convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id,
        x: 12,
        y: 22,
        width: 100,
        height: 80,
        locked: true,
        opacity: 12,
        customData: {
          kind: "image-shadow",
          imageId: "image1",
          placementId: "placement1",
          folderId,
        },
      } as never,
    ],
    { regenerateIds: false },
  )[0];

const regionElement = (id: string, folderId = "folder-root") =>
  convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id,
        x: 34,
        y: 42,
        width: 28,
        height: 24,
        customData: {
          kind: "region",
          regionId: "region1",
          imageId: "image1",
          folderId,
        },
      } as never,
    ],
    { regenerateIds: false },
  )[0];

const legacyBusiness = (): BusinessState => {
  const state = createEmptyBusinessState("legacy") as BusinessState;
  delete state.schemaVersion;
  delete state.rootFolderId;
  delete state.folders;
  delete state.document.folderIds;
  state.imageAssets.image1 = {
    id: "image1",
    fileId: "file1",
    name: "one.png",
    mimeType: "image/png",
    naturalWidth: 100,
    naturalHeight: 80,
    source: "local",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  state.imagePlacements.placement1 = {
    id: "placement1",
    imageId: "image1",
    elementId: "image-element",
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    angle: 0,
    scale: [1, 1],
    crop: null,
    active: true,
  };
  state.document.imageAssetIds = ["image1"];
  state.document.imagePlacementIds = ["placement1"];
  return state;
};

describe("folder semantic foundation", () => {
  it("moves a bound ROI from the previous canonical image frame exactly once", () => {
    const previousImage = nativeImageElement("image-element");
    const previousRegion = regionElement("region-element");
    const incomingImage = {
      ...previousImage,
      x: 65,
      y: 91,
    } as ExcalidrawElement;
    const synchronized = synchronizeImageBoundSceneElements(
      [incomingImage, previousRegion],
      [previousImage, previousRegion],
    );
    const movedRegion = synchronized.find(
      (element) => element.id === "region-element",
    )!;

    expect(movedRegion.x - incomingImage.x).toBe(
      previousRegion.x - previousImage.x,
    );
    expect(movedRegion.y - incomingImage.y).toBe(
      previousRegion.y - previousImage.y,
    );
    expect(
      synchronizeImageBoundSceneElements(synchronized, synchronized).find(
        (element) => element.id === "region-element",
      ),
    ).toEqual(movedRegion);
  });

  it("moves and scales an image shadow with its canonical image", () => {
    const previousImage = nativeImageElement("image-element");
    const previousShadow = imageShadowElement("image-shadow-element");
    const incomingImage = {
      ...previousImage,
      x: 60,
      y: 80,
      width: 150,
      height: 120,
    } as ExcalidrawElement;
    const synchronized = synchronizeImageBoundSceneElements(
      [incomingImage, previousShadow],
      [previousImage, previousShadow],
    );
    const shadow = synchronized.find(
      (element) => element.id === "image-shadow-element",
    )!;
    expect(shadow).toMatchObject({
      x: 63,
      y: 83,
      width: 150,
      height: 120,
      locked: true,
      customData: { kind: "image-shadow", imageId: "image1" },
    });
  });

  it("keeps accumulating native image drag frames when the incoming ROI is stale", () => {
    const originalImage = nativeImageElement("image-element");
    const originalRegion = regionElement("region-element");
    const firstImage = {
      ...originalImage,
      x: originalImage.x + 20,
    } as ExcalidrawElement;
    const first = synchronizeImageBoundSceneElements(
      [firstImage, originalRegion],
      [originalImage, originalRegion],
    );
    const secondImage = {
      ...originalImage,
      x: originalImage.x + 60,
    } as ExcalidrawElement;
    const second = synchronizeImageBoundSceneElements(
      [secondImage, originalRegion],
      first,
    );
    const secondRegion = second.find(
      (element) => element.id === originalRegion.id,
    )!;

    expect(secondRegion.x - secondImage.x).toBe(
      originalRegion.x - originalImage.x,
    );
    expect(secondRegion.y - secondImage.y).toBe(
      originalRegion.y - originalImage.y,
    );
  });

  it("migrates legacy objects into the invisible root scope", () => {
    const migrated = migrateBusinessStateToV2(legacyBusiness());
    expect(migrated.rootFolderId).toBe("folder-root");
    expect(migrated.folders["folder-root"].kind).toBe("root");
    expect(migrated.imageAssets.image1.folderId).toBe("folder-root");
    expect(migrated.imagePlacements.placement1.folderId).toBe("folder-root");
  });

  it("fails closed when legacy ownership cannot be reconstructed", () => {
    const legacy = legacyBusiness();
    legacy.imagePlacements.placement1.imageId = "missing";
    expect(() => migrateBusinessStateToV2(legacy)).toThrowError(
      expect.objectContaining({ code: FOLDER_MIGRATION_FAILED }),
    );
  });

  it("creates a visible canonical cover for an empty folder", () => {
    const created = createVisibleFolder({
      business: createEmptyBusinessState(),
      elements: [],
      folderId: "folder-a",
      name: "Folder A",
      x: 120,
      y: 80,
    });
    expect(created.business.folders["folder-a"].coverElementId).toBe(
      "folder-cover:folder-a",
    );
    expect(created.elements[0]).toMatchObject({
      id: "folder-cover:folder-a",
      x: 120,
      y: 80,
      locked: true,
      customData: { kind: "folder-cover", folderId: "folder-a" },
    });
    expect(
      folderSceneBounds(created.business, created.elements, "folder-a"),
    ).toEqual({ x: 120, y: 80, width: 232, height: 156 });
  });

  it("keeps the same compact canonical-cover surface after Folder gains members", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const occupied = synchronizeEmptyFolderCovers({
      business: filled,
      elements: [
        ...created.elements,
        ...convertToExcalidrawElements(
          [
            {
              type: "rectangle",
              id: "far-member",
              x: 620,
              y: 410,
              width: 240,
              height: 180,
              customData: {
                kind: "ordinary-text-box",
                folderId: "folder-a",
              },
            } as never,
          ],
          { regenerateIds: false },
        ),
      ],
    });

    expect(
      folderSceneBounds(occupied.business, occupied.elements, "folder-a"),
    ).toEqual({ x: 200, y: 100, width: 232, height: 156 });
  });

  it("preserves the Folder owner while stamping an empty cover", () => {
    const created = createVisibleFolder({
      business: createEmptyBusinessState(),
      elements: [],
      folderId: "folder-a",
      name: "Folder A",
      x: 120,
      y: 80,
    });
    const stamped = migrateCanonicalSceneToV3(
      created.elements,
      created.business,
    );
    expect(stamped[0].customData).toMatchObject({
      kind: "folder-cover",
      folderId: "folder-a",
    });
    expect(stamped[0].locked).toBe(true);
  });

  it("keeps the canonical empty cover hidden behind the product surface in every projection", () => {
    const created = createVisibleFolder({
      business: createEmptyBusinessState(),
      elements: [],
      folderId: "folder-a",
      name: "Folder A",
      x: 120,
      y: 80,
    });
    const cover = created.elements[0];
    const overview = projectFolderScene(created.elements, created.business, {
      type: "overview",
    });
    const preview = projectFolderScene(created.elements, created.business, {
      type: "preview",
      folderId: "folder-a",
    });
    const folder = projectFolderScene(created.elements, created.business, {
      type: "folder",
      folderId: "folder-a",
    });
    expect(overview.elements[0]).toMatchObject({
      opacity: 0,
      locked: true,
    });
    expect(preview.elements[0]).toMatchObject({
      opacity: 0,
      locked: true,
    });
    expect(overview.projectedElementIds.has(cover.id)).toBe(true);
    expect(preview.projectedElementIds.has(cover.id)).toBe(true);
    expect(overview.hiddenElementIds.has(cover.id)).toBe(true);
    expect(preview.hiddenElementIds.has(cover.id)).toBe(true);
    expect(folder.elements[0]).toMatchObject({ opacity: 0, locked: true });
    expect(deprojectFolderSceneChange(overview.elements, overview)[0]).toEqual(
      cover,
    );
    expect(deprojectFolderSceneChange(folder.elements, folder)[0]).toEqual(cover);
  });

  it("retains deleted canonical cover geometry when the runtime omits deleted elements", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const occupied = synchronizeEmptyFolderCovers({
      business: filled,
      elements: created.elements,
    });
    const projection = projectFolderScene(
      occupied.elements,
      occupied.business,
      { type: "folder", folderId: "folder-a" },
    );
    const runtimeElements = projection.elements.filter(
      (element) => !element.isDeleted,
    );
    const deprojected = deprojectFolderSceneChange(runtimeElements, projection);

    expect(
      deprojected.find((element) => element.id === "folder-cover:folder-a"),
    ).toMatchObject({ isDeleted: true, x: 200, y: 100, width: 232, height: 156 });
    expect(folderSceneBounds(occupied.business, deprojected, "folder-a")).toEqual({
      x: 200,
      y: 100,
      width: 232,
      height: 156,
    });
  });

  it("adopts Excalidraw runtime metadata for an unchanged transient projection", () => {
    const created = createVisibleFolder({
      business: createEmptyBusinessState(),
      elements: [],
      folderId: "folder-a",
      name: "Folder A",
      x: 120,
      y: 80,
    });
    const projection = projectFolderScene(created.elements, created.business, {
      type: "overview",
    });
    const projectedCover = projection.elements[0];
    const renderedCover = {
      ...projectedCover,
      index: "a0",
      version: projectedCover.version + 1,
      versionNonce: projectedCover.versionNonce + 1,
      updated: projectedCover.updated + 1,
    } as typeof projectedCover;

    const stabilized = stabilizeFolderProjectionRuntimeMetadata(projection, [
      renderedCover,
    ]);

    expect(stabilized.elements[0]).toEqual(renderedCover);
    expect(stabilized.canonical[0]).toEqual(created.elements[0]);
  });

  it("does not hide a canonical geometry change behind transient runtime metadata", () => {
    const created = createVisibleFolder({
      business: createEmptyBusinessState(),
      elements: [],
      folderId: "folder-a",
      name: "Folder A",
      x: 120,
      y: 80,
    });
    const projection = projectFolderScene(created.elements, created.business, {
      type: "overview",
    });
    const movedCanonical = created.elements.map((element) => ({
      ...element,
      x: element.x + 40,
      version: element.version + 1,
    })) as readonly ExcalidrawElement[];
    const movedProjection = projectFolderScene(
      movedCanonical,
      created.business,
      { type: "overview" },
    );
    const stabilized = stabilizeFolderProjectionRuntimeMetadata(
      movedProjection,
      projection.elements,
    );

    expect(stabilized.elements[0].x).toBe(160);
    expect(stabilized.elements[0].version).toBe(movedCanonical[0].version);
  });

  it("removes an empty Folder or ungroups a non-empty Folder without deleting members", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const empty = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-empty",
      name: "Empty",
      x: 120,
      y: 80,
    });
    const removedEmpty = removeVisibleFolderPreservingContents({
      business: empty.business,
      elements: empty.elements,
      folderId: "folder-empty",
      now: "2026-09-02T00:00:00.000Z",
    });
    expect(removedEmpty.business.folders["folder-empty"]).toBeUndefined();
    expect(removedEmpty.business.document.folderIds).not.toContain("folder-empty");
    expect(
      removedEmpty.elements.find(
        (element) => element.id === "folder-cover:folder-empty",
      ),
    ).toMatchObject({ isDeleted: true });
    expect(() =>
      projectFolderScene(removedEmpty.elements, removedEmpty.business, {
        type: "overview",
      }),
    ).not.toThrow();

    const filled = createVisibleFolder({
      business: removedEmpty.business,
      elements: removedEmpty.elements,
      folderId: "folder-filled",
      name: "Filled",
      x: 240,
      y: 120,
    });
    const reparented = reparentDirectObjects({
      business: filled.business,
      targetFolderId: "folder-filled",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const ungrouped = removeVisibleFolderPreservingContents({
      business: reparented,
      elements: filled.elements,
      folderId: "folder-filled",
      now: "2026-09-02T00:00:00.000Z",
    });
    expect(ungrouped.business.folders["folder-filled"]).toBeUndefined();
    expect(ungrouped.business.imageAssets.image1.folderId).toBe(
      ungrouped.business.rootFolderId,
    );
    expect(
      ungrouped.elements.find((element) => element.id === "image-element")
        ?.customData?.folderId,
    ).toBe(ungrouped.business.rootFolderId);
  });

  it("deletes a non-empty Folder closure while keeping scene tombstones replayable", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [
        imageShadowElement("image-shadow-element"),
        imageElement("image-element"),
      ],
      folderId: "folder-filled",
      name: "Filled",
      x: 240,
      y: 120,
    });
    const reparented = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-filled",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const deleted = deleteVisibleFolderWithContents({
      business: reparented,
      elements: created.elements,
      folderId: "folder-filled",
      now: "2026-09-02T00:00:00.000Z",
    });

    expect(deleted.business.folders["folder-filled"]).toBeUndefined();
    expect(deleted.business.imageAssets.image1).toBeUndefined();
    expect(
      deleted.elements.find((element) => element.id === "image-element"),
    ).toMatchObject({ isDeleted: true });
    expect(
      deleted.elements.find(
        (element) => element.id === "image-shadow-element",
      ),
    ).toMatchObject({ isDeleted: true });
    expect(() =>
      projectFolderScene(deleted.elements, deleted.business, {
        type: "overview",
      }),
    ).not.toThrow();
  });

  it("translates the unique preview cluster without changing canonical geometry", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const canonicalImage = created.elements.find(
      (element) => element.id === "image-element",
    )!;
    const preview = projectFolderScene(created.elements, filled, {
      type: "preview",
      folderId: "folder-a",
    });
    const projectedImage = preview.elements.find(
      (element) => element.id === "image-element",
    )!;

    expect(projectedImage).toMatchObject({
      x: 388,
      y: 76,
      width: canonicalImage.width,
      height: canonicalImage.height,
      locked: true,
    });
    expect(preview.projectedElementIds.has(canonicalImage.id)).toBe(true);
    expect(deprojectFolderSceneChange(preview.elements, preview)).toEqual(
      created.elements,
    );

    const nativeCreated = createVisibleFolder({
      business: root,
      elements: [nativeImageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const nativeFilled = reparentDirectObjects({
      business: nativeCreated.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const animatedPreview = projectFolderScene(nativeCreated.elements, nativeFilled, {
      type: "preview",
      folderId: "folder-a",
      previewImageId: "image1",
    });
    expect(animatedPreview.elements.find((element) => element.id === "image-element"))
      .toMatchObject({ opacity: 0, locked: true });
    expect(deprojectFolderSceneChange(animatedPreview.elements, animatedPreview))
      .toEqual(nativeCreated.elements);
  });

  it("fits a preview member inside a supplied viewport by temporary layout", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const canonicalImage = created.elements.find(
      (element) => element.id === "image-element",
    )!;
    const translation = folderPreviewTranslation(
      filled,
      created.elements,
      "folder-a",
      {
        width: 450,
        height: 400,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        offsetLeft: 0,
        offsetTop: 0,
      },
    );
    const projection = projectFolderScene(
      created.elements,
      filled,
      {
        type: "preview",
        folderId: "folder-a",
        viewport: {
          width: 450,
          height: 400,
          zoom: 1,
          scrollX: 0,
          scrollY: 0,
          offsetLeft: 0,
          offsetTop: 0,
        },
      },
    );
    const projectedImage = projection.elements.find(
      (element) => element.id === "image-element",
    )!;
    expect(projectedImage.x).toBeGreaterThanOrEqual(0);
    expect(projectedImage.y).toBeGreaterThanOrEqual(0);
    expect(projectedImage.x + projectedImage.width).toBeLessThanOrEqual(450);
    expect(projectedImage.y + projectedImage.height).toBeLessThanOrEqual(400);
    expect(projectedImage.width).not.toBe(canonicalImage.width);
    expect(projectedImage.height / projectedImage.width).toBeCloseTo(
      canonicalImage.height / canonicalImage.width,
    );
    expect(translation.dx).not.toBe(340);
    expect(created.elements.find((element) => element.id === "image-element"))
      .toMatchObject({ x: 10, y: 20 });
  });

  it("derives a compact Folder surface without changing canonical cover geometry", () => {
    const canonical = { x: 200, y: 100, width: 232, height: 156 };
    expect(compactFolderSurfaceBounds(canonical)).toEqual({
      x: 200,
      y: 100,
      width: 148,
      height: 200,
    });
    expect(canonical).toEqual({ x: 200, y: 100, width: 232, height: 156 });
  });

  it("uses a bounded inverse-responsive preview stage without changing scene truth", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const large = folderPreviewLayout(filled, created.elements, "folder-a", {
      width: 1400,
      height: 900,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
    });
    const small = folderPreviewLayout(filled, created.elements, "folder-a", {
      width: 700,
      height: 600,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
    });
    expect(large.stage).not.toBeNull();
    expect(small.stage).not.toBeNull();
    expect(large.previewCoverBounds).toBeDefined();
    expect(small.previewCoverBounds).toBeDefined();
    expect(large.stage!.x).toBeGreaterThanOrEqual(
      large.previewCoverBounds!.x + large.previewCoverBounds!.width + 8,
    );
    expect(small.stage!.x).toBeGreaterThanOrEqual(
      small.previewCoverBounds!.x + small.previewCoverBounds!.width + 8,
    );
    expect(large.stage!.width / 1400).toBeLessThan(
      small.stage!.width / 700,
    );
    expect(created.elements.find((element) => element.id === "image-element"))
      .toMatchObject({ x: 10, y: 20, width: 100, height: 80 });
  });

  it("reflows preview descriptions away from the compact Folder cover", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const withDescription = createDescription(filled, {
      descriptionId: "description1",
      referenceId: "reference1",
      anchor: { x: 10, y: 20 },
      folderId: "folder-a",
    });
    const withDescriptionV2 = migrateBusinessStateToV2(withDescription);
    const layout = folderPreviewLayout(
      withDescriptionV2,
      created.elements,
      "folder-a",
      {
        width: 730,
        height: 771,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        offsetLeft: 0,
        offsetTop: 0,
      },
    );
    const placement = layout.descriptionPlacements?.description1;
    expect(placement).toBeDefined();
    expect(placement!.x).toBeGreaterThanOrEqual(layout.stage!.x + 8);
    expect(placement!.x + placement!.width).toBeLessThanOrEqual(
      layout.stage!.x + layout.stage!.width - 8,
    );
    expect(placement!.width).toBeGreaterThan(48);
    expect(placement!.scale).toBeGreaterThan(0);
    // The accepted preview contract uses the isolated reference note width
    // relative to the displayed cover, rather than the old compact-cover cap.
    expect(placement!.width).toBeGreaterThan(120);
    expect(placement!.width).toBeLessThan(layout.stage!.width);
    expect(placement!.height).toBeLessThan(196);
    expect(created.elements.find((element) => element.id === "image-element"))
      .toMatchObject({ x: 10, y: 20 });
    const imagePlacement = layout.memberPlacements?.["image-element"];
    expect(imagePlacement).toBeDefined();
    expect(imagePlacement!.x).toBeGreaterThanOrEqual(layout.stage!.x);
    expect(imagePlacement!.x + imagePlacement!.width).toBeLessThanOrEqual(
      layout.stage!.x + layout.stage!.width,
    );
  });

  it("caps long preview notes without changing short notes or zoom scaling", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const shortNote = migrateBusinessStateToV2(createDescription(filled, {
      descriptionId: "description1",
      referenceId: "reference1",
      anchor: { x: 10, y: 20 },
      folderId: "folder-a",
    }));
    const longNote = {
      ...shortNote,
      descriptions: {
        ...shortNote.descriptions,
        description1: {
          ...shortNote.descriptions.description1!,
          text: "预览长文。".repeat(80),
        },
      },
    };
    const heightAt = (business: Parameters<typeof folderPreviewLayout>[0], zoom: number) =>
      folderPreviewLayout(business, created.elements, "folder-a", {
        width: 730,
        height: 771,
        zoom,
        scrollX: 0,
        scrollY: 0,
        offsetLeft: 0,
        offsetTop: 0,
      }).descriptionPlacements?.description1.height;

    const screenshotDisplayScale = 1.5;
    expect(heightAt(shortNote, 1)).toBeLessThan(230 / screenshotDisplayScale);
    expect(heightAt(longNote, 1)! * screenshotDisplayScale).toBeCloseTo(230);
    expect(heightAt(longNote, 0.7)! * 0.7 * screenshotDisplayScale).toBeCloseTo(161);
    expect(heightAt(longNote, 0.3)! * 0.3 * screenshotDisplayScale).toBeCloseTo(69);
  });

  it("creates ordered preview slots for missing and extra descriptions", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const withDescription1 = createDescription(filled, {
      descriptionId: "description1",
      referenceId: "reference1",
      anchor: { x: 10, y: 20 },
      folderId: "folder-a",
    });
    const withDescription2 = createDescription(withDescription1, {
      descriptionId: "description2",
      referenceId: "reference2",
      anchor: { x: 30, y: 40 },
      folderId: "folder-a",
    });
    const withDescription3 = createDescription(withDescription2, {
      descriptionId: "description3",
      referenceId: "reference3",
      anchor: { x: 50, y: 60 },
      folderId: "folder-a",
    });
    const layout = folderPreviewLayout(
      migrateBusinessStateToV2(withDescription3),
      created.elements,
      "folder-a",
      {
        width: 900,
        height: 700,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        offsetLeft: 0,
        offsetTop: 0,
      },
    );
    expect(layout.slots).toHaveLength(3);
    expect(layout.slots?.map((slot) => slot.descriptionId)).toEqual([
      "description1",
      "description2",
      "description3",
    ]);
    expect(layout.slots?.[0].element?.id).toBe("image-element");
    expect(layout.slots?.[1].element).toBeUndefined();
    expect(layout.slots?.[2].element).toBeUndefined();
    const descriptions = layout.slots
      ?.flatMap((slot) => (slot.descriptionRect ? [slot.descriptionRect] : [])) ?? [];
    expect(descriptions.every((rect, index) =>
      descriptions.every((other, otherIndex) =>
        index === otherIndex ||
        rect.x + rect.width <= other.x ||
        other.x + other.width <= rect.x ||
        rect.y + rect.height <= other.y ||
        other.y + other.height <= rect.y,
      ),
    )).toBe(true);
  });

  it("keeps multiple image targets disjoint inside the preview stage", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const second = {
      ...imageElement("image-element-2"),
      customData: { kind: "image", imageId: "image2", folderId: "folder-root" },
    } as ExcalidrawElement;
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const withSecond = migrateBusinessStateToV2(created.business);
    withSecond.imageAssets.image2 = { ...withSecond.imageAssets.image1, id: "image2", fileId: "file2" };
    withSecond.imagePlacements.placement2 = {
      ...withSecond.imagePlacements.placement1,
      id: "placement2",
      imageId: "image2",
      elementId: "image-element-2",
      x: 180,
    };
    withSecond.document.imageAssetIds.push("image2");
    withSecond.document.imagePlacementIds.push("placement2");
    const filled = reparentDirectObjects({
      business: withSecond,
      targetFolderId: "folder-a",
      imageIds: ["image1", "image2"],
      descriptionIds: [],
    });
    const layout = folderPreviewLayout(filled, [...created.elements, second], "folder-a", {
      width: 900,
      height: 700,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
    });
    const placements = [
      layout.memberPlacements?.["image-element"],
      layout.memberPlacements?.["image-element-2"],
    ];
    expect(placements.every(Boolean)).toBe(true);
    const [first, secondPlacement] = placements as [NonNullable<typeof placements[0]>, NonNullable<typeof placements[1]>];
    expect(first.x + first.width).toBeLessThanOrEqual(secondPlacement.x);
    expect(first.y).not.toBe(secondPlacement.y);
    expect(first.width).toBe(secondPlacement.width);
    // Both fixtures are 100×80 images, so natural-aspect fitting should keep
    // their ratios equal; the fan-out is expressed by position and tangent angle.
    expect(first.height / first.width).toBeCloseTo(
      secondPlacement.height / secondPlacement.width,
      6,
    );
    expect(first.angle).not.toBe(secondPlacement.angle);
  });

  it("derives a left anchor and directional member targets without changing canonical geometry", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const layout = folderPreviewLayout(filled, created.elements, "folder-a", {
      width: 900,
      height: 700,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
    });
    const placement = layout.memberPlacements?.["image-element"];
    expect(layout.previewCoverBounds).toBeDefined();
    expect(placement).toBeDefined();
    expect(placement!.x).toBeGreaterThan(layout.previewCoverBounds!.x);
    expect(placement!.x).toBeLessThan(
      layout.stage!.x + layout.stage!.width * 0.4,
    );
    expect(placement!.scale).toBe(layout.scale);
    expect(created.elements.find((element) => element.id === "image-element"))
      .toMatchObject({ x: 10, y: 20, width: 100, height: 80 });
  });

  it("puts the Preview cluster last without writing the temporary order back", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const rootContext = {
      ...regionElement("root-context"),
      customData: { kind: "ordinary", folderId: filled.rootFolderId },
    } as ExcalidrawElement;
    const canonical = [
      created.elements.find((element) => element.id === "image-element")!,
      rootContext,
      created.elements.find((element) => element.id !== "image-element")!,
    ];
    const preview = projectFolderScene(canonical, filled, {
      type: "preview",
      folderId: "folder-a",
    });

    expect(
      preview.elements.filter(
        (element) => !preview.hiddenElementIds.has(element.id),
      ).at(-1)?.id,
    ).toBe("image-element");
    expect(deprojectFolderSceneChange(preview.elements, preview).map(({ id }) => id))
      .toEqual(canonical.map(({ id }) => id));
  });

  it("keeps an image-bound ROI on the same canonical offset across preview and Folder", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    root.document.regionIds = ["region1"];
    root.regions.region1 = {
      id: "region1",
      imageId: "image1",
      elementId: "region-element",
      geometry: null,
      active: true,
      status: "valid",
      folderId: root.rootFolderId,
    };
    const created = createVisibleFolder({
      business: root,
      elements: [
        imageElement("image-element"),
        regionElement("region-element"),
      ],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const canonicalImage = created.elements.find(
      (element) => element.id === "image-element",
    )!;
    const canonicalRegion = created.elements.find(
      (element) => element.id === "region-element",
    )!;
    const previewElements = visibleFolderSceneElements(
      created.elements,
      filled,
      { type: "preview", folderId: "folder-a" },
    );
    const previewImage = previewElements.find(
      (element) => element.id === "image-element",
    )!;
    const previewRegion = previewElements.find(
      (element) => element.id === "region-element",
    )!;

    expect(previewRegion.x - previewImage.x).toBe(
      canonicalRegion.x - canonicalImage.x,
    );
    expect(previewRegion.y - previewImage.y).toBe(
      canonicalRegion.y - canonicalImage.y,
    );

    const folderElements = visibleFolderSceneElements(
      created.elements,
      filled,
      { type: "folder", folderId: "folder-a" },
    );
    expect(folderElements.find((element) => element.id === "image-element")).toEqual(
      canonicalImage,
    );
    expect(folderElements.find((element) => element.id === "region-element")).toEqual(
      canonicalRegion,
    );
  });

  it("drops every runtime edit and creation from the read-only Preview projection", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    root.document.regionIds = ["region1"];
    root.regions.region1 = {
      id: "region1",
      imageId: "image1",
      elementId: "region-element",
      geometry: null,
      active: true,
      status: "valid",
      folderId: root.rootFolderId,
    };
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element"), regionElement("region-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const projection = projectFolderScene(created.elements, filled, {
      type: "preview",
      folderId: "folder-a",
    });
    const incoming = [
      ...projection.elements.map((element) =>
        element.id === "region-element"
          ? ({ ...element, x: element.x + 80 } as ExcalidrawElement)
          : element,
      ),
      {
        ...regionElement("preview-created", "folder-a"),
        customData: {
          ...regionElement("preview-created", "folder-a").customData,
          regionId: "preview-created-region",
        },
      } as ExcalidrawElement,
    ];

    expect(deprojectFolderSceneChange(incoming, projection)).toEqual(
      created.elements,
    );
  });

  it("commits focused-image ROI edits while stripping temporary projection state", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const canonical = [
      imageElement("image-element"),
      regionElement("region-element"),
    ];
    const projection = projectFolderScene(canonical, root, {
      type: "image",
      folderId: root.rootFolderId,
      imageId: "image1",
    });
    const incoming = [
      ...projection.elements.map((element) =>
        element.id === "region-element"
          ? ({ ...element, x: 74, y: 66 } as ExcalidrawElement)
          : element,
      ),
      {
        ...regionElement("focus-created"),
        customData: {
          ...regionElement("focus-created").customData,
          regionId: "focus-created-region",
        },
      } as ExcalidrawElement,
    ];
    const deprojected = deprojectFolderSceneChange(incoming, projection);

    expect(
      deprojected.find((element) => element.id === "region-element"),
    ).toMatchObject({ x: 74, y: 66, opacity: 100, locked: false });
    expect(
      deprojected.find((element) => element.id === "focus-created"),
    ).toBeDefined();
  });

  it("keeps only the direct Root context in a focused Root image projection", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element"), regionElement("region-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const [rootContext, folderMember] = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: "root-context",
          x: 700,
          y: 20,
          width: 90,
          height: 70,
          customData: { kind: "ordinary", folderId: created.business.rootFolderId },
        } as never,
        {
          type: "rectangle",
          id: "folder-member",
          x: 240,
          y: 140,
          width: 90,
          height: 70,
          customData: { kind: "ordinary", folderId: "folder-a" },
        } as never,
      ],
      { regenerateIds: false },
    );
    const otherImage = {
      ...imageElement("other-image"),
      customData: {
        ...imageElement("other-image").customData,
        imageId: "image-other",
        folderId: created.business.rootFolderId,
      },
    } as ExcalidrawElement;
    const otherRegion = {
      ...regionElement("other-region"),
      customData: {
        ...regionElement("other-region").customData,
        imageId: "image-other",
        regionId: "region-other",
        folderId: created.business.rootFolderId,
      },
    } as ExcalidrawElement;
    const businessWithOtherImage = {
      ...created.business,
      imageAssets: {
        ...created.business.imageAssets,
        "image-other": {
          ...created.business.imageAssets.image1,
          id: "image-other",
        },
      },
      regions: {
        ...created.business.regions,
        "region-other": {
          ...created.business.regions.region1,
          id: "region-other",
          imageId: "image-other",
          elementId: "other-region",
        },
      },
    };
    const projection = projectFolderScene(
      [...created.elements, otherImage, otherRegion, rootContext, folderMember],
      businessWithOtherImage,
      {
        type: "image",
        folderId: created.business.rootFolderId,
        imageId: "image1",
      },
    );

    expect(
      projection.elements.find((element) => element.id === "root-context"),
    ).toMatchObject({ opacity: 100, locked: true });
    expect(
      projection.elements.find((element) => element.id === "folder-member"),
    ).toMatchObject({ opacity: 0, locked: true });
    expect(projection.hiddenElementIds.has("folder-member")).toBe(true);
    expect(
      projection.elements.find((element) => element.id === "other-image"),
    ).toMatchObject({ opacity: 100, locked: true });
    expect(projection.hiddenElementIds.has("other-image")).toBe(false);
    expect(
      projection.elements.find((element) => element.id === "other-region"),
    ).toMatchObject({ opacity: 0, locked: true });
    expect(projection.hiddenElementIds.has("other-region")).toBe(true);
    expect(projection.elements.slice(-2).map((element) => element.id)).toEqual([
      "image-element",
      "region-element",
    ]);
  });

  it("keeps only sibling content in a focused Folder image projection", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element"), regionElement("region-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const business = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const [rootContext, folderContext] = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: "root-context",
          x: 700,
          y: 20,
          width: 90,
          height: 70,
          customData: { kind: "ordinary", folderId: business.rootFolderId },
        } as never,
        {
          type: "rectangle",
          id: "folder-context",
          x: 240,
          y: 140,
          width: 90,
          height: 70,
          customData: { kind: "ordinary", folderId: "folder-a" },
        } as never,
      ],
      { regenerateIds: false },
    );
    const projection = projectFolderScene(
      [...created.elements, rootContext, folderContext],
      business,
      { type: "image", folderId: "folder-a", imageId: "image1" },
    );

    expect(
      projection.elements.find((element) => element.id === "root-context"),
    ).toMatchObject({ opacity: 0, locked: true });
    expect(
      projection.elements.find((element) => element.id === "folder-context"),
    ).toMatchObject({ opacity: 100, locked: true });
    expect(projection.hiddenElementIds.has("root-context")).toBe(true);
  });

  it("atomically reparents an image closure and rejects a split relation", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const moved = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    expect(moved.folders["folder-root"].imageAssetIds).toEqual([]);
    expect(moved.folders["folder-a"].imageAssetIds).toEqual(["image1"]);
    expect(moved.imagePlacements.placement1.folderId).toBe("folder-a");
  });

  it("fails closed unless a bound image and description move together", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    root.document.regionIds = ["region1"];
    root.regions.region1 = {
      id: "region1",
      imageId: "image1",
      elementId: "region-element",
      geometry: null,
      active: true,
      status: "valid",
      folderId: root.rootFolderId,
    };
    const described = toggleDescriptionScope(
      createDescription(root, {
        descriptionId: "description1",
        referenceId: "reference1",
        anchor: { x: 80, y: 90 },
      }),
      {
        descriptionId: "description1",
        regionId: "region1",
        linkId: "link1",
      },
    );
    const created = createVisibleFolder({
      business: migrateBusinessStateToV2(described),
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    expect(
      requiredDirectObjectsForReparent({
        business: created.business,
        imageIds: ["image1"],
        descriptionIds: [],
      }),
    ).toEqual({ imageIds: [], descriptionIds: ["description1"] });
    expect(
      requiredDirectObjectsForReparent({
        business: created.business,
        imageIds: [],
        descriptionIds: ["description1"],
      }),
    ).toEqual({ imageIds: ["image1"], descriptionIds: [] });
    expect(() =>
      reparentDirectObjects({
        business: created.business,
        targetFolderId: "folder-a",
        imageIds: ["image1"],
        descriptionIds: [],
      }),
    ).toThrowError(expect.objectContaining({ code: FOLDER_MIGRATION_FAILED }));
    const moved = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: ["description1"],
    });
    expect(moved.descriptionScopeLinks.link1.folderId).toBe("folder-a");
  });

  it("projects off-scope elements without altering canonical geometry", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const movedBusiness = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const canonical = created.elements.map((element) =>
      element.id === "image-element"
        ? ({
            ...element,
            customData: { ...element.customData, folderId: "folder-a" },
          } as typeof element)
        : element,
    );
    const projection = projectFolderScene(canonical, movedBusiness, {
      type: "overview",
    });
    expect(
      projection.elements.find((element) => element.id === "image-element"),
    ).toMatchObject({ opacity: 0, locked: true });
    const echoed = projection.elements.map((element) =>
      element.id === "image-element" ? ({ ...element, x: 999 } as typeof element) : element,
    );
    expect(
      deprojectFolderSceneChange(echoed, projection).find(
        (element) => element.id === "image-element",
      )?.x,
    ).toBe(10);
  });

  it("keeps root context dimmed and selected Folder content unique in preview", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const createdA = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const movedBusiness = reparentDirectObjects({
      business: createdA.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const filledA = synchronizeEmptyFolderCovers({
      business: movedBusiness,
      elements: createdA.elements.map((element) =>
        element.id === "image-element"
          ? ({
              ...element,
              customData: { ...element.customData, folderId: "folder-a" },
            } as typeof element)
          : element,
      ),
    });
    const createdB = createVisibleFolder({
      business: filledA.business,
      elements: filledA.elements,
      folderId: "folder-b",
      name: "Folder B",
      x: 500,
      y: 100,
    });
    const rootElement = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          id: "root-element",
          x: 800,
          y: 20,
          width: 100,
          height: 80,
          customData: { kind: "ordinary", folderId: createdB.business.rootFolderId },
        } as never,
      ],
      { regenerateIds: false },
    )[0];
    const projection = projectFolderScene(
      [...createdB.elements, rootElement],
      createdB.business,
      { type: "preview", folderId: "folder-a" },
    );

    expect(
      projection.elements.find((element) => element.id === "image-element"),
    ).toMatchObject({ opacity: 100 });
    expect(
      projection.elements.find((element) => element.id === "root-element"),
    ).toMatchObject({ opacity: 40, locked: true });
    expect(
      projection.elements.find(
        (element) => element.id === "folder-cover:folder-b",
      ),
    ).toMatchObject({ opacity: 0, locked: true });
    expect(
      deprojectFolderSceneChange(projection.elements, projection).find(
        (element) => element.id === "root-element",
      ),
    ).toEqual(rootElement);
  });

  it("moves a folder in one canonical scene transform", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const movedBusiness = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const moved = moveFolderScene({
      business: movedBusiness,
      elements: created.elements,
      folderId: "folder-a",
      dx: 30,
      dy: -10,
    });
    expect(moved.find((element) => element.id === "image-element")).toMatchObject({
      x: 40,
      y: 10,
    });
  });

  it("moves an empty Folder cover through the same canonical operation", () => {
    const created = createVisibleFolder({
      business: createEmptyBusinessState(),
      elements: [],
      folderId: "folder-empty",
      name: "Empty",
      x: 50,
      y: 70,
    });
    const moved = moveFolderContents({
      business: created.business,
      elements: created.elements,
      folderId: "folder-empty",
      dx: 25,
      dy: 15,
    });
    expect(moved.elements[0]).toMatchObject({ x: 75, y: 85 });
    expect(moved.business.folders["folder-empty"].coverElementId).toBe(
      "folder-cover:folder-empty",
    );
  });

  it("restores the canonical cover after deleting a Folder's last member", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const occupied = synchronizeEmptyFolderCovers({
      business: filled,
      elements: created.elements,
    });
    expect(
      occupied.elements.find(
        (element) => element.id === "folder-cover:folder-a",
      ),
    ).toMatchObject({
      id: "folder-cover:folder-a",
      x: 200,
      y: 100,
      width: 232,
      height: 156,
      isDeleted: true,
    });
    const deleted = deleteFolderDirectObjects({
      business: occupied.business,
      imageIds: ["image1"],
      descriptionIds: [],
      now: "2026-09-01T01:00:00.000Z",
    });
    const synchronized = synchronizeEmptyFolderCovers({
      business: deleted,
      elements: occupied.elements.map((element) =>
        element.id === "image-element"
          ? ({ ...element, isDeleted: true } as typeof element)
          : element,
      ),
    });
    expect(synchronized.business.folders["folder-a"]).toMatchObject({
      imageAssetIds: [],
      coverElementId: "folder-cover:folder-a",
    });
    expect(
      synchronized.elements.find(
        (element) => element.id === "folder-cover:folder-a",
      ),
    ).toMatchObject({
      isDeleted: false,
      x: 200,
      y: 100,
      width: 232,
      height: 156,
      customData: { kind: "folder-cover", folderId: "folder-a" },
    });
  });

  it("restores the canonical cover after moving the last member back to root", () => {
    const root = migrateBusinessStateToV2(legacyBusiness());
    const created = createVisibleFolder({
      business: root,
      elements: [imageElement("image-element")],
      folderId: "folder-a",
      name: "Folder A",
      x: 200,
      y: 100,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const occupied = synchronizeEmptyFolderCovers({
      business: filled,
      elements: created.elements,
    });
    const emptied = reparentDirectObjects({
      business: occupied.business,
      targetFolderId: occupied.business.rootFolderId,
      imageIds: ["image1"],
      descriptionIds: [],
    });
    const synchronized = synchronizeEmptyFolderCovers({
      business: emptied,
      elements: occupied.elements,
    });
    expect(synchronized.business.folders["folder-a"].coverElementId).toBe(
      "folder-cover:folder-a",
    );
    expect(
      synchronized.elements.some(
        (element) => element.id === "folder-cover:folder-a" && !element.isDeleted,
      ),
    ).toBe(true);
    expect(
      synchronized.elements.find(
        (element) => element.id === "folder-cover:folder-a",
      ),
    ).toMatchObject({ x: 200, y: 100, width: 232, height: 156 });
  });
});

describe("quick annotation folder integrity", () => {
  it("normalizes old v2 projects to an empty quick-annotation collection", () => {
    const oldV2 = createEmptyBusinessState("old-v2") as BusinessState;
    delete oldV2.quickAnnotations;
    delete oldV2.document.quickAnnotationIds;
    delete oldV2.document.nextQuickAnnotationOrdinal;

    const migrated = migrateBusinessStateToV2(oldV2);
    expect(migrated.quickAnnotations).toEqual({});
    expect(migrated.document.quickAnnotationIds).toEqual([]);
    expect(migrated.document.nextQuickAnnotationOrdinal).toBe(1);
  });

  it("accepts old top-left and new reverse-drag anchors under one rule", () => {
    let business = migrateBusinessStateToV2(legacyBusiness());
    business = createQuickAnnotation(business, {
      id: "quick-old",
      imageId: "image1",
      mode: "rectangle",
      anchor: { x: 0.25, y: 0.25 },
      rectangle: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
      text: "旧左上角",
    });
    business = createQuickAnnotation(business, {
      id: "quick-reverse",
      imageId: "image1",
      mode: "rectangle",
      anchor: { x: 0.5, y: 0.5 },
      rectangle: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
      text: "反向按下角",
    });

    const restored = migrateBusinessStateToV2(business);
    expect(restored.quickAnnotations["quick-old"].anchor).toEqual({
      x: 0.25,
      y: 0.25,
    });
    expect(restored.quickAnnotations["quick-reverse"].anchor).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("rejects broken quick-annotation indexes and duplicate ordinals", () => {
    const brokenIndex = createEmptyBusinessState("broken-index");
    brokenIndex.quickAnnotations["quick-a"] = {
      id: "quick-a",
      imageId: "missing-image",
      mode: "point",
      anchor: { x: 0.2, y: 0.3 },
      text: "文本",
      ordinal: 1,
      collapsed: false,
      active: true,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    expect(() => migrateBusinessStateToV2(brokenIndex)).toThrow(
      "QuickAnnotation",
    );
  });

  it("deletes quick annotations with their owning image without reusing ordinals", () => {
    let business = migrateBusinessStateToV2(legacyBusiness());
    business = createQuickAnnotation(business, {
      id: "quick-a",
      imageId: "image1",
      mode: "point",
      anchor: { x: 0.25, y: 0.5 },
      text: "参考窗户",
    });
    const deleted = deleteFolderDirectObjects({
      business,
      imageIds: ["image1"],
      descriptionIds: [],
    });
    expect(deleted.quickAnnotations).toEqual({});
    expect(deleted.document.quickAnnotationIds).toEqual([]);
    expect(deleted.document.nextQuickAnnotationOrdinal).toBe(2);
  });
});
