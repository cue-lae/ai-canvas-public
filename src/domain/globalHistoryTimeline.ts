export type GlobalHistorySource = "host" | "mixed";

export interface GlobalHistorySnapshot<Business, Scene, Selection> {
  business: Business;
  scene: Scene;
  selection: Selection;
}

export interface GlobalHistoryEntry<Snapshot> {
  sequence: number;
  committedAt: number;
  source: GlobalHistorySource;
  operation: string;
  before: Snapshot;
  after: Snapshot;
}

export class GlobalHistoryTimeline<Snapshot> {
  private entriesValue: GlobalHistoryEntry<Snapshot>[] = [];
  private cursorValue = 0;
  private nextSequence = 1;
  private currentValue: Snapshot | null = null;
  private replaying = false;

  constructor(
    private readonly cloneSnapshot: (snapshot: Snapshot) => Snapshot,
    private readonly snapshotsEqual: (left: Snapshot, right: Snapshot) => boolean,
  ) {}

  get entries(): readonly GlobalHistoryEntry<Snapshot>[] {
    return this.entriesValue;
  }

  get cursor(): number {
    return this.cursorValue;
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  get current(): Snapshot | null {
    return this.currentValue ? this.cloneSnapshot(this.currentValue) : null;
  }

  synchronize(snapshot: Snapshot): void {
    if (this.currentValue === null) {
      this.currentValue = this.cloneSnapshot(snapshot);
    }
  }

  synchronizeTransient(snapshot: Snapshot): void {
    if (!this.replaying) {
      this.currentValue = this.cloneSnapshot(snapshot);
    }
  }

  commit(input: {
    after: Snapshot;
    source: GlobalHistorySource;
    operation: string;
    committedAt?: number;
  }): GlobalHistoryEntry<Snapshot> | null {
    if (this.replaying) {
      return null;
    }
    if (this.currentValue === null) {
      this.currentValue = this.cloneSnapshot(input.after);
      return null;
    }
    if (this.snapshotsEqual(this.currentValue, input.after)) {
      return null;
    }
    const before = this.cloneSnapshot(this.currentValue);
    const after = this.cloneSnapshot(input.after);
    const entry: GlobalHistoryEntry<Snapshot> = {
      sequence: this.nextSequence++,
      committedAt: input.committedAt ?? Date.now(),
      source: input.source,
      operation: input.operation,
      before,
      after,
    };
    this.entriesValue = [
      ...this.entriesValue.slice(0, this.cursorValue),
      entry,
    ];
    this.cursorValue = this.entriesValue.length;
    this.currentValue = after;
    return entry;
  }

  undo(apply: (snapshot: Snapshot) => void): GlobalHistoryEntry<Snapshot> | null {
    if (this.cursorValue === 0) {
      return null;
    }
    const entry = this.entriesValue[this.cursorValue - 1];
    this.replay(entry.before, apply);
    this.cursorValue -= 1;
    return entry;
  }

  redo(apply: (snapshot: Snapshot) => void): GlobalHistoryEntry<Snapshot> | null {
    if (this.cursorValue >= this.entriesValue.length) {
      return null;
    }
    const entry = this.entriesValue[this.cursorValue];
    this.replay(entry.after, apply);
    this.cursorValue += 1;
    return entry;
  }

  private replay(snapshot: Snapshot, apply: (snapshot: Snapshot) => void): void {
    this.replaying = true;
    const replaySnapshot = this.cloneSnapshot(snapshot);
    try {
      apply(replaySnapshot);
      this.currentValue = this.cloneSnapshot(replaySnapshot);
    } finally {
      this.replaying = false;
    }
  }
}

export const mergeGlobalHistorySources = (
  left: GlobalHistorySource,
  right: GlobalHistorySource,
): GlobalHistorySource => (left === right ? left : "mixed");
