import { describe, expect, it } from "vitest";
import { createSnapshotBoundary } from "./snapshotBoundary";

describe("createSnapshotBoundary", () => {
  it("treats the first frame as the snapshot and the rest as live deltas", () => {
    const b = createSnapshotBoundary();
    // The serialized-screen snapshot frame: written to xterm, NOT live output.
    expect(b.isLiveDelta()).toBe(false);
    // Every subsequent chunk is a genuine PTY delta.
    expect(b.isLiveDelta()).toBe(true);
    expect(b.isLiveDelta()).toBe(true);
  });

  it("re-arms on retry so the reconnect snapshot is not counted as live", () => {
    const b = createSnapshotBoundary();
    b.isLiveDelta(); // initial snapshot consumed
    expect(b.isLiveDelta()).toBe(true); // a live delta
    // A WebSocket reconnect re-subscribes; `onRetry` fires before the retried
    // iterator's first yield, which replays a fresh snapshot.
    b.armSnapshot();
    // That replayed snapshot must NOT light the live dot — exactly the bug a
    // quiet-terminal reconnect would otherwise show.
    expect(b.isLiveDelta()).toBe(false);
    // …and the post-reconnect stream is live again.
    expect(b.isLiveDelta()).toBe(true);
  });
});
