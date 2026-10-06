export type CanvasArrangeObjectKind = "image" | "description" | "folder";

export interface CanvasArrangeObject {
  id: string;
  kind: CanvasArrangeObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasArrangePlacement extends CanvasArrangeObject {
  sourceIndex: number;
}

export interface CanvasArrangeLayoutOptions {
  maxRowWidth: number;
  horizontalGap?: number;
  verticalGap?: number;
  readingRowTolerance?: number;
}

export const resolveCanvasArrangeDescriptionImageId = (input: {
  imageBindingImageId?: string;
  linkedRegionImageIds: readonly string[];
  scopeImageIds: ReadonlySet<string>;
}): string | null => {
  if (
    input.imageBindingImageId &&
    input.scopeImageIds.has(input.imageBindingImageId)
  ) {
    return input.imageBindingImageId;
  }

  const linkedImageIds = [
    ...new Set(
      input.linkedRegionImageIds.filter((imageId) =>
        input.scopeImageIds.has(imageId),
      ),
    ),
  ];
  return linkedImageIds.length === 1 ? linkedImageIds[0] : null;
};

const finitePositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const readingOrder = (
  objects: readonly CanvasArrangePlacement[],
  tolerance: number,
): CanvasArrangePlacement[] => {
  const byTop = [...objects].sort(
    (left, right) =>
      left.y - right.y || left.x - right.x || left.sourceIndex - right.sourceIndex,
  );
  const rows: CanvasArrangePlacement[][] = [];

  byTop.forEach((object) => {
    const row = rows.at(-1);
    if (!row || object.y - Math.min(...row.map(({ y }) => y)) > tolerance) {
      rows.push([object]);
      return;
    }
    row.push(object);
  });

  return rows.flatMap((row) =>
    row.sort(
      (left, right) =>
        left.x - right.x || left.y - right.y || left.sourceIndex - right.sourceIndex,
    ),
  );
};

export const arrangeCanvasObjects = (
  objects: readonly CanvasArrangeObject[],
  options: CanvasArrangeLayoutOptions,
): readonly CanvasArrangePlacement[] => {
  if (objects.length === 0) return [];

  const horizontalGap = finitePositive(options.horizontalGap ?? 28, 28);
  const verticalGap = finitePositive(options.verticalGap ?? 32, 32);
  const readingRowTolerance = finitePositive(
    options.readingRowTolerance ?? 90,
    90,
  );
  const normalized = objects.map((object, sourceIndex) => ({
    ...object,
    width: finitePositive(object.width, 1),
    height: finitePositive(object.height, 1),
    sourceIndex,
  }));
  const anchorX = Math.min(...normalized.map(({ x }) => x));
  const anchorY = Math.min(...normalized.map(({ y }) => y));
  const widestObject = Math.max(...normalized.map(({ width }) => width));
  const maxRowWidth = Math.max(
    widestObject,
    finitePositive(options.maxRowWidth, widestObject),
  );
  const ordered = readingOrder(normalized, readingRowTolerance);

  let cursorX = anchorX;
  let cursorY = anchorY;
  let rowHeight = 0;

  return ordered.map((object) => {
    const occupiedWidth = cursorX - anchorX;
    if (
      occupiedWidth > 0 &&
      occupiedWidth + object.width > maxRowWidth
    ) {
      cursorX = anchorX;
      cursorY += rowHeight + verticalGap;
      rowHeight = 0;
    }

    const placement = {
      ...object,
      x: cursorX,
      y: cursorY,
    };
    cursorX += object.width + horizontalGap;
    rowHeight = Math.max(rowHeight, object.height);
    return placement;
  });
};
