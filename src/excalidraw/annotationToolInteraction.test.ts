import { describe, expect, it } from "vitest";
import {
  createRectangleSelectionPreviewStyle,
  isExplicitToolSessionElement,
  snapManualAnnotationArrow,
} from "./annotationToolInteraction";

describe("V5 标注工具交互", () => {
  it("矩形选区拖取预览始终是透明的选区本身，不继承气泡卡样式", () => {
    expect(createRectangleSelectionPreviewStyle("sharp")).toEqual({
      currentItemStrokeColor: "#0f766e",
      currentItemBackgroundColor: "transparent",
      currentItemFillStyle: "solid",
      currentItemStrokeWidth: 2,
      currentItemStrokeStyle: "solid",
      currentItemRoughness: 0,
      currentItemRoundness: "sharp",
    });
    expect(createRectangleSelectionPreviewStyle("round")).toMatchObject({
      currentItemBackgroundColor: "transparent",
      currentItemRoundness: "round",
    });
  });

  it("只接管显式模式开始后新增的目标元素", () => {
    const baseline = new Set(["existing-text", "existing-arrow"]);

    expect(
      isExplicitToolSessionElement(
        { id: "existing-text", type: "text" },
        "text",
        baseline,
      ),
    ).toBe(false);
    expect(
      isExplicitToolSessionElement(
        { id: "new-text", type: "text" },
        "text",
        baseline,
      ),
    ).toBe(true);
    expect(
      isExplicitToolSessionElement(
        { id: "new-arrow", type: "arrow" },
        "text",
        baseline,
      ),
    ).toBe(false);
  });

  it("把手动引线两端吸附到文字框和选区边缘，并让箭头指向选区", () => {
    const snapped = snapManualAnnotationArrow({
      arrow: {
        x: 301,
        y: 150,
        points: [
          [0, 0],
          [-102, 0],
        ],
      },
      card: { x: 300, y: 100, width: 200, height: 100 },
      selection: { x: 100, y: 100, width: 100, height: 100 },
    });

    expect(snapped).toEqual({
      x: 300,
      y: 150,
      points: [
        [0, 0],
        [-100, 0],
      ],
      anchors: {
        card: { edge: "left", offset: 0.5 },
        selection: { edge: "right", offset: 0.5 },
      },
    });
  });

  it("不会把远离文字框或选区的普通箭头升级为手动标注", () => {
    expect(
      snapManualAnnotationArrow({
        arrow: {
          x: 700,
          y: 700,
          points: [
            [0, 0],
            [100, 0],
          ],
        },
        card: { x: 300, y: 100, width: 200, height: 100 },
        selection: { x: 100, y: 100, width: 100, height: 100 },
      }),
    ).toBeNull();
  });
});
