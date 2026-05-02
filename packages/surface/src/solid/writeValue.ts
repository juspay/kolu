/**
 * Shared reconcile-or-assign branch: the load-bearing decision both
 * `createSubscription` and `createReactiveSubscription` make when writing
 * a new value into their backing store.
 *
 * Objects/arrays go through `reconcile` for fine-grained per-field
 * reactivity; primitives are written by direct assignment. Pulled out
 * of the two subscription factories so a future change to the strategy
 * (e.g. handling `Map` / `Set` types) lands in one place — the prior
 * "keep in sync" comment is no longer load-bearing.
 */

import type { SetStoreFunction } from "solid-js/store";
import { reconcile } from "solid-js/store";

/** Write `next` into the wrapped `{ v: T }` store at the `"v"` key. */
export function writeWrappedValue<T>(
  setStore: SetStoreFunction<{ v: T | undefined }>,
  next: T,
): void {
  if (next !== null && typeof next === "object") {
    setStore(
      "v",
      reconcile(next as Record<string, unknown>) as unknown as T | undefined,
    );
  } else {
    setStore("v", next);
  }
}
