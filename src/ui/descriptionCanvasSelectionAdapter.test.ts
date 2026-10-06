import { describe, expect, it } from "vitest";
import { createCanvasSelection } from "./canvasSelection";
import { selectedDescriptionIdsForOverlay } from "./descriptionCanvasSelectionAdapter";

describe("description canvas selection adapter", () => {
  it("projects only controlled description IDs into the overlay boundary", () => {
    expect(
      selectedDescriptionIdsForOverlay(
        createCanvasSelection({
          imagePlacementIds: ["image-placement-a"],
          regionIds: ["region-a"],
          descriptionIds: ["description-a"],
        }),
      ),
    ).toEqual(new Set(["description-a"]));
  });
});
