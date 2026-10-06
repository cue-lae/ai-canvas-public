export type DocumentSaveOutcome = "saved" | "cancelled" | "failed" | "unconfirmed";
export interface DocumentSaveResult {
  documentId: string;
  requestId: string;
  revision: number;
  status: DocumentSaveOutcome;
  fileName?: string;
  message?: string;
}

/** Persistence acknowledgement only; never a second Canvas/history owner. */
export const createDocumentSaveState = (documentId: string) => {
  let revision = 0;
  let current = "";
  let saved = "";
  let savedRevision = 0;
  const pending = new Map<string, { revision: number; fingerprint: string }>();
  return {
    documentId,
    get revision() { return revision; },
    get dirty() { return current !== saved; },
    observe(fingerprint: string): boolean {
      if (fingerprint === current) return false;
      current = fingerprint;
      revision++;
      return true;
    },
    loaded(fingerprint: string) {
      current = fingerprint;
      saved = fingerprint;
      revision++;
      savedRevision = revision;
      pending.clear();
    },
    begin(requestId: string) {
      const snapshot = { revision, fingerprint: current };
      pending.set(requestId, snapshot);
      return { documentId, requestId, revision };
    },
    acknowledge(result: DocumentSaveResult): boolean {
      const snapshot = pending.get(result.requestId);
      if (!snapshot || result.documentId !== documentId || result.revision !== snapshot.revision) return false;
      pending.delete(result.requestId);
      if (result.status === "saved" && result.revision >= savedRevision) {
        saved = snapshot.fingerprint;
        savedRevision = result.revision;
      }
      return result.status === "saved" && result.revision === revision && current === saved;
    },
  };
};

export const documentRecoveryKey = (documentId?: string): string => {
  if (documentId === undefined) return "current";
  if (!/^[a-f0-9]{32}$/i.test(documentId)) throw new Error("Invalid native document identity");
  return `document-session:${documentId}`;
};

/** Cache immutable image strings; walk semantic elements even after in-place
 * native edits. Content tokens are session-local equality IDs, not hashes or
 * proof of a saved file. Application theme and camera do not edit a document. */
export const createDocumentFingerprint = (
  identifyImageContent?: (content: string) => string,
) => {
  const contents = new Map<string, string>();
  let next = 0;
  const cache = new Map<string, { dataURL: string; token: string }>();
  const identify = identifyImageContent ?? ((content: string) => {
    let token = contents.get(content);
    if (token === undefined) { token = String(++next); contents.set(content, token); }
    return token;
  });
  return (bundle: {
    business: unknown;
    scene: { appState: unknown; elements: readonly object[]; files: Record<string, { dataURL: string }> };
  }): string => {
    const files = Object.entries(bundle.scene.files).sort(([a], [b]) => a.localeCompare(b)).map(([id, file]) => {
      let cached = cache.get(id);
      if (!cached || cached.dataURL !== file.dataURL) {
        cached = { dataURL: file.dataURL, token: identify(file.dataURL) }; cache.set(id, cached);
      }
      const { dataURL, lastRetrieved, ...metadata } = file as typeof file & { lastRetrieved?: number };
      return [id, metadata, cached.token];
    });
    const { scrollX, scrollY, zoom, theme, viewBackgroundColor, ...savedSemantics } = (bundle.scene.appState ?? {}) as Record<string, unknown>;
    const business = bundle.business as Record<string, unknown>;
    let contentBusiness = business;
    if (business?.document && typeof business.document === "object") {
      // reconcileBusinessState stamps this audit field on every SDK onChange,
      // including no-op initialization. Persist it, but do not call it an edit.
      const { updatedAt, ...document } = business.document as Record<string, unknown>;
      contentBusiness = { ...business, document };
    }
    return JSON.stringify({ business: contentBusiness, appState: savedSemantics, files,
      elements: bundle.scene.elements.map((value) => {
        const { version, versionNonce, updated, ...element } = value as Record<string, unknown>;
        return element;
      }) });
  };
};

export const restoredDocumentReady = (
  actual: { elements: readonly { id: string }[]; files: Record<string, { dataURL: string }>; appState: { theme: string; viewBackgroundColor: string } },
  expected: { elementIds: readonly string[]; files: Record<string, { dataURL: string }>; theme: string; viewBackgroundColor: string },
): boolean => actual.appState.theme === expected.theme && actual.appState.viewBackgroundColor === expected.viewBackgroundColor &&
  expected.elementIds.every((id) => actual.elements.some((element) => element.id === id)) &&
  Object.entries(expected.files).every(([id, file]) => actual.files[id]?.dataURL === file.dataURL);
