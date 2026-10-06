import { describe, expect, it } from "vitest";
import {
  createCanvasMenuActionHandler,
  type CanvasMenuAction,
} from "./canvasMenuState";

describe("Canvas menu state transitions", () => {
  it("keeps completed non-tool menu actions open and closes only explicit canvas transitions", () => {
    let menuOpen = true;
    const handleCanvasMenuAction = createCanvasMenuActionHandler((updater) => {
      menuOpen = updater(menuOpen);
    });

    const retainedActions: readonly CanvasMenuAction[] = [
      "save-project",
      "export-image",
      "overview",
      "help",
      "reset",
      "project-read-pending",
    ];

    retainedActions.forEach((action) => {
      handleCanvasMenuAction(action);
      expect(menuOpen).toBe(true);
    });

    const closingActions: readonly CanvasMenuAction[] = [
      "tool-switch",
      "outside-pointerdown",
      "marquee-start",
      "move-start",
      "escape",
    ];

    closingActions.forEach((action) => {
      menuOpen = true;
      handleCanvasMenuAction(action);
      expect(menuOpen).toBe(false);
    });
  });
});
