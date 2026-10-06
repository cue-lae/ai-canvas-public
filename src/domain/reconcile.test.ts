import { describe, expect, it } from "vitest";
import {
  appendUnique,
  createEmptyBusinessState,
  ROOT_FOLDER_ID,
  type BusinessState,
} from "./types";
import {
  reconcileBusinessState,
  type SceneElementLike,
} from "./reconcile";

const buildBusiness = (): BusinessState => {
  const state = createEmptyBusinessState("document-test");
  state.folders[ROOT_FOLDER_ID].imageAssetIds = ["image1"];
  state.imageAssets.image1 = {
    id: "image1",
    fileId: "file1",
    name: "test.png",
    mimeType: "image/png",
    naturalWidth: 4000,
    naturalHeight: 2000,
    source: "local",
    createdAt: "2026-07-26T00:00:00.000Z",
    folderId: ROOT_FOLDER_ID,
  };
  state.document.imageAssetIds = ["image1"];
  state.document.imagePlacementIds = ["placement1"];
  state.document.regionIds = ["region1"];
  state.document.annotationIds = ["annotation1"];
  state.document.aiExchangeIds = ["ai1"];
  state.imagePlacements.placement1 = {
    id: "placement1",
    imageId: "image1",
    elementId: "image-element",
    x: 100,
    y: 200,
    width: 1000,
    height: 500,
    angle: Math.PI / 8,
    scale: [1, 1],
    crop: null,
    active: true,
    folderId: ROOT_FOLDER_ID,
  };
  state.regions.region1 = {
    id: "region1",
    imageId: "image1",
    elementId: "roi-element",
    geometry: null,
    active: true,
    status: "valid",
    folderId: ROOT_FOLDER_ID,
  };
  state.annotations.annotation1 = {
    id: "annotation1",
    regionId: "region1",
    elementId: "text-element",
    text: "沙发颜色",
    active: true,
  };
  state.aiExchanges.ai1 = {
    id: "ai1",
    regionId: "region1",
    question: "沙发颜色",
    answer: "本地模拟回答",
    provider: "local-mock",
    status: "completed",
    createdAt: "2026-07-26T00:00:00.000Z",
  };
  return state;
};

const scene = (): SceneElementLike[] => [
  {
    id: "image-element",
    type: "image",
    x: 100,
    y: 200,
    width: 1000,
    height: 500,
    angle: Math.PI / 8,
    isDeleted: false,
    scale: [1, 1],
    crop: null,
    fileId: "file1",
    customData: {
      kind: "image",
      imageId: "image1",
      placementId: "placement1",
    },
  },
  {
    id: "roi-element",
    type: "rectangle",
    x: 300,
    y: 310,
    width: 200,
    height: 120,
    angle: 0,
    isDeleted: false,
    customData: {
      kind: "region",
      imageId: "image1",
      regionId: "region1",
    },
  },
  {
    id: "text-element",
    type: "text",
    x: 300,
    y: 450,
    width: 120,
    height: 24,
    angle: 0,
    isDeleted: false,
    text: "沙发颜色",
    customData: {
      kind: "annotation",
      annotationId: "annotation1",
      regionId: "region1",
    },
  },
];

describe("业务关系协调", () => {
  it("恢复图片、ROI、文字与模拟 AI 的稳定关系", () => {
    const result = reconcileBusinessState(
      buildBusiness(),
      scene(),
      new Set(["file1"]),
    );
    expect(result.issues).toEqual([]);
    expect(result.state.imagePlacements.placement1.active).toBe(true);
    expect(result.state.regions.region1.active).toBe(true);
    expect(result.state.regions.region1.geometry?.roundTripMaxErrorPx).toBeLessThanOrEqual(1);
    expect(result.state.annotations.annotation1.active).toBe(true);
    expect(result.state.aiExchanges.ai1.status).toBe("completed");
  });

  it("删除 ROI 后保留业务墓碑，撤销恢复时不产生悬空 AI 关系", () => {
    const initial = reconcileBusinessState(
      buildBusiness(),
      scene(),
      new Set(["file1"]),
    ).state;
    const deletedScene = scene().map((element) =>
      element.id === "roi-element" ? { ...element, isDeleted: true } : element,
    );
    const afterDelete = reconcileBusinessState(
      initial,
      deletedScene,
      new Set(["file1"]),
    );
    expect(afterDelete.state.regions.region1.active).toBe(false);
    expect(afterDelete.state.aiExchanges.ai1.regionId).toBe("region1");
    expect(afterDelete.state.aiExchanges.ai1.status).toBe("completed");

    const afterUndo = reconcileBusinessState(
      afterDelete.state,
      scene(),
      new Set(["file1"]),
    );
    expect(afterUndo.state.regions.region1.active).toBe(true);
    expect(afterUndo.state.aiExchanges.ai1.status).toBe("completed");
    expect(afterUndo.issues).toEqual([]);
  });

  it("缺失图片元素时返回明确错误而不是伪造坐标", () => {
    const result = reconcileBusinessState(
      buildBusiness(),
      scene().filter((element) => element.type !== "image"),
      new Set(["file1"]),
    );
    expect(result.state.regions.region1.status).toBe("invalid");
    expect(result.state.regions.region1.geometry).toBeNull();
    expect(
      result.issues.some((issue) => issue.code === "MISSING_IMAGE_ELEMENT"),
    ).toBe(true);
  });

  it("普通 Excalidraw 矩形不会成为业务 ROI", () => {
    const plainRectangleScene = scene().map((element) =>
      element.id === "roi-element"
        ? {
            ...element,
            id: "plain-rectangle",
            customData: undefined,
          }
        : element,
    );
    const result = reconcileBusinessState(
      buildBusiness(),
      plainRectangleScene,
      new Set(["file1"]),
    );

    expect(result.state.regions.region1.active).toBe(false);
    expect(result.state.regions["plain-rectangle"]).toBeUndefined();
    expect(result.state.document.regionIds).toEqual(["region1"]);
  });

  it("无效业务 ID 会形成明确错误", () => {
    const invalid = scene().map((element) =>
      element.type === "text"
        ? {
            ...element,
            customData: {
              kind: "annotation",
              annotationId: "annotation-invalid",
              regionId: "missing-region",
            },
          }
        : element,
    );
    const result = reconcileBusinessState(
      buildBusiness(),
      invalid,
      new Set(["file1"]),
    );
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "MISSING_REGION" &&
          issue.businessId === "missing-region",
      ),
    ).toBe(true);
  });
});

describe("稳定 ID 辅助函数", () => {
  it("不会重复写入文档 ID 列表", () => {
    expect(appendUnique(["region1"], "region1")).toEqual(["region1"]);
    expect(appendUnique(["region1"], "region2")).toEqual([
      "region1",
      "region2",
    ]);
  });
});
