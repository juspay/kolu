/**
 * Framework-run drain-and-confirm-exit — the skeleton BOTH enactments share.
 *
 * A drainable probe/connector only supplies two plugs:
 *   - `drain` — fire the daemon's drain verb (fire-and-forget; its resolve/reject
 *     is not ground truth)
 *   - `awaitExit` — observe that the daemon process actually left. **Contract (F3 /
 *     F10):** resolve ONLY from an independent process/instance oracle (local
 *     socket close of the daemon process, gate/pid gone over ssh). Sustained RPC
 *     failure alone is NOT exit — a link blip must not report `took: true`. Arm
 *     this wait **before** `drain` fires (the framework enforces that order).
 *
 * The framework owns the race against a ceiling, the arm-before-drain ordering,
 * and aborting the wait when the ceiling wins. Consumers never re-implement this.
 *
 * GROUND TRUTH is the EXIT (daemon actually gone), NOT the drain call's
 * resolve/reject. A drain that reached the daemon may resolve with the process
 * still momentarily alive, or reject mid-write as the link dies — neither is the
 * completion signal. Waiting only for the resolve would let a pre-flight re-adopt
 * a still-live, about-to-exit daemon.
 */

import { Effect, Ref } from "effect";
import { runFace } from "../promiseFace.ts";

export type DrainAndAwaitExitResult = {
  /** True when the exit was observed within `ceilingMs`. */
  readonly took: boolean;
  /** A mid-write `drain()` rejection, if any — for the caller to fold into a
   *  not-taken message. Null when the call resolved (or was never observed to reject). */
  readonly drainRejection: string | null;
};

/** The shared "; drain call rejected: …" tail for a drain-did-not-take error. */
export function drainRejectionSuffix(rejection: string | null): string {
  return rejection ? `; drain call rejected: ${rejection}` : "";
}

/**
 * Arm the exit wait, fire the drain, race exit vs ceiling.
 *
 * `awaitExit` is armed BEFORE the drain is fired, so a fast exit that fires before
 * `drain()` even settles is never missed. It resolves when the exit is observed and
 * MUST NOT reject — it observes its own {@link AbortSignal} (aborted the instant the
 * ceiling wins) to stop cleanly, so a poll-based plug never leaks a probe every tick
 * after the primitive returns.
 */
export function drainAndAwaitExitEffect(
  drain: () => Promise<void>,
  awaitExit: (signal: AbortSignal) => Promise<void>,
  { ceilingMs }: { ceilingMs: number },
): Effect.Effect<DrainAndAwaitExitResult, Error> {
  return Effect.suspend(() => {
    if (!Number.isFinite(ceilingMs) || ceilingMs <= 0) {
      return Effect.fail(
        new Error(
          `drainAndAwaitExit ceilingMs must be a positive number, got ${ceilingMs}`,
        ),
      );
    }
    const abort = new AbortController();
    // ARM FIRST — and in THIS step, not inside a fiber whose start we would be
    // trusting: the exit oracle must be watching before the drain verb can
    // possibly fire (F3/F10), so the plug is invoked here, synchronously, and
    // the drain is forked below.
    const exited = awaitExit(abort.signal);
    // Defensive, and still needed under fibers: when the CEILING wins the race
    // below, the fiber reading this promise is interrupted while the promise
    // itself lives on — a plug that rejects afterwards would have no reader and
    // take the process down as an unhandled rejection.
    exited.catch(() => {});

    return Effect.gen(function* () {
      const rejection = yield* Ref.make<string | null>(null);
      // Fire-and-forget, as a supervised CHILD fiber: it is interrupted when
      // this effect finishes, so a drain the daemon never answers cannot outlive
      // the wait that stopped caring about it. A sync throw and an async
      // rejection are the same fact here — drain completion is never ground
      // truth — so `tryPromise` folds both into the recorded string.
      //
      // `startImmediately` is LOAD-BEARING: the verb must actually fire before
      // the race below can win. A daemon whose exit oracle resolves at once
      // (an already-dead process) would otherwise see the child interrupted
      // before it ever called `drain`, and the daemon would never be asked.
      yield* Effect.forkChild(
        Effect.tryPromise({ try: drain, catch: (e) => String(e) }).pipe(
          Effect.catch((message) => Ref.set(rejection, message)),
        ),
        { startImmediately: true },
      );

      // GROUND TRUTH is the exit. The ceiling is the other runner in the race,
      // and losing it interrupts the sleep — no timer handle to clear, no
      // `timer!` definite-assignment hack, no dangling `"timeout"` promise.
      const took = yield* Effect.raceFirst(
        Effect.as(
          Effect.promise(() => exited),
          true,
        ),
        Effect.as(Effect.sleep(ceilingMs), false),
      );
      return { took, drainRejection: yield* Ref.get(rejection) };
    }).pipe(
      // The ceiling won (or we were interrupted): tell the plug to stop, so a
      // poll-based oracle does not leak a probe every tick after we return.
      Effect.ensuring(Effect.sync(() => abort.abort())),
    );
  });
}

/** The Promise face of {@link drainAndAwaitExitEffect} — see `promiseFace.ts`. */
export function drainAndAwaitExit(
  drain: () => Promise<void>,
  awaitExit: (signal: AbortSignal) => Promise<void>,
  opts: { ceilingMs: number },
): Promise<DrainAndAwaitExitResult> {
  return runFace(drainAndAwaitExitEffect(drain, awaitExit, opts));
}
