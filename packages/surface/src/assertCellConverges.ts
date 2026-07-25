/**
 * `assertCellConverges` — the AUTHORING-time twin of the reactor's runtime loop
 * guard, for a test to point at a poll source and prove it settles.
 *
 * The runtime guard catches a self-caused cycle in production and crashes naming
 * the cell. This catches it in a test, before it can ever reach production, and
 * it exists because the wiring that froze a kolu server was a defect in the JOIN
 * between two individually-correct modules: the poll's read and the change edge
 * it was fused with. Neither module's own unit tests could see it. A test of the
 * WIRING can.
 *
 * Generalized from the regression test written for that incident, so every fused
 * cell can get the same assertion for one line instead of re-deriving a
 * bounded-read harness each time.
 */

import { __setLoopReporterForTests } from "./reactor";

/** A poll source, as far as this helper needs it — `source({ read, install })`
 *  returns one, and the connect seam is all that is driven here. */
interface ConnectablePoll {
  connectPoll: (
    set: (next: never) => void,
    signal?: AbortSignal,
  ) => Promise<() => void>;
}

export interface ConvergenceResult {
  /** How many reads happened in the observation window. */
  reads: number;
  /** The loop the reactor detected, if it detected one. */
  loop: Error | undefined;
}

/** Drive a poll source, poke it, and assert it goes quiet.
 *
 *  `kick` is the act that would start a cycle if one existed — in the incident
 *  it was "a forward was opened", which fired the change edge the read then
 *  announced on. Without a kick a fused cell simply sits on its interval and
 *  proves nothing, which is why this takes one rather than only connecting.
 *
 *  Throws on either failure mode, because they are the same defect seen from two
 *  sides: the reactor reporting a self-caused loop, or reads still arriving after
 *  the source should have settled (a cycle the guard's provenance check somehow
 *  did not attribute — the belt to its braces). */
export async function assertCellConverges(opts: {
  /** Build the source. Called once; `onRead` must be invoked by its `read`. */
  build: (onRead: () => void) => ConnectablePoll;
  /** The act that could start a cycle. Defaults to doing nothing. */
  kick?: () => void;
  /** How long to watch after the kick. Long enough that a real cycle — which
   *  spins as fast as its read allows — would be unmistakable. */
  settleMs?: number;
}): Promise<ConvergenceResult> {
  let reads = 0;
  let loop: Error | undefined;
  __setLoopReporterForTests((err) => {
    loop ??= err;
  });
  const poll = opts.build(() => {
    reads += 1;
  });
  const stop = await poll.connectPoll(() => {});
  try {
    opts.kick?.();
    const settleMs = opts.settleMs ?? 250;
    await new Promise((r) => setTimeout(r, settleMs));
    const afterKick = reads;
    // A second window with nothing poking it: a settled source adds at most the
    // reads its own interval earns, while a cycle keeps climbing at read speed.
    await new Promise((r) => setTimeout(r, settleMs));
    const growth = reads - afterKick;

    if (loop !== undefined) {
      throw new Error(
        `assertCellConverges: the reactor reported a self-caused loop — ${loop.message}`,
      );
    }
    if (growth > afterKick) {
      throw new Error(
        `assertCellConverges: the source is still accelerating — ${afterKick} reads in the first window, ` +
          `${growth} in the second. A settled poll re-reads on its cadence; a cycle re-reads as fast as it can.`,
      );
    }
    return { reads, loop };
  } finally {
    stop();
    __setLoopReporterForTests(null);
  }
}
