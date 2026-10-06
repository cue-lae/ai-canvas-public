import { describe, expect, it } from "vitest";
import {
  ANNOTATION_CARD_PLACEHOLDER,
  ANNOTATION_CARD_FONT_FAMILY,
  ANNOTATION_CARD_ROUNDNESS,
  BUBBLE_CARD_BACKGROUND_COLOR,
  BUBBLE_CARD_KIND,
  BUBBLE_LEGACY_REFERENCE_STYLE_VERSION,
  BUBBLE_LEADER_KIND,
  BUBBLE_LEADER_COLOR,
  BUBBLE_LEADER_STROKE_WIDTH,
  BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION,
  BUBBLE_REGION_RELEASE_DISTANCE,
  BUBBLE_REGION_SNAP_DISTANCE,
  BUBBLE_REFERENCE_STYLE_VERSION,
  BUBBLE_TARGET_DOT_COLOR,
  BUBBLE_TARGET_DOT_FILL,
  BUBBLE_TARGET_DOT_SIZE,
  BUBBLE_TEXT_DEFAULT_COLOR_KEY,
  BUBBLE_TEXT_COLOR,
  BUBBLE_TEXT_KIND,
  createBubbleCardBounds,
  createAnnotationCardLayout,
  createOrdinaryTextBoxBounds,
  getAnnotationCardGroupId,
  getAnnotationLeaderLayoutToPoint,
  getBubbleCardShadowBounds,
  getBubbleCardBoundsForText,
  getBubbleCardGroupId,
  getCurrentBubbleReadableTextColor,
  getLatestBubbleLeaderStyle,
  getBubbleReadableTextColor,
  getBubbleRegionSnapTarget,
  getReadableTextColor,
  getRegionRoundness,
  getAnnotationCardTextPosition,
  getAnnotationLeaderLayout,
  getAnnotationLeaderLayoutFromEdgeAnchors,
  getOrdinaryTextBoxGroupId,
  normalizeAnnotationCardGroupIds,
  normalizeBubbleCardBackgroundColor,
  ORDINARY_TEXT_BOX_KIND,
  resolveBubbleCardOutlineStyle,
  resolveBubbleTextColor,
  shouldRetireSerializedBubbleShadow,
  shouldTreatBubbleTargetDotAsManualMove,
} from "./annotationCard";

describe("画布标注卡", () => {
  const selection = { x: 100, y: 140, width: 180, height: 90 };

  it("把卡片放在选区侧边，并计算文字与引线锚点", () => {
    const layout = createAnnotationCardLayout(selection);

    expect(ANNOTATION_CARD_PLACEHOLDER).toBe("双击此处输入修改指令");
    expect(layout.card).toEqual({
      x: selection.x + selection.width + 44,
      y: selection.y,
      width: 276,
      height: 96,
    });
    expect(layout.textPosition).toEqual(getAnnotationCardTextPosition(layout.card));
    expect(getAnnotationLeaderLayout(selection, layout.card)).toEqual({
      x: 324,
      y: 185,
      points: [
        [0, 0],
        [-44, 0],
      ],
    });
  });

  it("限制卡片宽度，避免随着超大选区无限扩张", () => {
    expect(
      createAnnotationCardLayout({ x: 0, y: 0, width: 900, height: 100 }).card
        .width,
    ).toBe(360);
  });

  it("把引线接到选区边缘，而不是选区中心", () => {
    expect(
      getAnnotationLeaderLayout(
        { x: 100, y: 100, width: 100, height: 100 },
        { x: 70, y: 260, width: 160, height: 96 },
      ),
    ).toEqual({
      x: 150,
      y: 260,
      points: [
        [0, 0],
        [0, -60],
      ],
    });
  });

  it("保持手动引线已选择的卡片和选区边缘锚点", () => {
    expect(
      getAnnotationLeaderLayoutFromEdgeAnchors(
        { x: 100, y: 100, width: 100, height: 100 },
        { x: 300, y: 250, width: 200, height: 100 },
        { edge: "left", offset: 0.5 },
        { edge: "right", offset: 0.5 },
      ),
    ).toEqual({
      x: 300,
      y: 300,
      points: [
        [0, 0],
        [-100, -150],
      ],
    });
  });

  it("定义无衬线小圆角标注卡样式", () => {
    expect(ANNOTATION_CARD_FONT_FAMILY).toBe(2);
    expect(ANNOTATION_CARD_ROUNDNESS).toEqual({ type: 3 });
  });

  it("让卡片文字在缩放后的框内保持居中", () => {
    expect(
      getAnnotationCardTextPosition(
        { x: 60, y: 120, width: 240, height: 80 },
        { width: 96, height: 24 },
      ),
    ).toEqual({ x: 132, y: 148 });
  });

  it("根据实心背景自动选择可读文字颜色", () => {
    expect(getReadableTextColor("#ffffff")).toBe("#172554");
    expect(getReadableTextColor("#172554")).toBe("#f8fafc");
  });

  it("为批注气泡保留框与文字成组、引线独立的语义", () => {
    const bubbleId = "bubble-1";
    const groupId = getBubbleCardGroupId(bubbleId);

    expect(groupId).toBe("bubble-card:bubble-1");
    expect(BUBBLE_CARD_KIND).toBe("bubble-card");
    expect(BUBBLE_TEXT_KIND).toBe("bubble-text");
    expect(BUBBLE_LEADER_KIND).toBe("bubble-leader");
    expect(createBubbleCardBounds({ x: 100, y: 80 })).toEqual({
      x: 130,
      y: 54,
      width: 224,
      height: 56,
    });
  });

  it("将批注气泡固定为 B 的柔和填充、灰白引线与可见小圆点", () => {
    const softYellow = normalizeBubbleCardBackgroundColor("#ffd43b");
    const mutedDarkBlue = normalizeBubbleCardBackgroundColor("#172554");

    expect(BUBBLE_REFERENCE_STYLE_VERSION).toBe("editorial-b3");
    expect(BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION).toBe("editorial-b2");
    expect(BUBBLE_CARD_BACKGROUND_COLOR).toBe("#ebfbee");
    expect(softYellow).not.toBe("#ffd43b");
    expect(getBubbleReadableTextColor(softYellow)).toBe("#334155");
    expect(mutedDarkBlue).not.toBe("#172554");
    expect(getBubbleReadableTextColor(mutedDarkBlue)).toBe("#f8fafc");
    expect(getCurrentBubbleReadableTextColor(BUBBLE_CARD_BACKGROUND_COLOR)).toBe(
      BUBBLE_TEXT_COLOR,
    );
    expect(BUBBLE_LEADER_COLOR).toBe("#9aa2ad");
    expect(BUBBLE_LEADER_STROKE_WIDTH).toBe(4);
    expect(getLatestBubbleLeaderStyle("#dbe6e0", 8)).toEqual({
      strokeColor: "#dbe6e0",
      strokeWidth: 8,
    });
    expect(BUBBLE_TARGET_DOT_COLOR).toBe("#9aa2ad");
    expect(BUBBLE_TARGET_DOT_FILL).toBe("#fffdf8");
    expect(BUBBLE_TARGET_DOT_SIZE).toBe(6);
    expect(
      getBubbleCardShadowBounds({ x: 100, y: 80, width: 192, height: 68 }),
    ).toMatchObject({ x: 102, y: 82, width: 192, height: 68 });
  });

  it("保留 B2 默认无描边与用户选择描边的持久化判定", () => {
    expect(
      resolveBubbleCardOutlineStyle({
        backgroundColor: "#ffd43b",
        strokeColor: BUBBLE_CARD_BACKGROUND_COLOR,
        defaultOutlineColor: BUBBLE_CARD_BACKGROUND_COLOR,
        outlineMode: "none",
      }),
    ).toEqual({
      backgroundColor: normalizeBubbleCardBackgroundColor("#ffd43b"),
      strokeColor: normalizeBubbleCardBackgroundColor("#ffd43b"),
      outlineMode: "none",
    });
    expect(
      resolveBubbleCardOutlineStyle({
        backgroundColor: "#ffd43b",
        strokeColor: "#be123c",
        defaultOutlineColor: BUBBLE_CARD_BACKGROUND_COLOR,
        outlineMode: "custom",
      }),
    ).toEqual({
      backgroundColor: normalizeBubbleCardBackgroundColor("#ffd43b"),
      strokeColor: "#be123c",
      outlineMode: "custom",
    });
  });

  it("将新气泡缩小一档，同时让文本色独立于描边色", () => {
    expect(createBubbleCardBounds({ x: 100, y: 80 })).toEqual({
      x: 130,
      y: 54,
      width: 224,
      height: 56,
    });
    const outline = resolveBubbleCardOutlineStyle({
      backgroundColor: "#dbe6e0",
      strokeColor: "transparent",
      defaultOutlineColor: BUBBLE_CARD_BACKGROUND_COLOR,
      outlineMode: "custom",
    });
    const text = resolveBubbleTextColor({
      backgroundColor: outline.backgroundColor,
      strokeColor: BUBBLE_TEXT_COLOR,
      defaultColor: BUBBLE_TEXT_COLOR,
      getDefaultColor: getCurrentBubbleReadableTextColor,
    });

    expect(outline).toEqual({
      backgroundColor: "#dbe6e0",
      strokeColor: "transparent",
      outlineMode: "custom",
    });
    expect(text).toEqual({
      strokeColor: BUBBLE_TEXT_COLOR,
      defaultColor: BUBBLE_TEXT_COLOR,
    });
  });

  it("彩色填充只有单一不透底的圆角表面，描边不会带走深灰文字", () => {
    const card = resolveBubbleCardOutlineStyle({
      backgroundColor: "#b7e8bf",
      strokeColor: BUBBLE_CARD_BACKGROUND_COLOR,
      defaultOutlineColor: BUBBLE_CARD_BACKGROUND_COLOR,
      outlineMode: "none",
    });
    const text = resolveBubbleTextColor({
      backgroundColor: card.backgroundColor,
      strokeColor: "#ffffff",
      defaultColor: BUBBLE_TEXT_COLOR,
      getDefaultColor: getCurrentBubbleReadableTextColor,
      forceDefaultColor: true,
    });

    expect(card.strokeColor).toBe(card.backgroundColor);
    expect(card.strokeColor).not.toBe("#ffffff");
    expect(text.strokeColor).toBe(BUBBLE_TEXT_COLOR);
  });

  it("保持细长气泡的默认高度，并仅在文字换行后向下增长", () => {
    const card = createBubbleCardBounds({ x: 100, y: 80 });
    expect(getBubbleCardBoundsForText(card, { height: 24 })).toEqual(card);
    expect(getBubbleCardBoundsForText(card, { height: 72 })).toEqual({
      ...card,
      height: 96,
    });
  });


  it("把旋转矩形选区的引线接到旋转后的真实边界", () => {
    const selection = {
      x: 100,
      y: 100,
      width: 100,
      height: 40,
      angle: Math.PI / 2,
    };
    const layout = getAnnotationLeaderLayout(selection, {
      x: 300,
      y: 80,
      width: 160,
      height: 80,
    });
    const target = {
      x: layout.x + layout.points[1][0],
      y: layout.y + layout.points[1][1],
    };

    expect(target.x).toBeCloseTo(170);
    expect(target.y).toBeCloseTo(120);
  });

  it("以卡片边缘作为批注气泡细引线的起点", () => {
    expect(
      getAnnotationLeaderLayoutToPoint(
        { x: 100, y: 140 },
        { x: 160, y: 100, width: 220, height: 76 },
      ),
    ).toEqual({
      x: 160,
      y: 140,
      points: [[0, 0], [-60, 0]],
    });
  });

  it("只将标注框外壳和框内文字放入稳定关联组，引线保持独立", () => {
    const annotationId = "annotation-linked";
    const groupId = getAnnotationCardGroupId(annotationId);

    expect(groupId).toBe("annotation-card:annotation-linked");
    expect(
      normalizeAnnotationCardGroupIds({
        kind: "annotation-card",
        annotationId,
        groupIds: [],
      }),
    ).toEqual([groupId]);
    expect(
      normalizeAnnotationCardGroupIds({
        kind: "annotation",
        annotationId,
        groupIds: [],
      }),
    ).toEqual([groupId]);
    expect(
      normalizeAnnotationCardGroupIds({
        kind: "annotation-leader",
        annotationId,
        groupIds: [groupId, "manual-group"],
      }),
    ).toEqual(["manual-group"]);
  });

  it("把普通文字包装为非结构化、可保存的文字框", () => {
    const textId = "ordinary-text-1";
    const groupId = getOrdinaryTextBoxGroupId(textId);
    const bounds = createOrdinaryTextBoxBounds({
      x: 160,
      y: 220,
      width: 180,
      height: 24,
    });

    expect(ORDINARY_TEXT_BOX_KIND).toBe("ordinary-text-box");
    expect(groupId).toBe("ordinary-text-box:ordinary-text-1");
    expect(
      normalizeAnnotationCardGroupIds({
        kind: ORDINARY_TEXT_BOX_KIND,
        annotationId: undefined,
        groupIds: [groupId],
      }),
    ).toEqual([groupId]);
    expect(bounds).toEqual({
      x: 148,
      y: 208,
      width: 204,
      height: 48,
    });
    expect(
      JSON.parse(
        JSON.stringify({
          kind: ORDINARY_TEXT_BOX_KIND,
          textId,
          groupIds: [groupId],
          bounds,
        }),
      ),
    ).toEqual({
      kind: ORDINARY_TEXT_BOX_KIND,
      textId,
      groupIds: [groupId],
      bounds,
    });
  });

  it("矩形选区默认直角，圆角只在明确选择时写入", () => {
    expect(getRegionRoundness()).toBeNull();
    expect(getRegionRoundness("round")).toEqual({ type: 3 });
  });

  it("将气泡端点吸附到最近矩形选区的真实边缘，并保留旋转信息", () => {
    const snapped = getBubbleRegionSnapTarget(
      [
        {
          regionId: "rotated-region",
          bounds: {
            x: 100,
            y: 100,
            width: 100,
            height: 40,
            angle: Math.PI / 2,
          },
        },
        {
          regionId: "far-region",
          bounds: { x: 300, y: 100, width: 80, height: 80 },
        },
      ],
      { x: 184, y: 120 },
    );

    expect(snapped).toMatchObject({
      regionId: "rotated-region",
      anchor: { edge: "top", offset: 0.5 },
    });
    expect(snapped?.target.x).toBeCloseTo(170);
    expect(snapped?.target.y).toBeCloseTo(120);
  });

  it("以较大的拖离阈值保持绑定，越过阈值后返回固定目标", () => {
    const candidates = [
      {
        regionId: "region-a",
        bounds: { x: 100, y: 100, width: 100, height: 100 },
      },
    ];

    expect(BUBBLE_REGION_SNAP_DISTANCE).toBeLessThan(
      BUBBLE_REGION_RELEASE_DISTANCE,
    );
    expect(
      getBubbleRegionSnapTarget(candidates, { x: 216, y: 150 }),
    ).toMatchObject({ regionId: "region-a" });
    expect(
      getBubbleRegionSnapTarget(candidates, { x: 226, y: 150 }, "region-a"),
    ).toMatchObject({ regionId: "region-a" });
    expect(
      getBubbleRegionSnapTarget(candidates, { x: 232, y: 150 }, "region-a"),
    ).toBeNull();
  });

  it("保留用户已选择的低饱和气泡背景色", () => {
    expect(normalizeBubbleCardBackgroundColor("#dbe6e0")).toBe("#dbe6e0");
  });

  it("只更新未修改的默认文字色，不覆盖用户选择的低饱和颜色", () => {
    expect(BUBBLE_TEXT_DEFAULT_COLOR_KEY).toBe("bubbleTextDefaultColor");
    expect(
      resolveBubbleTextColor({
        backgroundColor: BUBBLE_CARD_BACKGROUND_COLOR,
        strokeColor: "#334155",
        defaultColor: "#334155",
      }),
    ).toEqual({ strokeColor: "#334155", defaultColor: "#334155" });
    expect(
      resolveBubbleTextColor({
        backgroundColor: BUBBLE_CARD_BACKGROUND_COLOR,
        strokeColor: "#94a3b8",
        defaultColor: "#334155",
      }),
    ).toEqual({ strokeColor: "#94a3b8", defaultColor: "#334155" });
    expect(
      resolveBubbleTextColor({
        backgroundColor: BUBBLE_CARD_BACKGROUND_COLOR,
        strokeColor: "#be123c",
        defaultColor: BUBBLE_TEXT_COLOR,
        getDefaultColor: getCurrentBubbleReadableTextColor,
        forceDefaultColor: true,
      }),
    ).toEqual({
      strokeColor: BUBBLE_TEXT_COLOR,
      defaultColor: BUBBLE_TEXT_COLOR,
    });
  });

  it("只让 B3 淘汰旧的序列化阴影，保持 B/B2 存档兼容", () => {
    expect(shouldRetireSerializedBubbleShadow(BUBBLE_REFERENCE_STYLE_VERSION)).toBe(
      true,
    );
    expect(
      shouldRetireSerializedBubbleShadow(BUBBLE_PREVIOUS_REFERENCE_STYLE_VERSION),
    ).toBe(false);
    expect(
      shouldRetireSerializedBubbleShadow(BUBBLE_LEGACY_REFERENCE_STYLE_VERSION),
    ).toBe(false);
  });

  it("卡片移动连带选中端点时，不把它误判为拖动端点", () => {
    expect(
      shouldTreatBubbleTargetDotAsManualMove({
        dotSelected: true,
        cardSelected: true,
        textSelected: true,
      }),
    ).toBe(false);
    expect(
      shouldTreatBubbleTargetDotAsManualMove({
        dotSelected: true,
        cardSelected: false,
        textSelected: false,
      }),
    ).toBe(true);
  });
});
