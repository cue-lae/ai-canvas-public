import type { CanvasPointerSessionKind } from "./canvasPointerArbitration";
import { hasCanvasSelection, type CanvasSelection } from "./canvasSelection";
import {
  resolveCanvasShortcut,
  shortcutFromKeyboardEvent,
  type CanvasShortcutId,
  type CanvasShortcutPreferences,
} from "./canvasShortcutPreferences";

export type CanvasKeyboardAction =
  | { type: "select-all-content" }
  | { type: "copy-content" }
  | { type: "clipboard-blocked"; reason: "busy" | "cut" }
  | { type: "history-undo" }
  | { type: "history-redo" }
  | { type: "block-history-shortcut" }
  | { type: "delete-selection" }
  | { type: "delete-folder" }
  | { type: "block-uncontrolled-delete" }
  | { type: "close-menu" }
  | { type: "cancel-pointer-session" }
  | { type: "cancel-pending-tool" }
  | { type: "exit-temporary-layer" }
  | { type: "enter-selection" }
  | { type: "run-canvas-shortcut"; shortcut: CanvasShortcutId }
  | { type: "activate-native-tool-shortcut"; tool: CanvasNativeToolShortcut }
  | { type: "block-native-tool-shortcut" }
  | null;

export type CanvasNativeToolShortcut = "selection" | "hand" | "laser";

export const routeCanvasKeyboardEvent = ({
  key,
  code = "",
  editableTarget,
  textEntryTarget = editableTarget,
  selection,
  menuOpen,
  pointerSession,
  hasPendingTool,
  pendingSelectionTool,
  blockedNativeToolShortcut,
  allowDeleteFromEditableTarget = false,
  hasEnterTarget = false,
  hasFolderDeleteTarget = false,
  hasTemporaryLayer = false,
  ctrlKey = false,
  shiftKey = false,
  metaKey = false,
  altKey = false,
  repeat = false,
  shortcutPreferences,
  clipboardEnabled = false,
  clipboardTarget = true,
  selectionCommandsEnabled = false,
}: {
  key: string;
  code?: string;
  editableTarget: boolean;
  textEntryTarget?: boolean;
  selection: CanvasSelection;
  menuOpen: boolean;
  pointerSession: CanvasPointerSessionKind;
  hasPendingTool: boolean;
  pendingSelectionTool: boolean;
  blockedNativeToolShortcut: boolean;
  allowDeleteFromEditableTarget?: boolean;
  hasEnterTarget?: boolean;
  hasFolderDeleteTarget?: boolean;
  hasTemporaryLayer?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  shortcutPreferences?: CanvasShortcutPreferences;
  clipboardEnabled?: boolean;
  clipboardTarget?: boolean;
  selectionCommandsEnabled?: boolean;
}): CanvasKeyboardAction => {
  if(clipboardEnabled && clipboardTarget && !textEntryTarget && (ctrlKey || metaKey) && !altKey && !shiftKey){
    const clipboardKey=code==="KeyC"?"c":code==="KeyX"?"x":key.toLowerCase();
    if(clipboardKey==="c" || clipboardKey==="x"){
      if(menuOpen || pointerSession!=="idle" || hasPendingTool)return {type:"clipboard-blocked",reason:"busy"};
      return clipboardKey==="c"?{type:"copy-content"}:{type:"clipboard-blocked",reason:"cut"};
    }
  }
  if (selectionCommandsEnabled && clipboardTarget && !textEntryTarget && (ctrlKey || metaKey) && !altKey && !shiftKey && (key.toLowerCase() === "a" || code === "KeyA")) {
    if (menuOpen || pointerSession !== "idle" || hasPendingTool) return { type: "clipboard-blocked", reason: "busy" };
    return { type: "select-all-content" };
  }
  const isDeleteKey = key === "Delete" || key === "Backspace";
  if (editableTarget && !(isDeleteKey && allowDeleteFromEditableTarget)) {
    return blockedNativeToolShortcut && !textEntryTarget
      ? { type: "block-native-tool-shortcut" }
      : null;
  }
  const normalizedKey = key.toLowerCase();
  if (ctrlKey && !metaKey && !altKey && normalizedKey === "z") {
    return shiftKey
      ? { type: "block-history-shortcut" }
      : { type: "history-undo" };
  }
  if (ctrlKey && !metaKey && !altKey && normalizedKey === "y") {
    return shiftKey
      ? { type: "block-history-shortcut" }
      : { type: "history-redo" };
  }
  if (key === "Escape") {
    if (menuOpen) {
      return { type: "close-menu" };
    }
    if (pointerSession !== "idle") {
      return { type: "cancel-pointer-session" };
    }
    if (hasPendingTool) return { type: "cancel-pending-tool" };
    return hasTemporaryLayer ? { type: "exit-temporary-layer" } : null;
  }
  if (menuOpen) {
    return { type: "block-native-tool-shortcut" };
  }
  if (
    key === "Enter" &&
    hasEnterTarget &&
    pointerSession === "idle" &&
    !ctrlKey &&
    !metaKey &&
    !altKey
  ) {
    return { type: "enter-selection" };
  }
  if (key === "Delete" || key === "Backspace") {
    if (hasCanvasSelection(selection)) {
      return { type: "delete-selection" };
    }
    if (hasFolderDeleteTarget) {
      return { type: "delete-folder" };
    }
    return { type: "block-uncontrolled-delete" };
  }
  if (shortcutPreferences) {
    const pressedShortcut = shortcutFromKeyboardEvent({
      key,
      code,
      ctrlKey,
      altKey,
      shiftKey,
      metaKey,
    });
    const shortcut = resolveCanvasShortcut(shortcutPreferences, pressedShortcut);
    if (shortcut) {
      if (repeat || pointerSession !== "idle") {
        return { type: "block-native-tool-shortcut" };
      }
      if (
        hasPendingTool &&
        shortcut !== "selection" &&
        shortcut !== "hand" &&
        shortcut !== "laser"
      ) {
        return { type: "block-native-tool-shortcut" };
      }
      return { type: "run-canvas-shortcut", shortcut };
    }
    const normalizedKey = key.toLowerCase();
    if (!ctrlKey && !altKey && !metaKey && ["v", "1", "h", "k"].includes(normalizedKey)) {
      return { type: "block-native-tool-shortcut" };
    }
  }
  if (
    pendingSelectionTool &&
    pointerSession === "idle" &&
    !ctrlKey &&
    !metaKey &&
    !altKey
  ) {
    const nativeToolShortcut =
      normalizedKey === "v" || normalizedKey === "1"
        ? "selection"
        : normalizedKey === "h"
          ? "hand"
          : normalizedKey === "k"
            ? "laser"
            : null;
    if (nativeToolShortcut) {
      return { type: "activate-native-tool-shortcut", tool: nativeToolShortcut };
    }
  }
  return blockedNativeToolShortcut ? { type: "block-native-tool-shortcut" } : null;
};
