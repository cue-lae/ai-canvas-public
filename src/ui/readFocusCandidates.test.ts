import { describe, expect, it, vi } from "vitest";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { createEmptyBusinessState, ROOT_FOLDER_ID } from "../domain/types";
import type { SceneElementLike } from "../domain/reconcile";
import { deriveReadFocusCandidates } from "./readFocusCandidates";

// focusedPublish also exposes scene builders that import the renderer. This
// pure derivation exercises its real normalization rule, never those builders.
// Fail if it accidentally starts invoking renderer mutation helpers.
vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: () => {
    throw new Error("Candidate derivation must not invoke the renderer.");
  },
  newElementWith: () => {
    throw new Error("Candidate derivation must not mutate scene elements.");
  },
}));

const DATA_URL = "data:image/png;base64,YQ==";

const fixture = () => {
  const business = createEmptyBusinessState("read-focus-test");
  business.folders.child = {
    ...business.folders[ROOT_FOLDER_ID],
    id: "child",
    kind: "folder",
    name: "Child",
    imageAssetIds: [],
  };
  business.document.folderIds!.push("child");
  const elements: SceneElementLike[] = [];
  const files = {} as BinaryFiles;
  const addImage = (
    imageId: string,
    folderId = ROOT_FOLDER_ID,
    fileId = `file-${imageId}`,
  ) => {
    const elementId = `element-${imageId}`;
    const placementId = `placement-${imageId}`;
    business.imageAssets[imageId] = {
      id: imageId, fileId, folderId, name: `${imageId}.png`,
      mimeType: "image/png", naturalWidth: 800, naturalHeight: 600,
      source: "local", createdAt: "2026-10-20",
    };
    business.folders[folderId].imageAssetIds.push(imageId);
    business.document.imageAssetIds.push(imageId);
    business.document.imagePlacementIds.push(placementId);
    business.imagePlacements[placementId] = {
      id: placementId, imageId, elementId, folderId,
      x: 10000, y: 10000, width: 800, height: 600, angle: 0,
      scale: [1, 1], crop: null, active: true,
    };
    elements.push({
      id: elementId, type: "image", fileId,
      x: 10000, y: 10000, width: 800, height: 600, angle: 0, isDeleted: false,
      customData: { kind: "image", imageId, placementId, folderId },
    });
    files[fileId] = {
      id: fileId, dataURL: DATA_URL, mimeType: "image/png", created: 0,
    } as BinaryFiles[string];
  };
  return { business, elements, files, addImage };
};

const derive = (
  input: ReturnType<typeof fixture>,
  focusedImageIds: readonly string[] = [],
  folderId = ROOT_FOLDER_ID,
) => deriveReadFocusCandidates({ ...input, folderId, focusedImageIds });

describe("Read focus candidate derivation", () => {
  it("uses only the actual folder scope, including off-viewport images", () => {
    const input = fixture();
    input.addImage("root");
    input.addImage("nested", "child");
    expect(derive(input).map((row) => row.imageId)).toEqual(["root"]);
    expect(derive(input, [], "child").map((row) => row.imageId)).toEqual(["nested"]);
    expect(derive(input, ["nested"]).map((row) => row.imageId)).toEqual(["root"]);
  });

  it("uses folder index order and deduplicates imageId without merging fileId", () => {
    const input = fixture();
    input.addImage("a", ROOT_FOLDER_ID, "shared-file");
    input.addImage("b", ROOT_FOLDER_ID, "shared-file");
    input.business.folders[ROOT_FOLDER_ID].imageAssetIds = ["b", "a", "b"];
    expect(derive(input, ["a"]).map((row) => row.imageId)).toEqual(["b", "a"]);
    expect(derive(input, ["b", "a"]).map((row) => row.imageId)).toEqual(["b", "a"]);
  });

  it("does not cap the candidate list at the four-image focus limit", () => {
    const input = fixture();
    ["a", "b", "c", "d", "e", "f"].forEach((id) => input.addImage(id));
    expect(derive(input, ["a", "b", "c", "d"])).toHaveLength(6);
  });

  it.each([
    ["missing placement", (input: ReturnType<typeof fixture>) => {
      delete input.business.imagePlacements["placement-a"];
    }],
    ["inactive placement", (input: ReturnType<typeof fixture>) => {
      input.business.imagePlacements["placement-a"].active = false;
    }],
    ["deleted scene image", (input: ReturnType<typeof fixture>) => {
      input.elements[0].isDeleted = true;
    }],
    ["projection only", (input: ReturnType<typeof fixture>) => {
      input.elements[0].customData!.kind = "folder-preview-image";
    }],
    ["wrong placement owner", (input: ReturnType<typeof fixture>) => {
      input.business.imagePlacements["placement-a"].folderId = "child";
    }],
    ["wrong scene owner", (input: ReturnType<typeof fixture>) => {
      input.elements[0].customData!.folderId = "child";
    }],
    ["wrong scene registration", (input: ReturnType<typeof fixture>) => {
      input.elements[0].customData!.placementId = "different";
    }],
    ["wrong scene file", (input: ReturnType<typeof fixture>) => {
      input.elements[0].fileId = "different";
    }],
    ["duplicate canonical image", (input: ReturnType<typeof fixture>) => {
      input.elements.push({ ...input.elements[0], id: "duplicate" });
    }],
    ["duplicate scene id", (input: ReturnType<typeof fixture>) => {
      input.elements.push({ ...input.elements[0], type: "rectangle", customData: {} });
    }],
    ["duplicate active placement", (input: ReturnType<typeof fixture>) => {
      input.business.imagePlacements.other = {
        ...input.business.imagePlacements["placement-a"], id: "other",
      };
    }],
  ] as const)("rejects %s for new focus but preserves existing focus", (_, corrupt) => {
    const input = fixture();
    input.addImage("a");
    corrupt(input);
    expect(derive(input)).toEqual([]);
    const rows = derive(input, ["a"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].imageId).toBe("a");
    expect(rows[0].unavailableReason).toBeTruthy();
  });

  it("keeps original-less indexed rows visible and unavailable", () => {
    const input = fixture();
    input.addImage("a");
    delete input.files["file-a"];
    expect(derive(input)[0]).toMatchObject({
      imageId: "a", dataURL: null, unavailableReason: "原图数据缺失，无法加入重点。",
    });
    expect(derive(input, ["a"])).toEqual(derive(input));
  });

  it("appends restored unindexed focus in existing focus order without mutation", () => {
    const input = fixture();
    ["a", "b", "c"].forEach((id) => input.addImage(id));
    input.business.folders[ROOT_FOLDER_ID].imageAssetIds = ["a"];
    const selected = ["c", "a", "b", "c"];
    const before = JSON.stringify(input);
    const rows = derive(input, selected);
    expect(rows.map((row) => row.imageId)).toEqual(["a", "c", "b"]);
    expect(rows.slice(1).map((row) => row.unavailableReason)).toEqual([
      "图片不在当前范围索引中。", "图片不在当前范围索引中。",
    ]);
    expect(selected).toEqual(["c", "a", "b", "c"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("retains abnormal focus if the scope index is absent", () => {
    const input = fixture();
    input.addImage("a");
    delete input.business.folders[ROOT_FOLDER_ID];
    expect(derive(input)).toEqual([]);
    expect(derive(input, ["a"])[0]).toMatchObject({
      imageId: "a", unavailableReason: "图片不在当前范围索引中。",
    });
  });

  it("follows existing normalization for deleted assets and cross-scope focus", () => {
    const input = fixture();
    input.addImage("a");
    input.addImage("b");
    input.addImage("child", "child");
    delete input.business.imageAssets.b;
    expect(derive(input, ["b", "a", "child"]).map((row) => row.imageId)).toEqual(["a"]);
  });

  it("does not trust an index entry whose asset belongs to another folder", () => {
    const input = fixture();
    input.addImage("nested", "child");
    input.business.folders[ROOT_FOLDER_ID].imageAssetIds.push("nested");
    expect(derive(input, ["nested"])).toEqual([]);
  });

  it("preserves exact names and full original data without thumbnail policy", () => {
    const input = fixture();
    input.addImage("a");
    input.addImage("b");
    const name = "相同前缀_很长的完整原始文件名称_最终版本.png";
    input.business.imageAssets.a.name = name;
    input.business.imageAssets.b.name = "";
    expect(derive(input)).toMatchObject([
      { imageId: "a", name, dataURL: DATA_URL, unavailableReason: null },
      { imageId: "b", name: "", dataURL: DATA_URL, unavailableReason: null },
    ]);
  });
});
