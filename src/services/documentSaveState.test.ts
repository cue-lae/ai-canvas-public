import { describe, expect, it, vi } from "vitest";
import { createDocumentFingerprint, createDocumentSaveState, documentRecoveryKey, restoredDocumentReady } from "./documentSaveState";

describe("document-bound save acknowledgements", () => {
  it("only accepts matching document, request and revision", () => {
    const state = createDocumentSaveState("A");
    state.loaded("baseline"); state.observe("changed");
    const request = state.begin("save-1");
    expect(state.acknowledge({ ...request, documentId: "B", status: "saved" })).toBe(false);
    expect(state.acknowledge({ ...request, revision: request.revision - 1, status: "saved" })).toBe(false);
    expect(state.dirty).toBe(true);
    expect(state.acknowledge({ ...request, status: "saved" })).toBe(true);
    expect(state.dirty).toBe(false);
  });
  it("a successful old snapshot cannot close newer edits", () => {
    const state = createDocumentSaveState("A"); state.loaded("old"); state.observe("one");
    const request = state.begin("save-1"); state.observe("two");
    expect(state.acknowledge({ ...request, status: "saved" })).toBe(false);
    expect(state.dirty).toBe(true);
    state.observe("one"); expect(state.dirty).toBe(false);
  });
  it.each(["cancelled", "failed", "unconfirmed"] as const)("%s never marks edits saved", (status) => {
    const state = createDocumentSaveState("A"); state.loaded("old"); state.observe("new");
    expect(state.acknowledge({ ...state.begin("request"), status })).toBe(false);
    expect(state.dirty).toBe(true);
  });
  it("keeps native recovery keys isolated and leaves legacy current untouched", () => {
    const a = "a".repeat(32), b = "b".repeat(32);
    expect(documentRecoveryKey()).toBe("current");
    expect(documentRecoveryKey(a)).not.toBe(documentRecoveryKey(b));
    expect(() => documentRecoveryKey("../current")).toThrow();
  });
  it("caches image contents during viewport renders while detecting native in-place edits", () => {
    const identify = vi.fn((value: string) => value === "data:image/png;base64,AAAA" ? "one" : "two");
    const fingerprint = createDocumentFingerprint(identify);
    const element = { x: 0, version: 1 };
    const file = { dataURL: "data:image/png;base64,AAAA" };
    const bundle = { business: {}, scene: { appState: { scrollX: 0 }, elements: [element], files: { image: file } } };
    const initial = fingerprint(bundle);
    bundle.scene.appState.scrollX = 10; const pan = fingerprint(bundle);
    expect(pan).toBe(initial); expect(identify).toHaveBeenCalledTimes(1);
    element.x = 15; expect(fingerprint(bundle)).not.toBe(pan); expect(identify).toHaveBeenCalledTimes(1);
    file.dataURL = "data:image/png;base64,BBBB"; expect(fingerprint(bundle)).not.toBe(pan); expect(identify).toHaveBeenCalledTimes(2);
  });
  it("application theme changes stay clean while document settings still protect unsaved edits", () => {
    const fingerprint = createDocumentFingerprint();
    const state = createDocumentSaveState("A");
    const bundle = { business: {}, scene: { appState: { theme: "light", viewBackgroundColor: "#fafafa", gridModeEnabled: false }, elements: [], files: {} } };
    state.loaded(fingerprint(bundle));
    bundle.scene.appState.viewBackgroundColor = "#f5f8fd"; state.observe(fingerprint(bundle)); expect(state.dirty).toBe(false);
    bundle.scene.appState.viewBackgroundColor = "#fafafa"; state.observe(fingerprint(bundle)); expect(state.dirty).toBe(false);
    bundle.scene.appState.gridModeEnabled = true; state.observe(fingerprint(bundle)); expect(state.dirty).toBe(true);
    const request = state.begin("save-grid");
    bundle.scene.appState.theme = "dark"; bundle.scene.appState.viewBackgroundColor = "#323336"; state.observe(fingerprint(bundle));
    expect(state.acknowledge({ ...request, status: "saved" })).toBe(true); expect(state.dirty).toBe(false);
    bundle.scene.appState.gridModeEnabled = false; state.observe(fingerprint(bundle)); expect(state.dirty).toBe(true);
  });
  it("runtime file retrieval timestamps do not modify saved semantics", () => {
    const fingerprint = createDocumentFingerprint();
    const file = { dataURL: "data:image/png;base64,AAAA", lastRetrieved: 1 };
    const bundle = { business: {}, scene: { appState: { theme: "light" }, elements: [], files: { a: file } } };
    const saved = fingerprint(bundle); file.lastRetrieved = 200;
    expect(fingerprint(bundle)).toBe(saved);
  });
  it("reconcile audit timestamp alone does not dirty an unchanged document", () => {
    const fingerprint = createDocumentFingerprint();
    const bundle = { business: { document: { id: "A", updatedAt: "2026-10-02T01:01:16.120Z" }, descriptions: { a: { text: "A" } } },
      scene: { appState: { theme: "light" }, elements: [], files: {} } };
    const state = createDocumentSaveState("A"); state.loaded(fingerprint(bundle));
    bundle.business.document.updatedAt = "2026-10-02T01:01:16.128Z";
    state.observe(fingerprint(bundle)); expect(state.dirty).toBe(false);
    bundle.business.descriptions.a.text = "edited";
    state.observe(fingerprint(bundle)); expect(state.dirty).toBe(true);
  });
  it("does not complete file restoration from an old app-state or incomplete SDK file snapshot", () => {
    const expected = { elementIds: ["image"], files: { file: { dataURL: "data:image/png;base64,AAAA" } }, theme: "light", viewBackgroundColor: "#fafafa" };
    const actual = { elements: [{ id: "image" }], files: {}, appState: { theme: "light", viewBackgroundColor: "#f7f5f0" } };
    expect(restoredDocumentReady(actual, expected)).toBe(false);
    actual.appState.viewBackgroundColor = "#fafafa";
    expect(restoredDocumentReady(actual, expected)).toBe(false);
    expect(restoredDocumentReady({ ...actual, files: expected.files }, expected)).toBe(true);
  });
});
