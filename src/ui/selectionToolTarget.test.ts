import { describe, expect, it } from "vitest";
import { resolveSelectionToolImageId as resolve } from "./selectionToolTarget";

describe("selection tool focus target", () => {
  const images = { a: {}, b: {} };
  it("uses focus navigation after selection is cleared or another object is selected", () => {
    expect(resolve({ layer: "image", imageId: "a" }, null, images)).toBe("a");
    expect(resolve({ layer: "image", imageId: "a" }, "b", images)).toBe("a");
    expect(resolve({ layer: "image", imageId: "b" }, "a", images)).toBe("b");
  });
  it("does not reuse a stale image when focus disappears or preview is read-only", () => {
    expect(resolve({ layer: "image", imageId: "missing" }, "a", images)).toBeNull();
    expect(resolve({ layer: "preview" }, "a", images)).toBeNull();
    expect(resolve({ layer: "folder" }, null, images)).toBeNull();
    expect(resolve({ layer: "overview" }, "a", images)).toBe("a");
  });
});
