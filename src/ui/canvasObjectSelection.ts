export interface CanvasObjectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasObjectSelectionCandidate {
  kind: "description" | "image" | "region";
  /** Images use their stable ImagePlacement ID here, not an element ID. */
  id: string;
  bounds: CanvasObjectBounds;
}

export type CanvasMarqueeSelectionMode = "contain" | "intersect";

export interface CanvasObjectSelectionResult {
  descriptionIds: string[];
  imagePlacementIds: string[];
  regionIds: string[];
}

export const normalizeMarqueeRect = (
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): CanvasObjectBounds => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  right: Math.max(start.x, end.x),
  bottom: Math.max(start.y, end.y),
});

const intersects = (
  left: CanvasObjectBounds,
  right: CanvasObjectBounds,
): boolean =>
  left.left <= right.right &&
  left.right >= right.left &&
  left.top <= right.bottom &&
  left.bottom >= right.top;

const contains = (
  container: CanvasObjectBounds,
  candidate: CanvasObjectBounds,
): boolean =>
  container.left <= candidate.left &&
  container.right >= candidate.right &&
  container.top <= candidate.top &&
  container.bottom >= candidate.bottom;

/** CAD convention: left-to-right fully contains, right-to-left intersects. */
export const marqueeSelectionMode = (
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): CanvasMarqueeSelectionMode => (start.x <= end.x ? "contain" : "intersect");

export const marqueeSelectsBounds = (
  marquee: CanvasObjectBounds,
  candidate: CanvasObjectBounds,
  mode: CanvasMarqueeSelectionMode,
): boolean =>
  mode === "contain"
    ? contains(marquee, candidate)
    : intersects(marquee, candidate);

export const selectCanvasObjectsInMarquee = (
  marquee: CanvasObjectBounds,
  candidates: readonly CanvasObjectSelectionCandidate[],
  mode: CanvasMarqueeSelectionMode = "intersect",
): CanvasObjectSelectionResult => {
  const descriptionIds = new Set<string>();
  const imagePlacementIds = new Set<string>();
  const regionIds = new Set<string>();
  candidates.forEach((candidate) => {
    const selected = marqueeSelectsBounds(marquee, candidate.bounds, mode);
    if (!selected) {
      return;
    }
    if (candidate.kind === "description") {
      descriptionIds.add(candidate.id);
    } else if (candidate.kind === "image") {
      imagePlacementIds.add(candidate.id);
    } else {
      regionIds.add(candidate.id);
    }
  });
  return {
    descriptionIds: [...descriptionIds],
    imagePlacementIds: [...imagePlacementIds],
    regionIds: [...regionIds],
  };
};
