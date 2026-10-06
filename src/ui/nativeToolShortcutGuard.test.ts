import { describe, expect, it } from "vitest";
import {
  isAllowedNativeCanvasTool,
  isBlockedNativeToolShortcut,
  isBlockedNativeToolShortcutCode,
} from "./nativeToolShortcutGuard";

describe("native tool shortcut guard", () => {
  it("blocks the diamond shortcut together with the already disabled native tools", () => {
    expect(isBlockedNativeToolShortcutCode("KeyD")).toBe(true);
    expect(isBlockedNativeToolShortcutCode("KeyT")).toBe(true);
    expect(isBlockedNativeToolShortcutCode("KeyA")).toBe(true);
    expect(isBlockedNativeToolShortcutCode("KeyL")).toBe(true);
  });

  it("blocks P together with the disabled native tools", () => {
    expect(isBlockedNativeToolShortcutCode("KeyP")).toBe(true);
    expect(isBlockedNativeToolShortcutCode("Escape")).toBe(false);
  });

  it("blocks every native drawing-tool shortcut outside the product surface", () => {
    expect(
      [
        "KeyR",
        "KeyD",
        "KeyO",
        "KeyA",
        "KeyL",
        "KeyP",
        "KeyT",
        "KeyE",
        "KeyF",
        "Digit0",
        "Digit2",
        "Digit3",
        "Digit4",
        "Digit5",
        "Digit6",
        "Digit7",
        "Digit8",
        "Digit9",
        "Numpad0",
        "Numpad2",
        "Numpad3",
        "Numpad4",
        "Numpad5",
        "Numpad6",
        "Numpad7",
        "Numpad8",
        "Numpad9",
      ].every(isBlockedNativeToolShortcutCode),
    ).toBe(true);
  });

  it("leaves product and system navigation shortcuts available to the router", () => {
    expect(isBlockedNativeToolShortcutCode("KeyV")).toBe(false);
    expect(isBlockedNativeToolShortcutCode("KeyH")).toBe(false);
    expect(isBlockedNativeToolShortcutCode("KeyK")).toBe(false);
    expect(isBlockedNativeToolShortcutCode("KeyI")).toBe(false);
    expect(isBlockedNativeToolShortcutCode("ControlLeft")).toBe(false);
  });

  it("recognizes disabled tool keys even when WebView supplies no physical code", () => {
    expect(isBlockedNativeToolShortcut("", "a")).toBe(true);
    expect(isBlockedNativeToolShortcut("Unidentified", "5")).toBe(true);
    expect(isBlockedNativeToolShortcut("KeyQ", "A")).toBe(true);
    expect(isBlockedNativeToolShortcut("", "v")).toBe(false);
  });

  it("allows native text and arrow tools only inside their product creation stages", () => {
    const idle = { manualAnnotationStage: null, ordinaryTextPending: false } as const;
    expect(isAllowedNativeCanvasTool("selection", idle)).toBe(true);
    expect(isAllowedNativeCanvasTool("hand", idle)).toBe(true);
    expect(isAllowedNativeCanvasTool("laser", idle)).toBe(true);
    expect(isAllowedNativeCanvasTool("arrow", idle)).toBe(false);
    expect(isAllowedNativeCanvasTool("line", idle)).toBe(false);
    expect(isAllowedNativeCanvasTool("text", idle)).toBe(false);
    expect(isAllowedNativeCanvasTool("freedraw", idle)).toBe(false);
    expect(isAllowedNativeCanvasTool("text", { ...idle, ordinaryTextPending: true })).toBe(true);
    expect(isAllowedNativeCanvasTool("text", { ...idle, manualAnnotationStage: "text" })).toBe(true);
    expect(isAllowedNativeCanvasTool("arrow", { ...idle, manualAnnotationStage: "leader" })).toBe(true);
    expect(isAllowedNativeCanvasTool("arrow", { ...idle, manualAnnotationStage: "text" })).toBe(false);
  });
});
