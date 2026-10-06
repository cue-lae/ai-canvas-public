import { describe, expect, it } from "vitest";
import {
  createDescription,
  moveDescriptionReference,
  setDescriptionReferenceUrl,
  setDescriptionText,
  toggleDescriptionScope,
} from "./descriptions";
import {
  parseAiCanvasProjectFile,
  serializeAiCanvasProjectFile,
} from "./projectFile";
import {
  createVisibleFolder,
  deleteFolderDirectObjects,
  migrateBusinessStateToV2,
  reparentDirectObjects,
  synchronizeEmptyFolderCovers,
} from "./folderScene";
import {
  createEmptyBusinessState,
  ROOT_FOLDER_ID,
  type BusinessState,
  type P0Bundle,
} from "./types";
import { createQuickAnnotation, setQuickAnnotationLabelAnchor } from "../ui/quickAnnotations";

const projectBundle = (): P0Bundle => {
  let business: BusinessState = createEmptyBusinessState("project-file-test");
  business.document.imageAssetIds = ["image-a"];
  business.document.regionIds = ["region-a"];
  business.folders![ROOT_FOLDER_ID].imageAssetIds = ["image-a"];
  business.imageAssets["image-a"] = {
    id: "image-a",
    fileId: "file-a",
    name: "参考.png",
    mimeType: "image/png",
    naturalWidth: 100,
    naturalHeight: 100,
    source: "local",
    createdAt: "2026-08-10T00:00:00.000Z",
    folderId: ROOT_FOLDER_ID,
  };
  business.regions["region-a"] = {
    id: "region-a",
    imageId: "image-a",
    elementId: "region-element-a",
    geometry: null,
    active: true,
    status: "valid",
    folderId: ROOT_FOLDER_ID,
  };
  business = createDescription(business, {
    descriptionId: "description-a",
    referenceId: "reference-a",
    anchor: { x: 180, y: 90 },
    now: "2026-08-10T00:00:00.000Z",
  });
  business = setDescriptionText(
    business,
    "description-a",
    "保留木纹，并核对参考网页",
    "2026-08-10T00:01:00.000Z",
  );
  business = setDescriptionReferenceUrl(
    business,
    "description-a",
    "https://example.com/reference",
  );
  business = toggleDescriptionScope(business, {
    descriptionId: "description-a",
    regionId: "region-a",
    linkId: "link-a",
  });
  business = moveDescriptionReference(
    business,
    "description-a",
    { x: 220, y: 100 },
    { imageId: "image-a", relativeX: 0.3, relativeY: 0.5 },
  );
  return {
    format: "ai-canvas-excalidraw-p0",
    version: 1,
    savedAt: "2026-08-10T00:02:00.000Z",
    scene: {
      elements: [],
      appState: {
        viewBackgroundColor: "#f7f5f0",
        scrollX: 12,
        scrollY: 18,
        zoom: { value: 0.8 } as P0Bundle["scene"]["appState"]["zoom"],
        theme: "light",
        gridSize: 20,
        gridModeEnabled: true,
        objectsSnapModeEnabled: false,
      },
      files: {},
    },
    business,
  };
};

describe("AI Canvas 可编辑项目文件", () => {
  it("以 .excalidraw 外壳轮回恢复说明、范围、链接、锚点绑定和重点图片", () => {
    const serialized = serializeAiCanvasProjectFile(
      projectBundle(),
      ["image-a"],
      ROOT_FOLDER_ID,
    );
    const restored = parseAiCanvasProjectFile(serialized);

    expect(restored.sourceFormat).toBe("ai-canvas-project");
    expect(restored.focusImageIds).toEqual(["image-a"]);
    expect(restored.focusFolderId).toBe(ROOT_FOLDER_ID);
    expect(restored.bundle.business.descriptions["description-a"]).toMatchObject({
      text: "保留木纹，并核对参考网页",
      referenceUrl: "https://example.com/reference",
    });
    expect(restored.bundle.business.descriptionScopeLinks["link-a"]).toMatchObject({
      descriptionId: "description-a",
      regionId: "region-a",
    });
    expect(restored.bundle.business.descriptionReferences["reference-a"]).toMatchObject({
      anchor: { x: 220, y: 100 },
      imageBinding: { imageId: "image-a", relativeX: 0.3, relativeY: 0.5 },
    });
  });

  it("兼容旧 P0 存档，并对普通 Excalidraw 文件安全降级为空业务层", () => {
    const legacy = projectBundle();
    const restoredLegacy = parseAiCanvasProjectFile(JSON.stringify(legacy));
    expect(restoredLegacy.sourceFormat).toBe("legacy-p0");
    expect(restoredLegacy.bundle.business.descriptions["description-a"]).toBeDefined();

    const ordinary = parseAiCanvasProjectFile(JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    }));
    expect(ordinary.sourceFormat).toBe("excalidraw");
    expect(ordinary.bundle.business.descriptions).toEqual({});
  });

  it("保存并加载空 Folder 的 canonical cover 与真实 owner", () => {
    const base = projectBundle();
    const created = createVisibleFolder({
      business: migrateBusinessStateToV2(base.business),
      elements: base.scene.elements,
      folderId: "folder-empty",
      name: "Empty Folder",
      x: 240,
      y: 140,
    });
    const serialized = serializeAiCanvasProjectFile(
      {
        ...base,
        version: 3,
        business: created.business,
        scene: { ...base.scene, elements: created.elements },
      },
      [],
      ROOT_FOLDER_ID,
    );
    const restored = parseAiCanvasProjectFile(serialized);
    expect(restored.bundle.business.folders?.["folder-empty"].coverElementId).toBe(
      "folder-cover:folder-empty",
    );
    expect(
      restored.bundle.scene.elements.find(
        (element) => element.id === "folder-cover:folder-empty",
      )?.customData,
    ).toMatchObject({ kind: "folder-cover", folderId: "folder-empty" });
  });

  it("保存加载非空 Folder 后仍能原位恢复末成员离开的 cover", () => {
    const base = projectBundle();
    const created = createVisibleFolder({
      business: migrateBusinessStateToV2(base.business),
      elements: base.scene.elements,
      folderId: "folder-a",
      name: "Folder A",
      x: 310,
      y: 190,
    });
    const filled = reparentDirectObjects({
      business: created.business,
      targetFolderId: "folder-a",
      imageIds: ["image-a"],
      descriptionIds: ["description-a"],
    });
    const occupied = synchronizeEmptyFolderCovers({
      business: filled,
      elements: created.elements,
    });
    const restored = parseAiCanvasProjectFile(
      serializeAiCanvasProjectFile(
        {
          ...base,
          version: 3,
          business: occupied.business,
          scene: { ...base.scene, elements: occupied.elements },
        },
        ["image-a"],
        "folder-a",
      ),
    );
    const emptiedBusiness = deleteFolderDirectObjects({
      business: migrateBusinessStateToV2(restored.bundle.business),
      imageIds: ["image-a"],
      descriptionIds: ["description-a"],
    });
    const emptied = synchronizeEmptyFolderCovers({
      business: emptiedBusiness,
      elements: restored.bundle.scene.elements,
    });
    expect(
      emptied.elements.find(
        (element) => element.id === "folder-cover:folder-a",
      ),
    ).toMatchObject({
      x: 310,
      y: 190,
      width: 232,
      height: 156,
      isDeleted: false,
      customData: { folderId: "folder-a" },
    });
  });
});

describe("quick annotation project-file persistence", () => {
  it("round-trips point and rectangle annotations without changing format version", () => {
    const base = projectBundle();
    let business = migrateBusinessStateToV2(base.business);
    business = createQuickAnnotation(business, {
      id: "quick-a",
      imageId: "image-a",
      mode: "point",
      anchor: { x: 0.2, y: 0.3 },
      text: "保留这个节点",
      now: "2026-09-19T00:03:00.000Z",
    });
    business = createQuickAnnotation(business, {
      id: "quick-b",
      imageId: "image-a",
      mode: "rectangle",
      anchor: { x: 0.4, y: 0.25 },
      rectangle: { x: 0.4, y: 0.25, width: 0.3, height: 0.35 },
      text: "参考这个范围",
      now: "2026-09-19T00:04:00.000Z",
    });
    business = setQuickAnnotationLabelAnchor(business, "quick-b", { x: 1.15, y: -0.2 }, undefined, "left");

    const serialized = serializeAiCanvasProjectFile(
      { ...base, version: 3, business },
      ["image-a"],
      ROOT_FOLDER_ID,
    );
    const raw = JSON.parse(serialized) as { aiCanvas: { version: number } };
    const restored = parseAiCanvasProjectFile(serialized);

    expect(raw.aiCanvas.version).toBe(3);
    expect(restored.bundle.business.quickAnnotations).toEqual(
      business.quickAnnotations,
    );
    expect(restored.bundle.business.document.quickAnnotationIds).toEqual([
      "quick-a",
      "quick-b",
    ]);
    expect(
      restored.bundle.business.document.nextQuickAnnotationOrdinal,
    ).toBe(3);
  });

  it("preserves a reverse-drag hotspot separately from rectangle bounds", () => {
    const base = projectBundle();
    const business = createQuickAnnotation(
      migrateBusinessStateToV2(base.business),
      {
        id: "quick-reverse",
        imageId: "image-a",
        mode: "rectangle",
        anchor: { x: 0.5, y: 0.5 },
        rectangle: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
        text: "反向框选",
      },
    );
    const restored = parseAiCanvasProjectFile(
      serializeAiCanvasProjectFile(
        { ...base, version: 3, business },
        ["image-a"],
        ROOT_FOLDER_ID,
      ),
    );
    expect(restored.bundle.business.quickAnnotations?.["quick-reverse"])
      .toMatchObject({
        anchor: { x: 0.5, y: 0.5 },
        rectangle: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
      });
  });
});
