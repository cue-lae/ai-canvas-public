import { describe, expect, it } from "vitest";
import { createCanvasSessionResetState } from "./canvasSessionReset";
import { DEFAULT_CANVAS_THEME_ID } from "./canvasThemeContract";

describe("完整重置 Canvas 会话", () => {
  it("清空业务对象、重点、说明焦点与当前选择", () => {
    const reset = createCanvasSessionResetState();

    expect(reset.business.document.imageAssetIds).toEqual([]);
    expect(reset.business.document.regionIds).toEqual([]);
    expect(reset.business.document.descriptionIds).toEqual([]);
    expect(reset.business.document.descriptionReferenceIds).toEqual([]);
    expect(reset.business.document.descriptionScopeLinkIds).toEqual([]);
    expect(reset.business.imageAssets).toEqual({});
    expect(reset.business.regions).toEqual({});
    expect(reset.business.descriptions).toEqual({});
    expect(reset.business.descriptionReferences).toEqual({});
    expect(reset.business.descriptionScopeLinks).toEqual({});
    expect(reset.focusImageIds).toEqual([]);
    expect(reset.selectedImageId).toBeNull();
    expect(reset.selectedRegionId).toBeNull();
    expect(reset.activeDescriptionId).toBeNull();
    expect(reset.codexContext).toBeNull();
    expect(DEFAULT_CANVAS_THEME_ID).toBe("white");
    expect(reset.canvasTheme).toBe(DEFAULT_CANVAS_THEME_ID);
  });
});
