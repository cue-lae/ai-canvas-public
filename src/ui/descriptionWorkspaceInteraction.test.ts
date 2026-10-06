import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_WORKSPACE_DRAG_THRESHOLD_PX,
  DESCRIPTION_WORKSPACE_VISIBLE_EDGE_PX,
  descriptionWorkspaceDragResult,
  descriptionWorkspaceToggle,
} from "./descriptionWorkspaceInteraction";

describe("description workspace view interaction", () => {
  it("keeps a tap as a stable toggle candidate", () => {
    expect(
      descriptionWorkspaceDragResult({
        startOpen: false,
        startX: 200,
        currentX: 202,
        travel: 180,
      }),
    ).toEqual({ moved: false, progress: 1, open: false });
    expect(descriptionWorkspaceToggle(false)).toBe(true);
  });

  it("snaps horizontal drags without carrying business state", () => {
    expect(DESCRIPTION_WORKSPACE_VISIBLE_EDGE_PX).toBe(20);
    expect(DESCRIPTION_WORKSPACE_DRAG_THRESHOLD_PX).toBe(4);
    expect(
      descriptionWorkspaceDragResult({
        startOpen: true,
        startX: 20,
        currentX: 180,
        travel: 180,
      }),
    ).toMatchObject({ moved: true, open: false, progress: expect.closeTo(0.89) });
    expect(
      descriptionWorkspaceDragResult({
        startOpen: false,
        startX: 180,
        currentX: 10,
        travel: 180,
      }),
    ).toMatchObject({ moved: true, open: true, progress: expect.closeTo(0.06) });
  });
});
