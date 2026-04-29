/**
 * SolidJS primitive for consuming async streams whose **input parameters**
 * are reactive — i.e., the subscription must tear down and re-establish
 * whenever the input changes, not just when the consuming component
 * unmounts.
 *
 * Use this when the upstream stream depends on an input that the user can
 * change (selected file, active git mode, etc.). For static-input streams
 * (terminal metadata for one terminal-id), use `createSubscription` —
 * cheaper, simpler.
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
import { createStore, reconcile } from "solid-js/store";
import type { Subscription } from "./createSubscription";

export interface ReactiveSubscriptionOptions {
  /** Called when the stream errors. Mirror of `createSubscription`'s
   *  option — surface failures via toast.error or similar; the reactive
   *  `error()` accessor is also available for in-component handling. */
  onError?: (err: Error) => void;
}

/**
 * Convert a reactive input + factory into a SolidJS-readable async stream
 * subscription that resubscribes on input change.
 *
 * - `inputFn` returns the current input or `null` (input not ready —
 *   subscription is dropped, value resets to `undefined`).
 * - `factory(input, signal)` opens the underlying iterable. The signal
 *   aborts on input change and on consumer disposal.
 *
 * ```tsx
 * const status = createReactiveSubscription(
 *   () => repoPath() ? { repoPath: repoPath(), mode: mode() } : null,
 *   (input, signal) => stream.gitStatus(input.repoPath, input.mode, signal),
 * );
 * status();          // current value or undefined
 * status.pending();  // true between input change and first yield
 * status.error();    // last error or undefined
 * ```
 */
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
            if (item !== null && typeof item === "object") {
              setStore(
                "v",
                reconcile(item as Record<string, unknown>) as unknown as T,
              );
            } else {
              setStore("v", item as T);
            }
            if (pending()) setPending(false);
            if (error()) setError(undefined);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          const e = toError(err);
          setError(e);
          setPending(false);
          options?.onError?.(e);
        }
      })();
    }),
  );

  return Object.assign((() => store.v) as Accessor<T | undefined>, {
    error,
    pending,
  }) as Subscription<T>;
}
