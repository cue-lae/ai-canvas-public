import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";
import { transitionCanvasMenuOpen } from "./canvasMenuState";
import {
  EMPTY_CANVAS_SELECTION,
  createCanvasSelection,
} from "./canvasSelection";

const runtimeSource = readFileSync(
  new URL("./canvasInteractionRuntime.ts", import.meta.url),
  "utf8",
);

describe("canvas interaction runtime boundary", () => {
  it("keeps M2 selection and menu state semantics in their existing pure ports", () => {
    expect(createCanvasSelection({ regionIds: ["region-a", "region-a"] })).toEqual({
      imagePlacementIds: [],
      regionIds: ["region-a"],
      descriptionIds: [],
    });
    expect(EMPTY_CANVAS_SELECTION).toEqual({
      imagePlacementIds: [],
      regionIds: [],
      descriptionIds: [],
    });
    expect(transitionCanvasMenuOpen(true, "save-project")).toBe(true);
    expect(transitionCanvasMenuOpen(true, "outside-pointerdown")).toBe(false);
  });

  it("does not import protected theme, project, publish, or bridge modules", () => {
    [
      "canvasThemeContract",
      "workbenchPreferences",
      "projectFile",
      "canvasSessionReset",
      "focusedPublish",
      "codexContext",
      "canvasContextBridge",
      "canvasWorkspaceContract",
    ].forEach((forbidden) => expect(runtimeSource).not.toContain(forbidden));
    expect(runtimeSource).toContain("GlobalHistoryTimeline");
    expect(runtimeSource).toContain("CanvasSelection");
    expect(runtimeSource).toContain("NativeGestureHistoryBarrier");
  });
});
