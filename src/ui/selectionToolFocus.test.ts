import { describe, expect, it, vi } from "vitest";
import { releaseSelectionToolFocus } from "./selectionToolFocus";

describe("selection tool focus", () => {
  it("releases focus retained by the selection tool picker", () => {
    const blur = vi.fn();
    expect(
      releaseSelectionToolFocus({
        closest: (selector) => selector === ".selection-tool-picker",
        blur,
      }),
    ).toBe(true);
    expect(blur).toHaveBeenCalledOnce();
  });

  it("leaves unrelated focused controls untouched", () => {
    const blur = vi.fn();
    expect(releaseSelectionToolFocus({ closest: () => null, blur })).toBe(false);
    expect(blur).not.toHaveBeenCalled();
  });
});
