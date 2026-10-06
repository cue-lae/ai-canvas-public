import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const DEFAULT_LIMITS = Object.freeze({
  tokenTtlMs: 30_000,
  snapshotTtlMs: 15 * 60_000,
  maxRequestBytes: 50 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxCanvasSnapshotBytes: 4 * 1024 * 1024,
  maxFocusedImages: 4,
  maxFocusedImageBytes: 6 * 1024 * 1024,
  maxFocusedImagesTotalBytes: 6 * 1024 * 1024,
  maxPromptCharacters: 5_000,
  maxDescriptions: 200,
  maxDescriptionScopeLinks: 1_000,
});

export class BridgeProtocolError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BridgeProtocolError";
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => {
  throw new BridgeProtocolError(status, code, message);
};

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "INVALID_PAYLOAD", `${label} 必须是对象。`);
  }
  return value;
};

const stringValue = (value, label, maxLength, allowEmpty = false) => {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    fail(400, "INVALID_PAYLOAD", `${label} 不是有效字符串。`);
  }
  return value;
};

const finiteNumber = (value, label, { min = -10_000_000, max = 10_000_000 } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(400, "INVALID_PAYLOAD", `${label} 不是允许范围内的有限数值。`);
  }
  return value;
};

const validateBounds = (value, label) => {
  const bounds = objectValue(value, label);
  finiteNumber(bounds.x, `${label}.x`);
  finiteNumber(bounds.y, `${label}.y`);
  finiteNumber(bounds.width, `${label}.width`, { min: 0.000001 });
  finiteNumber(bounds.height, `${label}.height`, { min: 0.000001 });
};

const validateIsoDate = (value, label) => {
  stringValue(value, label, 64);
  if (!Number.isFinite(Date.parse(value))) {
    fail(400, "INVALID_PAYLOAD", `${label} 不是有效时间。`);
  }
};

const parseDataUrl = (value, maxImageBytes, label = "originalImage.dataUrl") => {
  const dataUrl = stringValue(
    value,
    label,
    Math.ceil(maxImageBytes * 1.4) + 128,
  );
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match || match[2].length % 4 !== 0) {
    fail(
      400,
      "INVALID_IMAGE_REFERENCE",
      "原图必须是 JPEG、PNG 或 WebP 的标准 base64 data URL。",
    );
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxImageBytes) {
    fail(
      413,
      "IMAGE_TOO_LARGE",
      `原图必须大于 0 且不超过 ${maxImageBytes} 字节。`,
    );
  }
  return {
    dataUrl,
    mimeType: match[1],
    base64: match[2],
    bytes: bytes.byteLength,
  };
};

const parseCanvasSnapshotDataUrl = (value, maxCanvasSnapshotBytes) => {
  const dataUrl = stringValue(
    value,
    "canvasSnapshot.dataUrl",
    Math.ceil(maxCanvasSnapshotBytes * 1.4) + 128,
  );
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dataUrl,
  );
  if (!match || match[2].length % 4 !== 0) {
    fail(
      400,
      "INVALID_CANVAS_SNAPSHOT",
      "画布快照必须是 PNG 的标准 base64 data URL。",
    );
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxCanvasSnapshotBytes) {
    fail(
      413,
      "CANVAS_SNAPSHOT_TOO_LARGE",
      `画布快照必须大于 0 且不超过 ${maxCanvasSnapshotBytes} 字节。`,
    );
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.byteLength < 24 ||
    !bytes.subarray(0, pngSignature.byteLength).equals(pngSignature) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    fail(
      400,
      "INVALID_CANVAS_SNAPSHOT",
      "画布快照不是包含 IHDR 的有效 PNG 数据。",
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 32_768 || height > 32_768) {
    fail(400, "INVALID_CANVAS_SNAPSHOT", "画布快照尺寸不受支持。");
  }
  return {
    dataUrl,
    mimeType: match[1],
    base64: match[2],
    bytes: bytes.byteLength,
    width,
    height,
  };
};

const validateCanvasSnapshotMetadata = (
  value,
  limits,
  label = "context.canvasSnapshot",
) => {
  const snapshot = objectValue(value, label);
  stringValue(snapshot.filename, `${label}.filename`, 255);
  if (snapshot.mimeType !== "image/png") {
    fail(
      400,
      "INVALID_CANVAS_SNAPSHOT",
      `${label}.mimeType 必须为 image/png。`,
    );
  }
  finiteNumber(snapshot.width, `${label}.width`, {
    min: 1,
    max: 32_768,
  });
  finiteNumber(snapshot.height, `${label}.height`, {
    min: 1,
    max: 32_768,
  });
  finiteNumber(snapshot.bytes, `${label}.bytes`, {
    min: 1,
    max: limits.maxCanvasSnapshotBytes,
  });
  return snapshot;
};

const validateContextBase = (contextValue, limits) => {
  const context = objectValue(contextValue, "context");
  if (
    context.format !== "ai-canvas-codex-visual-context" ||
    context.version !== 1
  ) {
    fail(400, "INVALID_CONTEXT_FORMAT", "上下文格式或版本不受支持。");
  }
  validateIsoDate(context.generatedAt, "context.generatedAt");

  const document = objectValue(context.document, "context.document");
  stringValue(document.id, "context.document.id", 128);
  stringValue(document.title, "context.document.title", 256, true);

  const image = objectValue(
    context.originalImage,
    "context.originalImage",
  );
  stringValue(image.imageId, "context.originalImage.imageId", 128);
  stringValue(image.fileId, "context.originalImage.fileId", 128);
  stringValue(image.name, "context.originalImage.name", 255);
  stringValue(image.mimeType, "context.originalImage.mimeType", 64);
  finiteNumber(image.naturalWidth, "context.originalImage.naturalWidth", {
    min: 1,
    max: 32_768,
  });
  finiteNumber(image.naturalHeight, "context.originalImage.naturalHeight", {
    min: 1,
    max: 32_768,
  });
  if (image.pixelsAvailable !== true) {
    fail(400, "INVALID_IMAGE_REFERENCE", "原图像素必须可用。");
  }
  validateQuickAnnotations(image, "context.originalImage");

  return {
    context,
    image,
    canvasSnapshot: validateCanvasSnapshotMetadata(
      context.canvasSnapshot,
      limits,
    ),
  };
};

const validateFocusedImageContext = (value, label) => {
  const image = objectValue(value, label);
  stringValue(image.imageId, `${label}.imageId`, 128);
  stringValue(image.fileId, `${label}.fileId`, 128);
  stringValue(image.name, `${label}.name`, 255);
  stringValue(image.mimeType, `${label}.mimeType`, 64);
  finiteNumber(image.naturalWidth, `${label}.naturalWidth`, {
    min: 1,
    max: 32_768,
  });
  finiteNumber(image.naturalHeight, `${label}.naturalHeight`, {
    min: 1,
    max: 32_768,
  });
  if (image.pixelsAvailable !== true) {
    fail(400, "INVALID_IMAGE_REFERENCE", "重点图片像素必须可用。");
  }
  return image;
};

const validateQuickAnnotations = (image, label) => {
  if (!Object.hasOwn(image, "quickAnnotations")) return [];
  if (!Array.isArray(image.quickAnnotations) || image.quickAnnotations.length === 0) {
    fail(
      400,
      "INVALID_QUICK_ANNOTATIONS",
      `${label}.quickAnnotations 必须是非空数组；没有快速标注时应省略字段。`,
    );
  }
  const ids = new Set();
  const ordinals = new Set();
  return image.quickAnnotations.map((value, index) => {
    const itemLabel = `${label}.quickAnnotations[${index}]`;
    const annotation = objectValue(value, itemLabel);
    const id = stringValue(
      annotation.quickAnnotationId,
      `${itemLabel}.quickAnnotationId`,
      128,
    );
    if (ids.has(id)) {
      fail(400, "INVALID_QUICK_ANNOTATIONS", "快速标注 ID 不能重复。");
    }
    ids.add(id);
    const ordinal = finiteNumber(annotation.ordinal, `${itemLabel}.ordinal`, {
      min: 1,
      max: 1_000_000,
    });
    if (!Number.isInteger(ordinal) || ordinals.has(ordinal)) {
      fail(400, "INVALID_QUICK_ANNOTATIONS", "快速标注编号必须是唯一正整数。");
    }
    ordinals.add(ordinal);
    if (annotation.label !== `Q${ordinal}`) {
      fail(400, "INVALID_QUICK_ANNOTATIONS", `${itemLabel}.label 与编号不一致。`);
    }
    if (annotation.imageId !== image.imageId) {
      fail(400, "INVALID_QUICK_ANNOTATIONS", `${itemLabel}.imageId 与所属图片不一致。`);
    }
    if (annotation.mode !== "point" && annotation.mode !== "rectangle") {
      fail(400, "INVALID_QUICK_ANNOTATIONS", `${itemLabel}.mode 无效。`);
    }
    stringValue(annotation.text, `${itemLabel}.text`, 100);
    const normalizedAnchor = objectValue(
      annotation.normalizedAnchor,
      `${itemLabel}.normalizedAnchor`,
    );
    finiteNumber(normalizedAnchor.x, `${itemLabel}.normalizedAnchor.x`, { min: 0, max: 1 });
    finiteNumber(normalizedAnchor.y, `${itemLabel}.normalizedAnchor.y`, { min: 0, max: 1 });
    const originalPixelAnchor = objectValue(
      annotation.originalPixelAnchor,
      `${itemLabel}.originalPixelAnchor`,
    );
    finiteNumber(originalPixelAnchor.x, `${itemLabel}.originalPixelAnchor.x`, { min: 0 });
    finiteNumber(originalPixelAnchor.y, `${itemLabel}.originalPixelAnchor.y`, { min: 0 });
    if (annotation.mode === "point") {
      if (Object.hasOwn(annotation, "rectangle")) {
        fail(400, "INVALID_QUICK_ANNOTATIONS", "点快速标注不得包含矩形范围。");
      }
      return annotation;
    }
    const rectangle = objectValue(annotation.rectangle, `${itemLabel}.rectangle`);
    const normalizedBounds = objectValue(
      rectangle.normalizedBounds,
      `${itemLabel}.rectangle.normalizedBounds`,
    );
    const nx = finiteNumber(normalizedBounds.x, `${itemLabel}.rectangle.normalizedBounds.x`, { min: 0, max: 1 });
    const ny = finiteNumber(normalizedBounds.y, `${itemLabel}.rectangle.normalizedBounds.y`, { min: 0, max: 1 });
    const nw = finiteNumber(normalizedBounds.width, `${itemLabel}.rectangle.normalizedBounds.width`, { min: 0.000001, max: 1 });
    const nh = finiteNumber(normalizedBounds.height, `${itemLabel}.rectangle.normalizedBounds.height`, { min: 0.000001, max: 1 });
    if (nx + nw > 1 || ny + nh > 1) {
      fail(400, "INVALID_QUICK_ANNOTATIONS", "快速标注矩形超出归一化图片范围。");
    }
    validateBounds(
      rectangle.originalPixelBounds,
      `${itemLabel}.rectangle.originalPixelBounds`,
    );
    return annotation;
  });
};

const validateFocusedAnnotationContext = (value, label, limits) => {
  const annotation = objectValue(value, label);
  stringValue(annotation.regionId, `${label}.regionId`, 128);
  if (typeof annotation.selectionVisible !== "boolean") {
    fail(400, "INVALID_PAYLOAD", `${label}.selectionVisible 必须为布尔值。`);
  }
  validateBounds(annotation.originalPixelBounds, `${label}.originalPixelBounds`);
  validateBounds(annotation.clippedPixelBounds, `${label}.clippedPixelBounds`);
  if (
    !Array.isArray(annotation.normalizedCorners) ||
    annotation.normalizedCorners.length !== 4
  ) {
    fail(400, "INVALID_PAYLOAD", `${label}.normalizedCorners 必须包含四个角点。`);
  }
  for (const [index, pointValue] of annotation.normalizedCorners.entries()) {
    const point = objectValue(pointValue, `${label}.normalizedCorners[${index}]`);
    finiteNumber(point.x, `${label}.normalizedCorners[${index}].x`, {
      min: -100,
      max: 100,
    });
    finiteNumber(point.y, `${label}.normalizedCorners[${index}].y`, {
      min: -100,
      max: 100,
    });
  }
  if (typeof annotation.isClipped !== "boolean") {
    fail(400, "INVALID_PAYLOAD", `${label}.isClipped 必须为布尔值。`);
  }
  if (annotation.card === null) {
    return annotation;
  }
  const card = objectValue(annotation.card, `${label}.card`);
  stringValue(card.annotationId, `${label}.card.annotationId`, 128);
  stringValue(card.text, `${label}.card.text`, limits.maxPromptCharacters);
  return annotation;
};

const validateDescriptionContextExtension = (context, focusImages, limits) => {
  const extensionFields = [
    "descriptions",
    "descriptionScopes",
    "descriptionScopeLinks",
  ];
  const hasExtension = extensionFields.some((field) =>
    Object.hasOwn(context, field),
  );
  if (!hasExtension) {
    return;
  }
  if (!extensionFields.every((field) => Array.isArray(context[field]))) {
    fail(
      400,
      "INVALID_DESCRIPTION_CONTEXT",
      "说明扩展必须同时包含 descriptions、descriptionScopes 和 descriptionScopeLinks 数组。",
    );
  }
  if (context.descriptions.length > limits.maxDescriptions) {
    fail(400, "INVALID_DESCRIPTION_CONTEXT", "说明数量超过允许上限。");
  }
  if (context.descriptionScopeLinks.length > limits.maxDescriptionScopeLinks) {
    fail(400, "INVALID_DESCRIPTION_CONTEXT", "说明范围关系超过允许上限。");
  }

  const descriptionIds = new Set();
  context.descriptions.forEach((value, index) => {
    const label = `context.descriptions[${index}]`;
    const description = objectValue(value, label);
    const descriptionId = stringValue(
      description.descriptionId,
      `${label}.descriptionId`,
      128,
    );
    if (descriptionIds.has(descriptionId)) {
      fail(400, "INVALID_DESCRIPTION_CONTEXT", "说明 ID 不能重复。");
    }
    descriptionIds.add(descriptionId);
    stringValue(description.text, `${label}.text`, limits.maxPromptCharacters);
    if (description.referenceUrl !== undefined) {
      const referenceUrl = stringValue(
        description.referenceUrl,
        `${label}.referenceUrl`,
        2_048,
      );
      let parsedReferenceUrl;
      try {
        parsedReferenceUrl = new URL(referenceUrl);
      } catch {
        fail(400, "INVALID_DESCRIPTION_CONTEXT", "说明参考链接必须是完整 URL。");
      }
      if (!['http:', 'https:'].includes(parsedReferenceUrl.protocol)) {
        fail(
          400,
          "INVALID_DESCRIPTION_CONTEXT",
          "说明参考链接只允许 http(s) 协议。",
        );
      }
    }
    const reference = objectValue(description.reference, `${label}.reference`);
    finiteNumber(reference.x, `${label}.reference.x`);
    finiteNumber(reference.y, `${label}.reference.y`);
  });

  const regionIds = new Set();
  context.descriptionScopes.forEach((value, index) => {
    const label = `context.descriptionScopes[${index}]`;
    const scope = objectValue(value, label);
    const regionId = stringValue(scope.regionId, `${label}.regionId`, 128);
    if (regionIds.has(regionId)) {
      fail(400, "INVALID_DESCRIPTION_CONTEXT", "说明范围 ID 不能重复。");
    }
    regionIds.add(regionId);
    stringValue(scope.imageId, `${label}.imageId`, 128);
    validateBounds(scope.originalPixelBounds, `${label}.originalPixelBounds`);
    validateBounds(scope.clippedPixelBounds, `${label}.clippedPixelBounds`);
    if (
      !Array.isArray(scope.normalizedCorners) ||
      scope.normalizedCorners.length !== 4
    ) {
      fail(
        400,
        "INVALID_DESCRIPTION_CONTEXT",
        `${label}.normalizedCorners 必须包含四个角点。`,
      );
    }
    scope.normalizedCorners.forEach((pointValue, pointIndex) => {
      const point = objectValue(
        pointValue,
        `${label}.normalizedCorners[${pointIndex}]`,
      );
      finiteNumber(point.x, `${label}.normalizedCorners[${pointIndex}].x`, {
        min: -100,
        max: 100,
      });
      finiteNumber(point.y, `${label}.normalizedCorners[${pointIndex}].y`, {
        min: -100,
        max: 100,
      });
    });
    if (typeof scope.isClipped !== "boolean") {
      fail(
        400,
        "INVALID_DESCRIPTION_CONTEXT",
        `${label}.isClipped 必须为布尔值。`,
      );
    }
  });

  const linkKeys = new Set();
  context.descriptionScopeLinks.forEach((value, index) => {
    const label = `context.descriptionScopeLinks[${index}]`;
    const link = objectValue(value, label);
    const descriptionId = stringValue(
      link.descriptionId,
      `${label}.descriptionId`,
      128,
    );
    const regionId = stringValue(link.regionId, `${label}.regionId`, 128);
    if (!descriptionIds.has(descriptionId) || !regionIds.has(regionId)) {
      fail(
        400,
        "INVALID_DESCRIPTION_RELATION",
        "说明范围关系引用了不存在的说明或范围。",
      );
    }
    const key = `${descriptionId}\u0000${regionId}`;
    if (linkKeys.has(key)) {
      fail(400, "INVALID_DESCRIPTION_RELATION", "说明范围关系不能重复。");
    }
    linkKeys.add(key);
  });

  focusImages.forEach((image) =>
    image.visibleAnnotations.forEach((annotation) => {
      if (annotation.card !== null) {
        fail(
          400,
          "DUPLICATE_DESCRIPTION_TEXT",
          "V8 说明扩展存在时，旧标注卡不得重复承载说明正文。",
        );
      }
    }),
  );
};

const validateFocusedContext = (contextValue, limits) => {
  const context = objectValue(contextValue, "context");
  if (
    context.format !== "ai-canvas-focused-context" ||
    context.version !== 1
  ) {
    fail(400, "INVALID_CONTEXT_FORMAT", "重点上下文格式或版本不受支持。");
  }
  validateIsoDate(context.generatedAt, "context.generatedAt");
  const document = objectValue(context.document, "context.document");
  stringValue(document.id, "context.document.id", 128);
  stringValue(document.title, "context.document.title", 256, true);
  const overviewSnapshot = validateCanvasSnapshotMetadata(
    context.overviewSnapshot,
    limits,
    "context.overviewSnapshot",
  );
  if (
    !Array.isArray(context.focusImages) ||
    context.focusImages.length === 0 ||
    context.focusImages.length > limits.maxFocusedImages
  ) {
    fail(
      400,
      "INVALID_FOCUSED_IMAGES",
      `重点图片必须为 1 到 ${limits.maxFocusedImages} 张。`,
    );
  }
  const imageIds = new Set();
  const quickAnnotationIds = new Set();
  const quickAnnotationOrdinals = new Set();
  const focusImages = context.focusImages.map((imageValue, index) => {
    const image = validateFocusedImageContext(
      imageValue,
      `context.focusImages[${index}]`,
    );
    if (imageIds.has(image.imageId)) {
      fail(400, "INVALID_FOCUSED_IMAGES", "重点图片不能重复。");
    }
    imageIds.add(image.imageId);
    if (!Array.isArray(image.visibleAnnotations)) {
      fail(
        400,
        "INVALID_PAYLOAD",
        `context.focusImages[${index}].visibleAnnotations 必须为数组。`,
      );
    }
    image.visibleAnnotations.forEach((annotation, annotationIndex) =>
      validateFocusedAnnotationContext(
        annotation,
        `context.focusImages[${index}].visibleAnnotations[${annotationIndex}]`,
        limits,
      ),
    );
    validateQuickAnnotations(image, `context.focusImages[${index}]`).forEach(
      (annotation) => {
        if (
          quickAnnotationIds.has(annotation.quickAnnotationId) ||
          quickAnnotationOrdinals.has(annotation.ordinal)
        ) {
          fail(
            400,
            "INVALID_QUICK_ANNOTATIONS",
            "重点图片之间的快速标注 ID 和文档编号必须唯一。",
          );
        }
        quickAnnotationIds.add(annotation.quickAnnotationId);
        quickAnnotationOrdinals.add(annotation.ordinal);
      },
    );
    return image;
  });
  validateDescriptionContextExtension(context, focusImages, limits);
  return { context, overviewSnapshot, focusImages };
};

const validateOriginalImageReference = (
  value,
  image,
  limits,
  maxImageBytes = limits.maxImageBytes,
  label = "originalImage",
) => {
  const originalImage = objectValue(value, label);
  if (originalImage.encoding !== "data-url") {
    fail(400, "INVALID_IMAGE_REFERENCE", "原图编码方式不受支持。");
  }
  const parsedImage = parseDataUrl(
    originalImage.dataUrl,
    maxImageBytes,
    `${label}.dataUrl`,
  );
  if (parsedImage.mimeType !== image.mimeType) {
    fail(
      400,
      "IMAGE_MIME_MISMATCH",
      "原图 data URL 类型与上下文 mimeType 不一致。",
    );
  }
  return parsedImage;
};

const validateCanvasSnapshotReference = (value, metadata, limits) => {
  const canvasSnapshot = objectValue(value, "canvasSnapshot");
  if (canvasSnapshot.encoding !== "data-url") {
    fail(400, "INVALID_CANVAS_SNAPSHOT", "画布快照编码方式不受支持。");
  }
  const parsedSnapshot = parseCanvasSnapshotDataUrl(
    canvasSnapshot.dataUrl,
    limits.maxCanvasSnapshotBytes,
  );
  if (
    metadata.mimeType !== parsedSnapshot.mimeType ||
    metadata.bytes !== parsedSnapshot.bytes ||
    metadata.width !== parsedSnapshot.width ||
    metadata.height !== parsedSnapshot.height
  ) {
    fail(
      400,
      "CANVAS_SNAPSHOT_MISMATCH",
      "画布快照元数据与 PNG 数据不一致。",
    );
  }
  return parsedSnapshot;
};

const validateReadyPayload = (payload, limits) => {
  const { context, image, canvasSnapshot } = validateContextBase(
    payload.context,
    limits,
  );

  const selection = objectValue(context.selection, "context.selection");
  stringValue(selection.regionId, "context.selection.regionId", 128);
  stringValue(selection.imageId, "context.selection.imageId", 128);
  if (selection.imageId !== image.imageId) {
    fail(
      400,
      "CONTEXT_RELATION_MISMATCH",
      "选区 imageId 与原图 imageId 不一致。",
    );
  }
  validateBounds(
    selection.originalPixelBounds,
    "context.selection.originalPixelBounds",
  );
  validateBounds(
    selection.clippedPixelBounds,
    "context.selection.clippedPixelBounds",
  );
  if (
    !Array.isArray(selection.normalizedCorners) ||
    selection.normalizedCorners.length !== 4
  ) {
    fail(400, "INVALID_PAYLOAD", "归一化选区必须包含四个角点。");
  }
  for (const [index, pointValue] of selection.normalizedCorners.entries()) {
    const point = objectValue(
      pointValue,
      `context.selection.normalizedCorners[${index}]`,
    );
    finiteNumber(point.x, `normalizedCorners[${index}].x`, {
      min: -100,
      max: 100,
    });
    finiteNumber(point.y, `normalizedCorners[${index}].y`, {
      min: -100,
      max: 100,
    });
  }

  const prompt = objectValue(context.prompt, "context.prompt");
  stringValue(
    prompt.text,
    "context.prompt.text",
    limits.maxPromptCharacters,
  );
  if (
    prompt.annotationId !== null &&
    typeof prompt.annotationId !== "string"
  ) {
    fail(400, "INVALID_PAYLOAD", "prompt.annotationId 类型无效。");
  }

  const parsedImage = validateOriginalImageReference(
    payload.originalImage,
    image,
    limits,
  );
  const parsedCanvasSnapshot = validateCanvasSnapshotReference(
    payload.canvasSnapshot,
    canvasSnapshot,
    limits,
  );

  return {
    version: 1,
    status: "READY",
    publishedAt: payload.publishedAt,
    context: structuredClone(context),
    originalImage: parsedImage,
    canvasSnapshot: parsedCanvasSnapshot,
  };
};

const validateNoActiveRegionPayload = (payload, limits) => {
  const snapshotFields = ["context", "originalImage", "canvasSnapshot"];
  const hasPublishedSnapshot = snapshotFields.some((field) =>
    Object.hasOwn(payload, field),
  );
  if (hasPublishedSnapshot) {
    if (!snapshotFields.every((field) => Object.hasOwn(payload, field))) {
      fail(
        400,
        "INVALID_PAYLOAD",
        "无选区快照发布必须同时包含 context、originalImage 和 canvasSnapshot。",
      );
    }
    const { context, image, canvasSnapshot } = validateContextBase(
      payload.context,
      limits,
    );
    if (context.selection !== null || context.prompt !== null) {
      fail(
        400,
        "INVALID_PAYLOAD",
        "无选区快照发布的 selection 和 prompt 必须为 null。",
      );
    }
    return {
      version: 1,
      status: "NO_ACTIVE_REGION",
      publishedAt: payload.publishedAt,
      context: structuredClone(context),
      originalImage: validateOriginalImageReference(
        payload.originalImage,
        image,
        limits,
      ),
      canvasSnapshot: validateCanvasSnapshotReference(
        payload.canvasSnapshot,
        canvasSnapshot,
        limits,
      ),
    };
  }
  const document = objectValue(payload.document, "document");
  return {
    version: 1,
    status: "NO_ACTIVE_REGION",
    publishedAt: payload.publishedAt,
    document: {
      id: stringValue(document.id, "document.id", 128),
    },
  };
};

const validateFocusedPayload = (payload, limits) => {
  const { context, overviewSnapshot, focusImages } = validateFocusedContext(
    payload.context,
    limits,
  );
  const overview = validateCanvasSnapshotReference(
    payload.overviewSnapshot,
    overviewSnapshot,
    limits,
  );
  if (
    !Array.isArray(payload.focusImages) ||
    payload.focusImages.length !== focusImages.length
  ) {
    fail(
      400,
      "INVALID_FOCUSED_IMAGES",
      "重点图片内容必须与重点上下文一一对应。",
    );
  }

  let totalImageBytes = 0;
  const parsedFocusImages = payload.focusImages.map((value, index) => {
    const reference = objectValue(value, `focusImages[${index}]`);
    const image = focusImages[index];
    if (reference.imageId !== image.imageId) {
      fail(
        400,
        "CONTEXT_RELATION_MISMATCH",
        "重点图片内容与上下文图片不一致。",
      );
    }
    const originalImage = validateOriginalImageReference(
      reference.originalImage,
      image,
      limits,
      limits.maxFocusedImageBytes,
      `focusImages[${index}].originalImage`,
    );
    totalImageBytes += originalImage.bytes;
    return {
      imageId: image.imageId,
      originalImage,
    };
  });
  if (totalImageBytes > limits.maxFocusedImagesTotalBytes) {
    fail(
      413,
      "FOCUSED_IMAGES_TOO_LARGE",
      `重点图片总大小不得超过 ${limits.maxFocusedImagesTotalBytes} 字节。`,
    );
  }

  return {
    version: 1,
    status: "FOCUSED",
    publishedAt: payload.publishedAt,
    context: structuredClone(context),
    overviewSnapshot: overview,
    focusImages: parsedFocusImages,
  };
};

const mergeLimits = (overrides = {}) =>
  Object.freeze({ ...DEFAULT_LIMITS, ...overrides });

export const validatePublication = (
  payloadValue,
  limitOverrides = DEFAULT_LIMITS,
) => {
  const limits = mergeLimits(limitOverrides);
  const payload = objectValue(payloadValue, "payload");
  if (payload.version !== 1) {
    fail(400, "INVALID_PAYLOAD", "发布协议版本不受支持。");
  }
  validateIsoDate(payload.publishedAt, "publishedAt");
  if (payload.status === "ready") {
    return validateReadyPayload(payload, limits);
  }
  if (payload.status === "no_active_region") {
    return validateNoActiveRegionPayload(payload, limits);
  }
  if (payload.status === "focused") {
    return validateFocusedPayload(payload, limits);
  }
  fail(400, "INVALID_PAYLOAD", "发布状态不受支持。");
};

export const createBridgeState = ({
  allowedOrigins = [
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
  ],
  limits: configuredLimits = DEFAULT_LIMITS,
} = {}) => {
  const limits = mergeLimits(configuredLimits);
  const sessionId = randomUUID();
  const mcpReadToken = randomUUID();
  const tokenRecords = new Map();
  let latestSnapshot = null;

  const assertOrigin = (origin) => {
    if (!allowedOrigins.includes(origin)) {
      fail(403, "ORIGIN_DENIED", "请求来源不在 Canvas 本机允许列表中。");
    }
  };

  const readSnapshot = (now = Date.now()) => {
    if (!latestSnapshot) {
      return {
        version: 1,
        sessionId,
        status: "NO_ACTIVE_REGION",
        reason: "NOT_PUBLISHED",
      };
    }
    if (Date.parse(latestSnapshot.expiresAt) < now) {
      latestSnapshot = null;
      return {
        version: 1,
        sessionId,
        status: "NO_ACTIVE_REGION",
        reason: "SNAPSHOT_EXPIRED",
      };
    }
    return latestSnapshot;
  };

  const hasMcpReadToken = (value) => {
    if (typeof value !== "string") {
      return false;
    }
    const expected = Buffer.from(mcpReadToken, "utf8");
    const received = Buffer.from(value, "utf8");
    return (
      expected.byteLength === received.byteLength &&
      timingSafeEqual(expected, received)
    );
  };

  return {
    sessionId,
    limits,
    allowedOrigins: [...allowedOrigins],
    getMcpReadToken() {
      return mcpReadToken;
    },
    issueToken(origin, now = Date.now()) {
      assertOrigin(origin);
      const token = randomUUID();
      const expiresAt = now + limits.tokenTtlMs;
      tokenRecords.set(token, { origin, expiresAt });
      return {
        version: 1,
        sessionId,
        token,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },
    publish({ origin, token, payload, now = Date.now() }) {
      assertOrigin(origin);
      const tokenRecord = tokenRecords.get(token);
      tokenRecords.delete(token);
      if (
        !tokenRecord ||
        tokenRecord.origin !== origin ||
        tokenRecord.expiresAt < now
      ) {
        fail(
          401,
          "TOKEN_INVALID",
          "发布令牌无效、已使用、来源不匹配或已过期。",
        );
      }
      const validated = validatePublication(payload, limits);
      const receivedAt = new Date(now).toISOString();
      latestSnapshot = Object.freeze({
        ...validated,
        sessionId,
        revision: randomUUID(),
        receivedAt,
        expiresAt: new Date(now + limits.snapshotTtlMs).toISOString(),
      });
      return {
        version: 1,
        sessionId,
        revision: latestSnapshot.revision,
        status: latestSnapshot.status,
        receivedAt,
      };
    },
    read(now = Date.now()) {
      return readSnapshot(now);
    },
    readFromMcp(readToken, now = Date.now()) {
      if (!hasMcpReadToken(readToken)) {
        fail(401, "MCP_READ_DENIED", "MCP 本机读取能力令牌无效。");
      }
      return readSnapshot(now);
    },
  };
};

const writeJson = (response, status, origin, body) => {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
};

const writeInternalJson = (response, status, body) => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request, maxBytes) => {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    fail(413, "REQUEST_TOO_LARGE", `请求不得超过 ${maxBytes} 字节。`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      fail(413, "REQUEST_TOO_LARGE", `请求不得超过 ${maxBytes} 字节。`);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "INVALID_JSON", "请求体不是有效 JSON。");
  }
};

const bearerToken = (request) => {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    fail(401, "TOKEN_REQUIRED", "发布请求缺少短期令牌。");
  }
  return header.slice("Bearer ".length);
};

const isLoopbackAddress = (address) =>
  address === "127.0.0.1" ||
  address === "::1" ||
  address === "::ffff:127.0.0.1";

const isInternalMcpReadRequest = (request) =>
  request.method === "POST" && request.url === "/mcp/context";

const isInternalControlRequest = (request) =>
  request.method === "POST" && request.url === "/control/shutdown";

export const createBridgeHttpServer = (
  state,
  { controlToken = null, onShutdown = null } = {},
) =>
  createServer(async (request, response) => {
    const origin =
      typeof request.headers.origin === "string"
        ? request.headers.origin
        : "";
    const internalMcpRead = isInternalMcpReadRequest(request);
    const internalControl = isInternalControlRequest(request);
    try {
      if (internalControl) {
        if (
          origin ||
          !isLoopbackAddress(request.socket.remoteAddress) ||
          typeof controlToken !== "string" ||
          !controlToken ||
          typeof onShutdown !== "function"
        ) {
          fail(403, "CONTROL_DENIED", "本机桥接控制仅允许认证的回环请求。");
        }
        if (
          !String(request.headers["content-type"] ?? "").startsWith(
            "application/json",
          )
        ) {
          fail(415, "CONTENT_TYPE_REQUIRED", "请求必须使用 application/json。");
        }
        const payload = await readJsonBody(request, 1_024);
        if (payload?.version !== 1) {
          fail(400, "INVALID_PAYLOAD", "桥接控制协议版本不受支持。");
        }
        if (bearerToken(request) !== controlToken) {
          fail(401, "CONTROL_DENIED", "本机桥接控制令牌无效。");
        }
        writeInternalJson(response, 202, { status: "shutting_down" });
        setImmediate(() => {
          void onShutdown();
        });
        return;
      }
      if (internalMcpRead) {
        if (
          origin ||
          !isLoopbackAddress(request.socket.remoteAddress)
        ) {
          fail(
            403,
            "MCP_READ_DENIED",
            "MCP 上下文读取仅允许无 Origin 的本机回环请求。",
          );
        }
        if (
          !String(request.headers["content-type"] ?? "").startsWith(
            "application/json",
          )
        ) {
          fail(415, "CONTENT_TYPE_REQUIRED", "请求必须使用 application/json。");
        }
        const payload = await readJsonBody(request, 1_024);
        if (payload?.version !== 1) {
          fail(400, "INVALID_PAYLOAD", "MCP 读取协议版本不受支持。");
        }
        writeInternalJson(
          response,
          200,
          state.readFromMcp(bearerToken(request)),
        );
        return;
      }
      if (!state.allowedOrigins.includes(origin)) {
        fail(403, "ORIGIN_DENIED", "请求来源不在 Canvas 本机允许列表中。");
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Max-Age": "60",
          Vary: "Origin",
        });
        response.end();
        return;
      }
      if (
        request.method !== "POST" ||
        (request.url !== "/session" && request.url !== "/publish")
      ) {
        fail(404, "NOT_FOUND", "本机桥接端点不存在。");
      }
      if (
        !String(request.headers["content-type"] ?? "").startsWith(
          "application/json",
        )
      ) {
        fail(415, "CONTENT_TYPE_REQUIRED", "请求必须使用 application/json。");
      }
      if (request.url === "/session") {
        const payload = await readJsonBody(request, 1_024);
        if (payload?.version !== 1) {
          fail(400, "INVALID_PAYLOAD", "会话协议版本不受支持。");
        }
        writeJson(response, 200, origin, state.issueToken(origin));
        return;
      }
      const token = bearerToken(request);
      const payload = await readJsonBody(
        request,
        state.limits.maxRequestBytes,
      );
      writeJson(
        response,
        200,
        origin,
        state.publish({ origin, token, payload }),
      );
    } catch (error) {
      const protocolError =
        error instanceof BridgeProtocolError
          ? error
          : new BridgeProtocolError(
              500,
              "INTERNAL_ERROR",
              "本机桥接处理失败。",
            );
      const errorBody = {
        error: {
          code: protocolError.code,
          message: protocolError.message,
        },
      };
      if (internalMcpRead) {
        writeInternalJson(response, protocolError.status, errorBody);
      } else {
        writeJson(response, protocolError.status, origin || "null", errorBody);
      }
    }
  });

const publicSnapshot = (snapshot) => {
  if (
    snapshot.status === "FOCUSED" &&
    snapshot.overviewSnapshot &&
    snapshot.context &&
    Array.isArray(snapshot.focusImages)
  ) {
    return {
      version: snapshot.version,
      sessionId: snapshot.sessionId,
      status: snapshot.status,
      revision: snapshot.revision,
      publishedAt: snapshot.publishedAt,
      receivedAt: snapshot.receivedAt,
      expiresAt: snapshot.expiresAt,
      context: snapshot.context,
      overviewSnapshot: {
        kind: "mcp_image_content",
        contentIndex: 1,
        contentBlock: 2,
        filename: snapshot.context.overviewSnapshot.filename,
        mimeType: snapshot.overviewSnapshot.mimeType,
        width: snapshot.overviewSnapshot.width,
        height: snapshot.overviewSnapshot.height,
        bytes: snapshot.overviewSnapshot.bytes,
      },
      focusImages: snapshot.focusImages.map((image, index) => ({
        imageId: image.imageId,
        kind: "mcp_image_content",
        contentIndex: index + 2,
        contentBlock: index + 3,
        name: snapshot.context.focusImages[index]?.name,
        mimeType: image.originalImage.mimeType,
        bytes: image.originalImage.bytes,
      })),
    };
  }
  if (!snapshot.originalImage || !snapshot.canvasSnapshot || !snapshot.context) {
    return snapshot;
  }
  return {
    version: snapshot.version,
    sessionId: snapshot.sessionId,
    status: snapshot.status,
    revision: snapshot.revision,
    publishedAt: snapshot.publishedAt,
    receivedAt: snapshot.receivedAt,
    expiresAt: snapshot.expiresAt,
    context: snapshot.context,
    originalImage: {
      kind: "mcp_image_content",
      contentIndex: 1,
      contentBlock: 2,
      mimeType: snapshot.originalImage.mimeType,
      bytes: snapshot.originalImage.bytes,
    },
    canvasSnapshot: {
      kind: "mcp_image_content",
      contentIndex: 2,
      contentBlock: 3,
      filename: snapshot.context.canvasSnapshot.filename,
      mimeType: snapshot.canvasSnapshot.mimeType,
      width: snapshot.canvasSnapshot.width,
      height: snapshot.canvasSnapshot.height,
      bytes: snapshot.canvasSnapshot.bytes,
    },
  };
};

export const buildMcpToolResult = (snapshot, includeImage = true) => {
  const result = {
    content: [
      {
        type: "text",
        text: JSON.stringify(publicSnapshot(snapshot), null, 2),
      },
    ],
    isError: false,
  };
  if (
    includeImage &&
    snapshot.status === "FOCUSED" &&
    snapshot.overviewSnapshot &&
    Array.isArray(snapshot.focusImages)
  ) {
    result.content.push({
      type: "image",
      data: snapshot.overviewSnapshot.base64,
      mimeType: snapshot.overviewSnapshot.mimeType,
    });
    snapshot.focusImages.forEach((image) => {
      result.content.push({
        type: "image",
        data: image.originalImage.base64,
        mimeType: image.originalImage.mimeType,
      });
    });
    return result;
  }
  if (includeImage && snapshot.originalImage && snapshot.canvasSnapshot) {
    result.content.push({
      type: "image",
      data: snapshot.originalImage.base64,
      mimeType: snapshot.originalImage.mimeType,
    });
    result.content.push({
      type: "image",
      data: snapshot.canvasSnapshot.base64,
      mimeType: snapshot.canvasSnapshot.mimeType,
    });
  }
  return result;
};

const readCanonicalResponse = async (response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BridgeProtocolError(
      502,
      "CANONICAL_CONTEXT_UNAVAILABLE",
      "唯一监听的本机桥接实例未提供可读取的上下文。",
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BridgeProtocolError(
      502,
      "CANONICAL_CONTEXT_INVALID",
      "唯一监听的本机桥接实例返回了无效上下文。",
    );
  }
  return payload;
};

export const createCanonicalContextReader = ({
  baseUrl,
  readToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5_000,
}) => {
  if (typeof baseUrl !== "string" || !baseUrl) {
    throw new TypeError("baseUrl 必须是非空字符串。");
  }
  if (typeof readToken !== "string" || !readToken) {
    throw new TypeError("readToken 必须是非空字符串。");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("当前运行时不支持本机上下文读取。");
  }
  return async () => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(`${baseUrl}/mcp/context`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${readToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: 1 }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      return await readCanonicalResponse(response);
    } catch (error) {
      if (error instanceof BridgeProtocolError) {
        throw error;
      }
      const code =
        error instanceof DOMException && error.name === "AbortError"
          ? "CANONICAL_CONTEXT_TIMEOUT"
          : "CANONICAL_CONTEXT_UNAVAILABLE";
      throw new BridgeProtocolError(
        502,
        code,
        "无法读取唯一监听的本机桥接上下文。",
      );
    } finally {
      globalThis.clearTimeout(timeout);
    }
  };
};

export const createMcpMessageHandler = ({ readSnapshot }) => {
  if (typeof readSnapshot !== "function") {
    throw new TypeError("readSnapshot 必须是函数。");
  }
  return async (message) => {
  if (!message || message.jsonrpc !== "2.0") {
    return null;
  }
  if (!("id" in message)) {
    return null;
  }
  const reply = (result) => ({
    jsonrpc: "2.0",
    id: message.id,
    result,
  });
  const errorReply = (code, errorMessage) => ({
    jsonrpc: "2.0",
    id: message.id,
    error: { code, message: errorMessage },
  });

  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    return reply({
      protocolVersion:
        typeof requestedVersion === "string"
          ? requestedVersion
          : "2024-11-05",
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "ai-canvas-local-context",
        version: "0.1.0",
      },
    });
  }
  if (message.method === "ping") {
    return reply({});
  }
  if (message.method === "tools/list") {
    return reply({
      tools: [
        {
          name: "get_canvas_context",
          description:
            "只读返回用户最近一次通过“准备给 Codex”显式发布的内容：单图发布会返回原图与画布快照；重点多图发布会返回当前视窗概览与每张重点原图及其可见标注语义。",
          inputSchema: {
            type: "object",
            properties: {
              includeImage: {
                type: "boolean",
                default: true,
                description: "是否同时返回已发布的视窗概览、原图或带标注画布快照的 MCP image 内容。",
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
      ],
    });
  }
  if (message.method === "tools/call") {
    if (message.params?.name !== "get_canvas_context") {
      return errorReply(-32601, "未知工具。");
    }
    const includeImage = message.params?.arguments?.includeImage !== false;
    try {
      return reply(buildMcpToolResult(await readSnapshot(), includeImage));
    } catch (error) {
      return errorReply(
        -32001,
        `本机桥接上下文读取失败：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
    }
  }
  return errorReply(-32601, "未知 MCP 方法。");
  };
};
