export interface ReadPublicationIdentity {
  documentId: string;
  restoreGeneration: number;
  folderScopeId: string;
}

export interface ReadPublicationRequestToken {
  readonly generation: number;
  readonly identityEpoch: number;
}

/** Nonpersistent ownership for the existing Read callback, not Canvas state. */
export function createReadPublicationRequestGuard(
  initialIdentity: ReadPublicationIdentity,
) {
  let identity = { ...initialIdentity };
  let identityEpoch = 0;
  let generation = 0;
  let active: ReadPublicationRequestToken | null = null;

  return {
    syncIdentity(next: ReadPublicationIdentity): boolean {
      if (
        identity.documentId === next.documentId &&
        identity.restoreGeneration === next.restoreGeneration &&
        identity.folderScopeId === next.folderScopeId
      ) {
        return false;
      }
      identity = { ...next };
      identityEpoch += 1;
      return true;
    },

    invalidate(): void {
      identityEpoch += 1;
    },

    begin(): ReadPublicationRequestToken {
      active = { generation: ++generation, identityEpoch };
      return active;
    },

    isCurrent(token: ReadPublicationRequestToken): boolean {
      return active === token && token.identityEpoch === identityEpoch;
    },

    finish(token: ReadPublicationRequestToken): boolean {
      // Identity invalidation suppresses results, but keeps cleanup ownership.
      // A newer begin takes that ownership, so an old finally cannot clear it.
      if (active !== token) {
        return false;
      }
      active = null;
      return true;
    },
  };
}
