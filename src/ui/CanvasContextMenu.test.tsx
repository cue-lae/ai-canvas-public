import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { canvasContextItems } from "./canvasContextMenuPolicy";
let root: Root | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("Canvas context menu keyboard interaction", () => {
  it("restores the original focused control when Escape cancels the menu",()=>{
    vi.spyOn(document,"hasFocus").mockReturnValue(true);
    const previous=document.createElement("input"),host=document.createElement("div");document.body.append(previous,host);previous.focus();root=createRoot(host);
    act(()=>root!.render(<CanvasContextMenu point={{x:30,y:40}} items={canvasContextItems("image")} onClose={()=>root!.render(null)} onCommand={()=>undefined}/>));
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(previous);
  });
  it("opens a target picker and passes the chosen ID without firing the parent command", () => {
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    const close=vi.fn(),command=vi.fn();
    act(()=>root!.render(<CanvasContextMenu point={{x:900,y:650}} items={canvasContextItems("image",{folders:[{id:"a",label:"Folder A"},{id:"b",label:"Folder B"}]})} onClose={close} onCommand={command}/>));
    act(()=>host.querySelector<HTMLButtonElement>('[aria-label="收进 Folder"]')!.click());
    expect(command).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("返回上一级菜单");
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true,cancelable:true})));
    expect(host.querySelector('[aria-label="收进 Folder"]')).not.toBeNull();
    act(()=>host.querySelector<HTMLButtonElement>('[aria-label="收进 Folder"]')!.click());
    act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Folder B"]')!.click());
    expect(command).toHaveBeenCalledExactlyOnceWith("move-to-folder","b");expect(close).toHaveBeenCalledOnce();
  });
  it("does not steal focus from an outside input when dismissed by a pointer", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const previous = document.createElement("button"), outside = document.createElement("input"), host = document.createElement("div");
    document.body.append(previous, outside, host); previous.focus(); root = createRoot(host);
    act(() => root!.render(<CanvasContextMenu point={{ x: 30, y: 40 }} items={canvasContextItems("canvas")} onClose={() => root!.render(null)} onCommand={() => undefined}/>));
    act(() => { outside.focus(); outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(document.activeElement).toBe(outside);
  });
  it("wraps focus through enabled items and routes Copy to the business command", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const close = vi.fn(), command = vi.fn();
    act(() => root!.render(<CanvasContextMenu point={{ x: 30, y: 40 }} items={canvasContextItems("description")} onClose={close} onCommand={command}/>));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("编辑说明");
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("删除");
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true })));
    expect(command).toHaveBeenCalledExactlyOnceWith("copy"); expect(close).toHaveBeenCalledOnce();
  });
  it("Escape closes locally without reaching the canvas key handler", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const close = vi.fn(), command = vi.fn(), canvasKey = vi.fn(); document.addEventListener("keydown", canvasKey);
    act(() => root!.render(<CanvasContextMenu point={{ x: 30, y: 40 }} items={canvasContextItems("canvas")} onClose={close} onCommand={command}/>));
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(close).toHaveBeenCalledOnce(); expect(command).not.toHaveBeenCalled(); expect(canvasKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", canvasKey);
  });
});
