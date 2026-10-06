import { describe, expect, it } from "vitest";
import { reconcileBusinessState, type SceneElementLike } from "./reconcile";
import { createEmptyBusinessState, ROOT_FOLDER_ID } from "./types";

const buildBusiness = () => {
  const state = createEmptyBusinessState("annotation-selection-test");
  state.imageAssets.image1 = {
    id: "image1",
    fileId: "file1",
    name: "interior.png",
    mimeType: "image/png",
    naturalWidth: 1200,
    naturalHeight: 800,
    source: "local",
    createdAt: "2026-07-31T00:00:00.000Z",
    folderId: ROOT_FOLDER_ID,
  };
  state.document.imageAssetIds = ["image1"];
  state.document.imagePlacementIds = ["placement1"];
  state.folders[ROOT_FOLDER_ID].imageAssetIds = ["image1"];
  state.imagePlacements.placement1 = {
    id: "placement1",
    imageId: "image1",
    elementId: "image-element",
    x: 100,
    y: 100,
    width: 600,
    height: 400,
    angle: 0,
    scale: [1, 1],
    crop: null,
    active: true,
    folderId: ROOT_FOLDER_ID,
  };
  return state;
};

const imageElement: SceneElementLike = {
  id: "image-element",
  type: "image",
  x: 100,
  y: 100,
  width: 600,
  height: 400,
  angle: 0,
  isDeleted: false,
  fileId: "file1",
  customData: {
    kind: "image",
    imageId: "image1",
    placementId: "placement1",
  },
};

const freehandSelection: SceneElementLike = {
  id: "freehand-selection",
  type: "freedraw",
  x: 220,
  y: 190,
  width: 180,
  height: 110,
  angle: 0,
  isDeleted: false,
  customData: {
    kind: "region",
    imageId: "image1",
    regionId: "region-freehand",
    selectionKind: "freedraw",
  },
};

describe("手绘标注选区兼容层", () => {
  it("把带稳定标识的手绘圈选映射为可发布的内部选区与修改指令", () => {
    const result = reconcileBusinessState(
      buildBusiness(),
      [
        imageElement,
        freehandSelection,
        {
          id: "card-text",
          type: "text",
          x: 430,
          y: 220,
          width: 160,
          height: 24,
          angle: 0,
          isDeleted: false,
          text: "将灯具改为暖光",
          customData: {
            kind: "annotation",
            annotationId: "annotation-freehand",
            regionId: "region-freehand",
            placeholder: "false",
          },
        },
      ],
      new Set(["file1"]),
    );

    expect(result.issues).toEqual([]);
    expect(result.state.regions["region-freehand"]).toMatchObject({
      imageId: "image1",
      elementId: "freehand-selection",
      active: true,
      status: "valid",
    });
    expect(
      result.state.regions["region-freehand"].geometry?.originalPixelBounds,
    ).toEqual({ x: 240, y: 180, width: 360, height: 220 });
    expect(result.state.annotations["annotation-freehand"]).toMatchObject({
      regionId: "region-freehand",
      text: "将灯具改为暖光",
      active: true,
    });
  });

  it("不会把普通自由画笔误当成可发布选区", () => {
    const result = reconcileBusinessState(
      buildBusiness(),
      [
        imageElement,
        {
          ...freehandSelection,
          id: "plain-freehand",
          customData: undefined,
        },
      ],
      new Set(["file1"]),
    );

    expect(result.issues).toEqual([]);
    expect(result.state.regions["region-freehand"]).toBeUndefined();
  });

  it("不会把普通文字或普通箭头猜测为结构化标注", () => {
    const result = reconcileBusinessState(
      buildBusiness(),
      [
        imageElement,
        {
          id: "plain-text",
          type: "text",
          x: 260,
          y: 220,
          width: 180,
          height: 24,
          angle: 0,
          isDeleted: false,
          text: "这只是画布说明",
        },
        {
          id: "plain-arrow",
          type: "arrow",
          x: 250,
          y: 210,
          width: 110,
          height: 32,
          angle: 0,
          isDeleted: false,
        },
      ],
      new Set(["file1"]),
    );

    expect(result.issues).toEqual([]);
    expect(result.state.annotations).toEqual({});
    expect(result.state.document.annotationIds).toEqual([]);
  });
});
