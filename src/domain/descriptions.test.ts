import { describe, expect, it } from "vitest";
import {
  activeDescriptionEntries,
  createDescription,
  deleteDescription,
  descriptionRegionIds,
  expandDescriptionReference,
  moveDescriptionReference,
  normalizeDescriptionReferenceUrl,
  normalizeDescriptionBusinessState,
  reconcileDescriptionImageBindings,
  removeImageSelections,
  removeRegionSelection,
  setDescriptionText,
  setDescriptionReferenceUrl,
  toggleDescriptionScope,
  translateSelectedDescriptionReferences,
} from "./descriptions";
import { createEmptyBusinessState, ROOT_FOLDER_ID } from "./types";

const withRegions = () => {
  const state = createEmptyBusinessState("description-test");
  state.document.imageAssetIds = ["image-a"];
  state.document.regionIds = ["region-a", "region-b"];
  state.folders[ROOT_FOLDER_ID].imageAssetIds = ["image-a"];
  state.imageAssets["image-a"] = {
    id: "image-a",
    fileId: "file-a",
    name: "image.png",
    mimeType: "image/png",
    naturalWidth: 100,
    naturalHeight: 100,
    source: "local",
    createdAt: "2026-09-01T00:00:00.000Z",
    folderId: ROOT_FOLDER_ID,
  };
  state.regions = {
    "region-a": {
      id: "region-a",
      imageId: "image-a",
      elementId: "element-a",
      geometry: null,
      active: true,
      status: "valid",
      folderId: ROOT_FOLDER_ID,
    },
    "region-b": {
      id: "region-b",
      imageId: "image-a",
      elementId: "element-b",
      geometry: null,
      active: true,
      status: "valid",
      folderId: ROOT_FOLDER_ID,
    },
  };
  return state;
};

describe("V8 说明对象", () => {
  it("以 Description 作为唯一正文来源，并支持零、单和多个平级范围", () => {
    const created = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 100, y: 120 },
      now: "2026-08-10T00:00:00.000Z",
    });
    const written = setDescriptionText(
      created,
      "description-a",
      "保留木纹并降低饱和度",
      "2026-08-10T00:01:00.000Z",
    );
    expect(descriptionRegionIds(written, "description-a")).toEqual([]);

    const single = toggleDescriptionScope(written, {
      descriptionId: "description-a",
      regionId: "region-a",
      linkId: "link-a",
    });
    expect(descriptionRegionIds(single, "description-a")).toEqual([
      "region-a",
    ]);

    const multiple = toggleDescriptionScope(single, {
      descriptionId: "description-a",
      regionId: "region-b",
      linkId: "link-b",
    });
    expect(new Set(descriptionRegionIds(multiple, "description-a"))).toEqual(
      new Set(["region-a", "region-b"]),
    );
    expect(multiple.descriptions["description-a"].text).toBe(
      "保留木纹并降低饱和度",
    );
    expect(JSON.stringify(multiple.descriptionScopeLinks)).not.toContain(
      "保留木纹",
    );
    expect(JSON.stringify(multiple.regions)).not.toContain("保留木纹");
  });

  it("允许同一选区被多条说明平级引用", () => {
    const first = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 10, y: 20 },
    });
    const second = createDescription(first, {
      descriptionId: "description-b",
      referenceId: "reference-b",
      anchor: { x: 30, y: 40 },
    });
    const linkedA = toggleDescriptionScope(second, {
      descriptionId: "description-a",
      regionId: "region-a",
      linkId: "link-a",
    });
    const linkedBoth = toggleDescriptionScope(linkedA, {
      descriptionId: "description-b",
      regionId: "region-a",
      linkId: "link-b",
    });

    expect(descriptionRegionIds(linkedBoth, "description-a")).toEqual([
      "region-a",
    ]);
    expect(descriptionRegionIds(linkedBoth, "description-b")).toEqual([
      "region-a",
    ]);
  });

  it("参考链接只归属说明，并仅把 http(s) 链接规范化用于交接", () => {
    const created = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 10, y: 20 },
    });
    const linked = setDescriptionReferenceUrl(
      created,
      "description-a",
      " https://example.com/design-brief ",
    );

    expect(linked.descriptions["description-a"].referenceUrl).toBe(
      " https://example.com/design-brief ",
    );
    expect(normalizeDescriptionReferenceUrl(
      linked.descriptions["description-a"].referenceUrl,
    )).toBe("https://example.com/design-brief");
    expect(normalizeDescriptionReferenceUrl("javascript:alert(1)")).toBeUndefined();
    expect(JSON.stringify(linked.regions)).not.toContain("example.com");
    expect(JSON.stringify(linked.descriptionScopeLinks)).not.toContain(
      "example.com",
    );
  });

  it("逐条打开说明时保留已有展开状态，支持并行对照", () => {
    const first = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 10, y: 20 },
    });
    const second = createDescription(first, {
      descriptionId: "description-b",
      referenceId: "reference-b",
      anchor: { x: 30, y: 40 },
    });

    const firstOpened = expandDescriptionReference(second, "description-a");
    const focused = expandDescriptionReference(firstOpened, "description-b");

    expect(focused.descriptionReferences["reference-a"].collapsed).toBe(false);
    expect(focused.descriptionReferences["reference-b"].collapsed).toBe(false);
  });

  it("安全补齐旧存档缺少的 V8 容器而不迁移旧 Annotation", () => {
    const legacy = createEmptyBusinessState();
    delete (legacy as Partial<typeof legacy>).descriptions;
    delete (legacy as Partial<typeof legacy>).descriptionScopeLinks;
    delete (legacy as Partial<typeof legacy>).descriptionReferences;
    delete (legacy.document as Partial<typeof legacy.document>).descriptionIds;
    delete (legacy.document as Partial<typeof legacy.document>)
      .descriptionScopeLinkIds;
    delete (legacy.document as Partial<typeof legacy.document>)
      .descriptionReferenceIds;

    const normalized = normalizeDescriptionBusinessState(legacy);
    expect(normalized.descriptions).toEqual({});
    expect(normalized.descriptionScopeLinks).toEqual({});
    expect(normalized.descriptionReferences).toEqual({});
    expect(activeDescriptionEntries(normalized)).toEqual([]);
  });

  it("移动锚点只改变 Reference 坐标，不改变正文、选区或范围关系", () => {
    const created = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 10, y: 20 },
    });
    const written = setDescriptionText(created, "description-a", "保留正文");
    const linked = toggleDescriptionScope(written, {
      descriptionId: "description-a",
      regionId: "region-a",
      linkId: "link-a",
    });
    const regionsBefore = structuredClone(linked.regions);
    const linksBefore = structuredClone(linked.descriptionScopeLinks);

    const moved = moveDescriptionReference(linked, "description-a", {
      x: 240,
      y: 180,
    });

    expect(moved.descriptionReferences["reference-a"].anchor).toEqual({
      x: 240,
      y: 180,
    });
    expect(moved.descriptions["description-a"].text).toBe("保留正文");
    expect(moved.regions).toEqual(regionsBefore);
    expect(moved.descriptionScopeLinks).toEqual(linksBefore);
  });

  it("删除说明会删除锚点和全部范围关系，但保留原选区", () => {
    const created = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 10, y: 20 },
    });
    const linked = toggleDescriptionScope(created, {
      descriptionId: "description-a",
      regionId: "region-a",
      linkId: "link-a",
    });
    const regionsBefore = structuredClone(linked.regions);

    const deleted = deleteDescription(linked, "description-a");

    expect(deleted.document.descriptionIds).not.toContain("description-a");
    expect(deleted.document.descriptionReferenceIds).not.toContain(
      "reference-a",
    );
    expect(deleted.document.descriptionScopeLinkIds).not.toContain("link-a");
    expect(deleted.descriptions["description-a"]).toBeUndefined();
    expect(deleted.descriptionReferences["reference-a"]).toBeUndefined();
    expect(deleted.descriptionScopeLinks["link-a"]).toBeUndefined();
    expect(deleted.regions).toEqual(regionsBefore);
  });

  it("删除选区会移除对应范围关系，但保留说明与其他选区", () => {
    const created = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 10, y: 20 },
    });
    const linkedA = toggleDescriptionScope(created, {
      descriptionId: "description-a",
      regionId: "region-a",
      linkId: "link-a",
    });
    const linkedBoth = toggleDescriptionScope(linkedA, {
      descriptionId: "description-a",
      regionId: "region-b",
      linkId: "link-b",
    });

    const deleted = removeRegionSelection(linkedBoth, "region-a");

    expect(deleted.regions["region-a"].active).toBe(false);
    expect(deleted.regions["region-b"].active).toBe(true);
    expect(deleted.descriptions["description-a"]).toBeDefined();
    expect(descriptionRegionIds(deleted, "description-a")).toEqual([
      "region-b",
    ]);
    expect(deleted.descriptionScopeLinks["link-a"]).toBeUndefined();
    expect(deleted.descriptionScopeLinks["link-b"]).toBeDefined();
  });

  it("删除图片会级联其选区和共享关系，但保留其他图片范围与说明正文", () => {
    const state = withRegions();
    state.regions["region-b"] = { ...state.regions["region-b"], imageId: "image-b" };
    const first = createDescription(state, {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 120, y: 130 },
    });
    const linkedA = toggleDescriptionScope(first, {
      descriptionId: "description-a", regionId: "region-a", linkId: "link-a",
    });
    const linkedBoth = toggleDescriptionScope(linkedA, {
      descriptionId: "description-a", regionId: "region-b", linkId: "link-b",
    });
    const deleted = removeImageSelections(linkedBoth, "image-a");

    expect(deleted.regions["region-a"].active).toBe(false);
    expect(deleted.regions["region-b"].active).toBe(true);
    expect(descriptionRegionIds(deleted, "description-a")).toEqual(["region-b"]);
    expect(deleted.descriptions["description-a"].text).toBe("");
  });

  it("图片被删除后解除锚点绑定并保留最后画布位置", () => {
    const created = createDescription(withRegions(), {
      descriptionId: "description-a", referenceId: "reference-a", anchor: { x: 200, y: 160 },
    });
    const bound = moveDescriptionReference(
      created,
      "description-a",
      { x: 200, y: 160 },
      { imageId: "image-a", relativeX: 0.5, relativeY: 0.5 },
    );
    const followed = reconcileDescriptionImageBindings(bound, [{
      imageId: "image-a", x: 300, y: 100, width: 400, height: 200, angle: 0, scale: [1, 1],
    }]);
    expect(followed.descriptionReferences["reference-a"].anchor).toEqual({ x: 500, y: 200 });
    const unbound = reconcileDescriptionImageBindings(followed, []);
    expect(unbound.descriptionReferences["reference-a"].anchor).toEqual({ x: 500, y: 200 });
    expect(unbound.descriptionReferences["reference-a"].imageBinding).toBeUndefined();
  });

  it("混合原生图片拖动时只平移未被图片绑定自动推进的选中说明", () => {
    const before = createDescription(withRegions(), {
      descriptionId: "description-a",
      referenceId: "reference-a",
      anchor: { x: 200, y: 120 },
      now: "2026-09-16T00:00:00.000Z",
    });
    const autoFollowed = moveDescriptionReference(
      before,
      "description-a",
      { x: 240, y: 120 },
      { imageId: "image-a", relativeX: 0.4 },
      "2026-09-16T00:00:01.000Z",
    );
    expect(
      translateSelectedDescriptionReferences(
        before,
        autoFollowed,
        ["description-a"],
        { x: 40, y: 0 },
        "2026-09-16T00:00:02.000Z",
      ).descriptionReferences["reference-a"].anchor,
    ).toEqual({ x: 240, y: 120 });
    const independent = moveDescriptionReference(
      before,
      "description-a",
      { x: 200, y: 120 },
      null,
      "2026-09-16T00:00:01.000Z",
    );
    expect(
      translateSelectedDescriptionReferences(
        before,
        independent,
        ["description-a"],
        { x: 40, y: 0 },
        "2026-09-16T00:00:02.000Z",
      ).descriptionReferences["reference-a"].anchor,
    ).toEqual({ x: 240, y: 120 });
  });
});
