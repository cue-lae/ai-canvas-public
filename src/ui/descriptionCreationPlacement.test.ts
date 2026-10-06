import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_CREATION_IMAGE_GAP_PX,
  descriptionCreationCardSize,
  placeNewDescriptionOutsideImages,
  type DescriptionPlacementBounds,
} from "./descriptionCreationPlacement";

const viewport = [0, 0, 1200, 800] as const;
const preferred = { x: 180, y: 150 };
const size = descriptionCreationCardSize(1);
const gap = DESCRIPTION_CREATION_IMAGE_GAP_PX;
const noOverlap = (
  p: { x: number; y: number },
  card: { width: number; height: number },
  image: DescriptionPlacementBounds,
  spacing = gap,
) => p.x + card.width <= image[0] - spacing + 1e-6 ||
  p.x >= image[2] + spacing - 1e-6 ||
  p.y + card.height <= image[1] - spacing + 1e-6 ||
  p.y >= image[3] + spacing - 1e-6;

describe("new description image avoidance", () => {
  it("preserves the existing creation point when no image covers the card", () => {
    for (const imageBounds of [[], [[700, 500, 1100, 700] as const]]) {
      expect(placeNewDescriptionOutsideImages({ preferred, size, viewport, gap, imageBounds }))
        .toEqual(preferred);
    }
  });

  it("moves the whole card clear even when its anchor already lies outside the image", () => {
    const image = [300, 100, 700, 500] as const;
    const result = placeNewDescriptionOutsideImages({ preferred, size, viewport, gap, imageBounds: [image] });
    expect(result).not.toEqual(preferred);
    expect(noOverlap(result, size, image)).toBe(true);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + size.width).toBeLessThanOrEqual(viewport[2]);
    expect(result.y + size.height).toBeLessThanOrEqual(viewport[3]);
  });

  it("checks neighboring images rather than moving onto the next image", () => {
    const images = [[0, 0, 650, 500], [660, 0, 1200, 500]] as const;
    const result = placeNewDescriptionOutsideImages({ preferred, size, viewport, gap, imageBounds: images });
    expect(images.every((image) => noOverlap(result, size, image))).toBe(true);
    expect(result.y).toBe(524);
  });

  it("prefers a visible empty area over a closer offscreen position", () => {
    const image = [-500, -500, 700, 550] as const;
    const result = placeNewDescriptionOutsideImages({ preferred, size, viewport, gap, imageBounds: [image] });
    expect(noOverlap(result, size, image)).toBe(true);
    expect(result.y).toBe(574);
  });

  it("allows an offscreen result when the image fills the viewport, without changing inputs", () => {
    const image = [-5000, -5000, 5000, 5000] as const;
    const input = { preferred, size, viewport, gap, imageBounds: [image] };
    const before = structuredClone(input);
    const result = placeNewDescriptionOutsideImages(input);
    expect(noOverlap(result, size, image)).toBe(true);
    expect(result.x < 0 || result.y < 0 || result.x > 1200 || result.y > 800).toBe(true);
    expect(input).toEqual(before);
  });

  it("respects the larger outer bounds supplied for a rotated image", () => {
    const image = [-120, -160, 480, 440] as const;
    const result = placeNewDescriptionOutsideImages({ preferred, size, viewport, gap, imageBounds: [image] });
    expect(noOverlap(result, size, image)).toBe(true);
  });

  it("finds a precisely fitting gap and is independent of image order", () => {
    const images = [[0, -500, 276, 1500], [540, -500, 1600, 1500]] as const;
    const input = { preferred, size, viewport, gap, imageBounds: images };
    const result = placeNewDescriptionOutsideImages(input);
    expect(result).toEqual({ x: 300, y: 150 });
    expect(placeNewDescriptionOutsideImages({ ...input, imageBounds: [...images].reverse() })).toEqual(result);
  });

  it.each([0.1, 0.25, 0.5, 1, 2, 2.8])("keeps the screen footprint and gap clear at zoom %s", (zoom) => {
    const card = descriptionCreationCardSize(zoom);
    expect(card.width * zoom).toBeGreaterThanOrEqual(48);
    expect(card.height * zoom).toBeGreaterThanOrEqual(32);
    const image = [-200 / zoom, -200 / zoom, 1100 / zoom, 900 / zoom] as const;
    const result = placeNewDescriptionOutsideImages({
      preferred: { x: 180 / zoom, y: 150 / zoom },
      size: card,
      viewport: [0, 0, 1200 / zoom, 800 / zoom],
      gap: gap / zoom,
      imageBounds: [image],
    });
    expect(noOverlap(result, card, image, gap / zoom)).toBe(true);
  });

  it("avoids every image in dense layouts, including offscreen obstacles", () => {
    const images: DescriptionPlacementBounds[] = Array.from({ length: 40 }, (_, i) => {
      const x = (i % 8) * 185 - 200;
      const y = Math.floor(i / 8) * 150 - 150;
      return [x, y, x + 150, y + 120];
    });
    const result = placeNewDescriptionOutsideImages({ preferred, size, viewport, gap, imageBounds: images });
    expect(images.every((image) => noOverlap(result, size, image))).toBe(true);
    expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
  });
});
