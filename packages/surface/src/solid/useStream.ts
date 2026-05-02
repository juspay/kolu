/**
 * `useStream` — Solid hook for a derived stream with reactive input.
 *
 * Thin wrapper over `createReactiveSubscription`. Takes a `Stream`
 * descriptor (for type identity), a reactive input accessor, and a typed
 * oRPC procedure ref (`client.git.onStatusChange`, etc.). The hook
 * threads `STREAM_RETRY` context per call so transport drops re-subscribe
 * transparently and the next yield is a fresh full snapshot.
 *
 * When the input changes, the previous subscription tears down and a
 * fresh one starts; value resets to `undefined` between input change and
 * first yield.
 *
 * Use for streams whose computation depends on a parameter the user can
 * change (selected file, active git mode, current repo). For static-input
 * streams or singletons, use `useCell` — cheaper, simpler.
 */

import { STREAM_RETRY, type StreamingProcedure } from "../client";
import type { Stream } from "../index";
import {
  createReactiveSubscription,
  type ReactiveSubscriptionOptions,
} from "./createReactiveSubscription";
import type { Subscription } from "./createSubscription";

export function useStream<Name extends string, I, T>(
  _stream: Stream<Name, I, T>,
  inputFn: () => I | null,
  source: StreamingProcedure<I, T>,
  options?: ReactiveSubscriptionOptions,
): Subscription<T> {
  return createReactiveSubscription(
    inputFn,
    (input, signal) => source(input, { signal, context: STREAM_RETRY }),
    options,
  );
}
