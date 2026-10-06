import { describe, expect, it } from "vitest";
import {
  EMPTY_CANVAS_SELECTION,
  createCanvasSelection,
  hasCanvasSelection,
  projectCanvasSelectionToNativeElementIds,
} from "./canvasSelection";

describe("CanvasSelection", () => {
  it("只保存稳定业务 ID，并对重复输入做确定性去重", () => {
    expect(
      createCanvasSelection({
        imagePlacementIds: ["placement-a", "placement-a"],
        regionIds: ["region-a"],
        descriptionIds: ["description-a", "description-a"],
      }),
    ).toEqual({
      imagePlacementIds: ["placement-a"],
      regionIds: ["region-a"],
      descriptionIds: ["description-a"],
    });
    expect(hasCanvasSelection(EMPTY_CANVAS_SELECTION)).toBe(false);
  });

  it("仅把受控选择单向投影为原生 selectedElementIds", () => {
    const nativeMirror = projectCanvasSelectionToNativeElementIds(
      createCanvasSelection({
        imagePlacementIds: ["placement-a", "inactive-placement"],
        regionIds: ["region-a"],
        descriptionIds: ["description-a"],
      }),
      [
        { id: "placement-a", elementId: "image-element-a", active: true },
        {
          id: "inactive-placement",
          elementId: "image-element-inactive",
          active: false,
        },
      ],
    );

    expect(nativeMirror).toEqual({
      "image-element-a": true,
    });
    expect(nativeMirror).not.toHaveProperty("region-a");
    expect(nativeMirror).not.toHaveProperty("description-a");
  });

  it("does not admit raw native elements into the business selection", () => {
    expect(createCanvasSelection({ nativeElementIds: ["free-a"] } as never)).toEqual(
      EMPTY_CANVAS_SELECTION,
    );
  });
});
