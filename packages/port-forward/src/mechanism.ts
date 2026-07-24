/**
 * The forward mechanism CONTRACT: how the map asks for a forward, and the one
 * shape every mechanism hands back — a listener that is up on some local port,
 * and the way to take it down again. (`nativeMechanisms.ts` is the real
 * implementation of it; a test's fake is another.)
 *
 * `onLost` is how a mechanism reports that a forward it opened has died on its
 * own — the ssh master went away, the relay's listener errored. A forward that
 * is gone must not keep rendering as live, so the mechanism *tells* the map
 * rather than leaving it to discover the lie later.
 */

import type { ForwardTarget } from "./target.ts";

/** A live listener, as its mechanism hands it back. */
export interface OpenedForward {
  /** The port it is listening on — bound on ALL interfaces, which is the whole
   *  point: the viewer's browser is on another machine. */
  readonly localPort: number;
  /** Take the listener down. Resolves when it is gone; rejects (loudly) if the
   *  mechanism could not do it. */
  close(): Promise<void>;
}

/** How the map opens forwards. One method, dispatching on the target kind, so
 *  the map itself stays a map — and so a test can hand it a fake. */
export interface ForwardMechanisms {
  open(
    target: ForwardTarget,
    onLost: (reason: string) => void,
  ): Promise<OpenedForward>;
}
