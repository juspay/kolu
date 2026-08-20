/**
 * What is standing at THIS padi's kaval rendezvous — one reading, one
 * vocabulary, read by both supervision arms.
 *
 * padi watches its kaval for two different faults with two different owners: a
 * dead or wedged DAEMON (`kavalSupervision`, which recycles on a ledgered
 * budget) and a dead LINK to a daemon that is still serving (`ptyHost/linkLoss`,
 * which re-converges). They are two repairs, but they are ONE question about the
 * rendezvous — so the question is asked here, in the module both depend on
 * downward, rather than in one of the arms with the other reaching up or forking
 * it. "The two arms can never disagree" is then a property of there being one
 * implementation, not of two that happen to match.
 *
 * The classification lives beside the probe it classifies (`hostInventory`'s
 * `heldKaval` + `probeKavalStatus`) and knows nothing about either arm's policy:
 * the ledger's ceilings stay in `kavalSupervision`, the backoff and the
 * stand-down stay in `linkLoss`.
 */

import { isNoListenerError } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import {
  heldKaval,
  type KavalProbe,
  probeKavalStatus,
} from "./hostInventory.ts";

/** What ONE probe of the held kaval proved. The two failing shapes are the two
 *  ledger classes; `healthy` is the ledger's `success()`.
 *
 *  `wedged` deliberately covers accepts-then-SILENCE *and* accepts-then-GARBAGE:
 *  the field's late receipts showed a delayed probe against the comatose socket
 *  receiving binary noise (`inbound frame parse failure: Unexpected token …`)
 *  before the transport closed. Both reach us as a rejected probe over a socket
 *  that accepted the dial, and both mean the same thing — this daemon cannot
 *  serve. Splitting them would split a budget without splitting a decision. */
export type KavalObservation =
  /** The probe answered all three read-only verbs inside its deadline. */
  | { readonly kind: "healthy" }
  /** The dial was accepted and then the probe timed out, errored, or the peer
   *  answered unspeakably. The field shape. */
  | { readonly kind: "wedged"; readonly err: unknown }
  /** Nothing is listening at the held address — the dial was refused, or the
   *  socket inode is gone. */
  | { readonly kind: "unreachable" };

/** Classify one settled probe of the held kaval.
 *
 *  Two independent spellings of "nobody is listening" both fold to
 *  `unreachable`, because the probe can produce either: `probeKavalStatus`
 *  catches a no-listener error in its FAILURE channel and yields an EMPTY probe
 *  (all fields null), but a dial that rejects with `ENOENT` rides
 *  `Effect.promise` and therefore arrives as a DEFECT, past that catch. Both are
 *  the same fact, so both are read with the same predicate the probe itself uses
 *  (`isNoListenerError`) rather than a second, drifting one.
 *
 *  Everything else that failed is `wedged`: the socket was there, the dial was
 *  accepted, and the daemon behind it did not answer — by timeout, by error, or
 *  by unspeakable bytes. */
export function classifyKavalProbe(
  outcome:
    | { readonly ok: true; readonly probe: KavalProbe }
    | { readonly ok: false; readonly err: unknown },
): KavalObservation {
  if (!outcome.ok) {
    return isNoListenerError(outcome.err)
      ? { kind: "unreachable" }
      : { kind: "wedged", err: outcome.err };
  }
  const { terminalCount, contractVersion } = outcome.probe;
  // An empty probe is the honest "no listener at this path" verdict, not a
  // served kaval with nothing running: a live kaval always answers
  // `system.version`, so a null contract version means nobody answered at all.
  return terminalCount === null && contractVersion === null
    ? { kind: "unreachable" }
    : { kind: "healthy" };
}

/**
 * ONE observation of the held kaval: dial it, fold both channels, and classify.
 *
 * SUSPENDED, so `heldKaval` is read when the question is ASKED rather than when
 * the Effect is built. The healer builds this value once, at boot, and runs it on
 * every attempt for the life of the process — an eager read would freeze the
 * boot-time socket into every later answer and go on probing an address a recycle
 * had already moved away from.
 */
export function observeHeldKaval(
  stateRoot: string,
): Effect.Effect<KavalObservation> {
  return Effect.suspend(() =>
    probeKavalStatus(heldKaval(stateRoot).socket).pipe(
      Effect.match({
        onSuccess: (probe) => ({ ok: true, probe }) as const,
        onFailure: (err) => ({ ok: false, err }) as const,
      }),
      // NOT belt-and-braces: `probeKavalStatus` dials through `Effect.promise`,
      // so a connect rejection (the socket inode is gone — `ENOENT`) is a DEFECT
      // and rides straight past `match`. A probe that produced no reading is a
      // failed probe however it failed, and `classifyKavalProbe` is the one place
      // that decides which KIND — so both channels land on the same value.
      Effect.catchDefect((err) => Effect.succeed({ ok: false, err } as const)),
      Effect.map(classifyKavalProbe),
    ),
  );
}
