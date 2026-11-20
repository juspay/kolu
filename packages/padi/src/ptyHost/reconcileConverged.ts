import {
  converge,
  destructiveRecycleSteps,
  type Endpoint,
  outcomeAdopted,
  recycle,
} from "@kolu/surface-daemon-supervisor";
import { Cause, Effect } from "effect";
import { log } from "../log.ts";
import { requireEndpointClaim, withConvergeClaim } from "./endpointClaim.ts";

/** What one converge + its reconcile settled on — the word the heal's journal
 *  line names. `recycled` is the fail-CLOSED arm: the adoption's reconcile
 *  failed, so the adopted daemon was recycled and the saved session parked. */
export type ConvergeVerdict =
  | "adopted"
  | "no-survivors"
  | "recycled"
  /** The connection came back and the post-converge work did NOT finish — the
   *  heal's arm: at boot an unfinished reconcile is answered by recycling the
   *  daemon, which mid-session would destroy the session the heal was invoked
   *  to save. So the heal reports instead, and its caller keeps trying. */
  | "incomplete";

export interface ConvergeHooks {
  /** Run after the converge ADOPTED a surviving daemon — reconcile its live PTYs
   *  against the saved session. */
  onAdopted?: Effect.Effect<void, unknown>;
  /** Run on the NO-SURVIVOR outcome (a fresh / recycled daemon), OR after a
   *  failed adoption forces the fail-closed recycle: PARK the saved session so
   *  the restore card can re-spawn it. */
  onNotAdopted?: () => void;
  /** What a FAILED `onAdopted` means here, stated by the caller because the two
   *  callers mean opposite things by it:
   *
   *  - `recycle` (the BOOT) — an unfinished reconcile may have left PTYs kolu
   *    never registered, so the daemon is replaced and the session parked;
   *  - `report` (a HEAL) — every live PTY already has an entry, and recycling
   *    would kill the session the heal exists to preserve, so it answers
   *    `incomplete` and lets the caller retry.
   *
   *  Required rather than defaulted (juspay/kolu#2184). */
  onAdoptFailure: "recycle" | "report";
}

/** Converge this endpoint and settle its post-converge hooks, as the endpoint's
 *  owner. Takes only the endpoint: `adopted` is read from THIS converge's own
 *  outcome, so converging one endpoint and reconciling another is unspellable. */
export function convergeAndReconcile<C, I, M>(
  ep: Endpoint<C, I, M>,
  hooks: ConvergeHooks,
): Effect.Effect<ConvergeVerdict, unknown> {
  return withConvergeClaim(
    Effect.gen(function* () {
      const outcome = yield* converge(ep);
      return yield* reconcileConverged(ep, outcomeAdopted(outcome), hooks);
    }),
  );
}

function reconcileConverged<C, I, M>(
  ep: Endpoint<C, I, M>,
  adopted: boolean,
  hooks: ConvergeHooks,
): Effect.Effect<ConvergeVerdict, unknown> {
  return Effect.gen(function* () {
    if (!adopted) {
      hooks.onNotAdopted?.();
      return "no-survivors" as const;
    }
    const reconcile = hooks.onAdopted;
    if (reconcile === undefined) return "adopted" as const;
    return yield* Effect.catchCause(
      Effect.as(reconcile, "adopted" as const),
      (cause) =>
        Effect.gen(function* () {
          if (hooks.onAdoptFailure === "report") {
            log.error(
              { err: Cause.squash(cause) },
              "link heal re-connected but could not finish re-wiring — leaving every terminal standing; the next attempt retries",
            );
            return "incomplete" as const;
          }
          log.error(
            { err: Cause.squash(cause) },
            "surviving-session reconciliation failed — recycling the adopted daemon",
          );
          requireEndpointClaim("the fail-closed recycle");
          yield* recycle(ep, destructiveRecycleSteps());
          hooks.onNotAdopted?.();
          return "recycled" as const;
        }),
    );
  });
}
