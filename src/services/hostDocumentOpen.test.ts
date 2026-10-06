import { describe, expect, it } from "vitest";
import { createHostDocumentOpenGate } from "./hostDocumentOpen";

const requestId = "0123456789abcdef0123456789abcdef";

describe("native host document-open messages", () => {
  it("accepts one matched offer and one matching document payload", () => {
    const gate = createHostDocumentOpenGate();
    expect(gate.acceptOffer({ type: "canvas-document-open-offer", requestId, name: "中文 文件.excalidraw" }))
      .toMatchObject({ requestId, name: "中文 文件.excalidraw" });
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "中文 文件.excalidraw", content: "{\"type\":\"excalidraw\",\"elements\":[]}" }))
      .toMatchObject({ requestId });
  });

  it("rejects late, repeated, mismatched and path-bearing host messages", () => {
    const gate = createHostDocumentOpenGate();
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "x.excalidraw", content: "{}" })).toBeNull();
    expect(gate.acceptOffer({ type: "canvas-document-open-offer", requestId, name: "x.excalidraw" })).not.toBeNull();
    expect(gate.acceptOffer({ type: "canvas-document-open-offer", requestId, name: "y.excalidraw" })).toBeNull();
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId: "f".repeat(32), name: "x.excalidraw", content: "{}" })).toBeNull();
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "C:\\outside.excalidraw", content: "{}" })).toBeNull();
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "x.excalidraw", content: "{}" })).not.toBeNull();
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "x.excalidraw", content: "{}" })).toBeNull();
  });

  it("rejects delivery after user interaction and rejects a changed offered filename", () => {
    const gate = createHostDocumentOpenGate();
    gate.acceptOffer({ type: "canvas-document-open-offer", requestId, name: "x.excalidraw" });
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "y.excalidraw", content: "{}" })).toBeNull();
    gate.cancel();
    expect(gate.acceptDocument({ type: "canvas-document-open", requestId, name: "x.excalidraw", content: "{}" })).toBeNull();
    expect(gate.acceptOffer({ type: "canvas-document-open-offer", requestId: "f".repeat(32), name: "y.excalidraw" })).toBeNull();
  });
});
