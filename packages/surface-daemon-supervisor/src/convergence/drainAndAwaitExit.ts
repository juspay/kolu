/**
 * Framework-run drain-and-confirm-exit — the skeleton BOTH enactments share.
 *
 * A drainable probe/connector only supplies two plugs:
 *   - `drain` — fire the daemon's drain verb (fire-and-forget; its success/failure
 *     is not ground truth)
 *   - `awaitExit` — observe that the daemon process actually left. **Contract (F3 /
 *     F10):** succeed ONLY from an independent process/instance oracle (local
 *     socket close of the daemon process, gate/pid gone over ssh). Sustained RPC
 *     failure alone is NOT exit — a link blip must not report `took: true`. Arm
 *     this wait **before** `drain` fires (the framework enforces that order).
 *
 * The framework owns the race against a ceiling, the arm-before-drain ordering,
 * and stopping the wait when the ceiling wins. Consumers never re-implement this.
 *
 * GROUND TRUTH is the EXIT (daemon actually gone), NOT the drain call's
 * success/failure. A drain that reached the daemon may succeed with the process
 * still momentarily alive, or fail mid-write as the link dies — neither is the
 * completion signal. Waiting only for the drain would let a pre-flight re-adopt
 * a still-live, about-to-exit daemon.
 */

import { Effect, Fiber, Ref } from "effect";

export type DrainAndAwaitExitResult = {
  /** True when the exit was observed within `ceilingMs`. */
  readonly took: boolean;
  /** A mid-write `drain` failure, if any — for the caller to fold into a
   *  not-taken message. Null when the call succeeded (or was never observed to fail). */
  readonly drainRejection: string | null;
};

/** The shared "; drain call rejected: …" tail for a drain-did-not-take error. */
export function drainRejectionSuffix(rejection: string | null): string {
  return rejection ? `; drain call rejected: ${rejection}` : "";
}

/**
 * Arm the exit wait, fire the drain, race exit vs ceiling.
 *
 * `awaitExit` is armed BEFORE the drain is fired, so a fast exit that happens
 * before `drain` even settles is never missed. Its error channel is `never` by
 * type — the F3 contract that it must not report failure as exit is now the
 * signature rather than a comment.
 *
 * **Where the AbortSignal went.** `awaitExit` used to take one, for exactly one
 * job: telling a poll-based oracle to stop once the ceiling had won. Both plugs
 * are forked into this effect's own scope now, so the scope closing — which
 * happens the instant this effect returns, on every path including interruption
 * — interrupts them. Interruption is not refusable; an abandoned
 * `AbortController` was.
 */
export function drainAndAwaitExit(
  drain: Effect.Effect<void, unknown>,
  awaitExit: Effect.Effect<void>,
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

    return Effect.gen(function* () {
      // ARM FIRST (F3/F10). `startImmediately` is what makes this an ordering
      // rather than a hope: the child runs on THIS stack until it suspends, so
      // the oracle is watching before the fork below can even be reached.
      const exited = yield* Effect.forkScoped(awaitExit, {
        startImmediately: true,
      });

      const rejection = yield* Ref.make<string | null>(null);
      // Fire-and-forget. A typed failure and a thrown defect are the same fact
      // here — drain completion is never ground truth — so both are recorded as
      // a string and neither is allowed to take the wait (or the process) down.
      //
      // `startImmediately` is LOAD-BEARING: the verb must actually fire before
      // the race below can win. A daemon whose exit oracle succeeds at once
      // (an already-dead process) would otherwise see the child interrupted
      // before it ever ran `drain`, and the daemon would never be asked.
      yield* Effect.forkScoped(
        drain.pipe(
          Effect.catch((e) => Ref.set(rejection, String(e))),
          Effect.catchDefect((e) => Ref.set(rejection, String(e))),
        ),
        { startImmediately: true },
      );

      // GROUND TRUTH is the exit. The ceiling is the other runner in the race,
      // and losing it interrupts the sleep — no timer handle to clear, no
      // `timer!` definite-assignment hack, no dangling `"timeout"` promise.
      const took = yield* Effect.raceFirst(
        Effect.as(Fiber.join(exited), true),
        Effect.as(Effect.sleep(ceilingMs), false),
      );
      return { took, drainRejection: yield* Ref.get(rejection) };
      // The scope closes here — on success, on failure, and on interruption —
      // which is what stops a poll-based oracle from leaking a probe every tick
      // after the ceiling has already decided the answer.
    }).pipe(Effect.scoped);
  });
}
