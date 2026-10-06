import type { CodexVisualContext } from "../domain/codexContext";
import type { FocusedCanvasContext } from "../domain/focusedPublish";
import { nativeDocumentIdentity } from "./hostDocumentSession";

const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:43127";
export const BRIDGE_SESSION_TIMEOUT_MS = 5_000;
export const BRIDGE_PUBLISH_TIMEOUT_MS = 30_000;
export const NORMAL_PUBLISH_PAYLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PUBLISH_PAYLOAD_BYTES = 50 * 1024 * 1024;
export const COMPLEX_CANVAS_PACKAGING_STATUS = "正在打包复杂画布…";

export const resolveBridgeBaseUrl = (
  configured = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env?.VITE_AI_CANVAS_BRIDGE_URL,
): string => {
  if (configured === undefined || configured === "") {
    return DEFAULT_BRIDGE_BASE_URL;
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("VITE_AI_CANVAS_BRIDGE_URL 必须是有效的 loopback HTTP 地址。");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("VITE_AI_CANVAS_BRIDGE_URL 只能指向带端口的 127.0.0.1 HTTP 根地址。");
  }
  return url.origin;
};

const BRIDGE_BASE_URL = resolveBridgeBaseUrl();

interface BridgeSession {
  version: 1;
  sessionId: string;
  token: string;
  expiresAt: string;
}

export interface BridgePublishReceipt {
  version: 1;
  sessionId: string;
  revision: string;
  status: "READY" | "NO_ACTIVE_REGION" | "FOCUSED";
  receivedAt: string;
}

export class CanvasContextBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CanvasContextBridgeError";
    this.code = code;
  }
}

type BridgeImageReference = {
  encoding: "data-url";
  dataUrl: string;
};

export type NoActiveRegionPublication =
  | {
      documentId: string;
      context?: never;
      originalImageDataUrl?: never;
      canvasSnapshotDataUrl?: never;
    }
  | {
      documentId?: string;
      context: CodexVisualContext;
      originalImageDataUrl: string;
      canvasSnapshotDataUrl: string;
    };

export interface FocusedImagePublication {
  imageId: string;
  originalImageDataUrl: string;
}

export interface BridgePublishOptions {
  onComplexCanvasPackaging?: () => void;
}

export const publishPayloadByteLength = (serializedPayload: string): number =>
  new TextEncoder().encode(serializedPayload).byteLength;

export const classifyPublishPayloadBytes = (
  byteLength: number,
): "normal" | "complex" | "too-large" => {
  if (byteLength > MAX_PUBLISH_PAYLOAD_BYTES) {
    return "too-large";
  }
  return byteLength > NORMAL_PUBLISH_PAYLOAD_BYTES ? "complex" : "normal";
};

const publishInputError = (message: string): CanvasContextBridgeError =>
  new CanvasContextBridgeError("INVALID_PUBLISH_INPUT", message);

const imageReference = (dataUrl: string, label: string): BridgeImageReference => {
  if (typeof dataUrl !== "string" || !dataUrl.trim()) {
    throw publishInputError(`${label} data URL 不可为空。`);
  }
  return {
    encoding: "data-url",
    dataUrl,
  };
};

const assertDocumentId = (documentId: string | undefined): string => {
  if (typeof documentId !== "string" || !documentId.trim()) {
    throw publishInputError("文档 ID 不可为空。");
  }
  return documentId;
};

const isFiniteUnit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const assertQuickAnnotations = (
  value: unknown,
  imageId: string,
  label: string,
): void => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw publishInputError(`${label}.quickAnnotations 必须为数组。`);
  }
  value.forEach((candidate, index) => {
    const item = candidate as Record<string, unknown> | null;
    const itemLabel = `${label}.quickAnnotations[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw publishInputError(`${itemLabel} 必须为对象。`);
    }
    if (
      typeof item.quickAnnotationId !== "string" ||
      !item.quickAnnotationId.trim() ||
      typeof item.imageId !== "string" ||
      item.imageId !== imageId ||
      !Number.isInteger(item.ordinal) ||
      (item.ordinal as number) < 1 ||
      item.label !== `Q${item.ordinal}` ||
      (item.mode !== "point" && item.mode !== "rectangle") ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      [...item.text].length > 100
    ) {
      throw publishInputError(`${itemLabel} 的标识、归属、模式或文本无效。`);
    }
    const normalizedAnchor = item.normalizedAnchor as
      | Record<string, unknown>
      | undefined;
    const originalPixelAnchor = item.originalPixelAnchor as
      | Record<string, unknown>
      | undefined;
    if (
      !normalizedAnchor ||
      !isFiniteUnit(normalizedAnchor.x) ||
      !isFiniteUnit(normalizedAnchor.y) ||
      !originalPixelAnchor ||
      typeof originalPixelAnchor.x !== "number" ||
      !Number.isFinite(originalPixelAnchor.x) ||
      typeof originalPixelAnchor.y !== "number" ||
      !Number.isFinite(originalPixelAnchor.y)
    ) {
      throw publishInputError(`${itemLabel} 的锚点坐标无效。`);
    }
    if (item.mode === "point") {
      if (item.rectangle !== undefined) {
        throw publishInputError(`${itemLabel} 的点标注不得包含矩形范围。`);
      }
      return;
    }
    const rectangle = item.rectangle as Record<string, unknown> | undefined;
    const normalizedBounds = rectangle?.normalizedBounds as
      | Record<string, unknown>
      | undefined;
    const originalPixelBounds = rectangle?.originalPixelBounds as
      | Record<string, unknown>
      | undefined;
    if (
      !normalizedBounds ||
      !isFiniteUnit(normalizedBounds.x) ||
      !isFiniteUnit(normalizedBounds.y) ||
      typeof normalizedBounds.width !== "number" ||
      !Number.isFinite(normalizedBounds.width) ||
      normalizedBounds.width <= 0 ||
      typeof normalizedBounds.height !== "number" ||
      !Number.isFinite(normalizedBounds.height) ||
      normalizedBounds.height <= 0 ||
      normalizedBounds.x + normalizedBounds.width > 1 ||
      normalizedBounds.y + normalizedBounds.height > 1 ||
      !originalPixelBounds ||
      ["x", "y", "width", "height"].some(
        (key) =>
          typeof originalPixelBounds[key] !== "number" ||
          !Number.isFinite(originalPixelBounds[key] as number),
      )
    ) {
      throw publishInputError(`${itemLabel} 的矩形范围无效。`);
    }
  });
};

const assertContextQuickAnnotations = (
  context: CodexVisualContext | FocusedCanvasContext,
): void => {
  if (context.format === "ai-canvas-focused-context") {
    context.focusImages.forEach((image, index) =>
      assertQuickAnnotations(
        image.quickAnnotations,
        image.imageId,
        `context.focusImages[${index}]`,
      ),
    );
    return;
  }
  assertQuickAnnotations(
    context.originalImage.quickAnnotations,
    context.originalImage.imageId,
    "context.originalImage",
  );
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | T
    | null;
  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    throw new CanvasContextBridgeError(
      errorPayload?.code ?? `HTTP_${response.status}`,
      errorPayload?.message ?? `本机桥接返回 HTTP ${response.status}。`,
    );
  }
  if (!payload) {
    throw new CanvasContextBridgeError(
      "INVALID_RESPONSE",
      "本机桥接返回了空响应。",
    );
  }
  return payload as T;
};

const formatMebibytes = (bytes: number): string =>
  (bytes / (1024 * 1024)).toFixed(2);

const decodedDataUrlBytes = (dataUrl: unknown): number => {
  if (typeof dataUrl !== "string") {
    return 0;
  }
  const comma = dataUrl.indexOf(",");
  const encoded = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  if (!encoded) {
    return 0;
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
};

export const largestPublishImageMaterial = (payload: unknown): {
  label: string;
  decodedBytes: number;
} => {
  const publication = payload as {
    status?: string;
    context?: { focusImages?: readonly { name?: string }[] };
    overviewSnapshot?: { dataUrl?: unknown };
    focusImages?: readonly { originalImage?: { dataUrl?: unknown } }[];
    originalImage?: { dataUrl?: unknown };
    canvasSnapshot?: { dataUrl?: unknown };
  };
  const materials: { label: string; decodedBytes: number }[] = [];
  if (publication.status === "focused") {
    materials.push({
      label: "当前视窗概览",
      decodedBytes: decodedDataUrlBytes(publication.overviewSnapshot?.dataUrl),
    });
    publication.focusImages?.forEach((image, index) => {
      const name = publication.context?.focusImages?.[index]?.name ?? `重点图片 ${index + 1}`;
      materials.push({
        label: `重点图片 ${name}`,
        decodedBytes: decodedDataUrlBytes(image.originalImage?.dataUrl),
      });
    });
  } else {
    materials.push({
      label: "原图",
      decodedBytes: decodedDataUrlBytes(publication.originalImage?.dataUrl),
    });
    materials.push({
      label: "画布快照",
      decodedBytes: decodedDataUrlBytes(publication.canvasSnapshot?.dataUrl),
    });
  }
  return materials.reduce(
    (largest, material) =>
      material.decodedBytes > largest.decodedBytes ? material : largest,
    { label: publication.status === "focused" ? "当前视窗概览" : "画布快照", decodedBytes: 0 },
  );
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

const publish = async (
  payload: unknown,
  options: BridgePublishOptions = {},
): Promise<BridgePublishReceipt> => {
  if (nativeDocumentIdentity()?.isolated) {
    throw new CanvasContextBridgeError("ISOLATED_CANDIDATE", "隔离候选不连接真实Bridge；发布与读取尚未验证。");
  }
  const serializedPayload = JSON.stringify(payload);
  const payloadByteLength = publishPayloadByteLength(serializedPayload);
  const capacity = classifyPublishPayloadBytes(payloadByteLength);
  if (capacity === "too-large") {
    const largest = largestPublishImageMaterial(payload);
    throw new CanvasContextBridgeError(
      "REQUEST_TOO_LARGE",
      `发布请求总量 ${formatMebibytes(payloadByteLength)} MiB 超过 ${formatMebibytes(MAX_PUBLISH_PAYLOAD_BYTES)} MiB 上限；最大图片材料为${largest.label}（解码 ${formatMebibytes(largest.decodedBytes)} MiB）。请减少重点图片、改用较小素材或缩小当前视窗。`,
    );
  }
  if (capacity === "complex") {
    options.onComplexCanvasPackaging?.();
  }
  try {
    const sessionResponse = await fetchWithTimeout(`${BRIDGE_BASE_URL}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version: 1 }),
      cache: "no-store",
      credentials: "omit",
    }, BRIDGE_SESSION_TIMEOUT_MS);
    const session = await parseResponse<BridgeSession>(sessionResponse);
    const publishResponse = await fetchWithTimeout(`${BRIDGE_BASE_URL}/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      },
      body: serializedPayload,
      cache: "no-store",
      credentials: "omit",
    }, BRIDGE_PUBLISH_TIMEOUT_MS);
    return await parseResponse<BridgePublishReceipt>(publishResponse);
  } catch (error) {
    if (error instanceof CanvasContextBridgeError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CanvasContextBridgeError(
        "BRIDGE_TIMEOUT",
        "本机桥接连接超时。",
      );
    }
    throw new CanvasContextBridgeError(
      "BRIDGE_UNAVAILABLE",
      error instanceof Error ? error.message : "本机桥接不可用。",
    );
  }
};

export const publishReadyCanvasContext = async ({
  context,
  originalImageDataUrl,
  canvasSnapshotDataUrl,
}: {
  context: CodexVisualContext;
  originalImageDataUrl: string;
  canvasSnapshotDataUrl: string;
}): Promise<BridgePublishReceipt> =>
  {
    assertContextQuickAnnotations(context);
    if (context.selection === null || context.prompt === null) {
      throw publishInputError("含 ROI 的发布必须包含选区和问题语义。");
    }
    return publish({
      version: 1,
      status: "ready",
      publishedAt: new Date().toISOString(),
      context,
      originalImage: imageReference(originalImageDataUrl, "原图"),
      canvasSnapshot: imageReference(canvasSnapshotDataUrl, "画布快照"),
    });
  };

export const publishNoActiveRegion = async (
  publication: NoActiveRegionPublication,
): Promise<BridgePublishReceipt> => {
  const hasSnapshotFields =
    "context" in publication ||
    "originalImageDataUrl" in publication ||
    "canvasSnapshotDataUrl" in publication;

  if (!hasSnapshotFields) {
    return publish({
      version: 1,
      status: "no_active_region",
      publishedAt: new Date().toISOString(),
      document: {
        id: assertDocumentId(publication.documentId),
      },
    });
  }

  const {
    context,
    originalImageDataUrl,
    canvasSnapshotDataUrl,
    documentId,
  } = publication as Partial<Extract<NoActiveRegionPublication, { context: CodexVisualContext }>>;
  if (!context || !originalImageDataUrl || !canvasSnapshotDataUrl) {
    throw publishInputError(
      "无选区画布快照必须同时包含上下文、原图和画布快照。",
    );
  }
  assertContextQuickAnnotations(context);
  if (context.selection !== null || context.prompt !== null) {
    throw publishInputError("无选区发布不得包含 ROI 或问题语义。");
  }
  if (documentId !== undefined && documentId !== context.document.id) {
    throw publishInputError("无选区发布的文档 ID 与上下文不一致。");
  }

  return publish({
    version: 1,
    status: "no_active_region",
    publishedAt: new Date().toISOString(),
    context,
    originalImage: imageReference(originalImageDataUrl, "原图"),
    canvasSnapshot: imageReference(canvasSnapshotDataUrl, "画布快照"),
  });
};

export const publishFocusedCanvasContext = async ({
  context,
  overviewSnapshotDataUrl,
  focusedImages,
  onComplexCanvasPackaging,
}: {
  context: FocusedCanvasContext;
  overviewSnapshotDataUrl: string;
  focusedImages: readonly FocusedImagePublication[];
  onComplexCanvasPackaging?: () => void;
}): Promise<BridgePublishReceipt> => {
  assertContextQuickAnnotations(context);
  if (context.focusImages.length === 0) {
    throw publishInputError("重点发布至少需要一张重点图片。");
  }
  if (focusedImages.length !== context.focusImages.length) {
    throw publishInputError("重点图片内容与上下文数量不一致。");
  }

  const imageReferences = context.focusImages.map((image, index) => {
    const publication = focusedImages[index];
    if (!publication || publication.imageId !== image.imageId) {
      throw publishInputError("重点图片内容必须与上下文顺序一一对应。");
    }
    return {
      imageId: image.imageId,
      originalImage: imageReference(
        publication.originalImageDataUrl,
        `重点图片 ${index + 1}`,
      ),
    };
  });

  return publish({
    version: 1,
    status: "focused",
    publishedAt: new Date().toISOString(),
    context,
    overviewSnapshot: imageReference(overviewSnapshotDataUrl, "当前视窗概览"),
    focusImages: imageReferences,
  }, { onComplexCanvasPackaging });
};
