import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { normalizeDescriptionReferenceUrl } from "../domain/descriptions";
import type {
  DescriptionCanvasItem,
  DescriptionCanvasScopeGroup,
} from "./descriptionPresentation";
import {
  DESCRIPTION_WORKSPACE_VISIBLE_EDGE_PX,
  descriptionWorkspaceDragResult,
  descriptionWorkspaceToggle,
} from "./descriptionWorkspaceInteraction";

export interface DescriptionWorkspaceProps {
  items: readonly DescriptionCanvasItem[];
  scopeGroups: readonly DescriptionCanvasScopeGroup[];
  activeDescriptionId: string | null;
  editorFocusDescriptionId: string | null;
  open: boolean;
  hasContentUnderlay?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
  onActivate: (descriptionId: string) => void;
  onTextChange: (descriptionId: string, text: string) => void;
  onReferenceUrlChange: (descriptionId: string, referenceUrl: string) => void;
  onEditorFocus: (descriptionId: string, focused: boolean) => void;
  onToggleScope: (descriptionId: string, regionId: string) => void;
  onFocusImage: (imageId: string) => void;
  onFocusScope: (regionId: string) => void;
}

/**
 * A presentation-only carrier for the existing description DTO and host
 * callbacks. It deliberately owns no BusinessState and no history state.
 */
export const DescriptionWorkspace = ({
  items,
  scopeGroups,
  activeDescriptionId,
  editorFocusDescriptionId,
  open,
  hasContentUnderlay = false,
  onOpenChange,
  onCreate,
  onActivate,
  onTextChange,
  onReferenceUrlChange,
  onEditorFocus,
  onToggleScope,
  onFocusImage,
  onFocusScope,
}: DescriptionWorkspaceProps) => {
  const rootRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startOpen: boolean;
    moved: boolean;
  } | null>(null);
  const suppressEdgeClickRef = useRef(false);
  const [drawerProgress, setDrawerProgress] = useState(open ? 0 : 1);
  const [drawerOffsetPx, setDrawerOffsetPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [openReferenceIds, setOpenReferenceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const activeItem =
    items.find((item) => item.id === activeDescriptionId) ?? items[0] ?? null;
  const normalizedReferenceUrl = activeItem
    ? normalizeDescriptionReferenceUrl(activeItem.referenceUrl)
    : null;
  const hasInvalidReferenceUrl = Boolean(
    activeItem?.referenceUrl?.trim() && !normalizedReferenceUrl,
  );

  useEffect(() => {
    if (!dragging) {
      setDrawerProgress(open ? 0 : 1);
      setDrawerOffsetPx(0);
    }
  }, [dragging, open]);

  useEffect(() => {
    if (activeItem?.id === editorFocusDescriptionId) {
      editorRef.current?.focus();
    }
  }, [activeItem?.id, editorFocusDescriptionId]);

  const stopWorkspacePointer = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const handleEdgePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOpen: open,
      moved: false,
    };
  };

  const handleEdgePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root || drag.pointerId !== event.pointerId) {
      return;
    }
    const travel = Math.max(
      1,
      root.getBoundingClientRect().width - DESCRIPTION_WORKSPACE_VISIBLE_EDGE_PX,
    );
    const result = descriptionWorkspaceDragResult({
      startOpen: drag.startOpen,
      startX: drag.startX,
      currentX: event.clientX,
      travel,
    });
    drag.moved = result.moved;
    if (result.moved) {
      event.preventDefault();
      event.stopPropagation();
      setDragging(true);
      setDrawerProgress(result.progress);
      setDrawerOffsetPx(result.progress * travel);
    }
  };

  const finishEdgePointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root || drag.pointerId !== event.pointerId) {
      return;
    }
    const travel = Math.max(
      1,
      root.getBoundingClientRect().width - DESCRIPTION_WORKSPACE_VISIBLE_EDGE_PX,
    );
    const result = descriptionWorkspaceDragResult({
      startOpen: drag.startOpen,
      startX: drag.startX,
      currentX: event.clientX,
      travel,
    });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    if (cancelled) {
      return;
    }
    suppressEdgeClickRef.current = true;
    onOpenChange(result.moved ? result.open : descriptionWorkspaceToggle(open));
  };

  const handleEdgeClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (suppressEdgeClickRef.current) {
      suppressEdgeClickRef.current = false;
      return;
    }
    // Some embedded browser drivers synthesize click without the matching
    // React pointer-up callback. A click is still a click, never a business
    // gesture; clear the view-only drag session and toggle once.
    dragRef.current = null;
    setDragging(false);
    onOpenChange(descriptionWorkspaceToggle(open));
  };

  const toggleReference = (descriptionId: string) => {
    setOpenReferenceIds((current) => {
      const next = new Set(current);
      if (next.has(descriptionId)) {
        next.delete(descriptionId);
      } else {
        next.add(descriptionId);
      }
      return next;
    });
  };

  return (
    <aside
      ref={rootRef}
      className={`description-workspace ${open ? "is-open" : "is-collapsed"} ${
        dragging ? "is-dragging" : ""
      }${hasContentUnderlay ? " has-content-underlay" : ""}`}
      aria-label="说明工作区"
      data-workspace-progress={drawerProgress}
      style={
        {
          transform: dragging ? `translateX(${drawerOffsetPx}px)` : undefined,
        } as CSSProperties
      }
      onPointerDown={stopWorkspacePointer}
    >
      <button
        type="button"
        className="description-workspace__edge"
        aria-label={open ? "收拢说明工作区" : "展开说明工作区"}
        aria-expanded={open}
        onPointerDown={handleEdgePointerDown}
        onPointerMove={handleEdgePointerMove}
        onPointerUp={(event) => finishEdgePointer(event, false)}
        onPointerCancel={(event) => finishEdgePointer(event, true)}
        onClick={handleEdgeClick}
      >
        <span aria-hidden="true" />
      </button>

      <div className="description-workspace__surface" data-description-workspace-ui>
        <header className="description-workspace__header">
          <div>
            <strong>画布说明</strong>
            <span>同一说明正文与范围关系</span>
          </div>
          <button type="button" onClick={onCreate}>
            新建说明
          </button>
        </header>

        <div className="description-workspace__body">
          <nav className="description-workspace__list" aria-label="说明列表">
            {items.length === 0 ? (
              <p>尚无说明。可新建零范围说明，或从顶部说明工具先关联选区。</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === activeItem?.id ? "is-active" : ""}
                  onClick={() => onActivate(item.id)}
                >
                  <strong>说明 {item.number}</strong>
                  <span>{item.regionIds.length === 0 ? "整张图 / 画布" : `${item.regionIds.length} 个范围`}</span>
                </button>
              ))
            )}
          </nav>

          {activeItem && (
            <section className="description-workspace__detail" aria-label={`说明 ${activeItem.number}`}>
              <div className="description-workspace__detail-heading">
                <strong>说明 {activeItem.number}</strong>
                <span>{activeItem.regionIds.length === 0 ? "零范围说明" : "关联范围"}</span>
              </div>
              <textarea
                ref={editorRef}
                value={activeItem.text}
                placeholder="写下可交给 Codex 的说明…"
                onChange={(event) => onTextChange(activeItem.id, event.target.value)}
                onFocus={() => onEditorFocus(activeItem.id, true)}
                onBlur={() => onEditorFocus(activeItem.id, false)}
              />

              <section className="description-workspace__reference">
                <button type="button" onClick={() => toggleReference(activeItem.id)}>
                  参考链接 <span>{openReferenceIds.has(activeItem.id) ? "−" : "+"}</span>
                </button>
                {openReferenceIds.has(activeItem.id) && (
                  <div>
                    <input
                      value={activeItem.referenceUrl ?? ""}
                      placeholder="https://"
                      aria-label={`说明 ${activeItem.number} 的参考链接`}
                      onChange={(event) =>
                        onReferenceUrlChange(activeItem.id, event.target.value)
                      }
                    />
                    {normalizedReferenceUrl && (
                      <a
                        href={normalizedReferenceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开参考网页
                      </a>
                    )}
                  </div>
                )}
                {openReferenceIds.has(activeItem.id) && hasInvalidReferenceUrl && (
                  <p className="description-workspace__reference-feedback">
                    请输入完整的 http(s) 链接。
                  </p>
                )}
              </section>

              <section className="description-workspace__scopes" aria-label="关联范围">
                <div className="description-workspace__section-heading">
                  <strong>关联范围</strong>
                  <span>可关联零个、一个或多个平级选区</span>
                </div>
                <div className="description-workspace__scope-groups">
                  {scopeGroups.length === 0 ? (
                    <p className="description-workspace__empty-scopes">
                      尚无选区；此说明作用于整张画布。
                    </p>
                  ) : scopeGroups.map((group) => (
                    <section className="description-workspace__image-group" key={group.imageId}>
                      <button
                        type="button"
                        className="description-workspace__image-summary"
                        onClick={() => onFocusImage(group.imageId)}
                      >
                        {group.thumbnailUrl ? <img src={group.thumbnailUrl} alt="" /> : <span>图</span>}
                        <strong>图片 {group.imageNumber}</strong>
                        <small>{group.scopes.length} 个选区</small>
                      </button>
                      {group.scopes.map((scope) => {
                        const linked = activeItem.regionIds.includes(scope.regionId);
                        return (
                          <div
                            className={`description-workspace__scope-row ${linked ? "is-linked" : ""}`}
                            key={scope.regionId}
                          >
                            <button type="button" onClick={() => onFocusScope(scope.regionId)}>
                              选区 {scope.number}
                            </button>
                            <button
                              type="button"
                              className="description-workspace__scope-toggle"
                              onClick={() => onToggleScope(activeItem.id, scope.regionId)}
                            >
                              {linked ? "已关联" : "关联"}
                            </button>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>
              </section>
            </section>
          )}
        </div>
      </div>
    </aside>
  );
};
