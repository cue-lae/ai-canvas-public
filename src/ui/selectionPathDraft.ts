export interface SelectionPathDraftPoint {
  x: number;
  y: number;
}

export const removeLastSelectionPathAnchor = <
  Point extends SelectionPathDraftPoint,
>(points: readonly Point[]): readonly Point[] =>
  points.length === 0 ? points : points.slice(0, -1);
