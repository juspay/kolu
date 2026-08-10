/**
 * The ONE place `@kolu/surface`'s Solid layer merges a server value into a
 * store — and therefore the one place Solid's `reconcile` is imported at all.
 *
 * Objects/arrays go through `reconcile` for fine-grained per-field reactivity;
 * primitives are written by direct assignment.
 *
 * **Never keyed.** `reconcile(next)` defaults to `key: "id"`: it assumes every
 * array element carries a top-level `id` and that that field is the element's
 * IDENTITY. A framework merging ARBITRARY app payloads has no basis for either
 * half of that assumption, and inheriting it from a library default is how the
 * assumption gets made without anyone deciding to make it.
 *
 * What the key actually decides is which PREVIOUS OBJECTS survive a merge. When
 * every element's key reads `undefined` — the shape of any payload that didn't
 * happen to name a field `id` — Solid's diff treats them all as the same key, so
 * it RECYCLES the previous row objects positionally and mutates the new record's
 * fields into them. Measured on a 3→4 mid-insert: the keyed default reuses 3 of 4
 * row objects, and the object that was record `b` comes to hold record `mid`. Any
 * consumer that reads identity rather than position — a `<For>` keyed by
 * reference, a memo that caches per row, a component holding a row across
 * frames — is then looking at a row whose identity says one thing and whose
 * fields say another. That is the shape of the downstream report this change
 * comes from: a live view that dropped and duplicated records on exactly the
 * edits that MOVE them (mid-insert, mid-delete, reorder), while end-appends and
 * in-place rewrites — the two edits that move nothing — stayed green.
 *
 * So every merge here passes `{ key: null }`: an element is replaced rather than
 * recycled, and no object is ever carried across records. Per-key granularity
 * within a dictionary (`useCollectionDeltas`' `byKey`) is untouched — that is
 * object-property reconciliation, not array-element identity.
 *
 * **Stated precisely, because the alternative invites overclaiming:** on Solid
 * 1.9 both spellings produce the same VALUES (checked across 4,000 randomised
 * shape × edit pairs — keyless rows, `id` rows, repeated-`id` rows, nested
 * arrays); what they differ in is object identity, and therefore which consumers
 * notify and what a reference-keyed reader sees. The suite beside this file pins
 * the identity law, not a value diff, because the value diff is not where the
 * defect lives.
 *
 * **A keyed merge would have to be DECLARED.** A collection declares its
 * `keySchema`, and that key is the dictionary key `useCollectionDeltas` folds by —
 * it says nothing about the identity of array elements INSIDE a value. Cells and
 * streams declare nothing at all. So no member definition today could authorize a
 * keyed merge, and until one exists the framework must not infer identity from a
 * field name. Adding that declaration later is a spec change with a call site;
 * inheriting `"id"` from a library default is neither.
 */

import type { SetStoreFunction } from "solid-js/store";
import { reconcile } from "solid-js/store";

/** Merge `next` into a store WITHOUT assuming array-element identity — the only
 *  merge this package performs (see the module docstring for why `key: null` is
 *  the honest default and what the library default costs). Exported so the other
 *  store-writing seams in `@kolu/surface/solid` reach the merge through this
 *  module rather than importing `reconcile` and re-deciding the question. */
export function unkeyedReconcile<T>(next: T) {
  return reconcile(next as Record<string, unknown>, {
    key: null,
  }) as unknown as (prev: T) => T;
}

/** Write `next` into the wrapped `{ v: T }` store at the `"v"` key. */
export function writeWrappedValue<T>(
  setStore: SetStoreFunction<{ v: T | undefined }>,
  next: T,
): void {
  if (next !== null && typeof next === "object") {
    setStore("v", unkeyedReconcile(next) as unknown as T | undefined);
  } else {
    setStore("v", next);
  }
}
