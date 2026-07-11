/**
 * SolidJS primitive for consuming async streams whose **input parameters**
 * are reactive — i.e., the subscription must tear down and re-establish
 * whenever the input changes, not just when the consuming component
 * unmounts.
 *
 * Use this when the upstream stream depends on an input that the user can
 * change (selected file, active git mode, etc.). For static-input streams
 * use `createSubscription` — cheaper, simpler.
 *
 * Lifecycle: every input change runs `onCleanup` for the previous
 * subscription's `AbortController`, abandons the in-flight iterator (the
 * server tears down on the abort), then opens a fresh subscription. The
 * exposed `Subscription<T>` reads the latest value any subscriber yielded;
 * `pending()` is true between the input change and the first new yield.
 */

import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import {
  type CellChange,
  type Dispose,
  framesEqual,
  type Subscription,
} from "./createSubscription";
import { writeWrappedValue } from "./writeValue";

export interface ReactiveSubscriptionOptions {
  onError?: (err: Error) => void;
}

export function createReactiveSubscription<I, T>(
  inputFn: () => I | null,
  factory: (input: I, signal: AbortSignal) => Promise<AsyncIterable<T>>,
  options?: ReactiveSubscriptionOptions,
): Subscription<T> {
  const [store, setStore] = createStore<{ v: T | undefined }>({ v: undefined });
  const [error, setError] = createSignal<Error | undefined>();
  const [pending, setPending] = createSignal(true);
  const [complete, setComplete] = createSignal(false);

  function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  // The change-iff-fired half of the Dynamic (see `createSubscription`). A fresh
  // input opens a fresh subscription, so `lastSeen` resets with the rest of the
  // state below — the new input's first frame is a value, not a change.
  const updatedHandlers = new Set<(change: CellChange<T>) => void>();
  let lastSeen: { has: boolean; value: T } = {
    has: false,
    value: undefined as T,
  };
  function noteFrame(next: T): void {
    if (!lastSeen.has) {
      lastSeen = { has: true, value: next };
      return;
    }
    if (framesEqual(lastSeen.value, next)) return;
    const prev = lastSeen.value;
    lastSeen = { has: true, value: next };
    if (updatedHandlers.size === 0) return;
    // Snapshot the pair — the store reconciles these frames and would mutate a
    // retained reference (see `createSubscription`'s `noteFrame`).
    const change: CellChange<T> = {
      prev: structuredClone(prev),
      next: structuredClone(next),
    };
    for (const h of [...updatedHandlers]) h(change);
  }

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
      lastSeen = { has: false, value: undefined as T };
      if (input === null) return;

      const controller = new AbortController();
      onCleanup(() => controller.abort());

      void (async () => {
        try {
          const iterable = await factory(input, controller.signal);
          for await (const item of iterable) {
            if (controller.signal.aborted) break;
            noteFrame(item);
            writeWrappedValue(setStore, item);
            if (pending()) setPending(false);
            if (error()) setError(undefined);
          }
          // Normal completion — mirrors `createSubscription`'s typed-end handling:
          // an aborted loop takes the `break` above with `aborted` already true,
          // so reaching here means the iterable ended on its own.
          if (!controller.signal.aborted) {
            if (pending()) setPending(false);
            setComplete(true);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          setError(toError(err));
          setPending(false);
        }
      })();
    }),
  );

  const sub = Object.assign((() => store.v) as Accessor<T | undefined>, {
    error,
    pending,
    complete,
    updated: (handler: (change: CellChange<T>) => void): Dispose => {
      updatedHandlers.add(handler);
      return () => updatedHandlers.delete(handler);
    },
  }) as Subscription<T>;

  // Route `onError` through the SAME self-clearing EDGE effect `createSubscription`
  // uses (`createSubscription.ts`: the `on(() => sub.error(), …)` block), NOT
  // inline in the `catch`. Inline-in-catch fires on every re-throw AND diverges
  // the callback from the self-clearing `error()` LEVEL: a consumer wiring
  // `onError → signal → render` would latch on a transient blip while `error()`
  // had already cleared on the next good frame (the #1564 latch, the reactive
  // path's copy of it). Driving the callback off `error()` makes the edge fire
  // once per rising error transition and clear with the signal — so the two
  // error channels can never disagree, the property `client.health()` relies on.
  if (options?.onError) {
    const handler = options.onError;
    createEffect(
      on(
        () => sub.error(),
        (err) => {
          if (err) handler(err);
        },
      ),
    );
  }

  return sub;
}
