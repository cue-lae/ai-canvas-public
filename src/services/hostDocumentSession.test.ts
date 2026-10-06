import { describe, expect, it, vi } from "vitest";
import { installNativeDocumentCloseStateResponder, installNativeDocumentRenameListener, readHostDocumentPresentation, readNativeMenuClipboard, requestNativeDocumentSave } from "./hostDocumentSession";
import { createDocumentSaveState } from "./documentSaveState";

describe("native file-save transport", () => {
  it("accepts only same-document rename metadata and removes its listener", () => {
    const handlers=new Set<(event:{data:unknown})=>void>();
    const port={postMessage:vi.fn(),addEventListener:(_:"message",handler:(event:{data:unknown})=>void)=>{handlers.add(handler);},removeEventListener:(_:"message",handler:(event:{data:unknown})=>void)=>{handlers.delete(handler);}};
    const renamed=vi.fn();const remove=installNativeDocumentRenameListener("A",renamed,port);
    const send=(documentId:string,recoveryId:string)=>handlers.forEach(fn=>fn({data:{type:"canvas-document-renamed",documentId,fileName:"新名.excalidraw",recoveryId}}));
    send("B","a".repeat(32));send("A","invalid");expect(renamed).not.toHaveBeenCalled();
    send("A","a".repeat(32));expect(renamed).toHaveBeenCalledExactlyOnceWith("新名.excalidraw");
    remove();expect(handlers.size).toBe(0);
  });
  it("reads only after the matching menu-paste readiness and releases intent on failure", async () => {
    const handlers = new Set<(event: { data: unknown }) => void>();
    const port = { postMessage: vi.fn(),
      addEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.add(fn); },
      removeEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.delete(fn); } };
    const read = vi.fn().mockRejectedValue(new Error("read denied"));
    const pending = readNativeMenuClipboard(read, { documentId: "A" }, port);
    const request = port.postMessage.mock.calls[0][0];
    handlers.forEach(fn => fn({ data: { ...request, type: "canvas-clipboard-read-ready", documentId: "B", ready: true } }));
    await Promise.resolve(); expect(read).not.toHaveBeenCalled();
    handlers.forEach(fn => fn({ data: { ...request, type: "canvas-clipboard-read-ready", ready: true } }));
    await expect(pending).rejects.toThrow("read denied");
    expect(read).toHaveBeenCalledOnce(); expect(handlers.size).toBe(0);
    expect(port.postMessage).toHaveBeenLastCalledWith({ ...request, type: "canvas-clipboard-read-end" });
  });
  it("carries explicit Save As intent and cancellation without claiming a save", async () => {
    const handlers = new Set<(event: { data: unknown }) => void>();
    const port = { postMessage: vi.fn(),
      addEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.add(fn); },
      removeEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.delete(fn); } };
    const request = { documentId: "A", requestId: "copy-A", revision: 4, saveAs: true };
    const result = requestNativeDocumentSave("{}", "A.excalidraw", request, port);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "canvas-document-save", ...request, fileName: "A.excalidraw", content: "{}" });
    handlers.forEach(fn => fn({ data: { type: "canvas-document-save-result", ...request, status: "cancelled" } }));
    expect((await result).status).toBe("cancelled"); expect(handlers.size).toBe(0);
  });
  it("ignores other documents and resolves only the matching native acknowledgement", async () => {
    const handlers = new Set<(event: { data: unknown }) => void>();
    const port = { postMessage: vi.fn(),
      addEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.add(fn); },
      removeEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.delete(fn); } };
    const request = { documentId: "A", requestId: "req-A", revision: 4 };
    let settled = false;
    const result = requestNativeDocumentSave("{}", "A.excalidraw", request, port).then((value) => { settled = true; return value; });
    handlers.forEach((fn) => fn({ data: { type: "canvas-document-save-result", ...request, documentId: "B", status: "saved" } }));
    await Promise.resolve(); expect(settled).toBe(false);
    handlers.forEach((fn) => fn({ data: { type: "canvas-document-save-result", ...request, status: "cancelled" } }));
    expect((await result).status).toBe("cancelled"); expect(handlers.size).toBe(0);
  });
});

describe("close-state freshness transport", () => {
  it("presentation is identity-bound and does not change document save state", () => {
    const state = createDocumentSaveState("A"); state.loaded("content");
    const revision = state.revision;
    expect(readHostDocumentPresentation({type:"canvas-document-presentation",documentId:"B",presentation:"lightweight"},"A")).toBeUndefined();
    expect(readHostDocumentPresentation({type:"canvas-document-presentation",documentId:"A",presentation:"other"},"A")).toBeUndefined();
    expect(readHostDocumentPresentation({type:"canvas-document-presentation",documentId:"A",presentation:"lightweight"},"A")).toBe("lightweight");
    expect(readHostDocumentPresentation({type:"canvas-document-presentation",documentId:"A",presentation:"normal"},"A")).toBe("normal");
    expect(state.revision).toBe(revision); expect(state.dirty).toBe(false);
  });
  const channel = () => {
    const handlers = new Set<(event: { data: unknown }) => void>();
    const port = { postMessage: vi.fn(),
      addEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.add(fn); },
      removeEventListener: (_: "message", fn: (event: { data: unknown }) => void) => { handlers.delete(fn); } };
    const receive = (data: unknown) => handlers.forEach((fn) => fn({ data }));
    return { port, receive, handlers };
  };
  const request = { type: "canvas-document-command", action: "refresh-close-state", documentId: "A", requestId: "a".repeat(32) };

  it("samples the latest edit before the delayed ordinary dirty effect runs", () => {
    const { port, receive } = channel();
    const state = createDocumentSaveState("A"); state.loaded("baseline");
    let latestCanvas = "baseline";
    installNativeDocumentCloseStateResponder("A", () => {
      state.observe(latestCanvas);
      return { revision: state.revision, dirty: state.dirty };
    }, port);
    latestCanvas = "edited"; // Ordinary state notification has not run.
    expect(state.dirty).toBe(false);
    receive(request);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "canvas-document-close-state-result",
      documentId: "A", requestId: request.requestId, ready: true, revision: 2, dirty: true });
  });
  it("rejects another document, malformed request IDs and other actions", () => {
    const { port, receive } = channel(); const snapshot = vi.fn(() => ({ revision: 1, dirty: true }));
    installNativeDocumentCloseStateResponder("A", snapshot, port);
    receive({ ...request, documentId: "B" }); receive({ ...request, requestId: "" }); receive({ ...request, action: "save" });
    expect(snapshot).not.toHaveBeenCalled(); expect(port.postMessage).not.toHaveBeenCalled();
  });
  it.each([undefined, "throws"])("fails closed when current Canvas/baseline is unavailable (%s)", (failure) => {
    const { port, receive, handlers } = channel();
    const remove = installNativeDocumentCloseStateResponder("A", () => {
      if (failure === "throws") throw new Error("Canvas unavailable");
      return undefined;
    }, port);
    receive(request);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "canvas-document-close-state-result",
      documentId: "A", requestId: request.requestId, ready: false });
    remove(); expect(handlers.size).toBe(0);
    port.postMessage.mockClear(); receive(request); expect(port.postMessage).not.toHaveBeenCalled();
  });
});
