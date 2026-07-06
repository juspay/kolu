/** Lazy module-scope singleton on top of `createRoot`.
 *
 *  NOT `@solid-primitives/rootless`'s `createSingletonRoot` — that REF-COUNTS and
 *  disposes the root when the last listener leaves (dispose-when-idle). Every consumer
 *  here requires app-lifetime NEVER-teardown (standing intervals, open subscriptions,
 *  state that must survive a transient unmount / HMR); audited 18/18 on 2026-07-06. The
 *  two primitives have DIFFERENT semantics, so this is not a duplicate to fold into the
 *  library — rootless ships no never-dispose singleton, and wrapping `createSingletonRoot`
 *  with a permanent subscriber would re-introduce this discard-the-disposer pattern on top
 *  of disposal machinery, for more code and less clarity. Keep it hand-rolled.
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
 *  freeze the value for every other consumer.
 *
 *  APP-LIFETIME, by construction: the `createRoot` disposer is
 *  intentionally DISCARDED (there is no handle to it, on purpose), so
 *  the value and any standing resource the factory opens — an
 *  interval, a window listener — live for the whole app and are
 *  NEVER torn down. So a factory must NOT register `onCleanup`
 *  expecting teardown: it would never run (the owner is never
 *  disposed). A standing interval/listener here is forever, and that
 *  is the point — only put a genuinely app-lifetime resource in a
 *  shared root. (The browser reclaims it on page teardown.)
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
