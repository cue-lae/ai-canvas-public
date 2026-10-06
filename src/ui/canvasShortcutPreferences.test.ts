import { describe, expect, it } from "vitest";
import {
  assignCanvasShortcut,
  CANVAS_SHORTCUT_LABELS,
  createCanvasShortcutRows,
  createCanvasShortcutPreferences,
  normalizeCanvasShortcutPreferences,
  restoreAllCanvasShortcutDefaults,
  restoreCanvasShortcutDefault,
  shortcutFromKeyboardEvent,
} from "./canvasShortcutPreferences";

describe("canvas shortcut preferences", () => {
  it("keeps the nine defaults and replaces every selection default together", () => {
    const defaults = createCanvasShortcutPreferences();
    expect(defaults.selection).toEqual(["V", "1"]);
    expect(defaults.hand).toEqual(["H"]);
    expect(defaults.laser).toEqual(["K"]);
    expect(defaults["selection-tool"]).toEqual([]);
    expect(defaults["quick-annotation"]).toEqual([]);
    const assigned = assignCanvasShortcut(defaults, "selection", "g");
    expect(assigned).toMatchObject({ ok: true });
    if (!assigned.ok) return;
    expect(assigned.preferences.selection).toEqual(["G"]);
    const restored = restoreCanvasShortcutDefault(assigned.preferences, "selection");
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(restored.preferences.selection).toEqual(["V", "1"]);
    expect(restoreAllCanvasShortcutDefaults()).toEqual(defaults);
  });

  it("accepts only one modifier and rejects fixed or conflicting assignments", () => {
    const defaults = createCanvasShortcutPreferences();
    expect(shortcutFromKeyboardEvent({ key: "g", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe("Ctrl+G");
    expect(shortcutFromKeyboardEvent({ key: "!", code: "Digit1", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toBe("Shift+1");
    expect(shortcutFromKeyboardEvent({ key: "g", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false })).toBeNull();
    expect(assignCanvasShortcut(defaults, "overview", "Ctrl+Z")).toEqual({ ok: false, reason: "reserved" });
    expect(assignCanvasShortcut(defaults, "overview", "V")).toEqual({ ok: false, reason: "conflict", conflictId: "selection" });
    expect(assignCanvasShortcut(defaults, "overview", "Enter")).toEqual({ ok: false, reason: "invalid" });
  });

  it("migrates missing or corrupt values back to safe defaults", () => {
    const defaults = createCanvasShortcutPreferences();
    expect(normalizeCanvasShortcutPreferences({ gridVisible: true })).toEqual(defaults);
    expect(normalizeCanvasShortcutPreferences({ selection: ["V", "V"] })).toEqual(defaults);
    expect(normalizeCanvasShortcutPreferences({ selection: [] }).selection).toEqual(["V", "1"]);
    expect(normalizeCanvasShortcutPreferences({ hand: ["J", "L"] }).hand).toEqual(["H"]);
    expect(normalizeCanvasShortcutPreferences({ selection: ["V", "1", "G"] }).selection).toEqual(["V", "1"]);
    expect(normalizeCanvasShortcutPreferences({ selection: ["V"], hand: ["V"] })).toMatchObject({
      selection: ["V", "1"],
      hand: ["H"],
    });
    expect(normalizeCanvasShortcutPreferences({ selection: ["H"] })).toMatchObject({
      selection: ["V", "1"],
      hand: ["H"],
    });
    expect(normalizeCanvasShortcutPreferences({ hand: ["K"] })).toMatchObject({
      hand: ["H"],
      laser: ["K"],
    });
    const duplicateCustom = normalizeCanvasShortcutPreferences({
      hand: ["J"],
      overview: ["J"],
    });
    expect(duplicateCustom.hand).toEqual(["H"]);
    expect(duplicateCustom.overview).toEqual([]);
    expect(new Set(Object.values(duplicateCustom).flat()).size).toBe(
      Object.values(duplicateCustom).flat().length,
    );
    expect(CANVAS_SHORTCUT_LABELS.arrange).toBe("整理画布");
    expect(CANVAS_SHORTCUT_LABELS["quick-annotation"]).toBe("快速标注");
    expect(createCanvasShortcutRows(defaults)[0]).toMatchObject({
      id: "selection",
      display: "V / 1",
    });
  });

  it("refuses a single restore when every default key is not available", () => {
    const defaults = createCanvasShortcutPreferences();
    const hand = assignCanvasShortcut(defaults, "hand", "J");
    expect(hand).toMatchObject({ ok: true });
    if (!hand.ok) return;
    const overview = assignCanvasShortcut(hand.preferences, "overview", "H");
    expect(overview).toMatchObject({ ok: true });
    if (!overview.ok) return;
    const restored = restoreCanvasShortcutDefault(overview.preferences, "hand");
    expect(restored).toEqual({ ok: false, reason: "conflict", conflictId: "overview" });
    expect(overview.preferences.hand).toEqual(["J"]);
    expect(overview.preferences.overview).toEqual(["H"]);
  });
});
