import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { bringImageLayerGroupToFront } from "./imageLayerOrder";

const image = (id: string, imageId: string) =>
  ({
    id,
    type: "image",
    isDeleted: false,
    customData: { kind: "image", imageId },
  }) as unknown as ExcalidrawElement;

const marker = (id: string) =>
  ({ id, type: "rectangle", isDeleted: false }) as unknown as ExcalidrawElement;

describe("bringImageLayerGroupToFront", () => {
  it("moves the selected image above other images without moving non-image slots", () => {
    const scene = [image("a", "image-a"), marker("note"), image("b", "image-b")];
    const next = bringImageLayerGroupToFront(scene, "image-a");
    expect(next.map((element) => element.id)).toEqual(["b", "note", "a"]);
  });

  it("keeps the scene unchanged when the image is not present", () => {
    const scene = [image("a", "image-a"), marker("note")];
    expect(bringImageLayerGroupToFront(scene, "missing")).toBe(scene);
  });

  it("does not allocate a new scene when the image is already on top", () => {
    const scene = [image("a", "image-a"), image("b", "image-b")];
    expect(bringImageLayerGroupToFront(scene, "image-b")).toBe(scene);
  });
});
