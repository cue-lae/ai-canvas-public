import type { AppState } from "@excalidraw/excalidraw/types";
import type {
  P0Bundle,
  PersistedAppState,
} from "../domain/types";
import {
  FolderMigrationError,
  migrateBusinessStateToV2,
  migrateCanonicalSceneToV3,
} from "../domain/folderScene";
import { documentRecoveryKey } from "./documentSaveState";
import { nativeDocumentIdentity } from "./hostDocumentSession";

const DATABASE_NAME = "ai-canvas-excalidraw-p0";
const DATABASE_VERSION = 3;
const STORE_NAME = "bundles";
const currentRecoveryKey = () => {
  const identity = nativeDocumentIdentity();
  return documentRecoveryKey(identity?.recoveryId ?? identity?.documentId);
};

export const sanitizeAppState = (appState: AppState): PersistedAppState => ({
  viewBackgroundColor: appState.viewBackgroundColor,
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  zoom: appState.zoom,
  theme: appState.theme,
  gridSize: appState.gridSize,
  gridModeEnabled: appState.gridModeEnabled,
  objectsSnapModeEnabled: appState.objectsSnapModeEnabled,
});

export const normalizeP0Bundle = (bundle: P0Bundle): P0Bundle => {
  if (
    bundle.format !== "ai-canvas-excalidraw-p0" ||
    (bundle.version !== 1 && bundle.version !== 3) ||
    !bundle.scene ||
    !Array.isArray(bundle.scene.elements) ||
    !bundle.business
  ) {
    throw new FolderMigrationError("IndexedDB current bundle 格式不受支持");
  }
  if (
    bundle.version === 3 &&
    bundle.scene.elements.some(
      (element) => element.customData?.kind === "folder-frame",
    )
  ) {
    throw new FolderMigrationError("v3 IndexedDB 仍包含 legacy Folder Frame");
  }
  const business = migrateBusinessStateToV2(bundle.business);
  return {
    ...bundle,
    version: 3,
    business,
    scene: {
      ...bundle.scene,
      elements: migrateCanonicalSceneToV3(bundle.scene.elements, business),
    },
  };
};

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开 IndexedDB"));
  });

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 请求失败"));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB 事务失败"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB 事务已中止"));
  });

export const saveP0Bundle = async (bundle: P0Bundle): Promise<void> => {
  const normalized = normalizeP0Bundle(bundle);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await requestResult(store.put(normalized, currentRecoveryKey()));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

export const loadP0Bundle = async (options: { legacy?: boolean } = {}): Promise<P0Bundle | null> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const value = await requestResult(
      transaction.objectStore(STORE_NAME).get(options.legacy ? "current" : currentRecoveryKey()),
    );
    await transactionDone(transaction);
    if (value === undefined) return null;
    if (!value || typeof value !== "object") {
      throw new FolderMigrationError("IndexedDB current bundle 不是对象");
    }
    const bundle = value as P0Bundle;
    const normalized = normalizeP0Bundle(bundle);
    if (bundle.version !== 3 && !options.legacy) {
      const writeTransaction = database.transaction(STORE_NAME, "readwrite");
      await requestResult(
        writeTransaction.objectStore(STORE_NAME).put(normalized, currentRecoveryKey()),
      );
      await transactionDone(writeTransaction);
    }
    return normalized;
  } finally {
    database.close();
  }
};

export const clearP0Bundle = async (): Promise<void> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(currentRecoveryKey()));
  } finally {
    database.close();
  }
};

export const serializedSizeBytes = (value: unknown): number =>
  new Blob([JSON.stringify(value)]).size;
