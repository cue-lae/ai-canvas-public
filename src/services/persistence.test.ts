import { describe, expect, it, vi } from "vitest";
import type { AppState } from "@excalidraw/excalidraw/types";
import { createEmptyBusinessState, type P0Bundle } from "../domain/types";
import { clearP0Bundle, loadP0Bundle, normalizeP0Bundle, sanitizeAppState, saveP0Bundle } from "./persistence";

describe("Excalidraw AppState 持久化白名单", () => {
  it("只保存恢复画布所需字段，不序列化协作者和临时 UI 状态", () => {
    const appState = {
      viewBackgroundColor: "#ffffff",
      scrollX: 120,
      scrollY: -80,
      zoom: { value: 0.8 },
      theme: "light",
      gridSize: 20,
      gridModeEnabled: false,
      objectsSnapModeEnabled: true,
      collaborators: new Map([["socket", { username: "不应保存" }]]),
      openDialog: { name: "help" },
    } as unknown as AppState;

    const persisted = sanitizeAppState(appState);
    expect(persisted).toEqual({
      viewBackgroundColor: "#ffffff",
      scrollX: 120,
      scrollY: -80,
      zoom: { value: 0.8 },
      theme: "light",
      gridSize: 20,
      gridModeEnabled: false,
      objectsSnapModeEnabled: true,
    });
    expect("collaborators" in persisted).toBe(false);
    expect("openDialog" in persisted).toBe(false);
  });
});

describe("document-scoped persistence operations", () => {
  it("executes save/load/clear and legacy reads without crossing native recovery keys", async () => {
    const stored = new Map<string, unknown>();
    const originalIdentity = window.__AI_CANVAS_NATIVE_DOCUMENT__;
    const request = (action: () => unknown, transaction?: Record<string, unknown>) => {
      const value = {} as Record<string, unknown>;
      queueMicrotask(() => {
        value.result = action();
        (value.onsuccess as (() => void) | undefined)?.();
        if (transaction) setTimeout(() => (transaction.oncomplete as (() => void) | undefined)?.(), 0);
      });
      return value;
    };
    vi.stubGlobal("indexedDB", { open: () => request(() => ({
      objectStoreNames: { contains: () => true }, close: () => {},
      transaction: () => {
        const transaction = {} as Record<string, unknown>;
        transaction.objectStore = () => ({
          put: (value: unknown, key: string) => request(() => { stored.set(key, structuredClone(value)); return key; }, transaction),
          get: (key: string) => request(() => structuredClone(stored.get(key)), transaction),
          delete: (key: string) => request(() => stored.delete(key), transaction),
        });
        return transaction;
      },
    })) });
    const make = (id: string): P0Bundle => ({ format: "ai-canvas-excalidraw-p0", version: 1, savedAt: "2026-10-02T00:00:00Z",
      business: createEmptyBusinessState(id), scene: { elements: [], files: {},
        appState: { viewBackgroundColor: "#ffffff", theme: "light", scrollX: 0, scrollY: 0, zoom: { value: 1 } as never,
          gridSize: 20, gridModeEnabled: false, objectsSnapModeEnabled: false } } });
    const legacy = make("legacy"); stored.set("current", structuredClone(legacy));
    try {
      window.__AI_CANVAS_NATIVE_DOCUMENT__ = { documentId: "a".repeat(32), recoveryId: "1".repeat(32) };
      await saveP0Bundle(make("A"));
      window.__AI_CANVAS_NATIVE_DOCUMENT__ = { documentId: "b".repeat(32), recoveryId: "2".repeat(32) };
      await saveP0Bundle(make("B")); expect((await loadP0Bundle())?.business.document.id).toBe("B");
      await clearP0Bundle(); expect(await loadP0Bundle()).toBeNull();
      window.__AI_CANVAS_NATIVE_DOCUMENT__ = { documentId: "c".repeat(32), recoveryId: "1".repeat(32) };
      expect((await loadP0Bundle())?.business.document.id).toBe("A");
      expect((await loadP0Bundle({ legacy: true }))?.business.document.id).toBe("legacy");
      expect(stored.get("current")).toEqual(legacy);
    } finally {
      window.__AI_CANVAS_NATIVE_DOCUMENT__ = originalIdentity; vi.unstubAllGlobals();
    }
  });
});

describe("P0 bundle v3 normalization", () => {
  const bundle = (): P0Bundle => ({
    format: "ai-canvas-excalidraw-p0",
    version: 1,
    savedAt: "2026-09-01T00:00:00.000Z",
    scene: {
      elements: [],
      appState: {
        viewBackgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 } as P0Bundle["scene"]["appState"]["zoom"],
        theme: "light",
        gridSize: 20,
        gridModeEnabled: false,
        objectsSnapModeEnabled: false,
      },
      files: {},
    },
    business: createEmptyBusinessState("persistence-test"),
  });

  it("writes legacy bundles as v3 without losing the root scope", () => {
    const normalized = normalizeP0Bundle(bundle());
    expect(normalized.version).toBe(3);
    expect(normalized.business.rootFolderId).toBe("folder-root");
  });

  it("rejects a declared v3 bundle that still contains legacy Folder Frame", () => {
    const invalid = bundle();
    invalid.version = 3;
    invalid.scene.elements = [
      {
        id: "legacy-frame",
        type: "frame",
        customData: { kind: "folder-frame", folderId: "folder-a" },
      } as never,
    ];
    expect(() => normalizeP0Bundle(invalid)).toThrow("legacy Folder Frame");
  });
});
