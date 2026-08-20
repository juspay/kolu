/**
 * The ONE place `@kolu/surface`'s Solid layer merges a server value into a
 * store — and therefore the one place Solid's `reconcile` is imported at all.
 *
 * Objects/arrays go through `reconcile` for fine-grained per-field reactivity;
 * primitives are written by direct assignment.
 *
 * **Never keyed unless the member SAID so.** `reconcile(next)` defaults to
 * `key: "id"`: it assumes every array element carries a top-level `id` and that
 * that field is the element's IDENTITY. A framework merging ARBITRARY app
 * payloads has no basis for either half of that assumption, and inheriting it
 * from a library default is how the assumption gets made without anyone deciding
 * to make it.
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
 * fields say another. That is the shape of the downstream report this file's
 * default comes from: a live view that dropped and duplicated records on exactly
 * the edits that MOVE them (mid-insert, mid-delete, reorder), while end-appends
 * and in-place rewrites — the two edits that move nothing — stayed green.
 *
 * So an UNDECLARED merge passes `{ key: null }`: an element is replaced rather
 * than recycled, and no object is ever carried across records. A collection's
 * keyed dictionary is not merged here at all — `useCollectionDeltas` owns its
 * store and writes the keys a frame NAMES, replacing each leaf whole for the same
 * replaced-rather-than-recycled reason, and it stays outside this seam (a fold may
 * be holding the very object a merge would mutate).
 *
 * **Stated precisely, because the alternative invites overclaiming:** on Solid
 * 1.9 both spellings produce the same VALUES (checked across 4,000 randomised
 * shape × edit pairs — keyless rows, `id` rows, repeated-`id` rows, nested
 * arrays); what they differ in is object identity, and therefore which consumers
 * notify and what a reference-keyed reader sees. The suite beside this file pins
 * the identity law, not a value diff, because the value diff is not where the
 * defect lives.
 *
 * ── What replacing every element COSTS, and the declaration that pays for it ──
 *
 * Replacing is safe and it is also total: nothing off the wire is `===` what came
 * before, so a frame REPEATING what the store already holds still replaces every
 * element and still notifies every reader of every array. A live view redrawn on
 * each keystroke pays a full teardown of every keyed `<For>` under it per frame,
 * and every per-row binding re-runs for every row for a one-character change in
 * one row. The measurement (the downstream audit's §6 replay, reproduced in this
 * file's suite): an identical frame notifies `rows[$TRACK]` once and
 * `rows[0].node.title` once. Zero is what those numbers should be.
 *
 * The framework cannot fix that by guessing better — the guess is the defect. It
 * fixes it by being TOLD: a cell or stream spec declares an `arrayKey` (see
 * `../define.ts`) — the field that identifies an element of an array inside that
 * member's value — and the declaration travels on the member's DESCRIPTOR, so the
 * definition site, not the use site, is where the answer lives. A declared merge
 * passes `{ key: <that field>, merge: true }`:
 *
 *   - an array whose elements carry the field is diffed BY IT — a repeated frame
 *     recycles every element and notifies nothing; a reorder MOVES the objects a
 *     keyed `<For>` is following instead of rebuilding its DOM;
 *   - an array whose elements do NOT carry it is merged BY POSITION (`merge:
 *     true`), which is likewise silent on a repeated frame. This is the declared
 *     reach of the key, not a fallback around it: the member named one identity,
 *     and for arrays that identity does not describe, position is what is left.
 *     A consumer that needs those elements' identity declares THEIR field instead
 *     (the declaration is one field per member, because Solid's `reconcile` takes
 *     one) or reads them by value.
 *
 * The declared field is IDENTITY WHEREVER IT APPEARS, not only inside arrays: a
 * nested object that happens to carry it is merged in place while it reads the
 * same, and REPLACED WHOLE the moment it reads different. That is the same
 * sentence as the array rule, applied to a value the member did not put in a
 * list, and it is coherent — the field said what the object IS, and it now says
 * something else — but it is a consequence worth knowing before naming a field
 * that also lives outside the rows it was chosen for.
 *
 * An undeclared member is unchanged in every particular — same `{ key: null }`,
 * same replaced-never-recycled law, same suite pinning it.
 */

import type { SetStoreFunction } from "solid-js/store";
import { reconcile } from "solid-js/store";

/** Merge `next` into a store under the member's DECLARED array identity — the only
 *  merge this package performs (see the module docstring for what `arrayKey`
 *  buys, what `key: null` costs, and why the honest default is to be told rather
 *  than to guess). Exported so the other store-writing seams in
 *  `@kolu/surface/solid` reach the merge through this module rather than importing
 *  `reconcile` and re-deciding the question.
 *
 *  `arrayKey` undefined ⇒ elements are replaced, never recycled. */
export function reconcileFrame<T>(next: T, arrayKey?: string) {
  return reconcile(
    next as Record<string, unknown>,
    arrayKey === undefined
      ? { key: null }
      : // `merge: true` is what routes an array the key does NOT describe to a
        // positional merge instead of Solid's all-keys-are-`undefined` diff. Both
        // land positionally; the explicit branch is the one that says so.
        { key: arrayKey, merge: true },
  ) as unknown as (prev: T) => T;
}

/** Write `next` into the wrapped `{ v: T }` store at the `"v"` key, under the
 *  member's declared array identity (see {@link reconcileFrame}). */
export function writeWrappedValue<T>(
  setStore: SetStoreFunction<{ v: T | undefined }>,
  next: T,
  arrayKey?: string,
): void {
  if (next !== null && typeof next === "object") {
    setStore("v", reconcileFrame(next, arrayKey) as unknown as T | undefined);
  } else {
    setStore("v", next);
  }
}
