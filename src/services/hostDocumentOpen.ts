export type HostDocumentOpenOffer = Readonly<{
  type: "canvas-document-open-offer";
  requestId: string;
  name: string;
}>;

export type HostDocumentOpenPayload = Readonly<{
  type: "canvas-document-open";
  requestId: string;
  name: string;
  content: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);

const isFileName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 255 &&
  !/[\\/]/.test(value) &&
  value.toLowerCase().endsWith(".excalidraw");

export const parseHostDocumentOpenOffer = (
  value: unknown,
): HostDocumentOpenOffer | null =>
  isRecord(value) &&
  value.type === "canvas-document-open-offer" &&
  isRequestId(value.requestId) &&
  isFileName(value.name)
    ? {
        type: "canvas-document-open-offer",
        requestId: value.requestId,
        name: value.name,
      }
    : null;

export const parseHostDocumentOpenPayload = (
  value: unknown,
): HostDocumentOpenPayload | null =>
  isRecord(value) &&
  value.type === "canvas-document-open" &&
  isRequestId(value.requestId) &&
  isFileName(value.name) &&
  typeof value.content === "string"
    ? {
        type: "canvas-document-open",
        requestId: value.requestId,
        name: value.name,
        content: value.content,
      }
    : null;

export const createHostDocumentOpenGate = () => {
  let offeredRequestId: string | null = null;
  let offeredName: string | null = null;
  let delivered = false;
  let cancelled = false;

  return {
    acceptOffer(value: unknown): HostDocumentOpenOffer | null {
      const offer = parseHostDocumentOpenOffer(value);
      if (!offer || cancelled || offeredRequestId !== null) return null;
      offeredRequestId = offer.requestId;
      offeredName = offer.name;
      return offer;
    },
    acceptDocument(value: unknown): HostDocumentOpenPayload | null {
      const payload = parseHostDocumentOpenPayload(value);
      if (!payload || cancelled || delivered || payload.requestId !== offeredRequestId || payload.name !== offeredName) return null;
      delivered = true;
      return payload;
    },
    cancel() { cancelled = true; },
  };
};
