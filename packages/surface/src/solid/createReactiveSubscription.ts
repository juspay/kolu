/**
 * SolidJS primitive for consuming streams whose **input parameters** are
 * reactive — i.e., the subscription must tear down and re-establish whenever the
 * input changes, not just when the consuming component unmounts.
 *
 * Use this when the upstream stream depends on an input that the user can
 * change (selected file, active git mode, etc.). For static-input streams
 * use `createSubscription` — cheaper, simpler.
 *
 * Lifecycle: every input change runs `onCleanup` for the previous subscription,
 * which INTERRUPTS its fiber (the server tears down through the stream's own
 * finalizers), then opens a fresh one. The exposed `Subscription<T>` reads the
 * latest value any subscriber yielded; `pending()` is true between the input
 * change and the first new yield.
 */

import type { Stream } from "effect";
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import {
  createUpdatedTracker,
  type Subscription,
  wireSubscriptionError,
} from "./createSubscription";
import { runStreamScoped } from "../runStream";
import { writeWrappedValue } from "./writeValue";

export interface ReactiveSubscriptionOptions {
  onError?: (err: Error) => void;
}

/** What this primitive takes on top of what a `.use()` caller may pass: the
 *  member's DECLARED array identity (see `./writeValue.ts`). Kept off
 *  {@link ReactiveSubscriptionOptions} — the type `useStream` exposes to a call
 *  site — because the answer belongs to the member's definition, not to whoever
 *  happens to be reading it; `useStream` threads it from the descriptor. A caller
 *  driving a RAW stream through this primitive has no descriptor to inherit from
 *  and so is itself the declaration site, which is why it is spellable here. */
export interface ReactiveSubscriptionInternalOptions
  extends ReactiveSubscriptionOptions {
  arrayKey?: string;
}

export function createReactiveSubscription<I, T>(
  inputFn: () => I | null,
  factory: (input: I) => Stream.Stream<T, unknown>,
  options?: ReactiveSubscriptionInternalOptions,
): Subscription<T> {
  const [store, setStore] = createStore<{ v: T | undefined }>({ v: undefined });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);

  // The change-iff-fired half of the Dynamic — the ONE law shared with
  // `createSubscription` via `createUpdatedTracker`. A fresh input opens a fresh
  // subscription, so the tracker is `reset()` with the rest of the state below —
  // the new input's first frame is a value, not a change.
  const tracker = createUpdatedTracker<T>();

  createEffect(
    on(inputFn, (input) => {
      // Reset state on every input change; the prior iterator is being
      // torn down so the previously-yielded value is no longer authoritative —
      // including `complete`: a fresh input opens a fresh iterator, so the
      // PRIOR typed end no longer describes the current one.
      setStore("v", undefined);
      setError(undefined);
      setPending(true);
      setComplete(false);
      tracker.reset();
      if (input === null) return;

      // The prior input's fiber was interrupted by this effect's own `onCleanup`
      // BEFORE this body ran, so the two subscriptions never overlap and a stale
      // frame can never land in the fresh state reset above.
      onCleanup(
        runStreamScoped<T>(factory(input), {
          // One tick per frame, matching `createStreamLifecycle`: the store write and
          // the `pending` clear settle together, so no consumer observes a frame
          // applied while the view still reads pending.
          onFrame: (item) =>
            batch(() => {
              tracker.noteFrame(item);
              writeWrappedValue(setStore, item, options?.arrayKey);
              setPending(false);
              // No clear-on-frame branch for the ERROR: a failure is the fiber's EXIT,
              // so no frame can follow one on the same subscription (see
              // `createSubscription`). Here the error clears when the INPUT changes —
              // the state reset above — which is this primitive's own recovery point.
            }),
          // Mirrors `createSubscription`'s typed-end handling: an interruption
          // (a superseding input, an unmount) reports nothing.
          onEnd: () => {
            if (pending()) setPending(false);
            setComplete(true);
          },
          onFailure: (err) => {
            setError(err);
            setPending(false);
          },
        }),
      );
    }),
  );

  const sub = Object.assign((() => store.v) as Accessor<T | undefined>, {
    error,
    pending,
    complete,
    updated: tracker.updated,
    changed: tracker.changed,
  }) as Subscription<T>;

  // Route `onError` through the SAME EDGE effect every other subscription uses, by
  // CALLING it rather than by restating it: driving the callback off the `error()`
  // LEVEL is what keeps the two error channels from disagreeing — the property
  // `client.health()` relies on. Whatever clears `error()` (here, an input change
  // resetting the state) clears the callback's view with it, so a consumer wiring
  // `onError → signal → render` cannot latch on a failure the signal has already
  // dropped (the #1564 latch, the reactive path's copy of it).
  if (options?.onError) wireSubscriptionError(sub, options.onError);

  return sub;
}
