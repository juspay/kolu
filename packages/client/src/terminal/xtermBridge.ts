/** E2E `__xterm` DOM bridge.

 *  `.cols` must exist as soon as the engine does — a hidden mobile tile
 *  never attaches, and "wait for all terminals to settle" reads cols
 *  off this handle. Buffer *content* is still empty until the snapshot
 *  write; waiters must poll for the text, not for the handle. */

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
