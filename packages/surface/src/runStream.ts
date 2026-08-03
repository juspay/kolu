/**
 * The ONE Effect→callback edge (PLAN D10, review #25) — `@kolu/surface/run-stream`.
 *
 * Reachable on its OWN subpath, not only through `@kolu/surface/solid`, because
 * it has nothing to do with Solid: `pollOnChange` is deliberately Solid-free and
 * runs its pulse through this same edge, and so do consumers outside this repo
 * (odu bridges a member stream into a non-Effect dashboard). Re-exported from
 * `./solid` as well, so the Solid consumers that already import it are unchanged.
 *
 * SolidJS's reactive graph is push-based and non-Effect by decision: components,
 * the reactor and xterm stay outside Effect and call Effect-backed clients at the
 * leaves. Somewhere a `Stream` therefore has to be RUN so its frames become signal
 * writes — and that somewhere is here, in one function, rather than once per
 * subscription primitive.
 *
 * Concentrating it buys three things a scattered `Effect.runFork` would not:
 *
 *   - **One teardown contract.** The fiber is interrupted by the returned stopper;
 *     interruption propagates into the stream's finalizers, which is what actually
 *     closes the wire subscription. There is no `AbortSignal` to thread and none to
 *     forget — cancellation IS interruption (D10/#18).
 *   - **One "a disposed subscription reports nothing" rule.** After the stopper
 *     runs, no handler fires: not a late frame, not the interruption exit, not a
 *     failure racing the stop. Every consumer inherits it instead of re-deriving
 *     an `aborted` check.
 *   - **One place for the run-edge allowlist to point at.** `Effect.runFork` in
 *     this package's UI tier appears exactly here.
 */

import { Cause, Effect, Exit, Stream } from "effect";

/** What a Solid consumer wants to be told about a running stream. Exactly three
 *  outcomes, and they are mutually exclusive: frames, then EITHER a typed end OR a
 *  failure — or silence, if the subscription was stopped first. */
export interface StreamRunHandlers<T> {
  /** One stream frame. */
  readonly onFrame: (item: T) => void;
  /** The stream ENDED NORMALLY — a typed end, i.e. the producer completed. Never
   *  fired for an interruption. */
  readonly onEnd: () => void;
  /** The stream FAILED. Already normalised to an `Error` (a non-`Error` failure
   *  value or a defect is stringified), because every consumer of this module
   *  stores it in an `Accessor<Error | undefined>`. */
  readonly onFailure: (error: Error) => void;
}

/** Normalise any failure value — a typed error, a bare string, a defect — to an
 *  `Error`. A tagged surface error is already an `Error` subclass, so it passes
 *  through with its `_tag` intact and a consumer can still narrow on it. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Run `stream` on its own fiber, delivering frames/end/failure to `handlers`, and
 *  return the STOPPER.
 *
 *  The stopper is idempotent and synchronous: it latches "stopped" BEFORE
 *  interrupting, so the interruption's own exit — and any frame already queued
 *  behind it — is silent. That is the "a disposed subscription cannot report
 *  anything" rule, held in one place. */
export function runStreamScoped<T>(
  stream: Stream.Stream<T, unknown>,
  handlers: StreamRunHandlers<T>,
): () => void {
  let stopped = false;
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (item) =>
      Effect.sync(() => {
        if (!stopped) handlers.onFrame(item);
      }),
    ),
  );
  fiber.addObserver((exit) => {
    if (stopped) return;
    if (Exit.isSuccess(exit)) {
      handlers.onEnd();
      return;
    }
    // An interruption is a TEARDOWN, not a failure — it is how this module stops a
    // stream, and how a parent scope stops it too. Reporting it would surface
    // "the component unmounted" as a subscription error in `client.health()`.
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    handlers.onFailure(toError(Cause.squash(exit.cause)));
  });
  return () => {
    stopped = true;
    fiber.interruptUnsafe();
  };
}
