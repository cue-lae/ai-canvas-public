import type {
  Bounds,
  BusinessState,
  BusinessStateV2,
  Point,
  QuickAnnotationRecord,
} from "../domain/types";

export const QUICK_ANNOTATION_TEXT_LIMIT = 100;

export interface QuickAnnotationContext {
  quickAnnotationId: string;
  ordinal: number;
  label: string;
  imageId: string;
  mode: "point" | "rectangle";
  text: string;
  normalizedAnchor: Point;
  originalPixelAnchor: Point;
  rectangle?: {
    normalizedBounds: Bounds;
    originalPixelBounds: Bounds;
  };
}

export const quickAnnotationContextsForImage = (
  business: BusinessState,
  imageId: string,
): QuickAnnotationContext[] => {
  const image = business.imageAssets[imageId];
  if (!image) return [];
  const placement = Object.values(business.imagePlacements).find(
    (candidate) => candidate.active && candidate.imageId === imageId,
  );
  const source = placement?.crop ?? {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  const toOriginalPoint = (point: Point): Point => ({
    x: source.x + point.x * source.width,
    y: source.y + point.y * source.height,
  });
  const toOriginalBounds = (bounds: Bounds): Bounds => ({
    x: source.x + bounds.x * source.width,
    y: source.y + bounds.y * source.height,
    width: bounds.width * source.width,
    height: bounds.height * source.height,
  });
  return Object.values(business.quickAnnotations ?? {})
    .filter(
      (annotation) =>
        annotation.active &&
        annotation.imageId === imageId &&
        Boolean(annotation.text.trim()),
    )
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((annotation) => ({
      quickAnnotationId: annotation.id,
      ordinal: annotation.ordinal,
      label: `Q${annotation.ordinal}`,
      imageId: annotation.imageId,
      mode: annotation.mode,
      text: annotation.text.trim(),
      normalizedAnchor: { ...annotation.anchor },
      originalPixelAnchor: toOriginalPoint(annotation.anchor),
      ...(annotation.mode === "rectangle" && annotation.rectangle
        ? {
            rectangle: {
              normalizedBounds: { ...annotation.rectangle },
              originalPixelBounds: toOriginalBounds(annotation.rectangle),
            },
          }
        : {}),
    }));
};

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const assertFiniteUnit = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} 必须是 [0, 1] 内的有限数`);
  }
};

const normalizedPoint = (point: Point): Point => {
  assertFiniteUnit(point.x, "快速标注锚点 x");
  assertFiniteUnit(point.y, "快速标注锚点 y");
  return { x: point.x, y: point.y };
};

const normalizedRectangle = (bounds: Bounds): Bounds => {
  assertFiniteUnit(bounds.x, "快速标注矩形 x");
  assertFiniteUnit(bounds.y, "快速标注矩形 y");
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > 1 ||
    bounds.y + bounds.height > 1
  ) {
    throw new Error("快速标注矩形必须完整位于图片归一化范围内");
  }
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
};

export const normalizeQuickAnnotationText = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("快速标注文本不能为空");
  }
  if ([...normalized].length > QUICK_ANNOTATION_TEXT_LIMIT) {
    throw new Error(`快速标注文本不能超过 ${QUICK_ANNOTATION_TEXT_LIMIT} 个字符`);
  }
  return normalized;
};

type CreateQuickAnnotationInput = {
  labelAnchor?: Point;
  labelSide?: "left" | "right";
} & (
  | {
      id: string;
      imageId: string;
      mode: "point";
      anchor: Point;
      text: string;
      now?: string;
    }
  | {
      id: string;
      imageId: string;
      mode: "rectangle";
      anchor: Point;
      rectangle: Bounds;
      text: string;
      now?: string;
    });

export const createQuickAnnotation = (
  state: BusinessStateV2,
  input: CreateQuickAnnotationInput,
): BusinessStateV2 => {
  if (!state.imageAssets[input.imageId]) {
    throw new Error(`快速标注引用未知图片 ${input.imageId}`);
  }
  if (state.quickAnnotations[input.id]) {
    throw new Error(`快速标注 ${input.id} 已存在`);
  }
  const ordinal = state.document.nextQuickAnnotationOrdinal;
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error("快速标注文档编号计数器无效");
  }
  const now = input.now ?? new Date().toISOString();
  const rectangle =
    input.mode === "rectangle"
      ? normalizedRectangle(input.rectangle)
      : undefined;
  const anchor = normalizedPoint(input.anchor);
  if (
    rectangle &&
    !(
      (Math.abs(anchor.x - rectangle.x) <= 1e-9 ||
        Math.abs(anchor.x - (rectangle.x + rectangle.width)) <= 1e-9) &&
      (Math.abs(anchor.y - rectangle.y) <= 1e-9 ||
        Math.abs(anchor.y - (rectangle.y + rectangle.height)) <= 1e-9)
    )
  ) {
    throw new Error("矩形快速标注的气泡尖角必须位于按下时对应的矩形角");
  }
  const annotation: QuickAnnotationRecord = {
    id: input.id,
    imageId: input.imageId,
    mode: input.mode,
    anchor,
    ...(input.labelAnchor ? { labelAnchor: { ...input.labelAnchor }, labelSide: input.labelSide } : {}),
    ...(rectangle ? { rectangle } : {}),
    text: normalizeQuickAnnotationText(input.text),
    ordinal,
    collapsed: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    document: {
      ...state.document,
      quickAnnotationIds: [...state.document.quickAnnotationIds, input.id],
      nextQuickAnnotationOrdinal: ordinal + 1,
      updatedAt: now,
    },
    quickAnnotations: {
      ...state.quickAnnotations,
      [input.id]: annotation,
    },
  };
};

const updateQuickAnnotation = (
  state: BusinessStateV2,
  annotationId: string,
  update: (annotation: QuickAnnotationRecord) => QuickAnnotationRecord,
  now = new Date().toISOString(),
): BusinessStateV2 => {
  const current = state.quickAnnotations[annotationId];
  if (!current) {
    throw new Error(`快速标注 ${annotationId} 不存在`);
  }
  return {
    ...state,
    document: { ...state.document, updatedAt: now },
    quickAnnotations: {
      ...state.quickAnnotations,
      [annotationId]: {
        ...update(current),
        updatedAt: now,
      },
    },
  };
};

export const setQuickAnnotationLabelAnchor = (
  state: BusinessStateV2,
  annotationId: string,
  labelAnchor: Point,
  now?: string,
  labelSide?: "left" | "right",
): BusinessStateV2 =>
  updateQuickAnnotation(
    state,
    annotationId,
    (annotation) => {
      if (!Number.isFinite(labelAnchor.x) || !Number.isFinite(labelAnchor.y)) {
        throw new Error("快速标注标签位置必须是有限数");
      }
      return { ...annotation, labelAnchor: { ...labelAnchor }, ...(labelSide ? { labelSide } : {}) };
    },
    now,
  );

export const setQuickAnnotationText = (
  state: BusinessStateV2,
  annotationId: string,
  text: string,
  now?: string,
): BusinessStateV2 =>
  updateQuickAnnotation(
    state,
    annotationId,
    (annotation) => ({
      ...annotation,
      text: normalizeQuickAnnotationText(text),
    }),
    now,
  );

export const setQuickAnnotationCollapsed = (
  state: BusinessStateV2,
  annotationId: string,
  collapsed: boolean,
  now?: string,
): BusinessStateV2 =>
  updateQuickAnnotation(
    state,
    annotationId,
    (annotation) => ({ ...annotation, collapsed }),
    now,
  );

export const translateQuickAnnotation = (
  state: BusinessStateV2,
  annotationId: string,
  delta: Point,
  now?: string,
): BusinessStateV2 => {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new Error("快速标注位移必须是有限数");
  }
  return updateQuickAnnotation(
    state,
    annotationId,
    (annotation) => {
      if (annotation.mode === "point") {
        return {
          ...annotation,
          anchor: {
            x: clampUnit(annotation.anchor.x + delta.x),
            y: clampUnit(annotation.anchor.y + delta.y),
          },
        };
      }
      const rectangle = annotation.rectangle;
      if (!rectangle) {
        throw new Error(`矩形快速标注 ${annotation.id} 缺少范围`);
      }
      const x = Math.min(
        Math.max(0, rectangle.x + delta.x),
        1 - rectangle.width,
      );
      const y = Math.min(
        Math.max(0, rectangle.y + delta.y),
        1 - rectangle.height,
      );
      return {
        ...annotation,
        anchor: {
          x: annotation.anchor.x + (x - rectangle.x),
          y: annotation.anchor.y + (y - rectangle.y),
        },
        rectangle: { ...rectangle, x, y },
      };
    },
    now,
  );
};

export const deleteQuickAnnotation = (
  state: BusinessStateV2,
  annotationId: string,
  now = new Date().toISOString(),
): BusinessStateV2 => {
  if (!state.quickAnnotations[annotationId]) {
    return state;
  }
  const { [annotationId]: _deleted, ...remaining } = state.quickAnnotations;
  return {
    ...state,
    document: {
      ...state.document,
      quickAnnotationIds: state.document.quickAnnotationIds.filter(
        (id) => id !== annotationId,
      ),
      updatedAt: now,
    },
    quickAnnotations: remaining,
  };
};

export const resizeQuickAnnotationBounds = (
  bounds: Bounds, corner: number, delta: Point, proportional: boolean,
  minimum: Point = { x: 0.001, y: 0.001 },
): Bounds => {
  const right = corner === 1 || corner === 2;
  const bottom = corner === 2 || corner === 3;
  const fixedX = right ? bounds.x : bounds.x + bounds.width;
  const fixedY = bottom ? bounds.y : bounds.y + bounds.height;
  const maxWidth = right ? 1 - fixedX : fixedX;
  const maxHeight = bottom ? 1 - fixedY : fixedY;
  let width = bounds.width + (right ? delta.x : -delta.x);
  let height = bounds.height + (bottom ? delta.y : -delta.y);
  if (proportional) {
    const desired = (width * bounds.width + height * bounds.height) /
      (bounds.width ** 2 + bounds.height ** 2);
    const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height,
      Math.max(minimum.x / bounds.width, minimum.y / bounds.height, desired));
    width = bounds.width * scale;
    height = bounds.height * scale;
  } else {
    width = Math.min(maxWidth, Math.max(minimum.x, width));
    height = Math.min(maxHeight, Math.max(minimum.y, height));
  }
  return { x: right ? fixedX : fixedX - width, y: bottom ? fixedY : fixedY - height, width, height };
};

export const withQuickAnnotationBounds = (annotation: QuickAnnotationRecord, rectangle: Bounds): QuickAnnotationRecord => {
  if (!annotation.rectangle) return annotation;
  const wasRight = Math.abs(annotation.anchor.x - annotation.rectangle.x) > 1e-9;
  const wasBottom = Math.abs(annotation.anchor.y - annotation.rectangle.y) > 1e-9;
  return { ...annotation, rectangle, anchor: {
    x: rectangle.x + (wasRight ? rectangle.width : 0),
    y: rectangle.y + (wasBottom ? rectangle.height : 0),
  } };
};

export const resizeQuickAnnotation = (state: BusinessStateV2, id: string, rectangle: Bounds): BusinessStateV2 =>
  updateQuickAnnotation(state, id, (annotation) => {
    if (annotation.mode !== "rectangle") throw new Error("仅矩形快速标注可以缩放");
    return withQuickAnnotationBounds(annotation, normalizedRectangle(rectangle));
  });
