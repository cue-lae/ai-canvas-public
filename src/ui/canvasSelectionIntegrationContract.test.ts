import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const descriptionWorkspaceSource = readFileSync(
  new URL("./DescriptionWorkspace.tsx", import.meta.url),
  "utf8",
);
const descriptionWorkspaceInteractionSource = readFileSync(
  new URL("./descriptionWorkspaceInteraction.ts", import.meta.url),
  "utf8",
);
const selectionOverlaySource = readFileSync(
  new URL("./SelectionCanvasOverlay.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("V9 阶段 B 选择与指针收敛合同", () => {
  it("App 只通过 CanvasSelection 投影原生选中态，且不存在宿主 window marquee", () => {
    expect(appSource).toContain("projectCanvasSelectionToNativeElementIds");
    expect(appSource).toContain("createCanvasPointerController");
    expect(appSource).toContain("resize: pointerDownState.resize");
    expect(appSource).toContain("createCanvasPointerController");
    expect(appSource).toContain("onBlockedFreedraw");
    expect(appSource).not.toContain("nativeElementIds");
    expect(appSource).not.toContain("canvasMarqueeDragRef");
    expect(appSource).not.toContain('window.addEventListener("pointermove"');
    expect(appSource).not.toContain('window.addEventListener("pointerup"');
  });

  it("local input integration", () => {
    const historyControllerBlock = appSource.slice(
      appSource.indexOf("const historyController = useMemo"),
      appSource.indexOf("const queueGlobalHistoryCommit"),
    );
    const pointerControllerBlock = appSource.slice(
      appSource.indexOf("const canvasPointerController = useMemo"),
      appSource.indexOf("const handleAppPointerDownCapture"),
    );
    expect(appSource).toContain("handleAppPointerDownCapture");
    expect(appSource).toContain(
      "onPointerDownCapture={handleAppPointerDownCapture}",
    );
    expect(appSource).toContain("createCanvasKeyboardController");
    expect(appSource).toContain("onPointerMoveCapture={handleCanvasPointerMoveCapture}");
    expect(appSource).toContain("onPointerUpCapture={handleCanvasPointerUpCapture}");
    expect(appSource).toContain("createCanvasHistoryRuntime");
    expect(appSource).toContain("createCanvasPointerRuntime");
    expect(appSource).toContain("historyController.finishSceneChange(previousElements, synchronizedElements)");
    expect(appSource).toContain("historyController.finishNativeGesture(sceneElements)");
    expect(appSource).toContain(
      "onNativeGestureCancel: () => historyController.finishNativeGesture(null)",
    );
    expect(appSource).toContain(
      "() => canvasSelectionController.deleteSelection()",
    );
    expect(historyControllerBlock).toContain(
      "createCanvasHistoryController(canvasHistoryRuntime",
    );
    expect(historyControllerBlock).toContain(
      "[canvasHistoryRuntime, captureGlobalHistorySnapshot]",
    );
    expect(historyControllerBlock).not.toContain("interactionRuntime");
    expect(pointerControllerBlock).toContain(
      "createCanvasPointerController(canvasPointerRuntime",
    );
    expect(pointerControllerBlock).toContain("canvasPointerRuntime");
    expect(pointerControllerBlock).not.toContain("interactionRuntime");
    expect(appSource).not.toContain("classifyGlobalHistorySceneChange");
    expect(appSource).not.toContain("Legacy selection mutation body");
    expect(appSource).not.toContain("finishHostMarquee");
    expect(appSource).not.toContain("beginHostMarquee");
    expect(appSource.match(/const handleCanvasPointerUpCapture/g)).toHaveLength(1);
    expect(appSource.match(/const handleCanvasPointerCancelCapture/g)).toHaveLength(1);
  });

  it("keeps the existing image and selection kind armed across successful continuous regions", () => {
    const creationBlock = appSource.slice(
      appSource.indexOf("const handleSelectionCreate"),
      appSource.indexOf("const handleSelectionCreationRejected"),
    );
    const rejectionBlock = appSource.slice(
      appSource.indexOf("const handleSelectionCreationRejected"),
      appSource.indexOf("const handleSelectionRegionSelect"),
    );
    const cancelBlock = appSource.slice(
      appSource.indexOf("const cancelPendingAnnotationSelection"),
      appSource.indexOf("const beginManualAnnotation"),
    );
    const toolSwitchBlock = appSource.slice(
      appSource.indexOf("const activateCanvasTool"),
      appSource.indexOf("const beginBubbleAnnotation"),
    );

    expect(creationBlock).toContain("commitBusiness((current) => ({");
    expect(creationBlock).toContain(
      "updateCanvasSelection(createCanvasSelection({ regionIds: [regionId] }))",
    );
    expect(creationBlock).toContain("setSelectedRegionId(regionId);");
    expect(creationBlock).toContain("captureUpdate: CaptureUpdateAction.IMMEDIATELY");
    expect(creationBlock).toContain("已创建选区；可继续创建同类型选区，按 Esc 退出。");
    expect(creationBlock).not.toContain("pendingRegionRef.current = null;");
    expect(creationBlock).not.toContain("setActiveSelectionTool(null);");
    expect(creationBlock).not.toContain("setActiveSelectionImageId(null);");
    expect(creationBlock).not.toContain('api.setActiveTool({ type: "selection" });');

    expect(rejectionBlock).toContain("请在当前图片内部创建至少 4 × 4 的选区。");
    expect(rejectionBlock).not.toContain("pendingRegionRef.current = null;");
    expect(rejectionBlock).not.toContain("setActiveSelectionTool(null);");
    expect(rejectionBlock).not.toContain("setActiveSelectionImageId(null);");

    expect(cancelBlock).toContain("pendingRegionRef.current = null;");
    expect(cancelBlock).toContain("setActiveSelectionTool(null);");
    expect(cancelBlock).toContain("setActiveSelectionImageId(null);");
    expect(cancelBlock).toContain('api?.setActiveTool({ type: "selection" });');
    expect(toolSwitchBlock).toContain("pendingRegionRef.current = null;");
    expect(toolSwitchBlock).toContain("setActiveSelectionTool(null);");
    expect(toolSwitchBlock).toContain("setActiveSelectionImageId(null);");
  });

  it("画布点击已绑定选区只负责选中，关联变化只通过说明工作区显式按钮", () => {
    const selectionBlock = appSource.slice(
      appSource.indexOf("const handleSelectionRegionSelect"),
      appSource.indexOf("const handleSelectionVertexChange"),
    );

    expect(selectionBlock).toContain("(regionId: string) => {");
    expect(selectionBlock).toContain(
      "createCanvasSelection({ regionIds: [selection.regionId] })",
    );
    expect(selectionBlock).not.toContain("toggleBinding");
    expect(selectionBlock).not.toContain("handleDescriptionScopeToggle");
    expect(selectionBlock).toContain("if (!isDescriptionWorkspaceOpen) {");
    expect(appSource).toContain("onToggleScope={handleDescriptionScopeToggle}");
  });

  it("说明只由右侧工作区承载，收拢手势不建立第二套业务状态", () => {
    expect(appSource).toContain("<DescriptionWorkspace");
    expect(appSource).not.toContain("<DescriptionCanvasOverlayAdapter");
    expect(descriptionWorkspaceSource).toContain("setPointerCapture(event.pointerId)");
    expect(descriptionWorkspaceSource).toContain("onPointerMove={handleEdgePointerMove}");
    expect(descriptionWorkspaceSource).toContain("onClick={handleEdgeClick}");
    expect(descriptionWorkspaceSource).toContain("suppressEdgeClickRef");
    expect(descriptionWorkspaceSource).toContain("scopeGroups.map");
    expect(descriptionWorkspaceInteractionSource).toContain(
      "Drawer progress is view-only",
    );
    expect(descriptionWorkspaceInteractionSource).not.toContain("BusinessState");
  });

  it("说明编辑器打开时空白点击不关闭，只允许收拢控件结束编辑态", () => {
    const blankClickBlock = appSource.slice(
      appSource.indexOf("onBlankClick: () =>"),
      appSource.indexOf("onMarqueeSelection:", appSource.indexOf("onBlankClick: () =>")),
    );
    const editorGuard = blankClickBlock.slice(
      0,
      blankClickBlock.indexOf('if (folderNavigationRef.current.layer === "preview")'),
    );
    expect(blankClickBlock).toContain("if (isDescriptionWorkspaceOpen)");
    expect(blankClickBlock).toContain("说明编辑器保持展开");
    expect(editorGuard).not.toContain("setIsDescriptionWorkspaceOpen(false);");
    const escapeBlock = appSource.slice(
      appSource.indexOf("const closeDescriptionEditorOnEscape"),
      appSource.indexOf("window.addEventListener(\"keydown\", closeDescriptionEditorOnEscape", appSource.indexOf("const closeDescriptionEditorOnEscape")),
    );
    expect(escapeBlock).toContain("setIsDescriptionWorkspaceOpen(false);");
    expect(escapeBlock).toContain("说明编辑器已收起");
  });

  it("说明编辑器打开时隐藏图片资料，并让实际选区提示优先", () => {
    const contextInformationBlock = appSource.slice(
      appSource.indexOf("const contextInformationData = useMemo"),
      appSource.indexOf("useEffect(() =>", appSource.indexOf("const contextInformationData = useMemo")),
    );
    expect(contextInformationBlock).toContain(
      'if (isDescriptionWorkspaceOpen && selectionTarget.kind === "image")',
    );
    expect(contextInformationBlock).toContain(
      "isDescriptionWorkspaceOpen",
    );

    const contextPreviewBlock = appSource.slice(
      appSource.indexOf('<section className="context-preview"'),
      appSource.indexOf('<section className="context-focus"'),
    );
    expect(contextPreviewBlock.indexOf("selectedRegionId ?")).toBeGreaterThan(-1);
    expect(contextPreviewBlock.indexOf("selectedRegionId ?")).toBeLessThan(
      contextPreviewBlock.indexOf("activeDescriptionId ?"),
    );
    expect(contextPreviewBlock).toContain("已选选区：选区");
    expect(contextPreviewBlock).toContain("selectedSelectionOrdinal");
  });

  it("说明编辑器把可见文件夹纳入重叠判定，原生回到内容入口复用全览画布", () => {
    const descriptionUnderlayBlock = appSource.slice(
      appSource.indexOf("const visibleDescriptionIds = new Set"),
      appSource.indexOf("const updateUnderlay = () =>", appSource.indexOf("const visibleDescriptionIds = new Set")),
    );
    expect(descriptionUnderlayBlock).toContain(
      "panel.querySelectorAll<HTMLElement>('[data-canvas-object=\"folder\"]')",
    );
    expect(descriptionUnderlayBlock).toContain(
      'querySelector<HTMLElement>(".folder-workspace-hit-target")',
    );
    expect(descriptionUnderlayBlock).toContain(
      "without committing scene coordinates on every pointermove",
    );
    expect(descriptionUnderlayBlock).toContain(
      "hasDescriptionUnderlay || hasFolderUnderlay || hasImageUnderlay",
    );

    const scrollBackBlock = appSource.slice(
      appSource.indexOf("const handleCanvasClickCapture"),
      appSource.indexOf("const resetCanvasSession"),
    );
    expect(scrollBackBlock).toContain(
      'target.closest(".scroll-back-to-content")',
    );
    expect(scrollBackBlock).toContain("event.preventDefault();");
    expect(scrollBackBlock).toContain("event.stopPropagation();");
    expect(scrollBackBlock).toContain("showCanvasOverview();");
    expect(appSource).toContain(
      "onClickCapture={handleCanvasClickCapture}",
    );
  });

  it("再次进入文件夹时在绘制前恢复上次视口，不闪出默认位置", () => {
    const restoreStart = appSource.indexOf(
      "const pendingRestore = pendingFolderViewportRestoreRef.current",
    );
    const restoreBlock = appSource.slice(
      restoreStart,
      appSource.indexOf(
        "}, [api, folderNavigation, folderPreviewMotion, renderCanonicalScene])",
        restoreStart,
      ),
    );
    expect(restoreStart).toBeGreaterThan(-1);
    expect(restoreBlock).toContain('folderNavigation.layer === "folder"');
    expect(restoreBlock).toContain("api.updateScene({");
    expect(restoreBlock).toContain("captureUpdate: CaptureUpdateAction.NEVER");

    const savedViewportStart = appSource.indexOf(
      "const savedViewport = folderViewportRef.current[folderId]",
    );
    const savedViewportBranch = appSource.slice(
      savedViewportStart,
      appSource.indexOf("} else {", savedViewportStart),
    );
    expect(savedViewportBranch).toContain(
      "pendingFolderViewportRestoreRef.current = {",
    );
    expect(savedViewportBranch).not.toContain("requestAnimationFrame");
  });

  it("方向框选、选区和说明保持蓝/亮蓝/紫语义", () => {
    expect(selectionOverlaySource).toContain("selectedRegionIds.has(selection.regionId)");
    expect(selectionOverlaySource).not.toContain("selectedRegionId:");
    expect(stylesSource).toContain("--canvas-object-marquee-stroke: #6d8ca8;");
    expect(stylesSource).toContain("stroke: #82add8;");
    expect(stylesSource).toContain("stroke: #765da2;");
    expect(stylesSource).toContain("background: rgba(96, 146, 192, 0.09);");
    expect(stylesSource).toContain("background: rgba(118, 93, 162, 0.1);");
  });

  it("多说明关系由纯 DTO 投影到选区标签，并先打开同一工作区再切换说明", () => {
    expect(appSource).toContain("regionBindings={descriptionRegionBindings}");
    expect(appSource).toContain("highlightedRegionIds={boundRegionIds}");
    expect(appSource).toContain("onSelectRegionFromBadge={handleSelectionRegionBadgeSelect}");
    expect(appSource).toContain("onActivateDescription={handleDescriptionSwitch}");
    expect(selectionOverlaySource).toContain("selection-canvas-overlay__badge-group");
    expect(selectionOverlaySource).toContain("horizontalSelectionBadgeLayout");
    expect(selectionOverlaySource).toContain("bindings: row.bindings");
    expect(selectionOverlaySource).toContain("segment.text");
    expect(selectionOverlaySource).not.toContain("hiddenBindingCount");
    expect(selectionOverlaySource).not.toContain("+{row.");
    const descriptionSwitchBlock = appSource.slice(
      appSource.indexOf("const handleDescriptionSwitch"),
      appSource.indexOf("const focusDescriptionImage"),
    );
    expect(descriptionSwitchBlock).toContain("setIsDescriptionWorkspaceOpen(true)");
    expect(descriptionSwitchBlock).toContain(
      "updateCanvasSelection(createCanvasSelection({ descriptionIds: [descriptionId] }))",
    );
    expect(descriptionSwitchBlock).toContain("descriptionHost.switchTo(descriptionId)");
    expect(
      descriptionSwitchBlock.indexOf("setIsDescriptionWorkspaceOpen(true)"),
    ).toBeLessThan(
      descriptionSwitchBlock.indexOf("descriptionHost.switchTo(descriptionId)"),
    );
    expect(
      descriptionSwitchBlock.indexOf("descriptionHost.switchTo(descriptionId)"),
    ).toBeLessThan(
      descriptionSwitchBlock.indexOf(
        "updateCanvasSelection(createCanvasSelection({ descriptionIds: [descriptionId] }))",
      ),
    );
    expect(appSource).toContain("createWorkspaceDescription(selection.regionId, false)");
    const descriptionCreateBlock = appSource.slice(
      appSource.indexOf("const createWorkspaceDescription"),
      appSource.indexOf("const beginDescription"),
    );
    expect(descriptionCreateBlock).toContain(
      "createCanvasSelection({ regionIds: [regionId] })",
    );
    expect(descriptionCreateBlock).toContain("EMPTY_CANVAS_SELECTION");
    expect(descriptionCreateBlock).not.toContain(
      "createCanvasSelection({ descriptionIds: [descriptionId] })",
    );
    const beginBlock = appSource.slice(appSource.indexOf("const beginDescription = useCallback"), appSource.indexOf("const beginQuickAnnotation = useCallback"));
    expect(beginBlock).toContain("createWorkspaceDescription(undefined, true)");
    expect(appSource).not.toContain("新建说明：单击画布放置锚点");
    expect(descriptionWorkspaceSource).toContain("scopeGroups.map");
    expect(descriptionWorkspaceSource).toContain("onFocusImage(group.imageId)");
    expect(descriptionWorkspaceSource).toContain("onFocusScope(scope.regionId)");
    expect(descriptionWorkspaceSource).toContain(
      "尚无选区；此说明作用于整张画布。",
    );
    expect(descriptionWorkspaceSource).toContain("打开参考网页");
    expect(descriptionWorkspaceSource).toContain("请输入完整的 http(s) 链接。");
  });
});
