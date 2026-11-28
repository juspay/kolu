/** A reactive root OWNED BY THE APP, not by whoever created it.
 *
 *  A root created while an owner is in scope is OWNED by it and dies with
 *  it, so a value built lazily inside a component, a memo or an effect would
 *  hand every later reader memos that stopped recomputing the moment that
 *  first caller re-ran or unmounted. `runWithOwner(null, …)` detaches the
 *  root: the owner is the app itself, and disposing the first caller's owner
 *  (fast-refresh, test teardown) does NOT freeze the value for anyone else.
 *
 *  `fn` is handed the root's disposer, as `createRoot`'s is — keep it when
 *  the thing has an end (a per-host record that is forgotten), discard it
 *  when the thing lives as long as the page. */

import { createRoot, runWithOwner } from "solid-js";

export const detachedRoot = <T>(fn: (dispose: () => void) => T): T =>
  runWithOwner(null, () => createRoot(fn));
