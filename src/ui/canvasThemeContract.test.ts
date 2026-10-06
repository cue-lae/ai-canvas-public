import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";
import {
  CANVAS_THEME_IDS,
  CANVAS_THEMES,
  DEFAULT_CANVAS_THEME_ID,
  canvasThemeAppState,
  canvasThemeCssVariables,
  canvasThemeIdFromAppState,
  canvasThemeViewBackgroundColor,
  contrastRatio,
  resolveCanvasTheme,
  resolveCanvasThemeToggle,
} from "./canvasThemeContract";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n",
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8").replace(
  /\r\n?/g,
  "\n",
);

const parseHexRgb = (color: string): readonly [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16) / 255,
  Number.parseInt(color.slice(3, 5), 16) / 255,
  Number.parseInt(color.slice(5, 7), 16) / 255,
];

const applyExcalidrawDarkCanvasFilter = (color: string): readonly number[] => {
  const [red, green, blue] = parseHexRgb(color).map(
    (channel) => 0.93 - channel * 0.86,
  );
  return [
    -0.574 * red + 1.43 * green + 0.144 * blue,
    0.426 * red + 0.43 * green + 0.144 * blue,
    0.426 * red + 1.43 * green - 0.856 * blue,
  ].map((channel) => Math.round(channel * 255));
};

describe("Canvas theme contract", () => {
  it("exposes the seven fixed themes", () => {
    expect(CANVAS_THEME_IDS).toEqual([
      "white",
      "black",
      "blue",
      "green",
      "pink",
      "purple",
      "yellow",
    ]);
    expect(Object.keys(CANVAS_THEMES)).toEqual(CANVAS_THEME_IDS);
    expect(DEFAULT_CANVAS_THEME_ID).toBe("white");
  });

  it("falls back safely to white", () => {
    expect(resolveCanvasTheme("missing").id).toBe(DEFAULT_CANVAS_THEME_ID);
    expect(canvasThemeIdFromAppState({ theme: "unexpected" })).toBe(
      DEFAULT_CANVAS_THEME_ID,
    );
  });

  it("keeps themes color-only and readable", () => {
    const forbiddenLayoutKeys = [
      "width",
      "height",
      "padding",
      "margin",
      "gap",
      "radius",
      "placement",
      "layout",
    ];
    CANVAS_THEME_IDS.forEach((themeId) => {
      const theme = CANVAS_THEMES[themeId];
      expect(Object.keys(theme).some((key) => forbiddenLayoutKeys.includes(key)))
        .toBe(false);
      expect(theme.shell).not.toBe(theme.canvas);
      expect(contrastRatio(theme.text, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.icon, theme.surface)).toBeGreaterThanOrEqual(3);
    });
  });

  it("maps theme tokens to the host and Excalidraw", () => {
    expect(canvasThemeAppState("black")).toEqual({
      theme: "dark",
      viewBackgroundColor: canvasThemeViewBackgroundColor(
        CANVAS_THEMES.black.canvas,
        "dark",
      ),
    });
    expect(canvasThemeAppState("blue")).toEqual({
      theme: "light",
      viewBackgroundColor: CANVAS_THEMES.blue.canvas,
    });
    expect(canvasThemeCssVariables("green")).toMatchObject({
      "--canvas-shell": CANVAS_THEMES.green.shell,
      "--canvas-surface": CANVAS_THEMES.green.surface,
      "--canvas-background": CANVAS_THEMES.green.canvas,
      "--canvas-object-surface": "#f5f7f2",
      "--canvas-status-surface": "#f5f7f2",
      "--canvas-text": CANVAS_THEMES.green.text,
      "--canvas-header": CANVAS_THEMES.green.header,
      "--canvas-rail": CANVAS_THEMES.green.rail,
      "--canvas-toolbar": CANVAS_THEMES.green.toolbar,
      "--canvas-handoff": CANVAS_THEMES.green.handoff,
    });
  });

  it("uses the blue lightness gap for non-neutral object card surfaces", () => {
    expect(CANVAS_THEMES).toMatchObject({
      blue: { objectSurface: "#fafbfe" },
      green: { objectSurface: "#f5f7f2" },
      pink: { objectSurface: "#fef8fa" },
      purple: { objectSurface: "#faf9ff" },
      yellow: { objectSurface: "#fcfaf5" },
    });
    expect(CANVAS_THEMES.white).not.toHaveProperty("objectSurface");
    expect(CANVAS_THEMES.black.objectSurface).toBe("#414247");
    expect(canvasThemeCssVariables("white")).not.toHaveProperty(
      "--canvas-object-surface",
    );
    expect(canvasThemeCssVariables("black")).toMatchObject({
      "--canvas-object-surface": "#414247",
      "--canvas-status-surface": "#414247",
    });
    expect(canvasThemeCssVariables("white")).not.toHaveProperty(
      "--canvas-status-surface",
    );
    expect(canvasThemeCssVariables("black")).toHaveProperty(
      "--canvas-status-surface",
      "#414247",
    );
  });

  it("routes colored global status pills through their explicit status surface", () => {
    expect(CANVAS_THEMES.blue.statusSurface).toBe("#fafbfe");
    expect(CANVAS_THEMES.green.statusSurface).toBe("#f5f7f2");
    expect(CANVAS_THEMES.pink.statusSurface).toBe("#fef8fa");
    expect(CANVAS_THEMES.purple.statusSurface).toBe("#faf9ff");
    expect(CANVAS_THEMES.yellow.statusSurface).toBe("#fcfaf5");
    const statusPillBlock = stylesSource.slice(
      stylesSource.indexOf("/* Global canvas status surfaces"),
    );
    expect(statusPillBlock).toContain(".is-theme-blue,");
    expect(statusPillBlock).toContain(".is-theme-yellow");
    expect(statusPillBlock).toContain(
      ":is(.header-status, .canvas-selection-chip).has-content-underlay",
    );
    expect(statusPillBlock).toContain("var(--canvas-status-surface) 53%");
  });

  it("keeps colored object and status surfaces synchronized", () => {
    for (const themeId of ["blue", "green", "pink", "purple", "yellow"] as const) {
      expect(CANVAS_THEMES[themeId].statusSurface).toBe(
        CANVAS_THEMES[themeId].objectSurface,
      );
    }
  });

  it("keeps the black object and global status surfaces synchronized", () => {
    expect(CANVAS_THEMES.black.objectSurface).toBe("#414247");
    expect(CANVAS_THEMES.black.statusSurface).toBe("#414247");
    expect(CANVAS_THEMES.black.statusSurface).toBe(
      CANVAS_THEMES.black.objectSurface,
    );
  });

  it("projects each theme canvas token into Excalidraw without creating history", () => {
    CANVAS_THEME_IDS.filter(
      (themeId) => CANVAS_THEMES[themeId].excalidrawTheme === "light",
    ).forEach((themeId) => {
      expect(canvasThemeAppState(themeId).viewBackgroundColor).toBe(
        CANVAS_THEMES[themeId].canvas,
      );
    });
    expect(CANVAS_THEMES.black.canvas).toBe("#323336");
    const filteredBlack = applyExcalidrawDarkCanvasFilter(
      canvasThemeAppState("black").viewBackgroundColor,
    );
    parseHexRgb(CANVAS_THEMES.black.canvas).forEach((channel, index) => {
      expect(Math.abs(filteredBlack[index] - Math.round(channel * 255))).toBeLessThanOrEqual(1);
    });

    const syncBlock = appSource.slice(appSource.indexOf("    const theme = canvasThemeAppState(workbenchPreferences.canvasTheme);"), appSource.indexOf("const applyGlobalHistorySnapshot"));
    expect(syncBlock).toContain("api.updateScene({ appState: theme, captureUpdate: CaptureUpdateAction.NEVER })");
    const preferenceBlock = appSource.slice(appSource.indexOf("const setCanvasTheme = useCallback"), appSource.indexOf("const toggleContextPanel = useCallback"));
    expect(preferenceBlock).toContain("writeApplicationTheme(canvasTheme, lastLightCanvasThemeRef.current)");
    expect(preferenceBlock).toContain("setWorkbenchPreferences");
  });

  it("maps each non-white reference by region without carrying layout state", () => {
    expect(CANVAS_THEMES).toMatchObject({
      blue: {
        header: "#f0f5fc",
        rail: "#f0f5fc",
        toolbar: "#f0f5fc",
        canvas: "#f5f8fd",
        handoff: "#f0f5fc",
        raised: "#fafbfe",
      },
      green: {
        header: "#e2e6de",
        rail: "#e3e6df",
        toolbar: "#e2e6de",
        canvas: "#f2f4ef",
        handoff: "#e2e6de",
        raised: "#eff1ec",
      },
      pink: {
        header: "#f3eaed",
        rail: "#f3eaed",
        toolbar: "#f4ecee",
        canvas: "#fbf5f7",
        handoff: "#f3eaed",
        raised: "#f8f0f2",
      },
      purple: {
        header: "#f0edf7",
        rail: "#f0eef8",
        toolbar: "#f7f5fd",
        canvas: "#f7f6fe",
        handoff: "#f0eef8",
        raised: "#f7f5fd",
      },
      yellow: {
        header: "#efebe6",
        rail: "#efece6",
        toolbar: "#efebe6",
        canvas: "#f9f7f2",
        handoff: "#efebe6",
        raised: "#f1eee9",
      },
      black: {
        header: "#232426",
        rail: "#232427",
        toolbar: "#1d1d1e",
        canvas: "#323336",
        handoff: "#202021",
        raised: "#1e1e20",
      },
    });
  });

  it("keeps the approved white geometry shared across every theme", () => {
    expect(CANVAS_THEMES.white).toMatchObject({
      shell: "#f7f7f7",
      surface: "#fbfbfc",
      canvas: "#fafafa",
      card: "#fafbfa",
    });
    expect(stylesSource).toContain(".app-shell .workspace,");
    expect(stylesSource).toContain("grid-template-columns: 88px minmax(0, 1fr);");
    expect(stylesSource).toContain(".app-shell .context-panel--bottom {");
    expect(stylesSource).toContain("bottom: 36px;");
    expect(stylesSource).toContain(
      ".app-shell .canvas-primary-toolbar > button,",
    );
    expect(stylesSource).toContain(
      ".app-shell .canvas-primary-toolbar .canvas-workspace-menu__trigger {",
    );
    expect(stylesSource).toContain(
      ".app-shell .canvas-primary-toolbar > button .canvas-tool-icon,",
    );
    expect(stylesSource).not.toContain(
      ".app-shell .canvas-primary-toolbar button {\n  width: 63px;",
    );
    expect(stylesSource).not.toContain(".app-shell.is-theme-white .workspace,");
    expect(stylesSource).not.toContain(".app-shell.is-theme-white .context-panel--bottom {");
    expect(stylesSource).toContain(
      ".canvas-primary-toolbar .canvas-workspace-menu__panel button,",
    );
    expect(stylesSource).toContain(
      ".canvas-primary-toolbar .canvas-workspace-menu__themes button {",
    );
    expect(stylesSource).not.toContain("Seven-theme canvas shell.");
  });

  it("restores the light theme that was active before entering black", () => {
    expect(resolveCanvasThemeToggle("blue", "blue")).toBe("black");
    expect(resolveCanvasThemeToggle("black", "blue")).toBe("blue");
    expect(resolveCanvasThemeToggle("black", "white")).toBe("white");
  });

  it("moves the black theme shortcut into the transparent view controls", () => {
    expect(appSource).toContain("canvas-view-controls");
    expect(appSource).toContain(
      'CANVAS_THEME_IDS.filter((themeId) => themeId !== "black")',
    );
    expect(appSource).toContain(
      'setCanvasTheme(\n                  resolveCanvasThemeToggle(\n                    canvasTheme,\n                    lastLightCanvasThemeRef.current,\n                  ),\n                )',
    );
    expect(appSource).toContain("setCanvasZoom(1)");
    expect(appSource).toContain("adjustCanvasZoom(-1)");
    expect(appSource).toContain("adjustCanvasZoom(1)");
    expect(stylesSource).toContain(".canvas-view-controls.has-content-underlay");
    expect(stylesSource).toContain("background: transparent;");
    expect(stylesSource).toContain(
      "padding: 3px;\n  border: 1px solid transparent;",
    );
    expect(stylesSource).toContain(
      ".canvas-view-controls .canvas-tool-icon {\n  width: 19px;\n  height: 19px;",
    );
    expect(stylesSource).toContain(
      ".canvas-view-controls__theme {\n  margin-right: 8px !important;",
    );
  });

  it("keeps the main status slightly larger and both status surfaces transparent", () => {
    const statusSurfaceBaseBlock = stylesSource.slice(
      stylesSource.indexOf(
        ".app-shell--overview-reference :is(.header-status, .canvas-selection-chip) {",
      ),
      stylesSource.indexOf("/* Global canvas status surfaces"),
    );
    expect(statusSurfaceBaseBlock).toContain("background: transparent;");
    expect(statusSurfaceBaseBlock).toContain("border-color: transparent;");
    expect(statusSurfaceBaseBlock).toContain("box-shadow: none;");
    expect(statusSurfaceBaseBlock).not.toContain("var(--canvas-raised)");
    expect(stylesSource).toContain(
      ".app-shell--overview-reference .header-status {\n  height: 34px;",
    );
    expect(stylesSource).toContain("padding: 6px 10px;");
    expect(stylesSource).toContain("font-size: 12px;");
    expect(stylesSource).toContain(".app-shell--overview-reference .canvas-selection-chip {\n  height: 30px;");
    expect(stylesSource).toContain("top: 60px;");
    expect(stylesSource).toContain("padding: 4px 8px;");
    expect(stylesSource).toContain("border: 0;\n  border-radius: 0;\n  background: transparent;");
    expect(stylesSource).toContain("box-shadow: none;\n  backdrop-filter: none;");
    expect(stylesSource).toContain(
      ":is(.header-status, .canvas-selection-chip).has-content-underlay",
    );
    expect(stylesSource).toContain("backdrop-filter: blur(12px);");
    expect(stylesSource).toContain(
      ".app-shell--overview-reference .header-status.has-content-underlay {\n  border-radius: 17px;",
    );
    expect(stylesSource).toContain(
      ".app-shell--overview-reference .canvas-selection-chip.has-content-underlay {\n  border-radius: 15px;",
    );
    expect(stylesSource).toContain("@media (min-width: 2200px)");
    expect(stylesSource).toContain(".app-shell--overview-reference .left-tool-rail {\n    top: 84px;");
    expect(stylesSource).toContain(".app-shell--overview-reference .canvas-view-controls {\n    left: 24px;");
    expect(stylesSource).toContain(".app-shell--overview-reference .tool-button {\n    width: 44px;");
    expect(stylesSource).toContain(".app-shell--overview-reference .context-information > strong {\n    font-size: 16px;");
    expect(stylesSource).toContain(".app-shell--overview-reference .app-brand-badge {\n    height: 36px;");
    expect(stylesSource).toContain(".app-settings-glyph {\n    font-size: 19px;");
    expect(stylesSource).toContain("white-space: nowrap;");
    expect(stylesSource).toContain("text-overflow: ellipsis;");
  });

  it("keeps the selection and image secondary status chip compact in full-screen", () => {
    const chipBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell--overview-reference .canvas-selection-chip {"),
      stylesSource.indexOf("/* Global canvas status pills", stylesSource.indexOf(".app-shell--overview-reference .canvas-selection-chip {")),
    );
    expect(chipBlock).toContain("max-width: min(42vw, 520px);");
    expect(chipBlock).toContain("z-index: 46;");
    expect(chipBlock).toContain("min-height: 30px;");
    expect(chipBlock).toContain("padding: 4px 8px;");
    expect(chipBlock).toContain("border-color: transparent;");
    expect(chipBlock).toContain("font-size: 12px;");
    expect(chipBlock).toContain("text-overflow: ellipsis;");
    expect(chipBlock).toContain("align-items: center;");
    expect(chipBlock).toContain("justify-content: center;");
    expect(chipBlock).toContain("text-align: center;");
    expect(stylesSource).toContain(".app-shell--overview-reference .canvas-selection-chip {\n  height: 30px;");
    expect(stylesSource).toContain("line-height: 20px;");
    expect(stylesSource).toContain("background: transparent;");
  });

  it("uses neutral dark shadows for black floating shells without changing semantic accents", () => {
    const blackFloatingShellBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell.is-theme-black .canvas-primary-toolbar,"),
      stylesSource.indexOf(".app-shell .context-panel--bottom .context-panel-header {"),
    );
    expect(blackFloatingShellBlock).toContain(
      ".app-shell.is-theme-black .context-panel--bottom",
    );
    expect(blackFloatingShellBlock).toContain(
      ".app-shell.is-theme-black .canvas-workspace-menu__panel",
    );
    expect(blackFloatingShellBlock).toContain(
      ".app-shell.is-theme-black .canvas-selection-chip",
    );
    expect(blackFloatingShellBlock).toContain("rgba(0, 0, 0,");
    expect(blackFloatingShellBlock).toContain("rgba(77, 79, 82,");
    expect(blackFloatingShellBlock).not.toContain("rgba(255, 255, 255,");
    expect(blackFloatingShellBlock).not.toContain(".tool-button.is-active");
    const blackStatusShadowBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell.is-theme-black .header-status.has-content-underlay,"),
      stylesSource.indexOf(".app-shell .context-panel--bottom .context-panel-header"),
    );
    expect(blackStatusShadowBlock).toContain(
      "box-shadow: 0 12px 30px color-mix(in srgb, var(--canvas-shadow) 8%, transparent);",
    );
    expect(blackStatusShadowBlock).not.toContain("rgba(0, 0, 0, 0.4)");
    expect(stylesSource).not.toContain(".app-shell.is-theme-black .header-status,");
    expect(stylesSource).not.toContain(".app-shell.is-theme-black .canvas-selection-chip {");
    const blackWorkspaceShadowBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell.is-theme-black .description-workspace {"),
      stylesSource.indexOf(".app-shell.is-theme-black .canvas-workspace-menu__panel {"),
    );
    expect(blackWorkspaceShadowBlock).toContain("-14px 18px 36px rgba(0, 0, 0, 0.42)");
    expect(blackWorkspaceShadowBlock).toContain("rgba(77, 79, 82, 0.34) inset");
    expect(blackWorkspaceShadowBlock).not.toContain("rgba(255, 255, 255,");
  });

  it("routes shared shadows through neutral tokens while scoping dark values to black", () => {
    const sharedThemeTokenBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell {\n  --canvas-shadow:"),
      stylesSource.indexOf(".app-shell.is-theme-black {"),
    );
    const blackThemeTokenBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell.is-theme-black {"),
      stylesSource.indexOf(".app-shell:not(.is-theme-black) {"),
    );
    expect(sharedThemeTokenBlock).toContain("--canvas-shadow: var(--canvas-text);");
    expect(sharedThemeTokenBlock).toContain("--canvas-highlight: #ffffff;");
    expect(blackThemeTokenBlock).toContain("--canvas-shadow: #000000;");
    expect(blackThemeTokenBlock).toContain("--canvas-highlight: #4d4f52;");
    expect(stylesSource).toContain(
      "box-shadow: 0 12px 30px color-mix(in srgb, var(--canvas-shadow) 8%, transparent);",
    );
    expect(stylesSource).toContain(
      "box-shadow: 1px 0 0 color-mix(in srgb, var(--canvas-highlight) 70%, transparent) inset;",
    );
  });

  it("uses one derived object surface for Folder and description cards", () => {
    const appShellTokenBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell {\n  --canvas-shadow:"),
      stylesSource.indexOf(".app-shell.is-theme-black {"),
    );
    expect(appShellTokenBlock).toContain(
      "--canvas-object-surface: var(--canvas-raised);",
    );
    const blackObjectSurfaceBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell.is-theme-black {"),
      stylesSource.indexOf(".app-shell:not(.is-theme-black) {"),
    );
    expect(blackObjectSurfaceBlock).toContain(
      "--canvas-object-surface: color-mix(\n    in srgb,\n    var(--canvas-background) 78%,\n    var(--canvas-text) 22%\n  );",
    );
    const folderBlock = stylesSource.slice(
      stylesSource.indexOf(".folder-workspace-hit-target {"),
      stylesSource.indexOf(".folder-workspace-hit-target:active {"),
    );
    const descriptionBlock = stylesSource.slice(
      stylesSource.indexOf(".folder-description-item {"),
      stylesSource.indexOf(".folder-description-item > strong {"),
    );
    expect(folderBlock).toContain("background: var(--canvas-object-surface);");
    expect(descriptionBlock).toContain(
      "background: var(--canvas-object-surface);",
    );
    const coloredFolderCoverBlock = stylesSource.slice(
      stylesSource.indexOf("/* Colored themes keep the Folder cover"),
      stylesSource.indexOf(".folder-workspace-kicker {"),
    );
    expect(coloredFolderCoverBlock).toContain(".is-theme-blue,");
    expect(coloredFolderCoverBlock).toContain(".is-theme-green,");
    expect(coloredFolderCoverBlock).toContain(".is-theme-pink,");
    expect(coloredFolderCoverBlock).toContain(".is-theme-purple,");
    expect(coloredFolderCoverBlock).toContain(".is-theme-yellow");
    expect(coloredFolderCoverBlock).toContain(
      "var(--canvas-object-surface) 94%",
    );
    expect(coloredFolderCoverBlock).toContain(
      "var(--canvas-object-surface) 100%",
    );
    expect(coloredFolderCoverBlock).toContain(
      "var(--canvas-object-surface) 82%",
    );
    expect(coloredFolderCoverBlock).toContain(
      "var(--canvas-object-surface) 66%",
    );
    expect(coloredFolderCoverBlock).not.toContain(".is-theme-white");
    expect(stylesSource).toContain(
      ".app-shell.is-theme-black .folder-workspace-cover",
    );
    expect(stylesSource).toContain(
      ".app-shell.is-theme-black .folder-workspace-hit-target",
    );
    expect(stylesSource).toContain(
      ".app-shell--overview-reference.is-theme-black",
    );
  });

  it("keeps description-card selection legible in the black theme", () => {
    const blackDescriptionSelectionBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell.is-theme-black\n  :is(.folder-description-item:hover"),
      stylesSource.indexOf(".app-shell.is-layer-preview .folder-description-item.is-preview-member"),
    );
    expect(blackDescriptionSelectionBlock).toContain(
      "border-color: color-mix(in srgb, var(--canvas-accent) 56%, var(--canvas-border));",
    );
    expect(blackDescriptionSelectionBlock).toContain("color: var(--canvas-text);");
    expect(blackDescriptionSelectionBlock).toContain(
      "background: color-mix(in srgb, var(--canvas-accent-surface) 72%, var(--canvas-raised));",
    );
  });

  it("aligns black Codex Read shadow with the help dialog without changing the light theme", () => {
    const blackCodexReadShadowBlock = stylesSource.slice(
      stylesSource.indexOf(
        ".app-shell.is-theme-black.app-shell--overview-reference\n  .context-panel--bottom.is-expanded {",
      ),
      stylesSource.indexOf(
        ".app-shell--overview-reference\n  .context-panel--bottom.is-expanded\n  .context-panel-header {",
        stylesSource.indexOf(
          ".app-shell.is-theme-black.app-shell--overview-reference\n  .context-panel--bottom.is-expanded {",
        ),
      ),
    );
    expect(blackCodexReadShadowBlock).toContain(
      "0 15px 34px rgba(0, 0, 0, 0.42),",
    );
    expect(blackCodexReadShadowBlock).toContain(
      "0 1px 0 rgba(77, 79, 82, 0.34) inset;",
    );
  });

  it("keeps description anchor states semantic instead of theme-colored", () => {
    const anchorColorBlock = stylesSource.slice(
      stylesSource.indexOf(".app-shell .description-anchor.is-collapsed,"),
      stylesSource.indexOf(".app-shell .description-frame,"),
    );
    expect(anchorColorBlock).not.toContain("var(--canvas-");
    expect(anchorColorBlock).toContain("border-color: #765da2;");
    expect(anchorColorBlock).toContain("color: #765da2;");
    expect(anchorColorBlock).toContain("background: #ffffff;");
    expect(anchorColorBlock).toContain(
      ".app-shell .description-anchor.is-collapsed:hover:not(.is-dragging):not(.is-marquee-selected),",
    );
    expect(anchorColorBlock).toContain(
      ".app-shell .description-anchor.is-expanded:hover:not(.is-dragging):not(.is-marquee-selected),",
    );
    expect(anchorColorBlock).toContain(
      ".app-shell .description-anchor.is-active:not(.is-dragging):not(.is-marquee-selected) {",
    );
    expect(anchorColorBlock).toContain(
      ".app-shell .description-anchor.is-dragging {",
    );
    expect(anchorColorBlock).toContain(
      ".app-shell .description-anchor.is-marquee-selected,",
    );
    expect(anchorColorBlock).toContain(
      ".app-shell .description-anchor.is-dragging",
    );
    expect(anchorColorBlock).toContain("color: #ffffff;");
    expect(anchorColorBlock).toContain("background: #765da2;");
    expect(
      anchorColorBlock.indexOf(
        ".app-shell .description-anchor.is-dragging {",
      ),
    ).toBeGreaterThan(
      anchorColorBlock.indexOf(
        ".app-shell .description-anchor.is-active:not(.is-dragging):not(.is-marquee-selected) {",
      ),
    );
  });

  it("maps the right description workspace through existing theme variables", () => {
    const workspaceStart = stylesSource.indexOf(".description-workspace {");
    const workspaceBlock = stylesSource.slice(
      workspaceStart,
      stylesSource.indexOf(".context-panel--bottom {", workspaceStart),
    );
    expect(workspaceBlock).toContain("top: 11.5%;");
    expect(workspaceBlock).toContain("width: 22.5%;");
    expect(workspaceBlock).toContain("height: 70.5%;");
    expect(workspaceBlock).toContain(".description-workspace__edge:active:not(:disabled) {");
    expect(workspaceBlock).toContain("transform: translateY(-50%);");
    expect(workspaceBlock).toContain("translateX(calc(100% - 20px))");
    expect(workspaceBlock).toContain("var(--canvas-raised)");
    expect(workspaceBlock).toContain("var(--canvas-border)");
    expect(workspaceBlock).toContain("var(--canvas-text)");
    expect(workspaceBlock).toContain("var(--canvas-muted-text)");
    expect(workspaceBlock).not.toContain("is-theme-white");
    expect(workspaceBlock).toContain(
      ".description-workspace__header > button {\n  flex: 0 0 auto;\n  width: auto;",
    );
    expect(workspaceBlock).toContain(".description-workspace__header {\n  min-height: 58px;");
    expect(workspaceBlock).toContain("padding: 12px 24px 11px;");
    expect(workspaceBlock).toContain(".description-workspace__list {\n  min-height: 0;\n  flex: 0 1 auto;\n  max-height: 30%;");
    expect(workspaceBlock).toContain("padding: 9px 24px;");
    expect(workspaceBlock).toContain(".description-workspace__detail {\n  min-height: 0;\n  flex: 1 1 0;");
    expect(workspaceBlock).toContain("padding: 12px 24px 16px;");
    expect(workspaceBlock).not.toContain("grid-template-rows: minmax(82px, 30%)");
    expect(workspaceBlock).toContain(
      "background: color-mix(in srgb, var(--canvas-raised) 72%, transparent);",
    );
    expect(workspaceBlock).toContain(
      ".description-workspace__edge:hover:not(:disabled) {\n  background: color-mix(in srgb, var(--canvas-raised) 86%, transparent);",
    );
    expect(workspaceBlock).not.toContain("rgba(255, 255, 255, 0.58) inset");
    expect(workspaceBlock).not.toContain("background: #f8f6f1;");
    expect(workspaceBlock).not.toContain("rgba(255, 255, 255,");
  });

  it("keeps Excalidraw's native return-to-content control above the live handoff card", () => {
    expect(stylesSource).toContain(
      ".workspace.workspace--context-bottom {\n  --context-panel-bottom-offset: 36px;\n  --context-panel-current-height: 98px;\n  --context-panel-inline-start: 107px;\n  --context-panel-inline-end: 20px;\n  --canvas-panel-inline-start: 88px;",
    );
    expect(stylesSource).toContain(
      ".workspace.workspace--context-bottom:has(.context-panel--bottom.is-expanded) {\n  --context-panel-current-height: min(354px, 46vh);",
    );
    const scrollBackBlock = stylesSource.slice(
      stylesSource.indexOf(".workspace--context-bottom .scroll-back-to-content {"),
      stylesSource.indexOf(".app-shell.is-theme-black .canvas-primary-toolbar,"),
    );
    expect(scrollBackBlock).toContain(
      "var(--context-panel-bottom-offset) + var(--context-panel-current-height) + 16px",
    );
    expect(scrollBackBlock).toContain(
      "right: calc(var(--context-panel-inline-end) + 12px);",
    );
    expect(scrollBackBlock).toContain(
      "left: calc(var(--context-panel-inline-start) - var(--canvas-panel-inline-start));",
    );
    expect(scrollBackBlock).toContain("width: auto;");
    expect(scrollBackBlock).toContain("transform: none;");
    expect(scrollBackBlock).toContain("border: 0;");
    expect(scrollBackBlock).toContain("background: transparent;");
    expect(scrollBackBlock).toContain(
      "color: color-mix(in srgb, var(--canvas-muted-text) 64%, transparent);",
    );
    expect(scrollBackBlock).toContain(
      "box-shadow: 0 6px 14px color-mix(in srgb, var(--canvas-shadow) 8%, transparent);",
    );
    expect(scrollBackBlock).toContain("text-shadow: none;");
    expect(scrollBackBlock).toContain("font-size: 13px;");
    expect(scrollBackBlock).toContain("font-weight: 400;");
    expect(scrollBackBlock).toContain("letter-spacing: 0.01em;");
    expect(scrollBackBlock).toContain("backdrop-filter: none;");
    expect(stylesSource).toContain(
      "right: calc(40px + min(133px, calc(100vw - 108px)) + 16px);",
    );
    expect(scrollBackBlock).toContain(
      ".workspace--context-bottom .scroll-back-to-content:hover:not(:disabled) {\n  border-color: color-mix(in srgb, var(--canvas-accent) 42%, transparent);\n  color: color-mix(in srgb, var(--canvas-accent-text) 84%, transparent);\n  background: color-mix(in srgb, var(--canvas-accent-surface) 56%, transparent);",
    );
    expect(scrollBackBlock).not.toContain("rgba(");
    expect(scrollBackBlock).not.toContain(".scroll-back-to-content::");
    const handoffAlignmentBlock = stylesSource.slice(
      stylesSource.indexOf(".workspace--context-bottom .context-panel--bottom {"),
      stylesSource.indexOf(".workspace--context-bottom .scroll-back-to-content {"),
    );
    expect(handoffAlignmentBlock).toContain("right: var(--context-panel-inline-end);");
    expect(handoffAlignmentBlock).toContain("left: var(--context-panel-inline-start);");
    expect(stylesSource).not.toContain(
      "@media (max-width: 1280px) {\n  .workspace.workspace--context-bottom {\n    --context-panel-inline-start: 86px;",
    );
  });

  it("recovers themes from a saved scene or safely degrades legacy scenes", () => {
    expect(
      canvasThemeIdFromAppState({
        theme: "light",
        viewBackgroundColor: CANVAS_THEMES.pink.canvas,
      }),
    ).toBe("pink");
    expect(
      canvasThemeIdFromAppState({
        theme: "dark",
        viewBackgroundColor: "#252722",
      }),
    ).toBe("black");
  });
});
