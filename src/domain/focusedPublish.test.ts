import { describe, expect, it } from "vitest";
import {
  addFocusedImage,
  buildFocusedCanvasContext,
  dataUrlDecodedByteLength,
  getFocusedPublishPreflightError,
  isFocusedAnnotationSemanticElementKind,
  normalizeFocusedImageIds,
  removeFocusedImage,
} from "./focusedPublish";
import {
  createEmptyBusinessState,
  ROOT_FOLDER_ID,
  type BusinessState,
} from "./types";
import {
  createDescription,
  setDescriptionReferenceUrl,
  setDescriptionText,
  toggleDescriptionScope,
} from "./descriptions";
import { migrateBusinessStateToV2 } from "./folderScene";
import { createQuickAnnotation } from "../ui/quickAnnotations";

const buildBusiness = (): BusinessState => {
  const business = createEmptyBusinessState("document-focus");
  business.document.title = "多图方案";
  business.document.imageAssetIds = ["image-a", "image-b"];
  business.document.regionIds = [
    "region-a-visible",
    "region-a-outside",
    "region-b-visible",
  ];
  business.document.annotationIds = [
    "annotation-a-visible",
    "annotation-a-outside",
    "annotation-b-visible",
  ];
  business.folders[ROOT_FOLDER_ID].imageAssetIds = ["image-a", "image-b"];
  business.imageAssets = {
    "image-a": {
      id: "image-a",
      fileId: "file-a",
      name: "客厅.png",
      mimeType: "image/png",
      naturalWidth: 1200,
      naturalHeight: 800,
      source: "local",
      createdAt: "2026-07-31T00:00:00.000Z",
      folderId: ROOT_FOLDER_ID,
    },
    "image-b": {
      id: "image-b",
      fileId: "file-b",
      name: "卧室.jpg",
      mimeType: "image/jpeg",
      naturalWidth: 1600,
      naturalHeight: 900,
      source: "local",
      createdAt: "2026-07-31T00:00:00.000Z",
      folderId: ROOT_FOLDER_ID,
    },
  };
  business.regions = {
    "region-a-visible": {
      id: "region-a-visible",
      imageId: "image-a",
      elementId: "region-a-visible-element",
      active: true,
      status: "valid",
      folderId: ROOT_FOLDER_ID,
      geometry: {
        sceneCorners: [],
        imageLocalCorners: [],
        originalPixelCorners: [],
        normalizedCorners: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.1 },
          { x: 0.4, y: 0.4 },
          { x: 0.1, y: 0.4 },
        ],
        originalPixelBounds: { x: 120, y: 80, width: 360, height: 240 },
        clippedPixelBounds: { x: 120, y: 80, width: 360, height: 240 },
        isClipped: false,
        roundTripMaxErrorPx: 0,
      },
    },
    "region-a-outside": {
      id: "region-a-outside",
      imageId: "image-a",
      elementId: "region-a-outside-element",
      active: true,
      status: "valid",
      folderId: ROOT_FOLDER_ID,
      geometry: {
        sceneCorners: [],
        imageLocalCorners: [],
        originalPixelCorners: [],
        normalizedCorners: [
          { x: 0.5, y: 0.5 },
          { x: 0.6, y: 0.5 },
          { x: 0.6, y: 0.6 },
          { x: 0.5, y: 0.6 },
        ],
        originalPixelBounds: { x: 600, y: 400, width: 120, height: 80 },
        clippedPixelBounds: { x: 600, y: 400, width: 120, height: 80 },
        isClipped: false,
        roundTripMaxErrorPx: 0,
      },
    },
    "region-b-visible": {
      id: "region-b-visible",
      imageId: "image-b",
      elementId: "region-b-visible-element",
      active: true,
      status: "valid",
      folderId: ROOT_FOLDER_ID,
      geometry: {
        sceneCorners: [],
        imageLocalCorners: [],
        originalPixelCorners: [],
        normalizedCorners: [
          { x: 0, y: 0 },
          { x: 0.1, y: 0 },
          { x: 0.1, y: 0.1 },
          { x: 0, y: 0.1 },
        ],
        originalPixelBounds: { x: 0, y: 0, width: 160, height: 90 },
        clippedPixelBounds: { x: 0, y: 0, width: 160, height: 90 },
        isClipped: false,
        roundTripMaxErrorPx: 0,
      },
    },
  };
  business.annotations = {
    "annotation-a-visible": {
      id: "annotation-a-visible",
      regionId: "region-a-visible",
      elementId: "annotation-a-visible-element",
      text: "只改重点客厅",
      active: true,
    },
    "annotation-a-outside": {
      id: "annotation-a-outside",
      regionId: "region-a-outside",
      elementId: "annotation-a-outside-element",
      text: "不要带出旧备注",
      active: true,
    },
    "annotation-b-visible": {
      id: "annotation-b-visible",
      regionId: "region-b-visible",
      elementId: "annotation-b-visible-element",
      text: "非重点图文字",
      active: true,
    },
  };
  return business;
};

const overview = {
  filename: "viewport.png",
  mimeType: "image/png" as const,
  width: 800,
  height: 500,
  bytes: 1234,
};

describe("本次重点图片", () => {
  it("保持加入顺序、去重并支持单独移除", () => {
    const withA = addFocusedImage([], "image-a");
    const withBoth = addFocusedImage(withA, "image-b");

    expect(addFocusedImage(withBoth, "image-a")).toEqual([
      "image-a",
      "image-b",
    ]);
    expect(removeFocusedImage(withBoth, "image-a")).toEqual(["image-b"]);
    expect(normalizeFocusedImageIds(buildBusiness(), ["missing", "image-b", "image-b"], ROOT_FOLDER_ID)).toEqual([
      "image-b",
    ]);
  });

  it("只为重点图片保留当前视窗内的选区和可见卡片文字", () => {
    const context = buildFocusedCanvasContext({
      business: buildBusiness(),
      focusFolderId: ROOT_FOLDER_ID,
      focusImageIds: ["image-a"],
      visibleRegionIds: ["region-a-visible", "region-b-visible"],
      visibleAnnotationRegionIds: [
        "region-a-visible",
        "region-b-visible",
      ],
      overviewSnapshot: overview,
      generatedAt: "2026-07-31T00:00:00.000Z",
    });

    expect(context.focusImages.map((image) => image.imageId)).toEqual([
      "image-a",
    ]);
    expect(context.focusImages[0]?.visibleAnnotations).toEqual([
      expect.objectContaining({
        regionId: "region-a-visible",
        selectionVisible: true,
        card: {
          annotationId: "annotation-a-visible",
          text: "只改重点客厅",
        },
      }),
    ]);
    expect(JSON.stringify(context)).not.toContain("region-a-outside");
    expect(JSON.stringify(context)).not.toContain("非重点图文字");
  });

  it("卡片矩形可见时保留卡片文字，即使选区和文字元素都在视窗外", () => {
    const context = buildFocusedCanvasContext({
      business: buildBusiness(),
      focusFolderId: ROOT_FOLDER_ID,
      focusImageIds: ["image-a"],
      visibleRegionIds: [],
      visibleAnnotationRegionIds: ["region-a-visible"],
      overviewSnapshot: overview,
    });

    expect(context.focusImages[0]?.visibleAnnotations).toEqual([
      expect.objectContaining({
        regionId: "region-a-visible",
        selectionVisible: false,
        card: {
          annotationId: "annotation-a-visible",
          text: "只改重点客厅",
        },
      }),
    ]);
    expect(isFocusedAnnotationSemanticElementKind("annotation")).toBe(true);
    expect(isFocusedAnnotationSemanticElementKind("annotation-card")).toBe(true);
    expect(isFocusedAnnotationSemanticElementKind("annotation-leader")).toBe(false);
    expect(isFocusedAnnotationSemanticElementKind("region")).toBe(false);
  });

  it("按重点图片过滤并发布文档级快速标注", () => {
    let business = migrateBusinessStateToV2(buildBusiness());
    business = createQuickAnnotation(business, {
      id: "quick-a",
      imageId: "image-a",
      mode: "point",
      anchor: { x: 0.25, y: 0.5 },
      text: "参考窗框",
    });
    business = createQuickAnnotation(business, {
      id: "quick-b",
      imageId: "image-b",
      mode: "rectangle",
      anchor: { x: 0.1, y: 0.2 },
      rectangle: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      text: "非重点图片标注",
    });
    const context = buildFocusedCanvasContext({
      business,
      focusFolderId: ROOT_FOLDER_ID,
      focusImageIds: ["image-a"],
      visibleRegionIds: [],
      visibleAnnotationRegionIds: [],
      overviewSnapshot: overview,
    });

    expect(context.version).toBe(1);
    expect(context.focusImages[0]?.quickAnnotations).toEqual([
      expect.objectContaining({
        quickAnnotationId: "quick-a",
        ordinal: 1,
        label: "Q1",
        imageId: "image-a",
        mode: "point",
        text: "参考窗框",
        normalizedAnchor: { x: 0.25, y: 0.5 },
        originalPixelAnchor: { x: 300, y: 400 },
      }),
    ]);
    expect(JSON.stringify(context)).not.toContain("quick-b");
  });

  it("以全局说明和独立关系交接零、单、多范围且不复制正文到选区", () => {
    const base = buildBusiness();
    const withCanvasDescription = setDescriptionText(
      createDescription(base, {
        descriptionId: "description-canvas",
        referenceId: "reference-canvas",
        anchor: { x: 30, y: 40 },
      }),
      "description-canvas",
      "整张画布保持暖白色温",
    );
    const withCanvasReference = setDescriptionReferenceUrl(
      withCanvasDescription,
      "description-canvas",
      "https://example.com/material-reference",
    );
    const withScopedDescription = setDescriptionText(
      createDescription(withCanvasReference, {
        descriptionId: "description-scoped",
        referenceId: "reference-scoped",
        anchor: { x: 300, y: 200 },
      }),
      "description-scoped",
      "两个范围使用同一种浅灰材质",
    );
    const withFirstScope = toggleDescriptionScope(withScopedDescription, {
      descriptionId: "description-scoped",
      regionId: "region-a-visible",
      linkId: "link-a",
    });
    const business = toggleDescriptionScope(withFirstScope, {
      descriptionId: "description-scoped",
      regionId: "region-b-visible",
      linkId: "link-b",
    });

    const context = buildFocusedCanvasContext({
      business,
      focusFolderId: ROOT_FOLDER_ID,
      focusImageIds: ["image-a"],
      visibleRegionIds: ["region-a-visible"],
      visibleAnnotationRegionIds: ["region-a-visible"],
      overviewSnapshot: overview,
    });

    expect(context.descriptions).toEqual([
      expect.objectContaining({
        descriptionId: "description-canvas",
        text: "整张画布保持暖白色温",
        referenceUrl: "https://example.com/material-reference",
      }),
      expect.objectContaining({
        descriptionId: "description-scoped",
        text: "两个范围使用同一种浅灰材质",
      }),
    ]);
    expect(context.descriptionScopeLinks).toEqual([
      { descriptionId: "description-scoped", regionId: "region-a-visible" },
      { descriptionId: "description-scoped", regionId: "region-b-visible" },
    ]);
    expect(context.descriptionScopes?.map((scope) => scope.regionId)).toEqual([
      "region-a-visible",
      "region-b-visible",
    ]);
    expect(context.focusImages[0]?.visibleAnnotations[0]?.card).toBeNull();
    expect(JSON.stringify(context.descriptionScopes)).not.toContain(
      "两个范围使用同一种浅灰材质",
    );
  });

  it("在发起快照和桥接请求前拦截重点图片限额", () => {
    const smallPng = "data:image/png;base64,AAAA";
    const oversizedPng = "data:image/png;base64,AAAAAA==";
    const limits = { maxImages: 1, maxImageBytes: 3, maxTotalImageBytes: 5 } as const;

    expect(dataUrlDecodedByteLength(smallPng)).toBe(3);
    expect(getFocusedPublishPreflightError([
      { name: "一.png", dataUrl: smallPng },
      { name: "二.png", dataUrl: smallPng },
    ], limits)).toContain("最多发布 1 张");
    expect(getFocusedPublishPreflightError([
      { name: "过大.png", dataUrl: oversizedPng },
    ], limits)).toContain("超过单张");
    expect(getFocusedPublishPreflightError([
      { name: "一.png", dataUrl: smallPng },
      { name: "二.png", dataUrl: smallPng },
    ], { ...limits, maxImages: 2 })).toContain("原图合计");
    expect(getFocusedPublishPreflightError([
      { name: "一.png", dataUrl: smallPng },
    ], limits)).toBeNull();
  });

  it("拒绝空的重点集合", () => {
    expect(() =>
      buildFocusedCanvasContext({
        business: buildBusiness(),
        focusFolderId: ROOT_FOLDER_ID,
        focusImageIds: [],
        visibleRegionIds: [],
        visibleAnnotationRegionIds: [],
        overviewSnapshot: overview,
      }),
    ).toThrow("请先将一张或多张图片设为本次重点");
  });
});
