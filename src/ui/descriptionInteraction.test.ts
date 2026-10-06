import { describe, expect, it } from "vitest";
import {
  anchorGestureOpensDescription,
  descriptionAnchorGestureFinish,
  descriptionAnchorAfterPointerMove,
  isDescriptionAnchorDrag,
  reduceDescriptionAnchorGesture,
  shouldCollapseDescriptionFrame,
} from "./descriptionInteraction";

describe("说明锚点与 Canvas Delete 交互", () => {
  it("区分普通 click 与超过阈值的真实 drag", () => {
    expect(
      isDescriptionAnchorDrag({ x: 100, y: 100 }, { x: 102, y: 102 }),
    ).toBe(false);
    expect(
      isDescriptionAnchorDrag({ x: 100, y: 100 }, { x: 120, y: 108 }),
    ).toBe(true);
  });

  it("按住后连续移动会按场景坐标差更新锚点", () => {
    expect(
      descriptionAnchorAfterPointerMove({
        anchorStart: { x: 30, y: 40 },
        pointerStart: { x: 100, y: 120 },
        pointerCurrent: { x: 145, y: 170 },
      }),
    ).toEqual({ x: 75, y: 90 });
  });

  it("普通点击展开说明，真实拖动保持原收起状态", () => {
    expect(anchorGestureOpensDescription({ dragged: false })).toBe(true);
    expect(anchorGestureOpensDescription({ dragged: true })).toBe(false);
  });

  it("总览缩放自动收起非编辑说明，但不收起正在编辑的正文", () => {
    expect(
      shouldCollapseDescriptionFrame({
        persistedCollapsed: false,
        zoom: 0.54,
        editorFocused: false,
      }),
    ).toBe(true);
    expect(
      shouldCollapseDescriptionFrame({
        persistedCollapsed: false,
        zoom: 0.54,
        editorFocused: true,
      }),
    ).toBe(false);
    expect(
      shouldCollapseDescriptionFrame({
        persistedCollapsed: false,
        zoom: 0.8,
        editorFocused: false,
      }),
    ).toBe(false);
    expect(
      shouldCollapseDescriptionFrame({
        persistedCollapsed: true,
        zoom: 1,
        editorFocused: true,
      }),
    ).toBe(true);
  });

  it("keeps a captured pointer session deterministic across click, drag, and cancel", () => {
    const start = { x: 100, y: 100 };
    const smallMove = reduceDescriptionAnchorGesture(
      { dragging: false },
      {
        type: "move",
        start,
        current: { x: 102, y: 103 },
      },
    );
    expect(smallMove).toEqual({ dragging: false });

    const drag = reduceDescriptionAnchorGesture(smallMove, {
      type: "move",
      start,
      current: { x: 106, y: 100 },
    });
    expect(drag).toEqual({ dragging: true });
    expect(
      reduceDescriptionAnchorGesture(drag, {
        type: "move",
        start,
        current: { x: 101, y: 101 },
      }),
    ).toEqual({ dragging: true });
    expect(descriptionAnchorGestureFinish({ dragging: true, cancelled: false }))
      .toEqual({ commitMove: true, suppressClick: true });
    expect(descriptionAnchorGestureFinish({ dragging: true, cancelled: true }))
      .toEqual({ commitMove: false, suppressClick: true });
    expect(reduceDescriptionAnchorGesture(drag, { type: "cancel" })).toEqual({
      dragging: false,
    });
  });
});
