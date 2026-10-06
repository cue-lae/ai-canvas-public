import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { contextMenuPosition, type CanvasContextCommand, type CanvasContextItem } from "./canvasContextMenuPolicy";

export const CanvasContextMenu = ({ point, items, onClose, onCommand }: {
  point: { x: number; y: number };
  items: readonly CanvasContextItem[];
  onClose: () => void;
  onCommand: (command: CanvasContextCommand, argument?: string) => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const [position, setPosition] = useState(point);
  const [path, setPath] = useState<CanvasContextCommand[]>([]);
  const shown = path.reduce<readonly CanvasContextItem[]>((level, id) => level.find(item => item.id === id)?.children ?? [], items);
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = root.current!;
    restoreFocus.current = true;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.contains(event.target)) { restoreFocus.current = false; onClose(); } };
    const wheel = (event: WheelEvent) => { if (!(event.target instanceof Node) || !menu.contains(event.target)) onClose(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose); window.addEventListener("resize", onClose);
    window.addEventListener("wheel", wheel, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", wheel, true);
      if (restoreFocus.current && previous?.isConnected && document.hasFocus()) previous.focus({ preventScroll: true });
    };
  }, [point, onClose]);
  // Capture the pre-menu focus above before moving into the menu or a picker.
  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    setPosition(contextMenuPosition(point, menu.getBoundingClientRect(), { width: innerWidth, height: innerHeight }));
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [point, path]);
  const run = (item: CanvasContextItem) => {
    if (item.disabled) return;
    if (item.children?.length) { setPath(current => [...current, item.id]); return; }
    restoreFocus.current = false; onClose();
    if (item.argument === undefined) onCommand(item.id); else onCommand(item.id, item.argument);
  };
  return <div ref={root} className="canvas-context-menu" data-canvas-context-menu role="menu" aria-label="画布操作"
    style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); onClose(); return; }
      if (event.key === "ArrowLeft" && path.length) { event.preventDefault(); setPath(current=>current.slice(0,-1)); return; }
      if (event.key === "ArrowRight") {
        const key = (document.activeElement as HTMLElement | null)?.dataset.command;
        const item = shown.find(row=>row.id === key && !!row.children?.length);
        if(item){event.preventDefault();run(item);} return;
      }
      const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        ? ({ c: "copy", v: "paste", a: "select-all", z: "undo", y: "redo" } as const)[event.key.toLowerCase() as "c" | "v" | "a" | "z" | "y"]
        : event.key === "Delete" ? "delete" : undefined;
      if (shortcut) { event.preventDefault(); const item = items.find(item => item.id === shortcut); if (item) run(item); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    }}>
    {path.length ? <><button type="button" role="menuitem" aria-label="返回上一级菜单" onClick={()=>setPath(current=>current.slice(0,-1))}>‹ 返回</button><div role="separator" className="canvas-context-menu__separator"/></> : null}
    {shown.map((item,index) => <Fragment key={item.id+":"+(item.argument??"")}>
      {index>0 && item.group!==shown[index-1].group ? <div role="separator" className="canvas-context-menu__separator"/> : null}
      <button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} data-command={item.id}
        aria-label={item.label} aria-haspopup={item.children?.length ? "menu" : undefined}
        className={item.danger ? "is-danger" : undefined} onClick={() => run(item)}>
        <span>{item.label}</span>{item.children?.length ? <span aria-hidden="true">›</span> : item.shortcut ? <kbd aria-hidden="true">{item.shortcut}</kbd> : null}
      </button>
    </Fragment>)}
  </div>;
};
