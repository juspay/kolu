/**
 * The composed restart sequence — one shape, two callers.
 *
 * Restarting a surface daemon without losing what it holds is a *sequence* whose
 * steps cannot be reordered (#1034 died on a kill-then-pray restart that killed
 * the daemon before snapshotting the session). So the sequence is composed once,
 * here, with the order fixed by the type:
 *
 *   capture → drain → recycle → reattach
 *
 * **All steps are required by the type, even when a caller has nothing to do.**
 * That is the point: B2's boot recycle supplies *degenerate* steps (capture
 * returns an empty context, drain and reattach are no-ops) because B2 makes no
 * survival promise — every boot serves fresh. B3 fills the same steps with the
 * real session capture, the terminal drain, and adoption-based reattach, and the
 * order is already proven by B2's recycle-on-every-deploy. A caller cannot
 * accidentally skip the snapshot: there is no restart entry point that omits a
 * step.
 *
 * The `recycle` itself is `endpoint.ensure()` — kill the live holder, wait for
 * it to actually go, spawn fresh, connect. This module only sequences the
 * caller's steps around it.
 */

import type { DaemonConnection, Endpoint } from "./endpoint.ts";

export interface RestartSteps<C, I, Ctx> {
  /** Snapshot whatever must outlive the restart, BEFORE the old daemon dies.
   *  B2: returns an empty context (nothing survives). B3: the saved session. */
  capture(): Promise<Ctx>;
  /** Quiesce the old daemon's consumers after capture, before the recycle.
   *  B2: no-op. B3: abort tap subscriptions, drain terminals. */
  drain(ctx: Ctx): Promise<void>;
  /** Re-establish consumers against the FRESH daemon after it is connected.
   *  B2: no-op. B3: adopt surviving PTYs, re-run the provider DAG. */
  reattach(ctx: Ctx, connection: DaemonConnection<C, I>): Promise<void>;
}

/** Run the composed restart: capture, drain, recycle the endpoint, reattach.
 *  Throws if the recycle leaves no connection (a failed boot already reported
 *  `dead`/`degraded` via the endpoint's status). */
export async function restart<C, I, Ctx>(
  endpoint: Endpoint<C, I>,
  steps: RestartSteps<C, I, Ctx>,
): Promise<void> {
  const ctx = await steps.capture();
  await steps.drain(ctx);
  await endpoint.ensure();
  const connection = endpoint.current();
  if (!connection) {
    throw new Error("restart: no connection after recycle");
  }
  await steps.reattach(ctx, connection);
}

/**
 * Bind a **serialized** session-preserving restart to one endpoint.
 *
 * Where the bare `restart()` is the composed sequence (and the boot recycle's
 * one shape), `serializeRestart` adds the two things a *user-initiated* restart
 * needs over a boot:
 *
 *   - **Coalescing.** Returns a trigger that runs at most one restart at a time.
 *     A double-click, or two clients both hitting the restart button, ride the
 *     *same* in-flight run instead of each launching a kill→spawn — a second
 *     recycle over a half-restarted daemon is exactly the kind of race #1034
 *     lost. The trigger resolves all callers when that single run settles.
 *   - **The emit-guard.** Wraps the run in `endpoint.holdRestarting`, so the
 *     whole sequence reports as one `restarting` rather than the recycle's
 *     internal degraded→connecting→connected flicker (see `endpoint.ts`'s
 *     `emit`). The terminal `connected`/`dead` ends the hold.
 *
 * The composed steps (capture → drain → recycle → reattach) and what they mean
 * stay the caller's soul, exactly as for `restart()`; this only governs *when*
 * a restart may run and *how* it is reported.
 */
export function serializeRestart<C, I>(
  endpoint: Endpoint<C, I>,
): <Ctx>(steps: RestartSteps<C, I, Ctx>) => Promise<void> {
  let inFlight: Promise<void> | undefined;
  return <Ctx>(steps: RestartSteps<C, I, Ctx>): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = endpoint
      .holdRestarting(() => restart(endpoint, steps))
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
