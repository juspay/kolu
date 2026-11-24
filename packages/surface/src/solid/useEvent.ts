/**
 * `useEvent` — Solid hook for point-in-time occurrences. Distinct from
 * `useStream` because there's no current value to render: consumers
 * register a handler that fires per occurrence. Lifecycle notifications
 * (terminal exit, session expiry, one-shot completions) fit this shape.
 *
 * Cleanup is signal-driven at the CALLER's edge. When `options.signal` is
 * provided, the subscription dies on abort. Otherwise the hook installs
 * `onCleanup` tied to the current reactive owner — call from inside `createRoot`
 * if you want imperative lifetime (e.g. fire-and-forget per-entity subscriptions
 * whose lifetime tracks the entity, not a component). Either way the actual
 * teardown is a fiber interrupt, which the stream's own finalizers turn into a
 * wire unsubscribe.
 *
 * No snapshot obligation: a late subscriber misses past occurrences by
 * design. Re-subscribe on transport drop is transparent (the retry fence) —
 * application errors propagate to `onError` and end the subscription, matching
 * the fence's `shouldRetryStreamError` policy.
 */

import { createEffect, onCleanup } from "solid-js";
import { type StreamingProcedure, unenrolledStreamCall } from "../client";
import type { Event } from "../index";
import { runStreamScoped } from "../runStream";

export interface UseEventOptions {
  /** Called when the subscription errors (a transport failure the fence can't
   *  recover, or a declared error from the source). Required because
   *  `useEvent` returns `void` — without an error handler, lifecycle
   *  bugs (the source dies and never re-fires) are invisible to the user. */
  onError: (err: Error) => void;
  /** External abort signal. When provided, used instead of `onCleanup`
   *  — allows installing the subscription outside a reactive owner
   *  (e.g. inside a `createRoot`). */
  signal?: AbortSignal;
}

/** Subscribe to an `Event<I,T>`, dispatching each occurrence to `handler`.
 *
 *  When `inputFn()` returns `null` the subscription is paused. When the
 *  input value changes, the previous subscription tears down and a fresh
 *  one starts (the same reactive-input model `useStream` uses). */
export function useEvent<Name extends string, I, T>(
  eventDescriptor: Event<Name, I, T>,
  inputFn: () => I | null,
  source: StreamingProcedure<I, T>,
  handler: (occurrence: T) => void,
  options: UseEventOptions,
): void {
  // The stopper for the ACTIVE subscription. Undefined while the input is `null`
  // (paused) — there is no fiber to interrupt then.
  let stopActive: (() => void) | undefined;

  function stop(): void {
    stopActive?.();
    stopActive = undefined;
  }

  function start(input: I): void {
    stopActive = runStreamScoped<T>(
      unenrolledStreamCall(source, input, { label: eventDescriptor.name }),
      {
        onFrame: handler,
        // An event stream's typed end is ordinary (the occurrence source is
        // finished); there is nothing to render, so nothing to report.
        onEnd: () => {},
        onFailure: options.onError,
      },
    );
  }

  // Single cleanup path: external signal OR `onCleanup`. Never both — avoids dual
  // lifecycle braiding (the same shape `createSubscription` uses).
  if (options.signal) {
    if (options.signal.aborted) return;
    options.signal.addEventListener("abort", stop, { once: true });
  } else {
    onCleanup(stop);
  }

  // ONE effect opens every subscription, the first one included: the compute reads
  // `inputFn` (so an input change re-runs it) and the effect phase does the
  // imperative work — stop the previous fiber, open the next. NOT deferred: the
  // first run IS the initial subscribe, so there is no second, body-level open to
  // keep in step with this one (and no top-level `inputFn()` read in the caller's
  // scope, which is a reactive read in a component body).
  //
  // The subscription therefore attaches on the first flush after this call rather
  // than synchronously. That is the deliberate price of keeping delivery out of
  // the creating scope: `handler` is consumer code that typically writes reactive
  // state, and `Effect.runFork` runs a stream synchronously to its first async
  // boundary, so an inline open would let an occurrence land in a component body.
  // A caller that fired an event itself (the `await client.X.create` shape) is not
  // racing the server: the member's own stream decides what a late subscriber
  // sees, and an event stream promises nothing about occurrences before it.
  createEffect(inputFn, (input) => {
    stop();
    if (input !== null) start(input);
  });
}
