import { describe, expect, it, vi } from "vitest";
import {
  createReadPublicationRequestGuard,
  type ReadPublicationIdentity,
} from "./readPublicationRequest";

const originalIdentity: ReadPublicationIdentity = {
  documentId: "document-a",
  restoreGeneration: 0,
  folderScopeId: "root",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function publicationHarness() {
  const guard = createReadPublicationRequestGuard(originalIdentity);
  const setContext = vi.fn();
  const setStatus = vi.fn();
  const setBusy = vi.fn();
  const snapshot = deferred<string>();
  const receipt = deferred<string>();
  const publish = vi.fn(() => receipt.promise);
  const run = async () => {
    const token = guard.begin();
    setBusy(true);
    try {
      const context = await snapshot.promise;
      if (!guard.isCurrent(token)) return;
      const revision = await publish();
      if (!guard.isCurrent(token)) return;
      setContext(context);
      setStatus(revision);
    } catch (error) {
      if (!guard.isCurrent(token)) return;
      setContext(null);
      setStatus(error);
    } finally {
      if (guard.finish(token)) setBusy(false);
    }
  };
  return {
    guard, setContext, setStatus, setBusy, snapshot, receipt, publish, run,
  };
}

describe("Read publication request ownership", () => {
  it("keeps the request current for unchanged identity and ordinary same-scope work", () => {
    const guard = createReadPublicationRequestGuard(originalIdentity);
    const token = guard.begin();
    expect(guard.syncIdentity({ ...originalIdentity })).toBe(false);
    expect(guard.isCurrent(token)).toBe(true);
    expect(guard.finish(token)).toBe(true);
    expect(guard.isCurrent(token)).toBe(false);
    expect(guard.finish(token)).toBe(false);
  });

  it.each([
    ["another document", { documentId: "document-b" }],
    ["same-ID restore", { restoreGeneration: 1 }],
    ["another actual folder scope", { folderScopeId: "folder-a" }],
  ])("invalidates results after %s but still permits owned cleanup", (_label, patch) => {
    const guard = createReadPublicationRequestGuard(originalIdentity);
    const token = guard.begin();
    expect(guard.syncIdentity({ ...originalIdentity, ...patch })).toBe(true);
    expect(guard.isCurrent(token)).toBe(false);
    expect(guard.finish(token)).toBe(true);
  });

  it("does not revive an old request after leaving and returning to the same scope", () => {
    const guard = createReadPublicationRequestGuard(originalIdentity);
    const token = guard.begin();
    guard.syncIdentity({ ...originalIdentity, folderScopeId: "folder-a" });
    guard.syncIdentity(originalIdentity);
    expect(guard.isCurrent(token)).toBe(false);
    const replacement = guard.begin();
    expect(guard.isCurrent(replacement)).toBe(true);
    expect(guard.finish(token)).toBe(false);
    expect(guard.isCurrent(replacement)).toBe(true);
  });

  it("explicitly invalidates a request before a restore changes business data", () => {
    const guard = createReadPublicationRequestGuard(originalIdentity);
    const token = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
    expect(guard.finish(token)).toBe(true);
  });

  it("an old finally cannot release busy owned by a newer request", () => {
    const guard = createReadPublicationRequestGuard(originalIdentity);
    const first = guard.begin();
    const second = guard.begin();
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.finish(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    expect(guard.finish(second)).toBe(true);
  });

  it("copies identity inputs so external object mutation cannot revive a request", () => {
    const identity = { ...originalIdentity };
    const guard = createReadPublicationRequestGuard(identity);
    const token = guard.begin();
    identity.folderScopeId = "folder-a";
    guard.syncIdentity(identity);
    identity.folderScopeId = "root";
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("does not send a snapshot that became stale before the send and releases busy", async () => {
    const harness = publicationHarness();
    const completion = harness.run();
    harness.guard.syncIdentity({ ...originalIdentity, restoreGeneration: 1 });
    harness.snapshot.resolve("stale snapshot");
    await completion;
    expect(harness.publish).not.toHaveBeenCalled();
    expect(harness.setContext).not.toHaveBeenCalled();
    expect(harness.setStatus).not.toHaveBeenCalled();
    expect(harness.setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("ignores late success after scope roundtrip without claiming to revoke the send", async () => {
    const harness = publicationHarness();
    const completion = harness.run();
    harness.snapshot.resolve("old context");
    await Promise.resolve();
    expect(harness.publish).toHaveBeenCalledTimes(1);
    harness.guard.syncIdentity({ ...originalIdentity, folderScopeId: "folder-a" });
    harness.guard.syncIdentity(originalIdentity);
    harness.receipt.resolve("old revision");
    await completion;
    expect(harness.setContext).not.toHaveBeenCalled();
    expect(harness.setStatus).not.toHaveBeenCalled();
    expect(harness.setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("ignores late failure after same-ID restore and releases its own busy", async () => {
    const harness = publicationHarness();
    const completion = harness.run();
    harness.snapshot.resolve("old context");
    await Promise.resolve();
    harness.guard.syncIdentity({ ...originalIdentity, restoreGeneration: 1 });
    harness.receipt.reject(new Error("old transport failure"));
    await completion;
    expect(harness.setContext).not.toHaveBeenCalled();
    expect(harness.setStatus).not.toHaveBeenCalled();
    expect(harness.setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("an old awaited callback cannot finish a replacement owner's busy", async () => {
    const harness = publicationHarness();
    const completion = harness.run();
    harness.snapshot.resolve("old context");
    await Promise.resolve();
    const replacement = harness.guard.begin();
    harness.receipt.resolve("old revision");
    await completion;
    expect(harness.setContext).not.toHaveBeenCalled();
    expect(harness.setStatus).not.toHaveBeenCalled();
    expect(harness.setBusy.mock.calls).toEqual([[true]]);
    expect(harness.guard.isCurrent(replacement)).toBe(true);
    expect(harness.guard.finish(replacement)).toBe(true);
  });

  it("accepts a current success and reports a current failure", async () => {
    const success = publicationHarness();
    const completed = success.run();
    success.snapshot.resolve("current context");
    await Promise.resolve();
    success.receipt.resolve("revision-2");
    await completed;
    expect(success.setContext).toHaveBeenCalledWith("current context");
    expect(success.setStatus).toHaveBeenCalledWith("revision-2");
    expect(success.setBusy.mock.calls).toEqual([[true], [false]]);

    const failure = publicationHarness();
    const failed = failure.run();
    const error = new Error("snapshot failure");
    failure.snapshot.reject(error);
    await failed;
    expect(failure.publish).not.toHaveBeenCalled();
    expect(failure.setContext).toHaveBeenCalledWith(null);
    expect(failure.setStatus).toHaveBeenCalledWith(error);
    expect(failure.setBusy.mock.calls).toEqual([[true], [false]]);
  });
});
