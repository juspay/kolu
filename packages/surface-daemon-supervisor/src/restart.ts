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
 * The `recycle` itself is private `ensure()` via the endpoint WeakMap — kill the
 * live holder, wait for it to actually go, spawn fresh, connect. This module only
 * sequences the caller's steps around it.
 */

import type { DaemonConnection, Endpoint } from "./endpoint.ts";
import { endpointPrivate } from "./endpoint.private.ts";

export interface RestartSteps<C, I, Ctx, M = undefined> {
  /** Snapshot whatever must outlive the restart, BEFORE the old daemon dies.
   *  B2: returns an empty context (nothing survives). B3: the saved session. */
  capture(): Promise<Ctx>;
  /** Quiesce the old daemon's consumers after capture, before the recycle.
   *  B2: no-op. B3: abort tap subscriptions, drain terminals. */
  drain(ctx: Ctx): Promise<void>;
  /** Re-establish consumers against the FRESH daemon after it is connected.
   *  B2: no-op. B3: adopt surviving PTYs, re-run the provider DAG. */
  reattach(ctx: Ctx, connection: DaemonConnection<C, I, M>): Promise<void>;
}

/**
 * Named canonical steps for a **destructive** recycle with no preservation
 * (F4). Every field is still required by the type — this constant makes the
 * no-preservation intent visible at the call site (kaval fail-closed recovery).
 */
export function destructiveRecycleSteps<C, I, M = undefined>(): RestartSteps<
  C,
  I,
  undefined,
  M
> {
  return {
    capture: async () => undefined,
    drain: async () => {},
    reattach: async () => {},
  };
}

/** The public replace verb — capture → drain → recycle → reattach. Pairs with
 *  `converge` on the endpoint. Throws if the recycle leaves no connection. */
export async function recycle<C, I, Ctx, M = undefined>(
  endpoint: Endpoint<C, I, M>,
  steps: RestartSteps<C, I, Ctx, M>,
): Promise<void> {
  const ctx = await steps.capture();
  await steps.drain(ctx);
  await endpointPrivate(endpoint).ensure();
  const connection = endpoint.current();
  if (!connection) {
    throw new Error("recycle: no connection after recycle");
  }
  await steps.reattach(ctx, connection);
}

/**
 * Bind a **serialized** session-preserving restart to one endpoint.
 *
 * Where the bare `recycle()` is the composed sequence (and the boot recycle's
 * one shape), `serializeRestart` adds the two things a *user-initiated* restart
 * needs over a boot:
 *
 *   - **Coalescing.** Returns a trigger that runs at most one restart at a time.
 *   - **The emit-guard.** Wraps the run in `endpoint.holdRestarting`.
 */
export function serializeRestart<C, I, M = undefined>(
  endpoint: Endpoint<C, I, M>,
): <Ctx>(steps: RestartSteps<C, I, Ctx, M>) => Promise<void> {
  let inFlight: Promise<void> | undefined;
  return <Ctx>(steps: RestartSteps<C, I, Ctx, M>): Promise<void> => {
    // Presence of the promise IS the in-flight flag — a concurrent caller rides
    // it rather than starting a second recycle.
    if (inFlight !== undefined) return inFlight;
    inFlight = endpoint
      .holdRestarting(() => recycle(endpoint, steps))
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
