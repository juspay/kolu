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

import { Effect, Fiber, Ref } from "effect";
import type { DaemonConnection, Endpoint } from "./endpoint.ts";
import { endpointPrivate } from "./endpoint.private.ts";

export interface RestartSteps<C, I, Ctx, M = undefined> {
  /** Snapshot whatever must outlive the restart, BEFORE the old daemon dies.
   *  B2: an empty context (nothing survives). B3: the saved session. A VALUE,
   *  not a thunk: an effect is already the description of work not yet done. */
  readonly capture: Effect.Effect<Ctx, unknown>;
  /** Quiesce the old daemon's consumers after capture, before the recycle.
   *  B2: no-op. B3: abort tap subscriptions, drain terminals. */
  drain(ctx: Ctx): Effect.Effect<void, unknown>;
  /** Re-establish consumers against the FRESH daemon after it is connected.
   *  B2: no-op. B3: adopt surviving PTYs, re-run the provider DAG. */
  reattach(
    ctx: Ctx,
    connection: DaemonConnection<C, I, M>,
  ): Effect.Effect<void, unknown>;
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
    capture: Effect.succeed(undefined),
    drain: () => Effect.void,
    reattach: () => Effect.void,
  };
}

/** The public replace verb — capture → drain → recycle → reattach. Pairs with
 *  `converge` on the endpoint. Fails if the recycle leaves no connection. */
export function recycle<C, I, Ctx, M = undefined>(
  endpoint: Endpoint<C, I, M>,
  steps: RestartSteps<C, I, Ctx, M>,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const ctx = yield* steps.capture;
    yield* steps.drain(ctx);
    yield* endpointPrivate(endpoint).ensure;
    const connection = endpoint.current();
    if (!connection) {
      return yield* Effect.fail(
        new Error("recycle: no connection after recycle"),
      );
    }
    yield* steps.reattach(ctx, connection);
  });
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
 *
 * **Coalescing, not queueing.** A concurrent caller RIDES the restart already in
 * flight and gets its outcome; it does not wait for it and then run a second
 * one. That is why the in-flight token is a FIBER joined by every caller rather
 * than a `Semaphore(1)` — a permit would serialize two restarts, which is a
 * different behaviour (and, for a user hammering the restart button, a
 * different daemon lifecycle).
 *
 * The restart is forked DETACHED, for the same reason the old shape held a bare
 * promise: it must outlive whichever caller happened to start it. A rider that
 * gives up must not take the restart down with it, and the emit-guard's
 * `restarting` hold must not be released by an interruption the daemon never
 * heard about.
 */
export function serializeRestart<C, I, M = undefined>(
  endpoint: Endpoint<C, I, M>,
): <Ctx>(steps: RestartSteps<C, I, Ctx, M>) => Effect.Effect<void, unknown> {
  const inFlight = Ref.makeUnsafe<Fiber.Fiber<void, unknown> | undefined>(
    undefined,
  );
  return <Ctx>(
    steps: RestartSteps<C, I, Ctx, M>,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      // Presence of the fiber IS the in-flight flag — a concurrent caller joins
      // it rather than starting a second recycle, and sees the same outcome.
      const running = yield* Ref.get(inFlight);
      if (running !== undefined) return yield* Fiber.join(running);
      // ORDERING, and it is load-bearing: `forkDetach` does NOT start the child
      // until this fiber yields (`startImmediately` defaults to false), so the
      // `Ref.set` below lands BEFORE the child's `ensuring` can clear it. Passing
      // `startImmediately: true` here would let a restart that finishes inside
      // its own fork leave a completed fiber parked in `inFlight` forever, and
      // every later restart would ride that corpse instead of running.
      const fiber = yield* Effect.forkDetach(
        endpoint
          .holdRestarting(recycle(endpoint, steps))
          .pipe(Effect.ensuring(Ref.set(inFlight, undefined))),
      );
      yield* Ref.set(inFlight, fiber);
      return yield* Fiber.join(fiber);
    });
}
