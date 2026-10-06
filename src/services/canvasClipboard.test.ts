import { describe,it,expect,vi,afterEach } from "vitest";
import { canvasClipboardFixture } from "../test/canvasClipboardFixture";
import { createCanvasClipboard } from "../domain/canvasClipboard";
import { encodeCanvasClipboard,decodeCanvasClipboard,writeCanvasClipboard,CANVAS_CLIPBOARD_MIME } from "./canvasClipboard";
const packet=()=>{const f=canvasClipboardFixture();return createCanvasClipboard(f.business,f.elements,f.files,{folderIds:["folder-one"]});};
afterEach(()=>vi.unstubAllGlobals());
describe("clipboard transport",()=>{
  it("round trips structured data without a newline prefix and admits whitespace/BOM",()=>{
    const p=packet(),encoded=encodeCanvasClipboard(p);
    expect(decodeCanvasClipboard(`\uFEFF\r\n${encoded}\r\n`)).toEqual(p);
    expect(decodeCanvasClipboard(JSON.stringify(p,null,2).replace(/\n/g,"\r\n"))).toEqual(p);
  });
  it("distinguishes unrelated text from an unsupported business package",()=>{
    expect(decodeCanvasClipboard("普通文本")).toBeNull();expect(decodeCanvasClipboard('{"hello":"world"}')).toBeNull();
    expect(()=>decodeCanvasClipboard('{"format":"ai-canvas-clipboard","version":999}')).toThrow();
  });
  it("uses both MIME and plain JSON in a real-copy handler adapter",async()=>{
    const setData=vi.fn(),preventDefault=vi.fn(),stopPropagation=vi.fn();
    await writeCanvasClipboard(packet(),{clipboardData:{setData},preventDefault,stopPropagation} as unknown as ClipboardEvent);
    expect(setData.mock.calls.map(row=>row[0])).toEqual([CANVAS_CLIPBOARD_MIME,"text/plain"]);
    expect(setData.mock.calls[0][1]).toBe(setData.mock.calls[1][1]);expect(preventDefault).toHaveBeenCalledOnce();
  });
  it("a command uses the verified public text writer and propagates refusal",async()=>{
    const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal("navigator",{clipboard:{writeText}});
    await writeCanvasClipboard(packet());expect(decodeCanvasClipboard(writeText.mock.calls[0][0])).not.toBeNull();
    writeText.mockRejectedValueOnce(new Error("write denied"));await expect(writeCanvasClipboard(packet())).rejects.toThrow("write denied");
  });
  it("blocks the native fallback before rejecting a malformed copy payload",async()=>{
    const event={clipboardData:{setData:vi.fn()},preventDefault:vi.fn(),stopPropagation:vi.fn()};
    await expect(writeCanvasClipboard({format:"wrong"} as never,event as unknown as ClipboardEvent)).rejects.toThrow();
    expect(event.preventDefault).toHaveBeenCalledOnce();expect(event.clipboardData.setData).not.toHaveBeenCalled();
  });
});
