/**
 * `useEvent` — Solid hook for point-in-time occurrences. Distinct from
 * `useStream` because there's no current value to render: consumers
 * register a handler that fires per occurrence. Lifecycle notifications
 * (terminal exit, session expiry, one-shot completions) fit this shape.
 *
 * Cleanup is signal-driven. When `options.signal` is provided, the
 * subscription dies on abort. Otherwise the hook installs `onCleanup`
 * tied to the current reactive owner — call from inside `createRoot` if
 * you want imperative lifetime (e.g. fire-and-forget per-entity
 * subscriptions whose lifetime tracks the entity, not a component).
 *
 * No snapshot obligation: a late subscriber misses past occurrences by
 * design. Re-subscribe on transport drop is best-effort — application
 * errors propagate to `onError` and end the subscription, matching the
 * `shouldRetry: !ORPCError` policy in `STREAM_RETRY`.
 */

import { createEffect, on, onCleanup } from "solid-js";
import { STREAM_RETRY, type StreamingProcedure } from "../client";
import type { Event } from "../index";

export interface UseEventOptions {
  /** Called when the subscription errors (transport failure that retry
   *  can't recover, or an `ORPCError` from the source). Required because
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
  _event: Event<Name, I, T>,
  inputFn: () => I | null,
  source: StreamingProcedure<I, T>,
  handler: (occurrence: T) => void,
  options: UseEventOptions,
): void {
  // Track the abort controller for the active subscription. Nullable
  // because input may be `null` (paused) — no controller in that case.
  let activeController: AbortController | undefined;

  function abortActive(): void {
    activeController?.abort();
    activeController = undefined;
  }

  function startSubscription(input: I, parentSignal: AbortSignal): void {
    const controller = new AbortController();
    activeController = controller;
    // Compose: abort our controller when the parent signal fires.
    const onParentAbort = (): void => controller.abort();
    parentSignal.addEventListener("abort", onParentAbort, { once: true });

    void (async () => {
      try {
        const iter = await source(input, {
          signal: controller.signal,
          context: STREAM_RETRY,
        });
        for await (const occurrence of iter) {
          if (controller.signal.aborted) break;
          handler(occurrence);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          options.onError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    })();
  }

  // Single cleanup path: external signal OR internal AbortController +
  // onCleanup. Never both — avoids dual lifecycle braiding (same shape
  // `createSubscription` uses).
  const parentSignal =
    options.signal ??
    (() => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      return controller.signal;
    })();

  // Open the initial subscription synchronously so callers from async
  // contexts (e.g. fire-and-forget after `await client.X.create`) don't
  // race a not-yet-attached subscriber against the first server yield.
  // `createEffect` with `defer` handles subsequent input changes only.
  const initial = inputFn();
  if (initial !== null) startSubscription(initial, parentSignal);

  createEffect(
    on(
      inputFn,
      (input) => {
        abortActive();
        if (input !== null) startSubscription(input, parentSignal);
      },
      { defer: true },
    ),
  );
}
