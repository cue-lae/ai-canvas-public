import { describe, expect, it } from "vitest";
import { createCanvasSelection } from "./canvasSelection";
import { routeCanvasKeyboardEvent } from "./canvasKeyboardRouter";
import { isBlockedNativeToolShortcutCode } from "./nativeToolShortcutGuard";
import { createCanvasShortcutPreferences } from "./canvasShortcutPreferences";

const baseInput = {
  editableTarget: false,
  selection: createCanvasSelection(),
  menuOpen: false,
  pointerSession: "idle" as const,
  hasPendingTool: false,
  pendingSelectionTool: false,
  blockedNativeToolShortcut: false,
};

describe("Canvas Keyboard Router", () => {
  it("routes Select All through controlled selection without replacing text-input selection", () => {
    const input = { ...baseInput, key: "a", code: "KeyA", ctrlKey: true, selectionCommandsEnabled: true };
    expect(routeCanvasKeyboardEvent(input)).toEqual({ type: "select-all-content" });
    expect(routeCanvasKeyboardEvent({ ...input, editableTarget: true, textEntryTarget: true })).toBeNull();
    expect(routeCanvasKeyboardEvent({ ...input, pointerSession: "moving" })).toEqual({ type: "clipboard-blocked", reason: "busy" });
  });
  it("copies business objects from a focused card but preserves text-entry shortcuts", () => {
    const input={...baseInput,key:"c",code:"KeyC",ctrlKey:true,clipboardEnabled:true,editableTarget:true,textEntryTarget:false};
    expect(routeCanvasKeyboardEvent(input)).toEqual({type:"copy-content"});
    expect(routeCanvasKeyboardEvent({...input,textEntryTarget:true})).toBeNull();
    expect(routeCanvasKeyboardEvent({...input,clipboardTarget:false})).toBeNull();
  });
  it("guards active gestures and native cut while keeping paste as a browser event", () => {
    const input={...baseInput,key:"c",code:"KeyC",ctrlKey:true,clipboardEnabled:true};
    expect(routeCanvasKeyboardEvent({...input,pointerSession:"moving"})).toEqual({type:"clipboard-blocked",reason:"busy"});
    expect(routeCanvasKeyboardEvent({...input,key:"x",code:"KeyX"})).toEqual({type:"clipboard-blocked",reason:"cut"});
    expect(routeCanvasKeyboardEvent({...input,key:"v",code:"KeyV"})).toBeNull();
    expect(routeCanvasKeyboardEvent({...input,key:"Process"})).toEqual({type:"copy-content"});
  });
  it("仅在存在可进入对象且 pointer 空闲时路由 Enter", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Enter",
        hasEnterTarget: true,
      }),
    ).toEqual({ type: "enter-selection" });
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Enter",
        hasEnterTarget: true,
        pointerSession: "moving",
      }),
    ).toBeNull();
  });

  it("先删除受控选择，不让过期 activeDescription 覆盖可见选择", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Delete",
        selection: createCanvasSelection({ regionIds: ["region-a"] }),
      }),
    ).toEqual({ type: "delete-selection" });
  });

  it("routes Delete to the selected Folder when the canvas selection is empty", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Delete",
        hasFolderDeleteTarget: true,
      }),
    ).toEqual({ type: "delete-folder" });
  });

  it("文本焦点保留输入语义；空选择忽略过期状态并阻止非受控删除", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Delete",
        editableTarget: true,
      }),
    ).toBeNull();
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Escape",
        editableTarget: true,
        menuOpen: true,
        pointerSession: "marquee",
      }),
    ).toBeNull();
    const staleEmptySelection = {
      ...baseInput,
      key: "Backspace",
      activeDescriptionId: "description-a",
      selectedRegionId: "region-a",
    };
    expect(
      routeCanvasKeyboardEvent(staleEmptySelection),
    ).toEqual({ type: "block-uncontrolled-delete" });
  });

  it("已选中的说明卡按钮允许 Delete，但正文输入框仍保留输入语义", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Delete",
        editableTarget: true,
        allowDeleteFromEditableTarget: true,
        selection: createCanvasSelection({ descriptionIds: ["description-a"] }),
      }),
    ).toEqual({ type: "delete-selection" });
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Delete",
        editableTarget: true,
        selection: createCanvasSelection({ descriptionIds: ["description-a"] }),
      }),
    ).toBeNull();
  });

  it("Esc 先关菜单，再取消 pointer 会话，最后才取消待创建工具", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Escape",
        menuOpen: true,
        pointerSession: "marquee",
        hasPendingTool: true,
      }),
    ).toEqual({ type: "close-menu" });
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Escape",
        pointerSession: "marquee",
        hasPendingTool: true,
      }),
    ).toEqual({ type: "cancel-pointer-session" });
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "Escape",
        hasTemporaryLayer: true,
      }),
    ).toEqual({ type: "exit-temporary-layer" });
  });

  it("routes Windows Ctrl+Z and Ctrl+Y only outside editable targets", () => {
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "z", ctrlKey: true })).toEqual({
      type: "history-undo",
    });
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "y", ctrlKey: true })).toEqual({
      type: "history-redo",
    });
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "z",
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toEqual({ type: "block-history-shortcut" });
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "z",
        ctrlKey: true,
        editableTarget: true,
      }),
    ).toBeNull();
  });

  it("routes KeyP to the native-tool block before Excalidraw can activate freedraw", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "p",
        blockedNativeToolShortcut: isBlockedNativeToolShortcutCode("KeyP"),
      }),
    ).toEqual({ type: "block-native-tool-shortcut" });
  });

  it("blocks disabled native keys on focused controls while preserving text entry and modified keys", () => {
    const buttonInput = {
      ...baseInput,
      key: "a",
      code: "",
      editableTarget: true,
      textEntryTarget: false,
      blockedNativeToolShortcut: true,
    };
    expect(routeCanvasKeyboardEvent(buttonInput))
      .toEqual({ type: "block-native-tool-shortcut" });
    expect(routeCanvasKeyboardEvent({ ...buttonInput, textEntryTarget: true })).toBeNull();
    expect(routeCanvasKeyboardEvent({ ...buttonInput, blockedNativeToolShortcut: false })).toBeNull();
  });

  it("routes the existing selection, hand, and laser shortcuts only while continuous selection is armed", () => {
    expect(
      routeCanvasKeyboardEvent({ ...baseInput, key: "v", pendingSelectionTool: true }),
    ).toEqual({ type: "activate-native-tool-shortcut", tool: "selection" });
    expect(
      routeCanvasKeyboardEvent({ ...baseInput, key: "1", pendingSelectionTool: true }),
    ).toEqual({ type: "activate-native-tool-shortcut", tool: "selection" });
    expect(
      routeCanvasKeyboardEvent({ ...baseInput, key: "h", pendingSelectionTool: true }),
    ).toEqual({ type: "activate-native-tool-shortcut", tool: "hand" });
    expect(
      routeCanvasKeyboardEvent({ ...baseInput, key: "k", pendingSelectionTool: true }),
    ).toEqual({ type: "activate-native-tool-shortcut", tool: "laser" });
    expect(
      routeCanvasKeyboardEvent({ ...baseInput, key: "v", pendingSelectionTool: false }),
    ).toBeNull();
  });

  it("preserves Ctrl, Meta, and Alt combinations while continuous selection is armed", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      expect(
        routeCanvasKeyboardEvent({
          ...baseInput,
          key: "h",
          pendingSelectionTool: true,
          [modifier]: true,
        }),
      ).toBeNull();
    }
  });

  it("defers tool shortcuts while a pointer session is active", () => {
    expect(
      routeCanvasKeyboardEvent({
        ...baseInput,
        key: "h",
        pendingSelectionTool: true,
        pointerSession: "moving",
      }),
    ).toBeNull();
  });

  it("routes configured shortcuts once, blocks replaced defaults, and keeps menu/input priority", () => {
    const shortcuts = {
      ...createCanvasShortcutPreferences(),
      selection: ["G"],
      overview: ["Shift+O"],
    };
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "g", shortcutPreferences: shortcuts }))
      .toEqual({ type: "run-canvas-shortcut", shortcut: "selection" });
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "v", shortcutPreferences: shortcuts }))
      .toEqual({ type: "block-native-tool-shortcut" });
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "o", shiftKey: true, shortcutPreferences: shortcuts, repeat: true }))
      .toEqual({ type: "block-native-tool-shortcut" });
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "g", shortcutPreferences: shortcuts, editableTarget: true }))
      .toBeNull();
    expect(routeCanvasKeyboardEvent({ ...baseInput, key: "g", shortcutPreferences: shortcuts, menuOpen: true }))
      .toEqual({ type: "block-native-tool-shortcut" });
  });
});
