import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const importHandlerStart = appSource.indexOf("const handleImportImage");
const importHandlerEnd = appSource.indexOf("const beginAnnotationSelection", importHandlerStart);
const importHandler = appSource.slice(importHandlerStart, importHandlerEnd);

describe("import image view contract", () => {
  it("adds the image without calling any viewport or app-state rewrite", () => {
    expect(importHandlerStart).toBeGreaterThanOrEqual(0);
    expect(importHandlerEnd).toBeGreaterThan(importHandlerStart);
    expect(importHandler).toContain("api.addFiles([binaryFile])");
    expect(importHandler).toContain("renderCanonicalScene({");
    expect(importHandler).not.toContain("scrollToContent");
    expect(importHandler).not.toMatch(/\b(?:scrollX|scrollY|zoom|appState)\b/);
  });

  it("leaves an imported image unselected until the user explicitly selects it", () => {
    expect(importHandler).toContain("updateCanvasSelection(EMPTY_CANVAS_SELECTION)");
    expect(importHandler).toContain("setSelectedImageId(null)");
    expect(importHandler).toContain("setSelectedCanvasImageId(null)");
  });

  it("keeps explicit user-driven image and region positioning paths intact", () => {
    expect(appSource).toContain("const scrollElementsAtCurrentZoom");
    expect(appSource).toContain("scrollElementsAtCurrentZoom([image])");
  });

  it("routes supported canvas drops through the business import path at the pointer", () => {
    expect(appSource).toContain("onDragOverCapture={handleCanvasFileDragOverCapture}");
    expect(appSource).toContain("onDropCapture={handleCanvasFileDropCapture}");
    expect(appSource).toContain("event.preventDefault();");
    expect(appSource).toContain("event.stopPropagation();");
    expect(appSource).toContain("viewportCoordsToSceneCoords(");
    expect(appSource).toContain("void handleImportImage(file, scenePoint);");
    expect(appSource).toContain("void prepareProjectOpen(projectFile);");
    expect(appSource).toContain('endsWith(".excalidraw")');
  });
});
