import { describe, expect, it, vi } from "vitest";
import {
  createCanvasHistoryController,
  createCanvasKeyboardController,
  createCanvasPointerController,
  createCanvasSelectionController,
  createDescriptionRuntimeAdapter,
  fitImportedImageToViewport,
  hitTestCanvasImageEntry,
  imageDetailViewportPlan,
  resolveMeasuredViewportSize,
  resolveCanvasImageEntryId,
  resolveUniformImageTranslation,
  resolveSelectionToolMenuKey,
  attachFolderPreviewWheelGuard,
  shouldBlockPreviewPan,
  shouldClaimCanvasImageDoubleClick,
} from "./canvasInteractionHostController";
import { EMPTY_CANVAS_SELECTION, createCanvasSelection } from "./canvasSelection";
import { GlobalHistoryTimeline } from "../domain/globalHistoryTimeline";
import { AsyncHistoryReplayGate, NativeGestureHistoryBarrier } from "./globalHistorySceneSync";
import { createCanvasShortcutPreferences } from "./canvasShortcutPreferences";

const pointer = (x: number, y: number, pointerId = 1) => ({
  button: 0, clientX: x, clientY: y, pointerId,
  preventDefault: vi.fn(), stopPropagation: vi.fn(),
});

const pointerRuntime = () => {
  let selection = EMPTY_CANVAS_SELECTION;
  return {
    canvasPointerSessionRef: { current: { kind: "idle" as const } },
    updateCanvasSelection: (next: typeof selection) => { selection = next; },
    selection: () => selection,
  };
};

describe("canvas interaction host controller", () => {
  it("blocks middle-button panning only while preview is open", () => {
    expect(shouldBlockPreviewPan({ layer: "preview", button: 1 })).toBe(true);
    expect(shouldBlockPreviewPan({ layer: "overview", button: 1 })).toBe(false);
    expect(shouldBlockPreviewPan({ layer: "preview", button: 0 })).toBe(false);
  });

  it("opens, cycles, and closes the unified selection-tool menu from the keyboard", () => {
    expect(
      resolveSelectionToolMenuKey({
        key: "ArrowRight",
        currentIndex: -1,
        optionCount: 3,
      }),
    ).toEqual({ type: "open", focusIndex: 0 });
    expect(
      resolveSelectionToolMenuKey({
        key: "ArrowDown",
        currentIndex: 2,
        optionCount: 3,
      }),
    ).toEqual({ type: "move", focusIndex: 0 });
    expect(
      resolveSelectionToolMenuKey({
        key: "ArrowUp",
        currentIndex: 0,
        optionCount: 3,
      }),
    ).toEqual({ type: "move", focusIndex: 2 });
    expect(
      resolveSelectionToolMenuKey({
        key: "Escape",
        currentIndex: 1,
        optionCount: 3,
      }),
    ).toEqual({ type: "close" });
  });

  it("prefers a direct image hit and otherwise falls back to the synchronized selection", () => {
    expect(
      resolveCanvasImageEntryId({
        selectedCanvasImageId: null,
        selectedPlacementImageId: "image-from-selection",
        selectedNativeImageId: "image-from-native-scene",
      }),
    ).toBe("image-from-native-scene");
    expect(
      resolveCanvasImageEntryId({
        selectedCanvasImageId: "image-from-state",
        selectedPlacementImageId: "image-from-selection",
        selectedNativeImageId: "image-from-native-scene",
      }),
    ).toBe("image-from-native-scene");
    expect(
      resolveCanvasImageEntryId({
        selectedCanvasImageId: null,
        selectedPlacementImageId: null,
        selectedNativeImageId: "image-from-native-scene",
      }),
    ).toBe("image-from-native-scene");
  });

  it("resolves a double-click directly from the topmost visible image bounds", () => {
    expect(
      hitTestCanvasImageEntry(
        { x: 45, y: 30 },
        [
          { imageId: "image-behind", bounds: { left: 0, top: 0, right: 80, bottom: 80 } },
          { imageId: "image-top", bounds: { left: 40, top: 20, right: 100, bottom: 90 } },
        ],
      ),
    ).toBe("image-top");
    expect(
      hitTestCanvasImageEntry(
        { x: 140, y: 30 },
        [{ imageId: "image-a", bounds: { left: 0, top: 0, right: 80, bottom: 80 } }],
      ),
    ).toBeNull();
  });

  it("does not reuse a stale selected image when this double-click misses all images", () => {
    const hitImageId = hitTestCanvasImageEntry(
      { x: 140, y: 140 },
      [{ imageId: "image-a", bounds: { left: 0, top: 0, right: 80, bottom: 80 } }],
    );
    expect(hitImageId).toBeNull();
    expect(
      shouldClaimCanvasImageDoubleClick({
        layer: "folder",
        selectedCanvasImageId: hitImageId,
      }),
    ).toBe(false);
  });

  it("fits first-import images to measured viewport bounds while preserving aspect ratio", () => {
    const landscape = fitImportedImageToViewport({
      naturalWidth: 1920,
      naturalHeight: 1080,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(landscape.scale).toBeCloseTo(0.21375, 8);
    expect(landscape.width).toBeCloseTo(410.4, 8);
    expect(landscape.height).toBeCloseTo(230.85, 8);
    const portrait = fitImportedImageToViewport({
      naturalWidth: 1000,
      naturalHeight: 2000,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    expect(portrait.scale).toBeCloseTo(0.2052, 8);
    expect(portrait.width).toBeCloseTo(205.2, 8);
    expect(portrait.height).toBeCloseTo(410.4, 8);
  });

  it("resolves one shared translation for selected images without treating resize as a move", () => {
    const before = [
      { id: "image-a", type: "image", x: 10, y: 20, width: 100, height: 80, angle: 0, scale: [1, 1], crop: null, customData: { imageId: "asset-a" } },
      { id: "image-b", type: "image", x: 240, y: 40, width: 120, height: 90, angle: 0, scale: [1, 1], crop: null, customData: { imageId: "asset-b" } },
    ];
    const after = [
      { ...before[0], x: 35, y: 14 },
      { ...before[1], x: 265, y: 34 },
    ];
    expect(resolveUniformImageTranslation(before as never, after as never, ["asset-a", "asset-b"])).toEqual({ dx: 25, dy: -6 });
    expect(resolveUniformImageTranslation(before as never, [{ ...after[0], width: 130 }, after[1]] as never, ["asset-a", "asset-b"])).toBeNull();
  });

  it("falls back to the browser viewport when the canvas panel reports zero size", () => {
    const measured = resolveMeasuredViewportSize({
      viewportWidth: 0,
      viewportHeight: 0,
      fallbackWidth: 1200,
      fallbackHeight: 900,
    });
    expect(measured).toEqual({ width: 1200, height: 900 });
    expect(
      fitImportedImageToViewport({
        naturalWidth: 1920,
        naturalHeight: 1080,
        viewportWidth: measured.width,
        viewportHeight: measured.height,
      }).width,
    ).toBeGreaterThan(1);
  });

  it("derives image detail framing from the current viewport", () => {
    expect(imageDetailViewportPlan({ viewportWidth: 1200, viewportHeight: 900 })).toEqual({
      viewportZoomFactor: 0.88,
      canvasOffsets: { left: 0, top: 0, right: 0, bottom: 0 },
    });
  });

  it("keeps focused images left of the context information panel", () => {
    expect(
      imageDetailViewportPlan({
        viewportWidth: 1200,
        viewportHeight: 900,
        statusPanelLeft: 1030,
        statusPanelGap: 16,
      }),
    ).toEqual({
      viewportZoomFactor: 0.88,
      canvasOffsets: { left: 0, top: 0, right: 186, bottom: 0 },
    });
  });

  it("claims a selected image double-click before Excalidraw can enter crop mode", () => {
    expect(
      shouldClaimCanvasImageDoubleClick({
        layer: "folder",
        selectedCanvasImageId: "image-a",
      }),
    ).toBe(true);
    expect(
      shouldClaimCanvasImageDoubleClick({
        layer: "image",
        selectedCanvasImageId: "image-a",
      }),
    ).toBe(false);
    expect(
      shouldClaimCanvasImageDoubleClick({
        layer: "folder",
        selectedCanvasImageId: null,
      }),
    ).toBe(false);
  });

  it("keeps blank click, CAD marquee, and native image gestures on separate paths", () => {
    const runtime = pointerRuntime();
    const root = { getBoundingClientRect: () => ({ left: 0, top: 0 }), hasPointerCapture: () => true, releasePointerCapture: vi.fn(), setPointerCapture: vi.fn() };
    const calls: string[] = [];
    const marqueeRects: unknown[] = [];
    const blank = vi.fn(); const nativeImage = vi.fn(); const nativeStart = vi.fn(); const marquee = vi.fn();
    const controller = createCanvasPointerController(runtime as never, {
      getCanvasRoot: () => root,
      getMarqueeCandidates: () => [{ kind: "region", id: "region-a", bounds: { left: 0, top: 0, right: 20, bottom: 20 } }],
      onBlankClick: blank, onMarqueeSelection: marquee, onNativeImage: nativeImage, onNativeElement: vi.fn(),
      onSynchronizeTransient: vi.fn(), onBlockedFreedraw: vi.fn(), isCanvasMenuOpen: () => false,
      isInsideMenu: () => false, applyMenuAction: vi.fn(), setMarqueeRect: (rect) => { if (rect === null) calls.push("clear-pointer"); else marqueeRects.push(rect); }, getActiveToolType: () => "selection", onNativeImageGestureStart: nativeStart,
      onNativeGestureCancel: () => { calls.push("cancel-history"); return true; },
    });
    controller.onNativePointerDown({ activeToolType: "selection", hitElement: null }, pointer(1, 1));
    controller.onUp(pointer(1, 1));
    expect(blank).toHaveBeenCalledOnce();
    controller.onNativePointerDown({ activeToolType: "selection", hitElement: null }, pointer(0, 0));
    controller.onMove(pointer(30, 30)); controller.onUp(pointer(30, 30));
    expect(marqueeRects).toContainEqual({ left: 0, top: 0, width: 30, height: 30, mode: "contain" });
    expect(marquee).toHaveBeenCalledWith(createCanvasSelection({ regionIds: ["region-a"] }));
    controller.onNativePointerDown({ activeToolType: "selection", hitElement: { type: "image" } }, pointer(2, 2));
    expect(nativeStart).toHaveBeenCalledOnce(); expect(nativeImage).toHaveBeenCalledOnce();
    controller.onNativePointerDown({ activeToolType: "selection", hitElement: null }, pointer(4, 4));
    expect(controller.onCancel(pointer(4, 4))).toEqual({
      pointerSessionCancelled: true,
      nativeGestureCancelled: true,
    });
    expect(calls.slice(-2)).toEqual(["clear-pointer", "cancel-history"]);
    expect(controller.onCancel(pointer(9, 9))).toEqual({
      pointerSessionCancelled: false,
      nativeGestureCancelled: true,
    });
    expect(calls.at(-1)).toBe("cancel-history");
  });

  it("lets a Folder surface consume host marquee bounds before ordinary selection", () => {
    const runtime = pointerRuntime();
    const root = { getBoundingClientRect: () => ({ left: 0, top: 0 }), hasPointerCapture: () => true, releasePointerCapture: vi.fn(), setPointerCapture: vi.fn() };
    const marquee = vi.fn();
    const folderBounds = vi.fn(() => true);
    const controller = createCanvasPointerController(runtime as never, {
      getCanvasRoot: () => root,
      getMarqueeCandidates: () => [],
      onBlankClick: vi.fn(),
      onMarqueeSelection: marquee,
      onMarqueeBounds: folderBounds,
      onNativeImage: vi.fn(),
      onNativeElement: vi.fn(),
      onSynchronizeTransient: vi.fn(),
      onBlockedFreedraw: vi.fn(),
      isCanvasMenuOpen: () => false,
      isInsideMenu: () => false,
      applyMenuAction: vi.fn(),
      setMarqueeRect: vi.fn(),
      getActiveToolType: () => "selection",
      onNativeImageGestureStart: vi.fn(),
      onNativeGestureCancel: () => false,
    });
    controller.onNativePointerDown({ activeToolType: "selection", hitElement: null }, pointer(10, 20));
    controller.onMove(pointer(90, 120));
    controller.onUp(pointer(90, 120));
    expect(folderBounds).toHaveBeenCalledWith(
      { left: 10, top: 20, right: 90, bottom: 120 },
      "contain",
    );
    expect(marquee).not.toHaveBeenCalled();
    expect(runtime.selection()).toEqual(EMPTY_CANVAS_SELECTION);
    folderBounds.mockClear();
    controller.onNativePointerDown({ activeToolType: "selection", hitElement: null }, pointer(90, 120));
    controller.onMove(pointer(10, 20));
    controller.onUp(pointer(10, 20));
    expect(folderBounds).toHaveBeenCalledWith(
      { left: 10, top: 20, right: 90, bottom: 120 },
      "intersect",
    );
  });

  it("blocks empty Delete and preserves composite deletion order", () => {
    const calls: string[] = [];
    let selection = EMPTY_CANVAS_SELECTION;
    const controller = createCanvasSelectionController({
      selection: () => selection, synchronizeTransient: () => calls.push("sync"),
      deleteBusiness: () => calls.push("business"), deleteScene: () => calls.push("scene"),
      afterDelete: () => calls.push("after"), clearSelection: () => calls.push("clear"),
    });
    expect(controller.deleteSelection()).toBe(false); expect(calls).toEqual([]);
    selection = createCanvasSelection({ imagePlacementIds: ["image-a"], regionIds: ["region-a"], descriptionIds: ["description-a"] });
    expect(controller.deleteSelection()).toBe(true);
    expect(calls).toEqual(["sync", "business", "scene", "after", "clear"]);
  });

  it("honors editable targets, Esc, and Ctrl+Z/Y through injected ports", () => {
    const calls: string[] = [];
    let menuOpen = true;
    const keyboard = createCanvasKeyboardController({
      selection: () => createCanvasSelection({ regionIds: ["region-a"] }), menuOpen: () => menuOpen,
      pointerSession: () => "idle", pendingTool: () => false, pendingSelectionTool: () => false, editableTarget: (target) => target === ("input" as unknown as EventTarget),
      shortcutPreferences: createCanvasShortcutPreferences, blockedShortcut: () => false, undo: () => calls.push("undo"), redo: () => calls.push("redo"), removeSelection: () => calls.push("delete"),
      hasEnterTarget: () => true, hasFolderDeleteTarget: () => false, enterSelection: () => calls.push("enter"), removeFolder: () => calls.push("folder-delete"),
      closeMenu: () => { menuOpen = false; calls.push("menu"); }, cancelPointer: () => calls.push("pointer"), cancelTool: () => calls.push("tool"), activateNativeTool: (tool) => calls.push(`native:${tool}`), runCanvasShortcut: (shortcut) => calls.push(`shortcut:${shortcut}`), blockNativeTool: () => calls.push("block"),
    });
    const event = (key: string, extras: Partial<KeyboardEvent> = {}) => ({ key, defaultPrevented: false, isComposing: false, target: null, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extras }) as unknown as KeyboardEvent;
    keyboard.onKeyDown(event("Delete", { target: "input" as never }));
    keyboard.onKeyDown(event("Escape")); keyboard.onKeyDown(event("Enter")); keyboard.onKeyDown(event("z", { ctrlKey: true })); keyboard.onKeyDown(event("y", { ctrlKey: true, defaultPrevented: true }));
    expect(calls).toEqual(["menu", "enter", "undo", "redo"]);
  });

  it("uses the shared tool activation port to leave continuous selection", () => {
    const calls: string[] = [];
    const keyboard = createCanvasKeyboardController({
      selection: () => EMPTY_CANVAS_SELECTION, menuOpen: () => false,
      pointerSession: () => "idle", pendingTool: () => true, pendingSelectionTool: () => true,
      editableTarget: () => false, shortcutPreferences: createCanvasShortcutPreferences, blockedShortcut: () => false,
      hasEnterTarget: () => false, hasFolderDeleteTarget: () => false,
      undo: vi.fn(), redo: vi.fn(), removeSelection: vi.fn(), closeMenu: vi.fn(),
      enterSelection: vi.fn(), removeFolder: vi.fn(),
      cancelPointer: vi.fn(), cancelTool: vi.fn(),
      activateNativeTool: (tool) => calls.push(tool), runCanvasShortcut: (shortcut) => calls.push(`shortcut:${shortcut}`), blockNativeTool: vi.fn(),
    });
    const event = {
      key: "k", code: "KeyK", defaultPrevented: false, isComposing: false, target: null,
      ctrlKey: false, shiftKey: false, metaKey: false, altKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    keyboard.onKeyDown(event);
    expect(calls).toEqual(["shortcut:laser"]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("leaves continuous selection even when Excalidraw already handled the shortcut", () => {
    const calls: string[] = [];
    const keyboard = createCanvasKeyboardController({
      selection: () => EMPTY_CANVAS_SELECTION, menuOpen: () => false,
      pointerSession: () => "idle", pendingTool: () => true, pendingSelectionTool: () => true,
      editableTarget: () => false, shortcutPreferences: createCanvasShortcutPreferences, blockedShortcut: () => false,
      hasEnterTarget: () => false, hasFolderDeleteTarget: () => false,
      undo: vi.fn(), redo: vi.fn(), removeSelection: vi.fn(), closeMenu: vi.fn(),
      enterSelection: vi.fn(), removeFolder: vi.fn(),
      cancelPointer: vi.fn(), cancelTool: vi.fn(),
      activateNativeTool: (tool) => calls.push(tool), runCanvasShortcut: (shortcut) => calls.push(`shortcut:${shortcut}`), blockNativeTool: vi.fn(),
    });
    const event = {
      key: "v", code: "KeyV", defaultPrevented: true, isComposing: false, target: null,
      ctrlKey: false, shiftKey: false, metaKey: false, altKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    keyboard.onKeyDown(event);
    expect(calls).toEqual(["shortcut:selection"]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("dispatches business copy once and leaves native text copy alone",()=>{
    const copy=vi.fn();
    const controller=createCanvasKeyboardController({
      selection:()=>EMPTY_CANVAS_SELECTION,menuOpen:()=>false,pointerSession:()=>"idle",pendingTool:()=>false,pendingSelectionTool:()=>false,
      shortcutPreferences:createCanvasShortcutPreferences,editableTarget:()=>true,textEntryTarget:target=>target===("text" as unknown as EventTarget),blockedShortcut:()=>false,
      hasEnterTarget:()=>false,hasFolderDeleteTarget:()=>false,undo:vi.fn(),redo:vi.fn(),removeSelection:vi.fn(),enterSelection:vi.fn(),removeFolder:vi.fn(),closeMenu:vi.fn(),cancelPointer:vi.fn(),cancelTool:vi.fn(),activateNativeTool:vi.fn(),runCanvasShortcut:vi.fn(),blockNativeTool:vi.fn(),copyContent:copy,
    });
    const event={key:"c",code:"KeyC",ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,isComposing:false,defaultPrevented:false,target:null,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()} as unknown as KeyboardEvent;
    controller.onKeyDown(event);expect(copy).toHaveBeenCalledOnce();expect(event.preventDefault).toHaveBeenCalledOnce();
    controller.onKeyDown({...event,target:"text",preventDefault:vi.fn()} as unknown as KeyboardEvent);expect(copy).toHaveBeenCalledOnce();
  });

  it("blocks every wheel in preview and restores native wheel routing outside it", () => {
    const panel = new EventTarget();
    let layer = "preview";
    const detach = attachFolderPreviewWheelGuard(
      panel as HTMLElement,
      () => layer === "preview",
    );

    const previewWheel = new Event("wheel", { bubbles: true, cancelable: true });
    panel.dispatchEvent(previewWheel);
    expect(previewWheel.defaultPrevented).toBe(true);
    expect(previewWheel.cancelBubble).toBe(true);

    layer = "folder";
    const folderWheel = new Event("wheel", { bubbles: true, cancelable: true });
    panel.dispatchEvent(folderWheel);
    expect(folderWheel.defaultPrevented).toBe(false);
    expect(folderWheel.cancelBubble).toBe(false);

    detach();
    layer = "preview";
    const detachedWheel = new Event("wheel", { bubbles: true, cancelable: true });
    panel.dispatchEvent(detachedWheel);
    expect(detachedWheel.defaultPrevented).toBe(false);
  });

  it("still resets a native drawing tool when Excalidraw handled its shortcut first", () => {
    const calls: string[] = [];
    const keyboard = createCanvasKeyboardController({
      selection: () => EMPTY_CANVAS_SELECTION, menuOpen: () => false,
      pointerSession: () => "idle", pendingTool: () => false, pendingSelectionTool: () => false,
      editableTarget: () => false, shortcutPreferences: createCanvasShortcutPreferences,
      blockedShortcut: (code) => code === "KeyA",
      hasEnterTarget: () => false, hasFolderDeleteTarget: () => false,
      undo: vi.fn(), redo: vi.fn(), removeSelection: vi.fn(), closeMenu: vi.fn(),
      enterSelection: vi.fn(), removeFolder: vi.fn(), cancelPointer: vi.fn(), cancelTool: vi.fn(),
      activateNativeTool: vi.fn(), runCanvasShortcut: vi.fn(),
      blockNativeTool: () => calls.push("block"),
    });
    const event = {
      key: "a", code: "KeyA", defaultPrevented: true, isComposing: false, target: null,
      ctrlKey: false, shiftKey: false, metaKey: false, altKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    keyboard.onKeyDown(event);
    expect(calls).toEqual(["block"]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("blocks code-less A on a button, but leaves editable text and Ctrl+A alone", () => {
    const calls: string[] = [];
    const keyboard = createCanvasKeyboardController({
      selection: () => EMPTY_CANVAS_SELECTION, menuOpen: () => false,
      pointerSession: () => "idle", pendingTool: () => false, pendingSelectionTool: () => false,
      editableTarget: () => true,
      textEntryTarget: (target) => target === ("input" as unknown as EventTarget),
      shortcutPreferences: createCanvasShortcutPreferences,
      blockedShortcut: (_code, key) => key.toLowerCase() === "a",
      hasEnterTarget: () => false, hasFolderDeleteTarget: () => false,
      undo: vi.fn(), redo: vi.fn(), removeSelection: vi.fn(), closeMenu: vi.fn(),
      enterSelection: vi.fn(), removeFolder: vi.fn(), cancelPointer: vi.fn(), cancelTool: vi.fn(),
      activateNativeTool: vi.fn(), runCanvasShortcut: vi.fn(),
      blockNativeTool: () => calls.push("block"),
    });
    const makeEvent = (target: EventTarget, ctrlKey = false) => ({
      key: "a", code: "", defaultPrevented: false, isComposing: false, target,
      ctrlKey, shiftKey: false, metaKey: false, altKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
    }) as unknown as KeyboardEvent;
    const button = makeEvent("button" as unknown as EventTarget);
    keyboard.onKeyDown(button);
    expect(calls).toEqual(["block"]);
    expect(button.preventDefault).toHaveBeenCalledOnce();
    const input = makeEvent("input" as unknown as EventTarget);
    keyboard.onKeyDown(input);
    expect(input.preventDefault).not.toHaveBeenCalled();
    const selectAll = makeEvent("button" as unknown as EventTarget, true);
    keyboard.onKeyDown(selectAll);
    expect(selectAll.preventDefault).not.toHaveBeenCalled();
  });

  it("lets an open top-layer dialog consume keys before canvas routing", () => {
    const calls: string[] = [];
    const keyboard = createCanvasKeyboardController({
      selection: () => EMPTY_CANVAS_SELECTION, menuOpen: () => false,
      pointerSession: () => "idle", pendingTool: () => false, pendingSelectionTool: () => false,
      editableTarget: () => false, shortcutPreferences: createCanvasShortcutPreferences,
      blockedShortcut: () => false, hasEnterTarget: () => false, hasFolderDeleteTarget: () => false,
      undo: vi.fn(), redo: vi.fn(), removeSelection: vi.fn(), closeMenu: vi.fn(),
      enterSelection: vi.fn(), removeFolder: vi.fn(), cancelPointer: vi.fn(), cancelTool: vi.fn(),
      activateNativeTool: vi.fn(), runCanvasShortcut: (shortcut) => calls.push(shortcut),
      blockNativeTool: vi.fn(), handleOverlayKeyDown: () => true,
    });
    const event = {
      key: "v", code: "KeyV", defaultPrevented: false, isComposing: false, target: null,
      ctrlKey: false, shiftKey: false, metaKey: false, altKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    keyboard.onKeyDown(event);
    expect(calls).toEqual([]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("keeps replay callbacks from recording and flushes only after the native barrier completes", () => {
    const scene = [{ id: "image-a", type: "image", x: 0, y: 0, width: 10, height: 10, isDeleted: false }] as never;
    const next = [{ id: "image-a", type: "image", x: 20, y: 0, width: 10, height: 10, isDeleted: false }] as never;
    const runtime = {
      globalHistoryRef: { current: new GlobalHistoryTimeline((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      pendingGlobalHistoryCommitRef: { current: null },
      globalHistoryReplayGateRef: { current: new AsyncHistoryReplayGate((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      nativeHistoryGestureBarrierRef: { current: new NativeGestureHistoryBarrier((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      globalHistoryScenePreviewRef: { current: null },
    };
    let snapshot = { business: {}, scene, selection: EMPTY_CANVAS_SELECTION } as never;
    const controller = createCanvasHistoryController(runtime as never, { capture: () => snapshot, apply: () => undefined, setStatus: vi.fn(), schedule: () => 1, cancelSchedule: vi.fn() });
    controller.synchronize(); controller.beginNativeGesture(scene); controller.finishNativeGesture(next);
    snapshot = { business: {}, scene: next, selection: EMPTY_CANVAS_SELECTION } as never;
    expect(controller.finishSceneChange(scene, next).completeNativeGesture).toBe(true);
    expect(runtime.globalHistoryRef.current.entries).toHaveLength(1);
    controller.beginReplay(next); expect(controller.finishSceneChange(next, next).replaying).toBe(true);
    expect(runtime.globalHistoryRef.current.entries).toHaveLength(1);
    controller.beginNativeGesture(next);
    expect(controller.finishNativeGesture(null)).toBe(false);
    expect(runtime.nativeHistoryGestureBarrierRef.current.active).toBe(false);
  });

  it("commits a pre-pointerup native image change as one image-move after folder-create", () => {
    const initialImage = [{ id: "image-a", type: "image", x: 0, y: 0, width: 10, height: 10, isDeleted: false }] as never;
    const movedImage = [{ id: "image-a", type: "image", x: 20, y: 0, width: 10, height: 10, isDeleted: false }] as never;
    const runtime = {
      globalHistoryRef: { current: new GlobalHistoryTimeline((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      pendingGlobalHistoryCommitRef: { current: null },
      globalHistoryReplayGateRef: { current: new AsyncHistoryReplayGate((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      nativeHistoryGestureBarrierRef: { current: new NativeGestureHistoryBarrier((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      globalHistoryScenePreviewRef: { current: null },
    };
    let snapshot = { business: {}, scene: [] as never, selection: EMPTY_CANVAS_SELECTION };
    const statuses: string[] = [];
    const controller = createCanvasHistoryController(runtime as never, {
      capture: () => snapshot as never,
      apply: (restored) => { snapshot = restored as typeof snapshot; },
      setStatus: (message) => statuses.push(message),
      schedule: () => 1,
      cancelSchedule: vi.fn(),
    });

    controller.synchronize();
    controller.queue("host", "folder-create");
    snapshot = { ...snapshot, scene: initialImage };
    controller.flush();

    controller.beginNativeGesture(initialImage);
    snapshot = { ...snapshot, scene: movedImage };
    expect(controller.finishSceneChange(initialImage, movedImage).completeNativeGesture).toBe(false);
    expect(runtime.globalHistoryRef.current.entries.map((entry) => entry.operation)).toEqual(["folder-create"]);
    expect(controller.finishNativeGesture(movedImage)).toBe(true);
    expect(runtime.globalHistoryRef.current.entries.map((entry) => entry.operation)).toEqual(["folder-create", "image-move"]);

    controller.replay("undo");
    expect(snapshot.scene[0]).toMatchObject({ x: 0 });
    expect(statuses.at(-1)).toBe("已撤销：image-move");
    controller.replay("redo");
    expect(snapshot.scene[0]).toMatchObject({ x: 20 });
    expect(statuses.at(-1)).toBe("已重做：image-move");
  });

  it("uses the native gesture baseline when Excalidraw mutates the prior image reference", () => {
    const image = { id: "image-a", type: "image", x: 0, y: 0, width: 10, height: 10, isDeleted: false };
    const scene = [image] as never;
    const runtime = {
      globalHistoryRef: { current: new GlobalHistoryTimeline((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      pendingGlobalHistoryCommitRef: { current: null },
      globalHistoryReplayGateRef: { current: new AsyncHistoryReplayGate((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      nativeHistoryGestureBarrierRef: { current: new NativeGestureHistoryBarrier((value: unknown) => structuredClone(value), (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)) },
      globalHistoryScenePreviewRef: { current: null },
    };
    let snapshot = { business: {}, scene, selection: EMPTY_CANVAS_SELECTION };
    const controller = createCanvasHistoryController(runtime as never, {
      capture: () => snapshot,
      apply: (restored) => { snapshot = restored; },
      setStatus: vi.fn(),
      schedule: () => 1,
      cancelSchedule: vi.fn(),
    });

    controller.synchronize();
    controller.beginNativeGesture(scene);
    image.x = 20;
    expect(controller.finishSceneChange(scene, scene)).toMatchObject({
      source: "mixed",
      completeNativeGesture: false,
    });
    expect(controller.finishNativeGesture(scene)).toBe(true);
    expect(runtime.globalHistoryRef.current.entries.map((entry) => entry.operation)).toEqual(["image-move"]);
  });

  it("keeps description transient synchronization before move start and flushes commits", () => {
    const calls: string[] = [];
    const adapter = createDescriptionRuntimeAdapter({ clearSelection: () => calls.push("clear"), synchronizeTransient: () => calls.push("sync"), moveStart: () => calls.push("start"), flush: () => calls.push("flush") });
    adapter.clearVisualSelection(); adapter.onAnchorDragStart(); adapter.onAnchorMoveCommitted();
    expect(calls).toEqual(["clear", "sync", "start", "flush"]);
  });
});
