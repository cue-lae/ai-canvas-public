import { describe, expect, it } from "vitest";
import {
  buildCodexVisualContext,
  findActiveAnnotationForRegion,
  isBridgePublishableImageMimeType,
  type CanvasSnapshot,
} from "./codexContext";
import { createEmptyBusinessState, type BusinessState } from "./types";

const buildCanvasSnapshot = (): CanvasSnapshot => ({
  filename: "document-context-canvas.png",
  mimeType: "image/png",
  width: 1600,
  height: 1100,
  bytes: 120_000,
});

const buildBusiness = (): BusinessState => {
  const state = createEmptyBusinessState("document-context");
  state.document.title = "客厅方案";
  state.document.imageAssetIds = ["image-1"];
  state.document.regionIds = ["region-1"];
  state.document.annotationIds = ["annotation-1"];
  state.imageAssets["image-1"] = {
    id: "image-1",
    fileId: "file-1",
    name: "living-room.jpg",
    mimeType: "image/jpeg",
    naturalWidth: 3000,
    naturalHeight: 2197,
    source: "local",
    createdAt: "2026-07-27T00:00:00.000Z",
  };
  state.regions["region-1"] = {
    id: "region-1",
    imageId: "image-1",
    elementId: "element-region-1",
    active: true,
    status: "valid",
    geometry: {
      sceneCorners: [],
      imageLocalCorners: [],
      originalPixelCorners: [],
      normalizedCorners: [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.3 },
        { x: 0.4, y: 0.6 },
        { x: 0.2, y: 0.6 },
      ],
      originalPixelBounds: {
        x: 600,
        y: 659.1,
        width: 600,
        height: 659.1,
      },
      clippedPixelBounds: {
        x: 600,
        y: 659.1,
        width: 600,
        height: 659.1,
      },
      isClipped: false,
      roundTripMaxErrorPx: 0,
    },
  };
  state.annotations["annotation-1"] = {
    id: "annotation-1",
    regionId: "region-1",
    elementId: "element-annotation-1",
    text: "沙发改为浅灰亚麻色吗？",
    active: true,
  };
  return state;
};

describe("选区备注选择", () => {
  it("返回当前 ROI 的有效备注用于恢复输入框", () => {
    const annotation = findActiveAnnotationForRegion(
      buildBusiness(),
      "region-1",
    );
    expect(annotation?.text).toBe("沙发改为浅灰亚麻色吗？");
  });

  it("忽略其他 ROI 或已失效的备注", () => {
    const state = buildBusiness();
    state.annotations["annotation-1"].active = false;
    expect(
      findActiveAnnotationForRegion(state, "region-1"),
    ).toBeNull();
    expect(
      findActiveAnnotationForRegion(buildBusiness(), "region-missing"),
    ).toBeNull();
  });
});

describe("桥接图片格式", () => {
  it("只允许 PNG、JPEG 与 WebP 原图发布到桥接", () => {
    expect(isBridgePublishableImageMimeType("image/png")).toBe(true);
    expect(isBridgePublishableImageMimeType("image/jpeg")).toBe(true);
    expect(isBridgePublishableImageMimeType("image/webp")).toBe(true);
    expect(isBridgePublishableImageMimeType(" IMAGE/JPEG ")).toBe(true);
    expect(isBridgePublishableImageMimeType("image/svg+xml")).toBe(false);
    expect(isBridgePublishableImageMimeType("")).toBe(false);
  });
});

describe("Codex 视觉上下文", () => {
  it("组织原图、矩形选区和已保存问题", () => {
    const context = buildCodexVisualContext({
      business: buildBusiness(),
      imageId: "image-1",
      regionId: "region-1",
      question: " 沙发改为浅灰亚麻色吗？ ",
      crop: {
        clippedBounds: {
          x: 600,
          y: 659,
          width: 600,
          height: 660,
        },
        bytes: 123456,
      },
      canvasSnapshot: buildCanvasSnapshot(),
      generatedAt: "2026-07-27T08:00:00.000Z",
    });

    expect(context.originalImage).toMatchObject({
      imageId: "image-1",
      name: "living-room.jpg",
      naturalWidth: 3000,
      naturalHeight: 2197,
      pixelsAvailable: true,
    });
    expect(context.canvasSnapshot).toEqual(buildCanvasSnapshot());
    expect(context.selection).toMatchObject({
      regionId: "region-1",
      imageId: "image-1",
      crop: {
        filename: "region-1-crop.png",
        width: 600,
        height: 660,
        bytes: 123456,
      },
    });
    expect(context.prompt).toEqual({
      text: "沙发改为浅灰亚麻色吗？",
      annotationId: "annotation-1",
      saved: true,
    });
  });

  it("拒绝没有问题文本的上下文", () => {
    expect(() =>
      buildCodexVisualContext({
        business: buildBusiness(),
        imageId: "image-1",
        regionId: "region-1",
        question: "  ",
        crop: {
          clippedBounds: { x: 0, y: 0, width: 1, height: 1 },
          bytes: 1,
        },
        canvasSnapshot: buildCanvasSnapshot(),
      }),
    ).toThrow("请先填写当前选区的问题或备注。");
  });

  it("无活动 ROI 时仅发布原图与带标注画布快照", () => {
    const business = buildBusiness();
    business.document.quickAnnotationIds = ["quick-1"];
    business.document.nextQuickAnnotationOrdinal = 2;
    business.quickAnnotations = {
      "quick-1": {
        id: "quick-1",
        imageId: "image-1",
        mode: "point",
        anchor: { x: 0.2, y: 0.25 },
        text: "参考扶手",
        ordinal: 1,
        collapsed: false,
        active: true,
        createdAt: "2026-09-19T00:00:00.000Z",
        updatedAt: "2026-09-19T00:00:00.000Z",
      },
    };
    const context = buildCodexVisualContext({
      business,
      imageId: "image-1",
      regionId: null,
      canvasSnapshot: buildCanvasSnapshot(),
      generatedAt: "2026-07-29T12:00:00.000Z",
    });

    expect(context.originalImage.imageId).toBe("image-1");
    expect(context.originalImage.quickAnnotations).toEqual([
      expect.objectContaining({
        quickAnnotationId: "quick-1",
        label: "Q1",
        normalizedAnchor: { x: 0.2, y: 0.25 },
        originalPixelAnchor: { x: 600, y: 549.25 },
      }),
    ]);
    expect(context.canvasSnapshot).toEqual(buildCanvasSnapshot());
    expect(context.selection).toBeNull();
    expect(context.prompt).toBeNull();
  });

  it("拒绝缺少 ROI 局部图、无效原图或无效画布快照", () => {
    expect(() =>
      buildCodexVisualContext({
        business: buildBusiness(),
        imageId: "image-1",
        regionId: "region-1",
        question: "测试问题",
        canvasSnapshot: buildCanvasSnapshot(),
      }),
    ).toThrow("当前 ROI 没有可用的局部图。");

    expect(() =>
      buildCodexVisualContext({
        business: buildBusiness(),
        imageId: "image-missing",
        regionId: null,
        canvasSnapshot: buildCanvasSnapshot(),
      }),
    ).toThrow("当前原始图片不存在。");

    expect(() =>
      buildCodexVisualContext({
        business: buildBusiness(),
        imageId: "image-1",
        regionId: null,
        canvasSnapshot: {
          ...buildCanvasSnapshot(),
          bytes: 0,
        },
      }),
    ).toThrow("当前画布快照不可用。");
  });
});
