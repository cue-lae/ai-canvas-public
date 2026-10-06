import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach,beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {CanvasBusinessNotice} from "./CanvasBusinessNotice";
let root:Root|undefined;
beforeAll(()=>vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true));
afterAll(()=>vi.unstubAllGlobals());
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;document.body.replaceChildren();});
describe("Canvas business notice",()=>{
  it("does not confirm a name while Enter is committing an IME composition",()=>{
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);const decide=vi.fn();
    act(()=>root!.render(<CanvasBusinessNotice notice={{title:"重命名",message:"",input:{label:"名称",initialValue:"中文名称"}}} onDecision={decide}/>));
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true})));
    expect(decide).not.toHaveBeenCalled();
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})));
    expect(decide).toHaveBeenCalledExactlyOnceWith(true,"中文名称");
  });
  it("uses the Canvas dialog for naming and blocks empty confirmation",()=>{
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    const decide=vi.fn();
    act(()=>root!.render(<CanvasBusinessNotice notice={{title:"重命名 Folder",message:"内容保持",input:{label:"文件夹名称",initialValue:""},confirmLabel:"重命名",cancelLabel:"取消"}} onDecision={decide}/>));
    expect(document.activeElement?.tagName).toBe("INPUT");
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})));
    expect(decide).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toBe("请输入名称。");
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    expect(decide).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("focuses cancel for destructive confirmation and traps Tab",()=>{
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    const decide=vi.fn();act(()=>root!.render(<CanvasBusinessNotice notice={{title:"确认删除",message:"会删除内容",confirmLabel:"删除",cancelLabel:"取消",danger:true}} onDecision={decide}/>));
    expect(document.activeElement?.textContent).toBe("取消");
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true})));
    expect(document.activeElement?.textContent).toBe("删除");
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true})));
    expect(document.activeElement?.textContent).toBe("取消");
  });
  it("Esc cancels locally rather than escaping into a canvas key handler",()=>{
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    const decide=vi.fn(),canvasKey=vi.fn();document.addEventListener("keydown",canvasKey);
    act(()=>root!.render(<CanvasBusinessNotice notice={{title:"尚未复制",message:"请补选图片"}} onDecision={decide}/>));
    act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    expect(decide).toHaveBeenCalledWith(false);expect(canvasKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown",canvasKey);
  });
});
