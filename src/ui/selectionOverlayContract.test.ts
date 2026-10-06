import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs on Node; this project intentionally omits Node types.
import { readFileSync } from "node:fs";

const overlaySource = readFileSync(
  new URL("./SelectionCanvasOverlay.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const badgeSource = readFileSync(
  new URL("./selectionBindingBadge.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("Selection overlay presentation contract", () => {
  it("路径草稿在全局删除路由前接管 Backspace 单步回退", () => {
    expect(overlaySource).toContain("onRegisterPathDraftUndo?:");
    expect(overlaySource).toContain("removeLastSelectionPathAnchor(current)");
    expect(overlaySource).toContain(
      'onRegisterPathDraftUndo(undoLastPathAnchor)',
    );
    expect(appSource).toContain('event.key === "Backspace"');
    expect(appSource).toContain('activeSelectionTool === "path"');
    expect(appSource).toContain("!isEditableKeyboardTarget(event.target)");
    expect(appSource).toContain("if (event.repeat)");
    expect(appSource).toContain(
      "onRegisterPathDraftUndo={registerPathDraftUndo}",
    );
  });

  it("keeps occlusion masks off selection handles", () => {
    const source = overlaySource.replace(/\r\n/g, "\n");
    const groupStart = source.indexOf(
      "<g\n              key={selection.regionId}",
    );
    const shapeStart = source.indexOf('{kind === "ellipse" ?', groupStart);
    const groupOpening = source.slice(groupStart, shapeStart);
    const shapeMaskToken =
      "mask={\n                    occlusionMask ? `url(#${occlusionMask.id})` : undefined\n                  }";
    const shapeBlock = source.slice(
      shapeStart,
      source.indexOf("{selected &&", shapeStart),
    );

    expect(groupStart).toBeGreaterThanOrEqual(0);
    expect(shapeStart).toBeGreaterThan(groupStart);
    expect(groupOpening).not.toContain("mask=");
    expect(shapeBlock.split(shapeMaskToken)).toHaveLength(3);
  });

  it("preserves shrink scaling and gently caps handle growth when zooming in", () => {
    expect(overlaySource).toContain(
      "SELECTION_HANDLE_DIAMETER_AT_100_PERCENT_PX = 6",
    );
    expect(overlaySource).toContain(
      "SELECTION_HANDLE_MAX_DIAMETER_PX = 14",
    );
    expect(overlaySource).toContain("zoom <= 1");
    expect(overlaySource).toContain(
      "SELECTION_HANDLE_DIAMETER_AT_100_PERCENT_PX * Math.sqrt(zoom)",
    );
    expect(overlaySource).toContain(
      "Math.min(selectionHandleDiameterForZoom(zoom), maxDiameterPx) / 2",
    );
    expect(
      overlaySource.match(
        /r=\{selectionHandleRadiusForZoom\([\s\S]*?viewport\.zoom,[\s\S]*?maxHandleDiameterPx,[\s\S]*?\)\}/g,
      ),
    ).toHaveLength(2);
    expect(overlaySource).not.toContain(
      "SELECTION_HANDLE_DIAMETER_AT_200_PERCENT_PX = 12",
    );
  });

  it("缩小创建态锚点并保留独立的首点闭合命中区", () => {
    expect(overlaySource).toContain(
      "const draftAnchorRadius = selectionHandleRadiusForZoom(",
    );
    expect(overlaySource).toContain(
      "const draftStartAnchorRadius = draftAnchorRadius + 1",
    );
    expect(overlaySource).toContain(
      "const draftStartHitRadius = Math.max(8, draftStartAnchorRadius)",
    );
    expect(overlaySource).toContain(
      'className="selection-canvas-overlay__draft-anchor-hit"',
    );
    expect(overlaySource).toContain(
      "r={index === 0 ? draftStartAnchorRadius : draftAnchorRadius}",
    );
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__draft-anchor-hit\s*\{[^}]*fill:\s*transparent;[^}]*pointer-events:\s*all;/s,
    );
  });

  it("caps selection handles at 12px only in image focus mode", () => {
    expect(overlaySource).toContain("maxHandleDiameterPx?: number");
    expect(overlaySource).toContain("maxDiameterPx = Number.POSITIVE_INFINITY");
    expect(overlaySource).toContain("Math.min(");
    expect(appSource).toContain(
      'folderNavigation.layer === "image" ? 12 : undefined',
    );
  });

  it("preserves the accepted 100% badge size and caps gentle zoom-in growth", () => {
    expect(badgeSource).toContain(
      "SELECTION_BADGE_MAX_SCALE = 2",
    );
    expect(badgeSource).toContain("zoom <= 1 ? zoom");
    expect(badgeSource).toContain("Math.sqrt(zoom)");
    expect(overlaySource).toContain("zoom: viewport.zoom");
    expect(overlaySource).toContain("nodeRadius: selectionHandleRadiusForZoom(");
    expect(overlaySource).toContain("scale: row.ordinal.scale");
    expect(overlaySource).toContain("SELECTION_BADGE_VISUALS.descriptionRadius * layout.scale");
    expect(overlaySource).toContain("r={1.25 * layout.scale}");
    expect(overlaySource).toContain(
      "SELECTION_BADGE_VISUALS.fontSize * layout.scale",
    );
    expect(badgeSource).toContain("height: 18,");
  });

  it("uses one horizontal badge group without restoring the rejected shape scan", () => {
    expect(overlaySource).not.toContain("selectionOrdinalLayout");
    expect(overlaySource).not.toContain("selection-ordinal-cutout-");
    expect(overlaySource).not.toContain("mask={`url(#");
    expect(overlaySource).toContain("selectionOrdinalBadgeLayout");
    expect(overlaySource).toContain("horizontalSelectionBadgeLayout");
    expect(overlaySource).toContain("selection-canvas-overlay__badge-group");
    expect(overlaySource).toContain("selection-canvas-overlay__ordinal-badge");
    expect(overlaySource).not.toContain(
      "selection-canvas-overlay__ordinal-badge-accent",
    );
    expect(overlaySource).not.toContain("selection-ordinal-accent-clip-");
    expect(overlaySource).toContain("selection-canvas-overlay__shape");
    expect(overlaySource).toContain("selection-canvas-overlay__description-badge");
    expect(overlaySource).toContain("selection-canvas-overlay__badge-group-surface");
    expect(overlaySource).toContain("selection-canvas-overlay__badge-group-dot");
    expect(overlaySource).toContain("selection-badge-occlusion-");
    expect(overlaySource).toContain("selectionOcclusionMasks.get(row.regionId)");
    expect(overlaySource).toContain("layout.separatorXs.map");
    expect(overlaySource).toContain("selectHighestScreenPoint");
    expect(overlaySource).toContain("Object.values(ellipseHandles)");
    expect(overlaySource).not.toContain("panelBounds.width");
    expect(overlaySource).not.toContain("viewportWidth");
    expect(badgeSource).not.toContain("viewportWidth");
    expect(badgeSource).not.toContain("groupLeft");
    expect(badgeSource).not.toContain("shiftX");
    expect(overlaySource.match(
      /rx=\{\s*SELECTION_BADGE_VISUALS\.descriptionRadius\s*\*\s*layout\.scale\s*\}/g,
    )).toHaveLength(2);
    expect(badgeSource).toContain("descriptionRadius: 4,");
    expect(overlaySource).not.toContain(
      "isRegion\n                            ? SELECTION_BADGE_VISUALS.ordinalRadius",
    );
    expect(overlaySource).toContain('layout.segments.map((segment) => segment.text).join("｜")');
    expect(overlaySource).toContain('bindings: row.bindings');
    expect(overlaySource).not.toContain("row.hiddenBindingCount");
    expect(overlaySource).not.toContain("expandedBindingRegionId");
    expect(overlaySource).not.toContain("+{row.");
    expect(overlaySource).not.toContain("🔗");
    expect(badgeSource).toContain("text: `说明 ${formatBadgeNumber(binding.number)}`");
    expect(badgeSource).not.toContain("🔗");
    expect(badgeSource).not.toContain("hiddenBindingCount");
    expect(overlaySource).not.toContain("<circle cx={left + 9} cy={top + 9} r=\"9\" />");
    expect(stylesSource).toContain(".description-anchor");
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__badge-group\s*\{[^}]*pointer-events:\s*none;/s,
    );
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__badge-group-surface\s*\{[^}]*fill:\s*rgba\(56, 94, 188, 0\.48\);[^}]*stroke:\s*color-mix\(in srgb, var\(--canvas-border\) 50%, transparent\);[^}]*pointer-events:\s*none;/s,
  );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__badge-group-dot",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__badge-group-dot {\n  fill: #f3f6fa;",
    );
    expect(stylesSource).toContain(
      "0 1px 3px color-mix(in srgb, var(--canvas-shadow) 16%, transparent)",
    );
    expect(stylesSource).toContain(
      "fill: transparent;",
    );
    expect(stylesSource).toContain(
      "fill: color-mix(in srgb, var(--canvas-text) 94%, transparent);",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__ordinal-badge text {\n  fill: #f3f6fa;",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__description-badge text {\n  fill: #f3f6fa;",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__ordinal-badge.is-description-linked text,",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__description-badge.is-current text {\n  fill: #f3f6fa;",
    );
    expect(stylesSource).toContain(
      "fill: transparent;\n  stroke: transparent;",
    );
    const badgeBlock = stylesSource.slice(
      stylesSource.indexOf(".selection-canvas-overlay__badge-group-surface"),
      stylesSource.indexOf(
        ".selection-canvas-overlay__handle",
        stylesSource.indexOf(".selection-canvas-overlay__badge-group-surface"),
      ),
    );
    expect(badgeBlock).toContain("fill: rgba(56, 94, 188, 0.48);");
    expect(badgeBlock).toContain(
      ".selection-canvas-overlay__badge-group-surface.is-description-linked",
    );
    expect(badgeBlock).toContain("fill: rgba(118, 79, 176, 0.52);");
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__selection.is-description-linked",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__selection.is-selected .selection-canvas-overlay__shape",
    );
    expect(stylesSource).toContain("stroke: #82add8;");
    expect(stylesSource).not.toContain(
      ".selection-canvas-overlay__ordinal-badge.is-selected:not(.is-description-linked)",
    );
    expect(stylesSource).not.toContain(
      ".selection-canvas-overlay__ordinal-badge.is-dragging:not(.is-description-linked)",
    );
  });

  it("keeps existing description controls clickable around the floating toolbar", () => {
    expect(stylesSource).toMatch(
      /\.description-canvas-overlay\s*\{[^}]*z-index:\s*32;/s,
    );
    expect(stylesSource).toMatch(
      /\.description-canvas-overlay\.is-creating\s*\{[^}]*z-index:\s*30;/s,
    );
    expect(stylesSource).toMatch(
      /\.canvas-primary-toolbar\s*\{[^}]*z-index:\s*31;/s,
    );
    expect(stylesSource).toMatch(
      /\.canvas-primary-toolbar:has\(\.canvas-workspace-menu__panel\)\s*\{[^}]*z-index:\s*33;/s,
    );
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__ordinal-badge,[\s\n]+\.selection-canvas-overlay__description-badge\s*\{[^}]*pointer-events:\s*all;[^}]*cursor:\s*pointer;/s,
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__ordinal-badge:hover:not(:disabled) rect",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__description-badge:focus-visible rect",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__description-badge.is-current rect",
    );
    expect(stylesSource).toContain("fill: transparent;");
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__binding-layer\s*\{[^}]*z-index:\s*33;[^}]*pointer-events:\s*none;/s,
    );
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__svg\s*\{[^}]*z-index:\s*3;/s,
    );
    expect(overlaySource).toContain("onActivateDescription?.(segment.id)");
    expect(overlaySource).toContain("selectRegionFromBadge(row.regionId)");
    expect(overlaySource).toContain("onPointerDown={stopBindingPointer}");
    expect(overlaySource).toContain("onPointerUp={stopBindingPointer}");
    expect(overlaySource).toContain("onPointerCancel={stopBindingPointer}");
    expect(overlaySource).toContain("activateBadgeOnKeyDown");
    expect(overlaySource).toContain("dominantBaseline=\"middle\"");
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__ordinal-badge text,[\s\n]+\.selection-canvas-overlay__description-badge text\s*\{[^}]*font-size:\s*10px;[^}]*font-weight:\s*400;/s,
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__description-badge.is-current",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__description-badge.is-current rect {\n  fill: transparent;\n  stroke: transparent;",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__ordinal-badge.is-description-linked rect {\n  fill: transparent;\n  stroke: transparent;",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__badge-group:has(\n    .selection-canvas-overlay__badge-group-surface.is-description-linked",
    );
    expect(stylesSource).toContain("stroke: transparent;\n}");
    expect(stylesSource).toContain(
      "fill: rgba(118, 79, 176, 0.3);",
    );
    expect(stylesSource).toContain(
      ".selection-canvas-overlay__ordinal-badge:not(.is-description-linked):hover:not(:disabled)",
    );
    expect(stylesSource).toContain("fill: rgba(74, 106, 181, 0.3);");
  });

  it("uses one cool blue family for unbound selection fill and outlines", () => {
    expect(stylesSource).toContain("fill: rgba(122, 141, 184, 0.34);");
    expect(stylesSource).toContain("stroke: #4a72b8;");
    expect(stylesSource).toContain("stroke: #6b8bc7;");
  });

  it("首次点击未选中的选区只进入选中态，不立即开始移动或缩放", () => {
    expect(overlaySource).toContain("if (!selectedRegionIds.has(regionId))");
    expect(overlaySource).toContain("onSelectRegion(regionId);");
    expect(overlaySource).toContain("return;\n    }\n    startSelectionDrag");
  });

  it("aligns selection geometry with the quick annotation visual language", () => {
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__shape,[\s\n]+\.app-shell \.selection-canvas-overlay__shape\s*\{[^}]*fill:\s*rgba\(22, 135, 242, 0\.09\);[^}]*stroke:\s*#1687f2;[^}]*stroke-width:\s*1\.35;[^}]*stroke-dasharray:\s*4 3;/s,
    );
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__selection\.is-selected \.selection-canvas-overlay__shape,[\s\n]+\.app-shell[\s\n]+\.selection-canvas-overlay__selection\.is-selected[\s\n]+\.selection-canvas-overlay__shape,[\s\n]+\.app-shell[\s\n]+\.selection-canvas-overlay__selection\.is-selected:not\(\.is-description-linked\)[\s\n]+\.selection-canvas-overlay__shape\s*\{[^}]*fill:\s*rgba\(22, 135, 242, 0\.15\);[^}]*stroke:\s*#1687f2;[^}]*stroke-width:\s*1\.8;[^}]*stroke-dasharray:\s*4 3;/s,
    );
    expect(stylesSource).toMatch(
      /\.app-shell[\s\n]+\.selection-canvas-overlay__selection\.is-description-linked:not\(\.is-selected\)[\s\n]+\.selection-canvas-overlay__shape\s*\{[^}]*fill:\s*rgba\(154, 114, 230, 0\.12\);[^}]*stroke:\s*#9a72e6;[^}]*stroke-width:\s*1\.35;[^}]*stroke-dasharray:\s*4 3;/s,
    );
    expect(stylesSource).toMatch(
      /\.app-shell[\s\n]+\.selection-canvas-overlay__selection\.is-description-linked\.is-selected[\s\n]+\.selection-canvas-overlay__shape\s*\{[^}]*fill:\s*rgba\(154, 114, 230, 0\.24\);[^}]*stroke:\s*#7f4fd1;[^}]*stroke-width:\s*2;[^}]*stroke-dasharray:\s*4 3;[^}]*filter:\s*drop-shadow\(0 0 2px rgba\(127, 79, 209, 0\.22\)\);/s,
    );
    expect(stylesSource).toMatch(
      /\.selection-canvas-overlay__draft-shape,[\s\n]+\.app-shell \.selection-canvas-overlay__draft-shape\s*\{[^}]*fill:\s*rgba\(22, 135, 242, 0\.09\);[^}]*stroke:\s*#1687f2;[^}]*stroke-width:\s*1\.35;[^}]*stroke-dasharray:\s*4 3;/s,
    );
  });

  it("passes Shift as a rectangle-only vertex constraint", () => {
    expect(overlaySource).toContain("constrainToRectangle?: boolean");
    expect(overlaySource).toContain("constrainToRectangle: event.shiftKey");
    expect(overlaySource).toContain(
      "drag.constrainToRectangle === true",
    );
  });
});
