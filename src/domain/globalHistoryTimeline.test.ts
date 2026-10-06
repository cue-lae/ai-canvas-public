import { describe, expect, it } from "vitest";
import {
  GlobalHistoryTimeline,
  type GlobalHistorySnapshot,
} from "./globalHistoryTimeline";

type Snapshot = GlobalHistorySnapshot<
  { imageX: number; regions: string[]; descriptions: Record<string, string>; scopes: string[]; anchorX: number },
  { regionDeleted: boolean },
  { ids: string[] }
>;

const clone = (snapshot: Snapshot): Snapshot => structuredClone(snapshot);
const equal = (left: Snapshot, right: Snapshot): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
const snapshot = (value = 0): Snapshot => ({
  business: {
    imageX: value,
    regions: value >= 1 ? ["region-a"] : [],
    descriptions: value >= 2 ? { "description-a": "正文" } : {},
    scopes: value >= 3 ? ["description-a:region-a"] : [],
    anchorX: value >= 4 ? 240 : 120,
  },
  scene: { regionDeleted: value >= 5 },
  selection: { ids: value >= 5 ? ["region-a"] : [] },
});

describe("GlobalHistoryTimeline", () => {
  it("keeps one real-time cursor across host and mixed entries", () => {
    const timeline = new GlobalHistoryTimeline(clone, equal);
    timeline.synchronize(snapshot(0));
    timeline.commit({ after: snapshot(1), source: "mixed", operation: "image-transform", committedAt: 1 });
    timeline.commit({ after: snapshot(2), source: "host", operation: "description", committedAt: 2 });
    timeline.commit({ after: snapshot(3), source: "host", operation: "scope", committedAt: 3 });
    timeline.commit({ after: snapshot(4), source: "host", operation: "anchor-move", committedAt: 4 });
    timeline.commit({ after: snapshot(5), source: "host", operation: "region-delete", committedAt: 5 });

    expect(timeline.entries.map(({ source, operation }) => ({ source, operation }))).toEqual([
      { source: "mixed", operation: "image-transform" },
      { source: "host", operation: "description" },
      { source: "host", operation: "scope" },
      { source: "host", operation: "anchor-move" },
      { source: "host", operation: "region-delete" },
    ]);
    const replayed: Snapshot[] = [];
    timeline.undo((value) => replayed.push(value));
    timeline.undo((value) => replayed.push(value));
    expect(replayed.map((value) => value.business.anchorX)).toEqual([240, 120]);
    timeline.redo((value) => replayed.push(value));
    expect(replayed.at(-1)?.business.anchorX).toBe(240);
  });

  it("atomically truncates the redo tail after a new successful commit", () => {
    const timeline = new GlobalHistoryTimeline(clone, equal);
    timeline.synchronize(snapshot(0));
    timeline.commit({ after: snapshot(1), source: "mixed", operation: "image" });
    timeline.commit({ after: snapshot(2), source: "host", operation: "description" });
    timeline.undo(() => undefined);
    timeline.commit({ after: snapshot(3), source: "host", operation: "scope-new-branch" });
    expect(timeline.entries.map((entry) => entry.operation)).toEqual(["image", "scope-new-branch"]);
    expect(timeline.redo(() => undefined)).toBeNull();
  });

  it("suppresses listener commits during replay and restores region Delete Undo Redo", () => {
    const timeline = new GlobalHistoryTimeline(clone, equal);
    timeline.synchronize(snapshot(4));
    timeline.commit({ after: snapshot(5), source: "host", operation: "region-delete" });
    const entryCount = timeline.entries.length;
    timeline.undo((value) => {
      expect(timeline.isReplaying).toBe(true);
      timeline.commit({ after: value, source: "host", operation: "listener-reentry" });
      expect(value.scene.regionDeleted).toBe(false);
    });
    expect(timeline.entries).toHaveLength(entryCount);
    timeline.redo((value) => expect(value.scene.regionDeleted).toBe(true));
  });
});
