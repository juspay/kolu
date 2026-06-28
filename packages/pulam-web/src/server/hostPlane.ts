/**
 * `hostPlane` — the ONE shape every parent-side host source adapts into.
 *
 * pulam-web serves two kinds of host behind one uniform browser leg: ssh-dialed
 * `HostSession`s (via the shared `HostRegistry`) and the local kolu mirror (R9a).
 * Both must present the SAME parent-side face so `main` reads a single
 * `Map<string, HostHandle>` and never folds two planes by hand — the `?host=`
 * dispatch, `/api/hosts`, the reconnect route, socket tracking, and shutdown all
 * read this one receptacle.
 *
 * The type lives HERE, not in `main.ts`, so the source that already produces the
 * unified shape — `startLocalKoluMirror` — can return `HostHandle` directly
 * instead of being re-wrapped by a field-copy in `main`. Imports only
 * `HostEntry["handler"]` (the oRPC handler) and `ClosableSocket` — no dependency
 * on `localKolu`/`main`, so there's no cycle.
 */

import type { ClosableSocket } from "@kolu/surface-nix-host";
import type { HostEntry } from "./hostEntry.ts";

/** One host's uniform face — what every parent-side consumer (the `?host=`
 *  dispatcher, `/api/hosts`, the reconnect route, socket tracking, shutdown)
 *  plugs into, regardless of whether the host is an ssh-dialed `HostSession` or
 *  the local-kolu mirror. The two sources each adapt into this one shape, so
 *  `main` reads a single map and never folds two planes by hand. */
export interface HostHandle {
  /** The oRPC handler a `?host=` upgrade dispatches the browser socket onto. */
  handler: HostEntry["handler"];
  /** Re-arm the host (the `/api/reconnect` button): re-spawn the ssh session, or
   *  re-open the kolu link. */
  reconnect(): void;
  /** Tear the host down (server shutdown). */
  destroy(): void;
  /** Track an open browser socket so a host removal can close it. Present ONLY
   *  for the (removable) ssh hosts; a static local mirror tracks nothing and
   *  omits the whole capability (an absent capability, not a remembered guard).
   *  The two halves (`register`/`unregister`) are ONE object so the coupling is
   *  structural — you can't supply one without the other. */
  tracking?: {
    register(ws: ClosableSocket): void;
    unregister(ws: ClosableSocket): void;
  };
}
