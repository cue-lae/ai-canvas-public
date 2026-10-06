import { describe, expect, it } from "vitest";
import {
  classifyCanvasPointerIntent,
  shouldDismissCanvasMenuOnPointerDown,
  shouldPromoteMarquee,
} from "./canvasPointerArbitration";

describe("Canvas 指针仲裁", () => {
  it("图片命中只交给原生；只有真正空白画布可启动宿主 marquee", () => {
    expect(
      classifyCanvasPointerIntent({
        activeToolType: "selection",
        hitElement: { type: "image" },
      }),
    ).toBe("native-image");
    expect(
      classifyCanvasPointerIntent({
        activeToolType: "selection",
        hitElement: { type: "freedraw" },
      }),
    ).toBe("native-element");
    expect(
      classifyCanvasPointerIntent({
        activeToolType: "selection",
        hitElement: null,
      }),
    ).toBe("host-marquee");
    expect(
      classifyCanvasPointerIntent({
        activeToolType: "hand",
        hitElement: null,
      }),
    ).toBe("none");
  });

  it("image transform handles with no hit element stay on the native path", () => {
    expect(
      classifyCanvasPointerIntent({
        activeToolType: "selection",
        hitElement: null,
        resize: { handleType: "se", isResizing: true },
        hasControlledImageSelection: true,
      }),
    ).toBe("native-image");
    expect(
      classifyCanvasPointerIntent({
        activeToolType: "selection",
        hitElement: null,
        resize: { isResizing: true },
        hasControlledImageSelection: true,
      }),
    ).toBe("native-image");
  });

  it("未越过阈值不把普通点击误判为 marquee；菜单只由外部按下收起", () => {
    expect(
      shouldPromoteMarquee({
        start: { x: 100, y: 100 },
        current: { x: 103, y: 104 },
      }),
    ).toBe(false);
    expect(
      shouldPromoteMarquee({
        start: { x: 100, y: 100 },
        current: { x: 107, y: 100 },
      }),
    ).toBe(true);
    expect(shouldDismissCanvasMenuOnPointerDown({ insideMenu: true })).toBe(false);
    expect(shouldDismissCanvasMenuOnPointerDown({ insideMenu: false })).toBe(true);
  });
});
