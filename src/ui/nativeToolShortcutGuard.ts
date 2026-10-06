/**
 * Native Excalidraw tools that are not part of the AI Canvas tool surface.
 * Keep this registry in one place so a tool can be intentionally reopened
 * later without adding another keyboard listener or changing canvas data.
 */
const BLOCKED_NATIVE_TOOL_SHORTCUT_CODES = new Set([
  // Rectangle / diamond / ellipse.
  "KeyR",
  "KeyD",
  "KeyO",
  "Digit2",
  "Digit3",
  "Digit4",
  "Numpad2",
  "Numpad3",
  "Numpad4",
  // Arrow / line / free draw / text.
  "KeyA",
  "KeyL",
  "KeyP",
  "KeyT",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Numpad5",
  "Numpad6",
  "Numpad7",
  "Numpad8",
  // Native image, eraser and frame tools.
  "Digit9",
  "Digit0",
  "Numpad9",
  "Numpad0",
  "KeyE",
  "KeyF",
]);

export const isBlockedNativeToolShortcutCode = (code: string): boolean =>
  BLOCKED_NATIVE_TOOL_SHORTCUT_CODES.has(code);

export const isBlockedNativeToolShortcut = (
  code: string,
  key: string,
): boolean => {
  if (isBlockedNativeToolShortcutCode(code)) return true;
  if (/^[a-z]$/i.test(key)) {
    return isBlockedNativeToolShortcutCode(`Key${key.toUpperCase()}`);
  }
  if (/^[0-9]$/.test(key)) {
    return isBlockedNativeToolShortcutCode(`Digit${key}`);
  }
  return false;
};

export const isAllowedNativeCanvasTool = (
  type: string,
  context: Readonly<{
    manualAnnotationStage: "text" | "leader" | null;
    ordinaryTextPending: boolean;
  }>,
): boolean =>
  type === "selection" ||
  type === "hand" ||
  type === "laser" ||
  (type === "text" &&
    (context.manualAnnotationStage === "text" || context.ordinaryTextPending)) ||
  (type === "arrow" && context.manualAnnotationStage === "leader");
