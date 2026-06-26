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
import type { Subscription } from "./createSubscription";
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

  function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  createEffect(
    on(inputFn, (input) => {
      // Reset state on every input change; the prior iterator is being
      // torn down so the previously-yielded value is no longer authoritative.
      setStore("v", undefined);
      setError(undefined);
      setPending(true);
      if (input === null) return;

      const controller = new AbortController();
      onCleanup(() => controller.abort());

      void (async () => {
        try {
          const iterable = await factory(input, controller.signal);
          for await (const item of iterable) {
            if (controller.signal.aborted) break;
            writeWrappedValue(setStore, item);
            if (pending()) setPending(false);
            if (error()) setError(undefined);
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
