/**
 * Converge the kaval endpoint and settle what the converge owes the saved
 * session — the ONE composition padi's boot and its mid-session heal both take
 * (juspay/kolu#2182).
 *
 * The two cannot be allowed to drift: a heal that adopts the resident kaval owes
 * the saved session exactly the reconciliation a boot adoption does, including
 * the fail-CLOSED arm that recycles a daemon whose survivors could not be
 * reconciled rather than leaving invisible live terminals behind the restore
 * card. So the whole verb is shared, not just its tail — the converge, the
 * adopted reading OF that converge, and the reconciliation are one step, and
 * there is no way to reconcile one endpoint against another's outcome.
 *
 * It is its own module rather than a function in the composition root because
 * both `ptyHost/index.ts` and `ptyHost/linkLoss.ts` want to name it and its
 * verdict, and neither can own it without closing a cycle. It reaches nothing
 * above it: the spine's verbs, the endpoint it is handed, and the claim.
 */

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
export type ConvergeVerdict = "adopted" | "no-survivors" | "recycled";

/** What a converge owes the saved session, per outcome. Its own two-key type
 *  rather than the whole `ensureLocalEndpoint` opts bag, so what this step reads
 *  is what its signature says. */
export interface ConvergeHooks {
  /** Run after the converge ADOPTED a surviving daemon — reconcile its live PTYs
   *  against the saved session. */
  onAdopted?: Effect.Effect<void, unknown>;
  /** Run on the NO-SURVIVOR outcome (a fresh / recycled daemon), OR after a
   *  failed adoption forces the fail-closed recycle: PARK the saved session so
   *  the restore card can re-spawn it (W1.R6). */
  onNotAdopted?: () => void;
}

/**
 * Converge this endpoint and settle its post-converge hooks, as the endpoint's
 * owner.
 *
 * Takes only the endpoint: `adopted` is read from THIS converge's own outcome,
 * so converging one endpoint and reconciling another is unspellable. The claim
 * is taken HERE, around the whole verb, because the fail-closed arm below
 * replaces the daemon — see {@link withConvergeClaim} for why claiming it again
 * further in would deadlock a heal against itself.
 */
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

/** What the converge above owes the saved session, given what it settled on.
 *  Private: `adopted` is only ever this endpoint's own converge outcome, and a
 *  caller that could pass its own could reconcile against a verdict from
 *  somewhere else. */
function reconcileConverged<C, I, M>(
  ep: Endpoint<C, I, M>,
  adopted: boolean,
  hooks: ConvergeHooks,
): Effect.Effect<ConvergeVerdict, unknown> {
  return Effect.gen(function* () {
    if (!adopted) {
      // Fresh / recycled — no survivors. Park the saved session so the restore
      // card can re-spawn it (W1.R6).
      hooks.onNotAdopted?.();
      return "no-survivors" as const;
    }
    const reconcile = hooks.onAdopted;
    if (reconcile === undefined) return "adopted" as const;
    return yield* Effect.catchCause(
      Effect.as(reconcile, "adopted" as const),
      (cause) =>
        Effect.gen(function* () {
          // Reconciliation failed AFTER we adopted the survivor's connection — the
          // daemon is connected but holds PTYs kolu may not have registered (F3).
          // Fail CLOSED: recycle the daemon (kill + spawn fresh) so those hidden
          // PTYs are destroyed and the user's saved session falls back to the
          // restore card, rather than leaving invisible live terminals behind it.
          log.error(
            { err: Cause.squash(cause) },
            "surviving-session reconciliation failed — recycling the adopted daemon",
          );
          // This recycle kills and respawns, and the healer (armed by the
          // `degraded` the kill itself emits) must not converge into the gap. It
          // takes NO claim of its own: it runs inside the claim the verb above
          // took — at boot the restart claim, during a heal the heal's own. A
          // second claim here would wait on the very heal that is running it
          // (#2184).
          requireEndpointClaim("the fail-closed recycle");
          yield* recycle(ep, destructiveRecycleSteps());
          // The recycle spawned a FRESH daemon — nothing live survives now, so
          // this is the no-survivor path: park the saved session for the restore
          // card.
          hooks.onNotAdopted?.();
          return "recycled" as const;
        }),
    );
  });
}
