import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";
import {
  CANVAS_GRID_SOURCE,
  CANVAS_TOOLBAR_ORDER,
  CANVAS_HELP_DEVELOPER,
  PRIMARY_CANVAS_TOOL_IDS,
  PRIMARY_CANVAS_TOOL_LABELS,
  codexHandoffStatusLabel,
  gridControlState,
} from "./canvasWorkspaceContract";
import {
  createCanvasShortcutPreferences,
  createCanvasShortcutRows,
} from "./canvasShortcutPreferences";

describe("Canvas 视觉工作区合同", () => {
  it("主工具带保持核心工具顺序，并把选区工具显示为选择", () => {
    expect(CANVAS_TOOLBAR_ORDER).toEqual([
      "menu",
      "selection",
      "description",
      "hand",
      "overview",
      "laser",
      "separator",
    ]);
    expect(PRIMARY_CANVAS_TOOL_IDS).toEqual([
      "selection",
      "description",
      "hand",
      "overview",
      "laser",
    ]);
    expect(PRIMARY_CANVAS_TOOL_LABELS.selection).toBe("选择");
    expect(PRIMARY_CANVAS_TOOL_LABELS).not.toHaveProperty("library");
    expect(PRIMARY_CANVAS_TOOL_IDS).not.toContain("more");
  });

  it("左侧与菜单网格入口只镜像同一套 Excalidraw 原生状态", () => {
    expect(CANVAS_GRID_SOURCE).toBe("excalidraw-native");
    expect(gridControlState(false)).toEqual({
      railPressed: false,
      menuChecked: false,
      nextNativeGridModeEnabled: true,
    });
    expect(gridControlState(true)).toEqual({
      railPressed: true,
      menuChecked: true,
      nextNativeGridModeEnabled: false,
    });
  });

  it("从 AI Canvas 界面完全隐藏 Excalidraw 原生素材库入口", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const normalized = appSource.replace(/\r\n?/g, "\n");
    expect(normalized).not.toContain('aria-label="素材库"');
    expect(normalized).not.toContain("openExcalidrawLibrary");
    expect(normalized).not.toContain("<span>素材库</span>");
    expect(normalized).not.toContain('tab: "library"');
    expect(normalized).toContain('aria-pressed={workbenchPreferences.gridVisible}');
    expect(normalized).toContain('onClick={toggleGrid}');
  });

  it("快速标注使用独立工具入口和单一业务覆盖层", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const overlaySource = readFileSync(
      new URL("./QuickAnnotationOverlay.tsx", import.meta.url),
      "utf8",
    );
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(appSource).toContain('aria-label="快速标注"');
    expect(appSource).toContain("<QuickAnnotationOverlay");
    expect(appSource).toContain('"quick-annotation-create"');
    expect(appSource).toContain('"quick-annotation-delete"');
    expect(overlaySource).toContain("distance < 4");
    expect(overlaySource).toContain('mode: "point"');
    expect(overlaySource).toContain('mode: "rectangle"');
    expect(overlaySource).toContain("Q{annotation.ordinal}");
    expect(stylesSource).toContain("--quick-annotation-accent");
    expect(stylesSource).toContain(".quick-annotation-overlay__rectangle");
  });

  it("无图片时禁用快速标注入口并保护内部启动路径", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(appSource).toContain(
      "const hasCanvasImages = Object.keys(business.imageAssets).length > 0;",
    );
    expect(appSource).toContain(
      "Object.keys(businessRef.current.imageAssets).length === 0",
    );
    const disabledQuickButtons = appSource.match(
      /aria-label="快速标注"[\s\S]{0,320}?disabled=\{!api \|\| busy \|\| !hasCanvasImages\}/g,
    ) ?? [];
    expect(disabledQuickButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("快速标注角标从光标预览、拖动、输入到建成连续，并使文本横排位于矩形上方", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const overlaySource = readFileSync(
      new URL("./QuickAnnotationOverlay.tsx", import.meta.url),
      "utf8",
    );
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(appSource).toContain("nextOrdinal={");
    expect(overlaySource).toContain("const [cursorPreview, setCursorPreview]");
    expect(overlaySource).toContain("const draftBadgePoint = creationDraft");
    expect(overlaySource).toContain("className={`quick-annotation-overlay__cursor-badge");
    expect(overlaySource).toContain("quick-annotation-overlay__pending-badge");
    expect(stylesSource).toMatch(
      /\.quick-annotation-overlay\.is-creating:has\(\.quick-annotation-overlay__pending-badge\)\s+\.quick-annotation-overlay__svg\s*\{[^}]*cursor:\s*default;/s,
    );
    expect(overlaySource).toContain("const pendingRectangleCorners =");
    expect(overlaySource).toContain("localToNormalized(creationDraft.startLocal, image)");
    expect(overlaySource).toContain("anchor: localToNormalized(draft.startLocal, image)");
    expect(overlaySource).toContain("quick-annotation-overlay__connector");
    expect(stylesSource).toContain(".quick-annotation-overlay__cursor-badge");
    expect(stylesSource).toContain(".quick-annotation-overlay__badge");
    expect(stylesSource).toContain("--quick-annotation-accent: #1687f2");
    expect(stylesSource).toContain("transform: none;");
    expect(stylesSource).toMatch(
      /\.quick-annotation-overlay__item\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(stylesSource).toMatch(
      /\.quick-annotation-overlay__text\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(stylesSource).toMatch(
      /\.quick-annotation-overlay__item\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*min\(280px, 38vw\);/s,
    );
    expect(stylesSource).toMatch(
      /\.quick-annotation-overlay__badge\s*\{[^}]*width:\s*max-content;[^}]*flex:\s*0 0 auto;/s,
    );
    expect(stylesSource).toMatch(
      /\.quick-annotation-overlay__text\s*\{[^}]*width:\s*auto;[^}]*flex:\s*1 1 auto;/s,
    );
  });

  it("让帮助列表独立滚动并将开发者信息固定在首列", () => {
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
      .replace(/\r\n?/g, "\n");
    expect(stylesSource).toMatch(
      /\.canvas-dialog--help dl\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*padding-bottom:\s*12px;/s,
    );
    expect(stylesSource).toMatch(
      /\.canvas-dialog--help dl\s*\{[^}]*padding-right:\s*16px;[^}]*scrollbar-color:[^;]+;[^}]*scrollbar-width:\s*thin;/s,
    );
    expect(stylesSource).toContain(
      ".canvas-dialog--help dl::-webkit-scrollbar-track",
    );
    expect(stylesSource).toContain(
      ".canvas-dialog--help dl::-webkit-scrollbar-thumb",
    );
    expect(stylesSource).toMatch(
      /\.canvas-dialog--help\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(stylesSource).toMatch(
      /\.canvas-dialog__developer\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-start;[^}]*justify-content:\s*flex-start;[^}]*gap:\s*2px;/s,
    );
  });

  it("在所有窗口尺寸隐藏 Excalidraw 原生提示层", () => {
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
      .replace(/\r\n?/g, "\n");
    expect(stylesSource).toMatch(
      /\.app-shell--overview-reference \.canvas-panel \.HintViewer\s*\{[^}]*display:\s*none !important;/s,
    );
  });

  it("窄屏继续使用桌面紧凑工具栏尺寸", () => {
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
      .replace(/\r\n?/g, "\n");
    const narrowStart = stylesSource.indexOf("@media (max-width: 780px)");
    const narrowEnd = stylesSource.indexOf("@media", narrowStart + 1);
    const narrowBlock = stylesSource.slice(
      narrowStart,
      narrowEnd === -1 ? undefined : narrowEnd,
    );
    expect(narrowStart).toBeGreaterThanOrEqual(0);
    expect(narrowBlock).toMatch(
      /\.app-shell--overview-reference \.left-tool-rail\s*\{[^}]*width:\s*48px;/s,
    );
    expect(narrowBlock).toMatch(
      /\.app-shell--overview-reference \.tool-button,[^}]*width:\s*38px;/s,
    );
    expect(narrowBlock).toContain("--tool-rail-control-width: 38px;");
    expect(narrowBlock).not.toContain("width: 104px;");
    expect(narrowBlock).not.toContain("width: 88px;");
  });

  it("使用清晰且间距可控的虚线框选轮廓", () => {
    const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8")
      .replace(/\r\n?/g, "\n");
    expect(stylesSource).toMatch(
      /\.canvas-object-marquee\s*\{[^}]*--canvas-object-marquee-stroke:\s*rgba\(104, 85, 143, 0\.88\);[^}]*border:\s*0;[^}]*background:\s*rgba\(104, 85, 143, 0\.1\);[^}]*box-shadow:\s*none;/s,
    );
    expect(stylesSource).toContain("var(--canvas-object-marquee-stroke) 0 6px");
    expect(stylesSource).toContain("transparent 6px 10px");
    expect(stylesSource).toMatch(
      /\.canvas-object-marquee\.is-contain\s*\{[^}]*#6d8ca8[^}]*rgba\(96, 146, 192, 0\.09\)/s,
    );
    expect(stylesSource).toMatch(
      /\.canvas-object-marquee\.is-intersect\s*\{[^}]*#765da2[^}]*rgba\(118, 93, 162, 0\.1\)/s,
    );
  });

  it("帮助只展示开发者 Cue 与邮箱纯文字", () => {
    expect(CANVAS_HELP_DEVELOPER).toEqual({
      label: "开发者 Cue",
      email: "liu355609@gmail.com",
    });
  });

  it("Codex Read 只表达准备状态，不假称已经读取", () => {
    expect(codexHandoffStatusLabel({ prepared: false, descriptionCount: 0 }))
      .toBe("等待说明");
    expect(codexHandoffStatusLabel({ prepared: false, descriptionCount: 2 }))
      .toBe("待准备");
    expect(codexHandoffStatusLabel({ prepared: true, descriptionCount: 2 }))
      .toBe("已准备，等待 Codex 读取");
  });

  it("设置和帮助可从同一份当前快捷键配置生成显示", () => {
    const preferences = {
      ...createCanvasShortcutPreferences(),
      overview: ["Alt+O"],
    };
    const settingsRows = createCanvasShortcutRows(preferences);
    const helpRows = createCanvasShortcutRows(preferences);
    expect(settingsRows).toEqual(helpRows);
    expect(settingsRows.find((row) => row.id === "overview")).toMatchObject({
      display: "Alt + O",
    });
  });
});
