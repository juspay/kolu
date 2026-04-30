/**
 * `useStream` — Solid hook for a derived stream with reactive input.
 *
 * Thin wrapper over `createReactiveSubscription` that takes a `Stream`
 * descriptor (for type identity) plus the source factory and reactive
 * input expression. When the input changes, the previous subscription
 * tears down and a fresh one starts; value resets to `undefined`
 * between input change and first yield.
 *
 * Use for streams whose computation depends on a parameter the user can
 * change (selected file, active git mode, current repo). For static-input
 * streams or singletons, use `useCell` — cheaper, simpler.
 */

import type { Stream } from "../index";
import {
  createReactiveSubscription,
  type ReactiveSubscriptionOptions,
} from "./createReactiveSubscription";
import type { Subscription } from "./createSubscription";

export function useStream<Name extends string, I, T>(
  _stream: Stream<Name, I, T>,
  inputFn: () => I | null,
  factory: (input: I, signal: AbortSignal) => Promise<AsyncIterable<T>>,
  options?: ReactiveSubscriptionOptions,
): Subscription<T> {
  return createReactiveSubscription(inputFn, factory, options);
}
