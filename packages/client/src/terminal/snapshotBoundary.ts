/** Snapshot boundary for the attach stream.
 *
 *  The terminal `attach` stream yields a serialized screen snapshot
 *  (scrollback) as its FIRST item, then live PTY deltas — see `terminal.attach`
 *  in router.ts. Consumers that treat the snapshot as live output (lighting a
 *  "streaming now" indicator, say) lie on every mount and on every transparent
 *  reconnect, because `ClientRetryPlugin` re-subscribes and replays a fresh
 *  snapshot first.
 *
 *  This is the one-bit gate that distinguishes the snapshot frame from a live
 *  delta. `isLiveDelta()` returns false for the first frame after construction
 *  or after `armSnapshot()` (call it from the attach loop's `onRetry`, which
 *  fires before the retried iterator's first yield), and true for every frame
 *  thereafter. It says nothing about writing the data to xterm — the snapshot
 *  is still drawn; only the "this is live" classification is suppressed. */

export interface SnapshotBoundary {
  /** True once the snapshot frame has been consumed — i.e. this frame is a live
   *  PTY delta. The snapshot frame itself returns false and arms the gate so the
   *  next frame reads as live. */
  isLiveDelta(): boolean;
  /** Re-arm the gate so the next frame is treated as a snapshot again. Called
   *  on reconnect retry, where the re-subscribed iterator replays a snapshot. */
  armSnapshot(): void;
}

export function createSnapshotBoundary(): SnapshotBoundary {
  let pendingSnapshot = true;
  return {
    isLiveDelta() {
      if (pendingSnapshot) {
        pendingSnapshot = false;
        return false;
      }
      return true;
    },
    armSnapshot() {
      pendingSnapshot = true;
    },
  };
}
