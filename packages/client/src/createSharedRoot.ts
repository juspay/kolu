/** Lazy module-scope singleton on top of `createRoot`.
 *
 *  Multiple modules need "build this reactive value once, share it
 *  across every consumer" — `useDockOrder` (one canonical dock tree
 *  for the desktop dock, mobile drawer, and `Cmd+1..9` keyboard
 *  shortcut), `staleness.getNowTicker` (one 60-second clock signal
 *  for every stale-check consumer in the app).
 *
 *  This helper names the pattern. The factory runs once inside a
 *  `createRoot` so the reactive owner is the app itself — disposing
 *  the first caller's owner (fast-refresh, test teardown) does NOT
 *  freeze the value for every other consumer. The factory may
 *  register cleanup via `onCleanup` (e.g. `setInterval` teardown);
 *  that cleanup lives in the same `createRoot` and survives the
 *  initial caller's lifecycle.
 *
 *  Returns the factory's product directly — typically an accessor
 *  for memo-style singletons, but the helper is shape-agnostic so
 *  signal+ticker bundles work too. */

import { createRoot } from "solid-js";

export function createSharedRoot<T>(factory: () => T): () => T {
  // Box the result so the "not yet initialized" state is distinct from
  // any falsy value `T` might legally hold (null, 0, false, …).
  let box: { value: T } | undefined;
  return () => {
    if (!box) {
      box = { value: createRoot(factory) };
    }
    return box.value;
  };
}
