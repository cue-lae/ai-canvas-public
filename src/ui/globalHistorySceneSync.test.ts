import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { GlobalHistoryTimeline } from "../domain/globalHistoryTimeline";
import {
  AsyncHistoryReplayGate,
  NativeGestureHistoryBarrier,
  classifyGlobalHistorySceneChange,
} from "./globalHistorySceneSync";

const element = (input: Partial<ExcalidrawElement> & Pick<ExcalidrawElement, "id" | "type">) =>
  ({ x: 0, y: 0, width: 10, height: 10, isDeleted: false, ...input }) as ExcalidrawElement;

describe("global history scene synchronization", () => {
  it("admits only current image and host objects while rejecting raw freedraw", () => {
    const image = element({ id: "image-a", type: "image", x: 10 });
    expect(classifyGlobalHistorySceneChange([image], [{ ...image, x: 20 }])).toBe("mixed");
    const region = element({ id: "region-a", type: "rectangle", customData: { kind: "region" } });
    expect(classifyGlobalHistorySceneChange([region], [{ ...region, x: 20 }])).toBe("host");
    const freedraw = element({ id: "free-a", type: "freedraw" });
    expect(classifyGlobalHistorySceneChange([freedraw], [{ ...freedraw, isDeleted: true }])).toBeNull();
    const rawRectangle = element({ id: "raw-a", type: "rectangle" });
    expect(classifyGlobalHistorySceneChange([rawRectangle], [{ ...rawRectangle, x: 20 }])).toBeNull();
  });

  it("replays current mixed and host snapshots without listener re-recording", () => {
    const image = element({ id: "image-a", type: "image", x: 10, customData: { placementId: "placement-a" } });
    const region = element({ id: "region-a", type: "rectangle", customData: { kind: "region" } });
    const before = {
      business: {
        imagePlacements: { "placement-a": { elementId: "image-a", x: 10 } },
        regions: { "region-a": { elementId: "region-a" } },
        descriptions: { "description-a": { text: "正文", anchorX: 100 } },
        scopeLinks: ["description-a:region-a"],
      },
      scene: [image, region],
      selection: { imagePlacementIds: ["placement-a"], regionIds: [], descriptionIds: [] },
    };
    const afterImage = structuredClone(before);
    afterImage.business.imagePlacements["placement-a"].x = 40;
    afterImage.business.descriptions["description-a"].anchorX = 130;
    afterImage.scene[0] = { ...afterImage.scene[0], x: 40 };
    const afterRegionDelete = structuredClone(afterImage);
    afterRegionDelete.scene[1] = { ...afterRegionDelete.scene[1], isDeleted: true };
    afterRegionDelete.selection.regionIds = [];

    const timeline = new GlobalHistoryTimeline(
      (value: typeof before) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    timeline.synchronize(before);
    timeline.commit({ after: afterImage, source: "mixed", operation: "image-transform" });
    timeline.commit({ after: afterRegionDelete, source: "host", operation: "region-delete" });

    timeline.undo((restored) => {
      expect(restored.scene[1].isDeleted).toBe(false);
      expect(restored.business.imagePlacements["placement-a"].elementId).toBe("image-a");
      expect(restored.business.descriptions["description-a"].anchorX).toBe(130);
      timeline.commit({ after: restored, source: "host", operation: "listener-reentry" });
    });
    expect(timeline.entries).toHaveLength(2);
    timeline.redo((restored) => expect(restored.scene[1].isDeleted).toBe(true));
  });

  it("completes when the final image onChange arrives before pointerup", () => {
    const initialImage = [element({ id: "image-a", type: "image", x: 10, width: 10 })];
    const finalImage = [element({ id: "image-a", type: "image", x: 40, width: 30 })];
    const barrier = new NativeGestureHistoryBarrier(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    const timeline = new GlobalHistoryTimeline(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    timeline.synchronize(initialImage);
    barrier.begin("image-transform", initialImage);
    expect(barrier.observeScene(finalImage)).toBe(false);
    if (barrier.pointerUp(finalImage)) {
      timeline.commit({ after: finalImage, source: "mixed", operation: "image-transform" });
    }
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0].after[0]).toMatchObject({ x: 40, width: 30 });
    expect(barrier.active).toBe(false);
  });

  it("waits when pointerup arrives before the final image onChange", () => {
    const initialImage = [element({ id: "image-a", type: "image", x: 10, width: 10 })];
    const finalImage = [element({ id: "image-a", type: "image", x: 40, width: 30 })];
    const barrier = new NativeGestureHistoryBarrier(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );

    barrier.begin("image-transform", initialImage);
    expect(barrier.pointerUp(finalImage)).toBe(false);
    expect(barrier.active).toBe(true);
    expect(barrier.observeScene(finalImage)).toBe(true);
    expect(barrier.active).toBe(false);
  });

  it("releases a click-only native image gesture without blocking later host history", () => {
    const initialImage = [element({ id: "image-a", type: "image", x: 10 })];
    const barrier = new NativeGestureHistoryBarrier(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );

    barrier.begin("image-transform", initialImage);
    expect(barrier.observeScene(initialImage)).toBe(false);
    expect(barrier.pointerUp(initialImage)).toBe(false);
    expect(barrier.active).toBe(false);
  });

  it("holds the replay gate through delayed image onChange without re-recording or truncating redo", async () => {
    const first = [element({ id: "image-a", type: "image", x: 0 })];
    const second = [{ ...first[0], x: 10 }];
    const third = [{ ...first[0], x: 20 }];
    const timeline = new GlobalHistoryTimeline(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    const replayGate = new AsyncHistoryReplayGate(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    timeline.synchronize(first);
    timeline.commit({ after: second, source: "mixed", operation: "move-1" });
    timeline.commit({ after: third, source: "mixed", operation: "move-2" });
    timeline.undo((restored) => replayGate.begin(restored));
    const replayingSceneChange = replayGate.active;
    await Promise.resolve();
    expect(replayGate.observeScene(second)).toBe(true);
    if (!replayingSceneChange) {
      timeline.commit({ after: second, source: "mixed", operation: "listener-reentry" });
    }
    expect(timeline.entries.map((entry) => entry.operation)).toEqual(["move-1", "move-2"]);
    expect(timeline.redo(() => undefined)?.operation).toBe("move-2");
  });

  it("undoes and redoes a Folder cover tombstone without losing geometry", () => {
    const cover = element({
      id: "folder-cover:folder-a",
      type: "rectangle",
      x: 310,
      y: 190,
      width: 232,
      height: 156,
      customData: { kind: "folder-cover", folderId: "folder-a" },
    });
    const empty = [cover];
    const occupied = [{ ...cover, isDeleted: true, version: 2 }];
    const restored = [{ ...cover, isDeleted: false, version: 3 }];
    const timeline = new GlobalHistoryTimeline(
      (value: readonly ExcalidrawElement[]) => structuredClone(value),
      (left, right) => JSON.stringify(left) === JSON.stringify(right),
    );
    timeline.synchronize(empty);
    timeline.commit({ after: occupied, source: "host", operation: "folder-fill" });
    timeline.commit({ after: restored, source: "host", operation: "folder-empty" });

    timeline.undo((snapshot) =>
      expect(snapshot[0]).toMatchObject({
        x: 310,
        y: 190,
        width: 232,
        height: 156,
        isDeleted: true,
      }),
    );
    timeline.undo((snapshot) =>
      expect(snapshot[0]).toMatchObject({ x: 310, y: 190, isDeleted: false }),
    );
    timeline.redo((snapshot) =>
      expect(snapshot[0]).toMatchObject({ x: 310, y: 190, isDeleted: true }),
    );
    timeline.redo((snapshot) =>
      expect(snapshot[0]).toMatchObject({ x: 310, y: 190, isDeleted: false }),
    );
  });
});
