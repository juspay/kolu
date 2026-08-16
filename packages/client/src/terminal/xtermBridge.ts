/** E2E `__xterm` DOM bridge.

 *  Buffer readers (`__readXtermBuffer`) treat a published handle as "this
 *  pane has cells". The attach stream's first frame is the snapshot that
 *  *fills* those cells. Publishing at `onReady` (engine constructed, attach
 *  not yet open) makes every split look ready while its buffer is still
 *  the constructor's empty 80×24 — echo goes to the PTY, reads time out.
 *
 *  The one legal publish is the write-callback of a snapshot that has
 *  actually landed. Deltas, stale-grid refusals, and pre-attach onReady
 *  must not publish. */

export function createXtermBridge<T>(container: HTMLElement, term: T) {
  const el = container as HTMLElement & { __xterm?: T };
  let published = false;
  return {
    get published() {
      return published;
    },
    /** Call from the attach write callback after a snapshot parsed. */
    onSnapshotLanded() {
      if (published) return;
      el.__xterm = term;
      published = true;
    },
    clear() {
      el.__xterm = undefined;
      published = false;
    },
  };
}
