import { describe, expect, it } from "vitest";
import { GlobalHistoryTimeline } from "../domain/globalHistoryTimeline";
import { createEmptyBusinessState, ROOT_FOLDER_ID } from "../domain/types";
import {
  createQuickAnnotation,
  resizeQuickAnnotation,
  resizeQuickAnnotationBounds,
  deleteQuickAnnotation,
  normalizeQuickAnnotationText,
  setQuickAnnotationCollapsed,
  setQuickAnnotationLabelAnchor,
  setQuickAnnotationText,
  translateQuickAnnotation,
} from "./quickAnnotations";

const stateWithImage = () => {
  const state = createEmptyBusinessState("quick-annotation-test");
  state.document.imageAssetIds = ["image-a"];
  state.folders[ROOT_FOLDER_ID].imageAssetIds = ["image-a"];
  state.imageAssets["image-a"] = {
    id: "image-a",
    fileId: "file-a",
    name: "reference.png",
    mimeType: "image/png",
    naturalWidth: 1000,
    naturalHeight: 800,
    source: "local",
    createdAt: "2026-09-19T00:00:00.000Z",
    folderId: ROOT_FOLDER_ID,
  };
  return state;
};

describe("quick annotation business foundation", () => {
  it("resizes all four corners proportionally around the opposite corner", () => {
    const bounds = { x: 0.3, y: 0.3, width: 0.2, height: 0.1 };
    for (const corner of [0, 1, 2, 3]) {
      const right = corner === 1 || corner === 2;
      const bottom = corner === 2 || corner === 3;
      const next = resizeQuickAnnotationBounds(bounds, corner, { x: right ? 0.1 : -0.1, y: bottom ? 0.05 : -0.05 }, true);
      expect(next.width / next.height).toBeCloseTo(2);
      expect(next.width).toBeCloseTo(0.3);
      expect(next.x + (right ? 0 : next.width)).toBeCloseTo(bounds.x + (right ? 0 : bounds.width));
      expect(next.y + (bottom ? 0 : next.height)).toBeCloseTo(bounds.y + (bottom ? 0 : bounds.height));
    }
  });

  it("supports free resizing and limits growth and shrinkage to the image", () => {
    const bounds = { x: 0.3, y: 0.3, width: 0.2, height: 0.1 };
    const free = resizeQuickAnnotationBounds(bounds, 2, { x: 0.1, y: 0.2 }, false);
    expect(free.width).toBeCloseTo(0.3); expect(free.height).toBeCloseTo(0.3);
    const large = resizeQuickAnnotationBounds(bounds, 2, { x: 3, y: 3 }, true);
    expect(large.x + large.width).toBeLessThanOrEqual(1);
    expect(large.y + large.height).toBeLessThanOrEqual(1);
    expect(large.width / large.height).toBeCloseTo(2);
    const small = resizeQuickAnnotationBounds(bounds, 2, { x: -3, y: -3 }, false, { x: 0.01, y: 0.01 });
    expect(small.width).toBe(0.01); expect(small.height).toBe(0.01);
  });

  it("keeps the anchored corner and label placement when resizing the range", () => {
    const state = createQuickAnnotation(stateWithImage(), { id: "resize", imageId: "image-a", mode: "rectangle",
      anchor: { x: 0.5, y: 0.4 }, rectangle: { x: 0.3, y: 0.3, width: 0.2, height: 0.1 },
      labelAnchor: { x: 0.8, y: 0.1 }, labelSide: "right", text: "缩放" });
    const result = resizeQuickAnnotation(state, "resize", { x: 0.3, y: 0.3, width: 0.4, height: 0.2 });
    expect(result.quickAnnotations.resize.anchor).toEqual({ x: 0.7, y: 0.5 });
    expect(result.quickAnnotations.resize.labelAnchor).toEqual({ x: 0.8, y: 0.1 });
    expect(result.quickAnnotations.resize.labelSide).toBe("right");
  });
  it("creates stable document-wide point and rectangle ordinals", () => {
    const point = createQuickAnnotation(stateWithImage(), {
      id: "quick-a",
      imageId: "image-a",
      mode: "point",
      anchor: { x: 0.25, y: 0.4 },
      text: "  保留窗框  ",
      now: "2026-09-19T00:01:00.000Z",
    });
    const rectangle = createQuickAnnotation(point, {
      id: "quick-b",
      imageId: "image-a",
      mode: "rectangle",
      anchor: { x: 0.1, y: 0.2 },
      rectangle: { x: 0.1, y: 0.2, width: 0.35, height: 0.25 },
      text: "参考这个比例",
      now: "2026-09-19T00:02:00.000Z",
    });

    expect(rectangle.quickAnnotations["quick-a"]).toMatchObject({
      ordinal: 1,
      mode: "point",
      text: "保留窗框",
      anchor: { x: 0.25, y: 0.4 },
      collapsed: false,
    });
    expect(rectangle.quickAnnotations["quick-b"]).toMatchObject({
      ordinal: 2,
      mode: "rectangle",
      anchor: { x: 0.1, y: 0.2 },
      rectangle: { x: 0.1, y: 0.2, width: 0.35, height: 0.25 },
    });
    expect(rectangle.document.quickAnnotationIds).toEqual(["quick-a", "quick-b"]);
    expect(rectangle.document.nextQuickAnnotationOrdinal).toBe(3);

    const deleted = deleteQuickAnnotation(rectangle, "quick-b");
    const afterGap = createQuickAnnotation(deleted, {
      id: "quick-c",
      imageId: "image-a",
      mode: "point",
      anchor: { x: 0.5, y: 0.5 },
      text: "不回收 Q2",
    });
    expect(afterGap.quickAnnotations["quick-c"].ordinal).toBe(3);
  });

  it("enforces non-empty 100-character text and normalized geometry", () => {
    expect(() => normalizeQuickAnnotationText("   ")).toThrow("不能为空");
    expect(() => normalizeQuickAnnotationText("字".repeat(101))).toThrow("100");
    expect(normalizeQuickAnnotationText("🙂".repeat(100))).toHaveLength(200);
    expect(() =>
      createQuickAnnotation(stateWithImage(), {
        id: "quick-invalid",
        imageId: "image-a",
        mode: "rectangle",
        anchor: { x: 0.8, y: 0.2 },
        rectangle: { x: 0.8, y: 0.2, width: 0.3, height: 0.2 },
        text: "越界",
      }),
    ).toThrow("完整位于");
  });

  it("edits, collapses and translates annotations without leaving the image", () => {
    const created = createQuickAnnotation(stateWithImage(), {
      id: "quick-a",
      imageId: "image-a",
      mode: "rectangle",
      anchor: { x: 0.7, y: 0.75 },
      rectangle: { x: 0.7, y: 0.75, width: 0.2, height: 0.2 },
      text: "原文",
    });
    const edited = setQuickAnnotationText(created, "quick-a", "新文本");
    const collapsed = setQuickAnnotationCollapsed(edited, "quick-a", true);
    const moved = translateQuickAnnotation(collapsed, "quick-a", {
      x: 0.4,
      y: 0.4,
    });
    expect(moved.quickAnnotations["quick-a"]).toMatchObject({
      text: "新文本",
      collapsed: true,
      anchor: { x: 0.8, y: 0.8 },
      rectangle: { x: 0.8, y: 0.8, width: 0.2, height: 0.2 },
    });
  });

  it("moves the label independently and keeps its position when the annotation moves", () => {
    const created = createQuickAnnotation(stateWithImage(), {
      id: "quick-label",
      imageId: "image-a",
      mode: "rectangle",
      anchor: { x: 0.25, y: 0.25 },
      rectangle: { x: 0.25, y: 0.25, width: 0.2, height: 0.2 },
      text: "标签可调整",
    });
    const labelMoved = setQuickAnnotationLabelAnchor(
      created,
      "quick-label",
      { x: 1.2, y: -0.1 },
    );
    expect(labelMoved.quickAnnotations["quick-label"]).toMatchObject({
      anchor: { x: 0.25, y: 0.25 },
      rectangle: { x: 0.25, y: 0.25, width: 0.2, height: 0.2 },
      labelAnchor: { x: 1.2, y: -0.1 },
    });
    const groupMoved = translateQuickAnnotation(labelMoved, "quick-label", { x: 0.1, y: 0.1 });
    expect(groupMoved.quickAnnotations["quick-label"].anchor).toEqual({ x: 0.35, y: 0.35 });
    expect(groupMoved.quickAnnotations["quick-label"].labelAnchor).toEqual({ x: 1.2, y: -0.1 });
  });

  it("keeps the stored label position and side when a point anchor crosses it", () => {
    const created = createQuickAnnotation(stateWithImage(), {
      id: "quick-point", imageId: "image-a", mode: "point",
      anchor: { x: 0.2, y: 0.3 }, labelAnchor: { x: 0.4, y: 0.1 }, labelSide: "right", text: "独立移动",
    });
    const moved = translateQuickAnnotation(created, "quick-point", { x: 0.5, y: 0.1 });
    expect(moved.quickAnnotations["quick-point"]).toMatchObject({
      anchor: { x: 0.7, y: 0.4 }, labelAnchor: { x: 0.4, y: 0.1 }, labelSide: "right",
    });
  });

  it("keeps the press hotspot at any rectangle corner through movement", () => {
    const rectangle = { x: 0.25, y: 0.25, width: 0.25, height: 0.25 };
    const corners = [
      { x: 0.25, y: 0.25 },
      { x: 0.5, y: 0.25 },
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    for (const [index, anchor] of corners.entries()) {
      const created = createQuickAnnotation(stateWithImage(), {
        id: `quick-corner-${index}`,
        imageId: "image-a",
        mode: "rectangle",
        anchor,
        rectangle,
        text: "同一按下热点",
      });
      expect(created.quickAnnotations[`quick-corner-${index}`].anchor).toEqual(anchor);
      const moved = translateQuickAnnotation(
        created,
        `quick-corner-${index}`,
        { x: 0.5, y: 0.5 },
      );
      expect(moved.quickAnnotations[`quick-corner-${index}`].anchor).toEqual({
        x: anchor.x + 0.5,
        y: anchor.y + 0.5,
      });
    }
    expect(() =>
      createQuickAnnotation(stateWithImage(), {
        id: "quick-interior",
        imageId: "image-a",
        mode: "rectangle",
        anchor: { x: 0.375, y: 0.375 },
        rectangle,
        text: "不允许偏离按下角",
      }),
    ).toThrow("必须位于按下时对应的矩形角");
  });

  it("replays each pure quick-annotation action as one global history transaction", () => {
    const initial = stateWithImage();
    const timeline = new GlobalHistoryTimeline(
      (value: typeof initial) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    timeline.synchronize(initial);
    const created = createQuickAnnotation(initial, {
      id: "quick-a",
      imageId: "image-a",
      mode: "point",
      anchor: { x: 0.2, y: 0.3 },
      text: "初始",
    });
    timeline.commit({ after: created, source: "host", operation: "quick-create" });
    const edited = setQuickAnnotationText(created, "quick-a", "编辑");
    timeline.commit({ after: edited, source: "host", operation: "quick-edit" });
    const collapsed = setQuickAnnotationCollapsed(edited, "quick-a", true);
    timeline.commit({ after: collapsed, source: "host", operation: "quick-collapse" });
    const moved = translateQuickAnnotation(collapsed, "quick-a", { x: 0.1, y: 0.1 });
    timeline.commit({ after: moved, source: "host", operation: "quick-move" });
    const deleted = deleteQuickAnnotation(moved, "quick-a");
    timeline.commit({ after: deleted, source: "host", operation: "quick-delete" });

    expect(timeline.entries).toHaveLength(5);
    timeline.undo((restored) => {
      expect(restored.quickAnnotations["quick-a"]).toBeDefined();
    });
    timeline.redo((restored) => {
      expect(restored.quickAnnotations["quick-a"]).toBeUndefined();
    });
  });
});
