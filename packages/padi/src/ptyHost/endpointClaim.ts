/**
 * Who owns the local kaval endpoint RIGHT NOW — a restart, or a heal.
 *
 * Two arms replace or re-dial this process's one kaval: the RESTART arm (the
 * "Restart kaval" button, `kavalSupervision`'s auto-recycle, and the fail-closed
 * recycle a failed adopt-reconcile takes) and the HEAL arm (the link-loss
 * re-converge, `linkLoss.ts`). They must never run at once — two spawns at one
 * rendezvous is the "the new daemon yields to the live gate holder" no-op
 * recycle the spine fails loudly on — so this module is the one arbiter of the
 * exclusion, owning BOTH sides of it.
 *
 * It lives beside the endpoint rather than inside either arm: an arbiter housed
 * in one of the two parties makes the composition root import the healer in
 * order to arbitrate its own restarts, and leaves "am I already inside a claim?"
 * answerable only out of band, by each call site remembering.
 *
 * ## The exclusion, and where each side is taken
 *
 *   - A restart claims SYNCHRONOUSLY, before the endpoint is touched, so no heal
 *     can start behind it; it then waits out a heal already mid-converge. The
 *     claim is taken at exactly ONE site — the restart trigger, wrapped where it
 *     is built (`holdEndpoint`) — so every path that reaches the endpoint
 *     through the trigger is claimed by construction and none can forget.
 *   - A heal claims for the whole attempt through {@link withHealClaim}, whose
 *     token is published BEFORE the work starts. The healer stands down while a
 *     restart is claimed and never converges behind one.
 *
 * ## Why nothing NESTED takes a second claim
 *
 * A converge's post-converge reconciliation can itself replace the daemon (the
 * fail-CLOSED recycle). That replacement runs on its caller's stack — at boot,
 * inside the boot's own claim; during a heal, inside the heal's. A second claim
 * there would make the recycle wait on the very heal that is running it: a
 * circular wait bounded by nothing, which also strands the heal token and with
 * it the healer, the "Restart kaval" button and the supervision auto-recycle —
 * every recovery path padi has, dead for the process (#2184). So a nested
 * endpoint mutation states its coverage with {@link requireEndpointClaim} and
 * takes no claim of its own, and {@link withConvergeClaim} is what guarantees
 * the coverage is there.
 */

import { Effect } from "effect";

/** How many restarts currently OWN the endpoint. A counter, not a flag, because
 *  the trigger it guards coalesces riders: several callers can hold the claim
 *  over one restart, and the healer must stand down until the last of them is
 *  done. */
let restarts = 0;

/** The heal in flight, or `undefined`. A promise rather than a fiber because the
 *  healer's loop is a node timer, not an Effect. It NEVER rejects — it is
 *  settled by {@link withHealClaim}'s finalizer, not by the attempt — so waiting
 *  on it can only ever be a delay, never a way for a heal's failure to reach the
 *  restart that waited. */
let heal: Promise<void> | undefined;

/** Does a restart own the endpoint right now? */
export const restartClaimed = (): boolean => restarts > 0;

/** Does a heal own the endpoint right now? */
export const healClaimed = (): boolean => heal !== undefined;

/**
 * Run `restart` as the endpoint's exclusive owner: the healer stands down for
 * its whole duration, and a heal already mid-converge is waited out first.
 *
 * The claim is taken in the SAME synchronous step that installs the finalizer,
 * so it can never be released without having been taken (nor taken by a restart
 * that is described and never run). The wait is bounded by the endpoint's own
 * deadlines, and it happens BEFORE the trigger rather than around it — so the
 * trigger's coalescing is untouched: concurrent callers still ride one restart.
 */
export function withRestartClaim<A, E>(
  restart: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.suspend(() => {
    restarts += 1;
    const pending = heal;
    return Effect.gen(function* () {
      if (pending !== undefined) yield* Effect.promise(() => pending);
      return yield* restart;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          restarts -= 1;
        }),
      ),
    );
  });
}

/**
 * Run one heal attempt as the endpoint's owner.
 *
 * The token is published BEFORE `run` is called, not on the same stack after it:
 * the attempt runs synchronously into its own first suspension, and anything
 * reached in that burst — the converge, its reconciliation, the fail-closed
 * recycle — must already see the heal that is running it. The token is settled
 * by this finalizer rather than by the attempt's own promise, so it never
 * rejects and never carries the attempt's failure to a waiting restart.
 */
export async function withHealClaim<A>(run: () => Promise<A>): Promise<A> {
  let settle = (): void => {};
  heal = new Promise<void>((resolve) => {
    settle = resolve;
  });
  try {
    return await run();
  } finally {
    heal = undefined;
    settle();
  }
}

/**
 * Run one CONVERGE (and the post-converge reconciliation whose fail-closed arm
 * recycles the daemon) as the endpoint's owner.
 *
 * Re-entrant against the heal BY CONSTRUCTION rather than by a caller's flag: a
 * heal in flight when this runs can only be THIS converge's own claim, because
 * the two callers are the BOOT — which runs before any link has been held, so no
 * heal can exist yet — and the healer's own re-converge, which took the heal
 * claim before it started. Claiming again on the heal path would be waiting on
 * ourselves; declining to claim on the boot path would leave the fail-closed
 * recycle's kill free to arm the healer into the gap it opens.
 */
export function withConvergeClaim<A, E>(
  converge: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.suspend(() =>
    healClaimed() ? converge : withRestartClaim(converge),
  );
}

/**
 * Assert that an endpoint mutation about to run is covered by a claim its caller
 * already holds — for the nested replacements that must NOT take one of their
 * own (see this module's header).
 *
 * Fail fast: an unclaimed daemon replacement races the healer silently, and the
 * race's outcome is a no-op recycle nobody ordered. `what` names the mutation so
 * one line says which path arrived uncovered.
 */
export function requireEndpointClaim(what: string): void {
  if (restarts === 0 && heal === undefined) {
    throw new Error(
      `${what} reached the endpoint with nobody holding the claim — every path that replaces this endpoint's daemon must run under a restart or heal claim`,
    );
  }
}
