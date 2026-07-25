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

/** What a mechanism can tell the map about a forward after it is up.
 *
 *  Two channels, because they are two different facts and the map acts on them
 *  differently. Collapsing them was a real defect: a relay whose listener
 *  errored AND whose teardown then failed is not gone — it may still be
 *  reachable — so reporting it as `lost` would make the map drop its only
 *  handle on it, while reporting nothing at all left the operator looking at a
 *  row that was quietly broken. */
/** NB the map SANITISES every `reason` before it reaches a consumer (see
 *  `plainDiagnostic`): these strings are rendered verbatim by a TUI today and
 *  a browser later, and a mechanism that reads a subprocess's stderr is
 *  carrying text the far end chose. A mechanism may pass its raw text here. */
export interface ForwardReport {
  /** It is GONE. The map drops it and tells its consumer why. */
  lost(reason: string): void;
  /** Something failed and the forward may still be out there — the mechanism
   *  could not clean up. The map KEEPS it (a listener nobody can close must
   *  stay visible and retryable) and passes the trouble on. */
  fault(reason: string): void;
}

/** How the map opens forwards. One method, dispatching on the target kind, so
 *  the map itself stays a map — and so a test can hand it a fake. */
export interface ForwardMechanisms {
  open(target: ForwardTarget, report: ForwardReport): Promise<OpenedForward>;
}
