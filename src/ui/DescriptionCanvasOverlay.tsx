import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { normalizeDescriptionReferenceUrl } from "../domain/descriptions";
import {
  descriptionAnchorVisualPosition,
  layoutDescriptionPanels,
  type DescriptionPanelBounds,
  type DescriptionPanelSize,
} from "./descriptionLayout";
import {
  anchorGestureOpensDescription,
  descriptionAnchorGestureFinish,
  descriptionAnchorAfterPointerMove,
  reduceDescriptionAnchorGesture,
  shouldCollapseDescriptionFrame,
} from "./descriptionInteraction";
import type {
  DescriptionCanvasItem,
  DescriptionCanvasScopeGroup,
} from "./descriptionPresentation";

export interface DescriptionCanvasViewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface DescriptionCanvasOverlayProps {
  items: readonly DescriptionCanvasItem[];
  scopeGroups: readonly DescriptionCanvasScopeGroup[];
  activeDescriptionId: string | null;
  selectedDescriptionIds?: ReadonlySet<string>;
  editorFocusDescriptionId: string | null;
  creationActive: boolean;
  viewport: DescriptionCanvasViewport;
  onCreate: (anchor: Readonly<{ x: number; y: number }>) => void;
  onActivate: (descriptionId: string) => void;
  onDragStart: (descriptionId: string) => void;
  onAnchorChange: (
    descriptionId: string,
    anchor: Readonly<{ x: number; y: number }>,
    commit: boolean,
  ) => void;
  onTextChange: (descriptionId: string, text: string) => void;
  onReferenceUrlChange: (descriptionId: string, referenceUrl: string) => void;
  onEditorFocus: (descriptionId: string, focused: boolean) => void;
  onToggleCollapsed: (descriptionId: string, collapsed: boolean) => void;
  onToggleScope: (descriptionId: string, regionId: string) => void;
  onFocusImage: (imageId: string) => void;
  onFocusScope: (regionId: string) => void;
}

const coordinateState = (viewport: DescriptionCanvasViewport) => ({
  zoom: { value: viewport.zoom } as AppState["zoom"],
  offsetLeft: viewport.offsetLeft,
  offsetTop: viewport.offsetTop,
  scrollX: viewport.scrollX,
  scrollY: viewport.scrollY,
});

export const DescriptionCanvasOverlay = ({
  items,
  scopeGroups,
  activeDescriptionId,
  selectedDescriptionIds = new Set<string>(),
  editorFocusDescriptionId,
  creationActive,
  viewport,
  onCreate,
  onActivate,
  onDragStart,
  onAnchorChange,
  onTextChange,
  onReferenceUrlChange,
  onEditorFocus,
  onToggleCollapsed,
  onToggleScope,
  onFocusImage,
  onFocusScope,
}: DescriptionCanvasOverlayProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const panelElementsRef = useRef(new Map<string, HTMLElement>());
  const anchorDragRef = useRef<{
    pointerId: number;
    descriptionId: string;
    clientStart: Readonly<{ x: number; y: number }>;
    pointerStart: Readonly<{ x: number; y: number }>;
    anchorStart: Readonly<{ x: number; y: number }>;
    captureTarget: HTMLButtonElement;
    moved: boolean;
    activated: boolean;
  } | null>(null);
  const suppressAnchorClickRef = useRef<string | null>(null);
  const [draggingDescriptionId, setDraggingDescriptionId] = useState<
    string | null
  >(null);
  const [openReferenceIds, setOpenReferenceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [panelBounds, setPanelBounds] = useState<
    DescriptionPanelBounds & { left: number; top: number }
  >({ width: 0, height: 0, left: 0, top: 0 });
  const [panelSizes, setPanelSizes] = useState<
    ReadonlyMap<string, DescriptionPanelSize>
  >(() => new Map());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const update = () => {
      const bounds = root.getBoundingClientRect();
      const handoffBounds = document
        .querySelector<HTMLElement>(".context-panel--bottom")
        ?.getBoundingClientRect();
      const overlapsHandoff =
        handoffBounds &&
        bounds.left < handoffBounds.right &&
        bounds.right > handoffBounds.left;
      setPanelBounds({
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        top: bounds.top,
        bottomInset:
          overlapsHandoff && handoffBounds
            ? Math.max(0, bounds.bottom - handoffBounds.top + 12)
            : 0,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    const handoff = document.querySelector<HTMLElement>(".context-panel--bottom");
    if (handoff) {
      observer.observe(handoff);
    }
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const panelAnchors = useMemo(
    () =>
      items.map((item) => {
        const point = sceneCoordsToViewportCoords(
          { sceneX: item.anchor.x, sceneY: item.anchor.y },
          coordinateState(viewport),
        );
        return {
          id: item.id,
          x: point.x - panelBounds.left,
          y: point.y - panelBounds.top,
        };
      }),
    [items, panelBounds.left, panelBounds.top, viewport],
  );
  const panelAnchorById = useMemo(
    () => new Map(panelAnchors.map((anchor) => [anchor.id, anchor])),
    [panelAnchors],
  );
  const collapsedById = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.id,
          shouldCollapseDescriptionFrame({
            persistedCollapsed: item.collapsed,
            zoom: viewport.zoom,
            editorFocused: item.id === editorFocusDescriptionId,
          }),
        ]),
      ),
    [editorFocusDescriptionId, items, viewport.zoom],
  );
  const expandedPanelIds = useMemo(
    () =>
      items
        .filter((item) => !collapsedById.get(item.id))
        .map((item) => item.id)
        .join("|"),
    [collapsedById, items],
  );

  useLayoutEffect(() => {
    const panels = panelElementsRef.current;
    const update = () => {
      const next = new Map<string, DescriptionPanelSize>();
      panels.forEach((panel, id) => {
        const bounds = panel.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) {
          next.set(id, { width: bounds.width, height: bounds.height });
        }
      });
      setPanelSizes((previous) => {
        const unchanged =
          previous.size === next.size &&
          [...next].every(
            ([id, size]) =>
              previous.get(id)?.width === size.width &&
              previous.get(id)?.height === size.height,
          );
        return unchanged ? previous : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [expandedPanelIds]);

  const placements = useMemo(
    () =>
      layoutDescriptionPanels(
        panelAnchors.filter(
          (anchor) => !collapsedById.get(anchor.id),
        ),
        { ...panelBounds, panelSizes },
      ),
    [collapsedById, panelAnchors, panelBounds, panelSizes],
  );

  useEffect(() => {
    activeEditorRef.current?.focus();
  }, [editorFocusDescriptionId, items.length]);

  const pointerToScene = (clientX: number, clientY: number) =>
    viewportCoordsToSceneCoords(
      { clientX, clientY },
      coordinateState(viewport),
    );

  const handleAnchorPointerDown = (
    item: DescriptionCanvasItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    anchorDragRef.current = {
      pointerId: event.pointerId,
      descriptionId: item.id,
      clientStart: { x: event.clientX, y: event.clientY },
      pointerStart: pointerToScene(event.clientX, event.clientY),
      anchorStart: item.anchor,
      captureTarget: event.currentTarget,
      moved: false,
      activated: false,
    };
  };

  const handleAnchorPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = anchorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const gesture = reduceDescriptionAnchorGesture(
      { dragging: drag.moved },
      {
        type: "move",
        start: drag.clientStart,
        current: { x: event.clientX, y: event.clientY },
      },
    );
    if (!gesture.dragging) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const beganDragging = !drag.moved;
    drag.moved = gesture.dragging;
    if (beganDragging) {
      // Keep the semantic drag state visible throughout the captured sequence,
      // without waiting for React to render a native pointer move.
      drag.captureTarget.classList.add("is-dragging");
      setDraggingDescriptionId(drag.descriptionId);
    }
    if (!drag.activated) {
      drag.activated = true;
      if (!anchorGestureOpensDescription({ dragged: true })) {
        onDragStart(drag.descriptionId);
      }
    }
    onAnchorChange(
      drag.descriptionId,
      descriptionAnchorAfterPointerMove({
        anchorStart: drag.anchorStart,
        pointerStart: drag.pointerStart,
        pointerCurrent: pointerToScene(event.clientX, event.clientY),
      }),
      false,
    );
  };

  const finishAnchorPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ) => {
    const drag = anchorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const gestureResult = descriptionAnchorGestureFinish({
      dragging: drag.moved,
      cancelled,
    });
    if (gestureResult.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressAnchorClickRef.current = drag.descriptionId;
      window.setTimeout(() => {
        if (suppressAnchorClickRef.current === drag.descriptionId) {
          suppressAnchorClickRef.current = null;
        }
      }, 0);
      if (gestureResult.commitMove) {
        onAnchorChange(
          drag.descriptionId,
          descriptionAnchorAfterPointerMove({
            anchorStart: drag.anchorStart,
            pointerStart: drag.pointerStart,
            pointerCurrent: pointerToScene(event.clientX, event.clientY),
          }),
          true,
        );
      }
    }
    if (drag.captureTarget.hasPointerCapture(event.pointerId)) {
      drag.captureTarget.releasePointerCapture(event.pointerId);
    }
    drag.captureTarget.classList.remove("is-dragging");
    anchorDragRef.current = null;
    setDraggingDescriptionId(null);
  };

  const handleCreate = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!creationActive || event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest("[data-description-ui]")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCreate(
      viewportCoordsToSceneCoords(
        { clientX: event.clientX, clientY: event.clientY },
        coordinateState(viewport),
      ),
    );
  };

  return (
    <div
      ref={rootRef}
      className={`description-canvas-overlay ${
        creationActive ? "is-creating" : ""
      }`}
      data-creation-active={creationActive ? "true" : "false"}
      onPointerDown={handleCreate}
    >
      {items.map((item) => {
        const anchor = panelAnchorById.get(item.id);
        const placement = placements.get(item.id);
        const isActive = item.id === activeDescriptionId;
        const isSelected = selectedDescriptionIds.has(item.id);
        const collapsed = collapsedById.get(item.id) ?? item.collapsed;
        if (!anchor) {
          return null;
        }
        const anchorVisualPosition =
          !collapsed && placement
            ? descriptionAnchorVisualPosition({
                anchor,
                placement,
                collapsed: false,
              })
            : anchor;
        const normalizedReferenceUrl = normalizeDescriptionReferenceUrl(
          item.referenceUrl,
        );
        return (
          <div key={item.id} data-description-ui>
            <button
              type="button"
              className={`description-anchor ${isActive ? "is-active" : ""} ${
                isSelected ? "is-marquee-selected" : ""
              } ${
                draggingDescriptionId === item.id ? "is-dragging" : ""
              } ${collapsed ? "is-collapsed" : "is-expanded"}`}
              style={{
                left: anchorVisualPosition.x,
                top: anchorVisualPosition.y,
              }}
              data-anchor-state={collapsed ? "collapsed" : "expanded"}
              data-canvas-object="description"
              data-description-id={item.id}
              aria-label={`打开说明 ${item.number}`}
              aria-expanded={!collapsed}
              onPointerDown={(event) => handleAnchorPointerDown(item, event)}
              onPointerMove={handleAnchorPointerMove}
              onPointerUp={(event) => finishAnchorPointer(event, false)}
              onPointerCancel={(event) => finishAnchorPointer(event, true)}
              onClick={(event) => {
                if (suppressAnchorClickRef.current === item.id) {
                  suppressAnchorClickRef.current = null;
                  event.preventDefault();
                  return;
                }
                if (anchorGestureOpensDescription({ dragged: false })) {
                  if (collapsed) {
                    onActivate(item.id);
                  } else {
                    onToggleCollapsed(item.id, true);
                  }
                }
              }}
            >
              {item.number}
            </button>
            {!collapsed && placement && (
              <section
                ref={(element) => {
                  if (element) {
                    panelElementsRef.current.set(item.id, element);
                  } else {
                    panelElementsRef.current.delete(item.id);
                  }
                }}
                className={`description-frame ${isActive ? "is-active" : ""} ${
                  isSelected ? "is-marquee-selected" : ""
                }`}
                style={{ left: placement.x, top: placement.y }}
                data-placement={placement.side}
                data-canvas-object="description"
                data-description-id={item.id}
                aria-label={`说明 ${item.number}`}
                tabIndex={0}
                onFocusCapture={(event) => {
                  if ((event.target as HTMLElement).closest("textarea")) {
                    onEditorFocus(item.id, true);
                  }
                }}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    !(nextTarget instanceof Node) ||
                    !event.currentTarget.contains(nextTarget)
                  ) {
                    onEditorFocus(item.id, false);
                  }
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (
                    !(event.target as HTMLElement).closest(
                      "textarea, input, select, button, [contenteditable='true']",
                    )
                  ) {
                    event.currentTarget.focus({ preventScroll: true });
                  }
                }}
              >
                <header className="description-frame__header">
                  <div>
                    <strong>说明 {item.number}</strong>
                    <span>
                      {item.regionIds.length === 0
                        ? "整图／整张画布"
                        : `${item.regionIds.length} 个平级范围`}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={`收起说明 ${item.number}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleCollapsed(item.id, true);
                    }}
                  >
                    −
                  </button>
                </header>
                <textarea
                  ref={
                    item.id === editorFocusDescriptionId
                      ? activeEditorRef
                      : undefined
                  }
                  value={item.text}
                  rows={4}
                  aria-label={`说明 ${item.number} 正文`}
                  placeholder="直接写下希望 Codex 理解的完整说明…"
                  onFocus={() => {
                    onActivate(item.id);
                  }}
                  onChange={(event) => onTextChange(item.id, event.target.value)}
                />
                <details
                  className="description-frame__reference"
                  data-reference-valid={normalizedReferenceUrl ? "true" : "false"}
                  open={
                    Boolean(item.referenceUrl) || openReferenceIds.has(item.id)
                  }
                  onToggle={(event) => {
                    if (!event.currentTarget.open && item.referenceUrl) {
                      event.currentTarget.open = true;
                      return;
                    }
                    const open = event.currentTarget.open;
                    setOpenReferenceIds((current) => {
                      if (current.has(item.id) === open) {
                        return current;
                      }
                      const next = new Set(current);
                      if (open) {
                        next.add(item.id);
                      } else {
                        next.delete(item.id);
                      }
                      return next;
                    });
                  }}
                >
                  <summary>
                    <span>参考链接</span>
                    <small>{normalizedReferenceUrl ? "已添加" : "可选"}</small>
                  </summary>
                  <div>
                    <input
                      type="url"
                      aria-label={`说明 ${item.number} 参考链接`}
                      placeholder="https://…"
                      value={item.referenceUrl ?? ""}
                      onChange={(event) =>
                        onReferenceUrlChange(item.id, event.target.value)
                      }
                    />
                    {normalizedReferenceUrl ? (
                      <a
                        href={normalizedReferenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        打开参考网页
                      </a>
                    ) : item.referenceUrl ? (
                      <small>请输入完整的 http(s) 链接。</small>
                    ) : null}
                  </div>
                </details>
                <div className="description-frame__scopes">
                  <span>关联范围</span>
                  {scopeGroups.length === 0 ? (
                    <p>尚无选区；此说明作用于整张画布。</p>
                  ) : (
                    <div className="description-frame__scope-list">
                      {scopeGroups.map((group) => (
                        <section
                          className="description-frame__image-group"
                          key={group.imageId}
                        >
                          <button
                            type="button"
                            className="description-frame__image-summary"
                            onClick={(event) => {
                              event.stopPropagation();
                              onFocusImage(group.imageId);
                            }}
                          >
                            {group.thumbnailUrl ? (
                              <img alt="" src={group.thumbnailUrl} />
                            ) : (
                              <span aria-hidden="true">图</span>
                            )}
                            <span>图片 {group.imageNumber}</span>
                            <small>{group.scopes.length} 个范围</small>
                          </button>
                          {group.scopes.map((scope) => {
                            const linked = item.regionIds.includes(scope.regionId);
                            return (
                              <div
                                className={`description-frame__scope-row ${
                                  linked ? "is-linked" : ""
                                }`}
                                key={scope.regionId}
                              >
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onFocusScope(scope.regionId);
                                  }}
                                >
                                  选区 {scope.number}
                                </button>
                                <button
                                  type="button"
                                  className="description-frame__scope-toggle"
                                  aria-label={`${linked ? "取消关联" : "关联"}选区 ${scope.number}`}
                                  aria-pressed={linked}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleScope(item.id, scope.regionId);
                                  }}
                                >
                                  {linked ? "已关联" : "关联"}
                                </button>
                              </div>
                            );
                          })}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        );
      })}
    </div>
  );
};

export type { DescriptionCanvasItem, DescriptionCanvasScopeGroup };
