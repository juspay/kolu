/**
 * The ONE place `@kolu/surface`'s Solid layer merges a server value into a
 * store — and therefore the one place Solid's `reconcile` is imported at all.
 *
 * Objects and arrays go through `reconcile` for fine-grained per-field
 * reactivity; primitives — and the first frame, which has nothing to merge into
 * — are written by assignment.
 *
 * ── What a merge can carry across frames ──
 *
 * `reconcile` ADOPTS the incoming frame: at every level it reaches, the store's
 * backing BECOMES the frame's own object by a pointer swap, and the nodes that
 * exist are notified where the two frames disagree (`@solidjs/signals` 2.0.3
 * `dist/dev.js`: `reconcileState` :6553, `applyAdopt` :6592, `adoptPB` :4392).
 * Nothing off the wire is cloned, and nothing already in the store is mutated:
 * a frame handed to the store is frozen by construction, and `snapshot(store)`
 * is always the newest frame's own objects.
 *
 * So the thing a merge can carry across records is not the raw object — it is
 * the store PROXY, which is the row identity every consumer actually holds: a
 * `<For>` item, a per-row memo, a component that captured a row. Per array slot,
 * a merge either hands the proxy standing there the incoming element (it keeps
 * its identity and its readers are notified field by field) or drops it for a
 * fresh one (every reader of that row re-reads). `key` is what decides which,
 * and it decides it PER ELEMENT:
 *
 *   - `reconcile(v, "id")` / `reconcile(v, fn)` — the aligned prefix is walked
 *     positionally while each pair's keys match; from the first misalignment,
 *     incoming elements are matched to previous ones BY KEY, so a surviving row
 *     keeps its proxy wherever it moved to and an element matching nothing is
 *     replaced (`applyAdopt` :6592, `sameRow` :5136);
 *   - an element whose key reads `undefined` falls back to its POSITION — it
 *     adopts whatever proxy stands at that index (`applyAdopt` :6592, "keyless
 *     item: positional fallback");
 *   - `reconcile(v, null)` makes every element keyless: the whole array merges
 *     by position. This is Solid 1.9's `{ key, merge: true }`, NOT its
 *     `{ key: null }` — measured here on a 3→4 mid-insert, the proxy that was
 *     record `b` comes to hold record `mid` and the one that was `c` comes to
 *     hold `b`. Solid 2 has no spelling of "replace every element" among its
 *     three documented key forms; the one below is how this module asks for it.
 *   - a nested OBJECT (not an array element) is merged in place unless both
 *     sides carry the key and read DIFFERENT, in which case it is replaced
 *     whole (`descend` :6809). Two `undefined`s are not a mismatch, so a key no
 *     object outside the arrays carries leaves every object merging per field.
 *   - at the ROOT, a key that reads different on the two frames is not a
 *     replacement but a THROW — "Cannot reconcile states with different
 *     identity" (`reconcileState` :6553). This module answers that case itself
 *     (see {@link frameMerge}) by replacing, which is what Solid 1.9 did.
 *
 * A level nothing is observing is skipped: with a key, `descend` adopts only
 * where a node exists below (`:6837`), so an unread row is replaced whatever the
 * key says. Identity is preserved exactly where it is observable, which is why
 * every identity test beside this file OBSERVES the rows it then compares.
 *
 * **Never keyed unless the member SAID so.** `reconcile(next)` defaults to
 * `key: "id"`: it assumes every array element carries a top-level `id` and that
 * that field is the element's IDENTITY. A framework merging ARBITRARY app
 * payloads has no basis for either half of that assumption, and inheriting it
 * from a library default is how the assumption gets made without anyone deciding
 * to make it. Worse under the default than under any explicit key: a payload
 * that did not happen to name a field `id` reads EVERY element's key as
 * `undefined`, which is the positional fallback above — the guess silently
 * degrades to the one behaviour this module exists to avoid.
 *
 * The downstream report this file's default comes from is exactly that shape: a
 * live view that dropped and duplicated records on the edits that MOVE them
 * (mid-insert, mid-delete, reorder), while end-appends and in-place rewrites —
 * the two edits that move nothing — stayed green.
 *
 * ── The UNDECLARED spelling: replaced, never recycled ──
 *
 * An undeclared member passes a key FUNCTION that answers for the INCOMING
 * frame's array elements and `undefined` for everything else
 * ({@link freshElementKey}). Every clause of the law falls out of that one
 * asymmetry, because the previous frame's objects are never the incoming
 * frame's:
 *
 *   - an element of the previous frame reads `undefined` and an incoming
 *     element reads a key, so the aligned prefix breaks at the first slot and
 *     the by-key match finds nothing: every element is REPLACED, and no proxy
 *     ever comes to hold a record it did not already hold;
 *   - a nested object reads `undefined` on both sides, so it keeps merging per
 *     field — an unchanged leaf beside a changed one still notifies nobody;
 *   - the root reads `undefined`, so the root identity throw cannot fire.
 *
 * The frame is walked once to tag its array elements. The walk STOPS at an
 * element (it is replaced, so no merge ever descends into one), so it costs the
 * object spine plus one tag per element — an order below the decode that just
 * produced the frame, and nothing per unchanged leaf.
 *
 * **Stated precisely, because the alternative invites overclaiming:** both
 * spellings produce the same VALUES; what they differ in is proxy identity, and
 * therefore which consumers notify and what a reference-keyed reader sees. The
 * suite beside this file pins the identity law, not a value diff, because the
 * value diff is not where the defect lives.
 *
 * ── What replacing every element COSTS, and the declaration that pays for it ──
 *
 * Replacing is safe and it is also total: nothing off the wire is `===` what
 * came before, so a frame REPEATING what the store already holds still replaces
 * every element and still notifies every reader of every array. A live view
 * redrawn on each keystroke pays a full teardown of every keyed `<For>` under it
 * per frame, and every per-row binding re-runs for every row for a
 * one-character change in one row. Measured in this file's suite: an identical
 * frame notifies `rows[$TRACK]` once and `rows[0].node.title` once. Zero is what
 * those numbers should be — and zero is what they are once a key is declared.
 *
 * The framework cannot fix that by guessing better — the guess is the defect. It
 * fixes it by being TOLD: a cell or stream spec declares an `arrayKey` (see
 * `../define.ts`) — the field that identifies an element of an array inside that
 * member's value — and the declaration travels on the member's DESCRIPTOR, so
 * the definition site, not the use site, is where the answer lives. A declared
 * merge passes that field as the key:
 *
 *   - an array whose elements carry the field is diffed BY IT — a repeated frame
 *     recycles every element and notifies nothing; a reorder MOVES the proxies a
 *     keyed `<For>` is following instead of rebuilding its DOM;
 *   - an array whose elements do NOT carry it is merged BY POSITION, which is
 *     likewise silent on a repeated frame. This is the declared reach of the
 *     key, not a fallback around it: the member named one identity, and for
 *     arrays that identity does not describe, position is what is left. A
 *     consumer that needs those elements' identity declares THEIR field instead
 *     (the declaration is one field per member, because `reconcile` takes one)
 *     or reads them by value.
 *
 * **The named field must be REQUIRED and NON-NULLABLE on the element**, and that
 * is a property of the schema because it cannot be one of the merge. Solid 2
 * decides keyed-versus-positional PER ELEMENT, so an optional field does not
 * cost an array its keyed diff — it costs the rows that are missing it their
 * identity, one at a time and invisibly: a row whose key reads `undefined`
 * takes the positional fallback and ADOPTS the proxy standing at its index,
 * which under a declared key is some other record's row. Measured: against
 * `[{key:"a"},{key:"b"}]`, the frame `[{n:2},{key:"a"}]` hands `a`'s proxy to
 * the keyless row. That is the recycling the undeclared default exists to
 * prevent, reappearing inside a declaration that was supposed to prevent it —
 * so the field is made unrepresentable-when-absent in the schema, which is the
 * only place it CAN be made unrepresentable: the merge sees values, not schemas.
 *
 * The declared field is IDENTITY WHEREVER IT APPEARS, not only inside arrays: a
 * nested object that happens to carry it is merged in place while it reads the
 * same, and REPLACED WHOLE the moment it reads different. At the member's root
 * that same mismatch is Solid's "different identity" throw rather than a
 * replacement, so this module makes it a replacement — the Solid 1.9 behaviour
 * and the only one a frame-by-frame merge can mean.
 *
 * An undeclared member keeps the same replaced-never-recycled law it always had,
 * and the same suite pinning it; what changed underneath is that the objects it
 * protects are the store's proxies rather than the frame's rows, because Solid 2
 * never mutates a frame at all.
 */

import { reconcile, type StoreSetter } from "solid-js";

/** The key an INCOMING frame's array element answers under an undeclared
 *  member. Any defined value does: the previous frame's elements are not in the
 *  tag map, so their key reads `undefined` and no incoming element can ever
 *  match one. Distinctness would buy nothing — matches are looked up in the
 *  PREVIOUS frame's keys, which are all `undefined` and therefore not indexed at
 *  all (`applyAdopt` :6592). */
const ELEMENT_OF_THIS_FRAME = true;

/** Tag every array element reachable in `next` — at any depth — and answer with
 *  the element key `reconcile` reads.
 *
 *  The walk does NOT descend into an element: an element is replaced by this
 *  very key, so no merge ever descends into one either, and arrays nested inside
 *  one are never paired with anything. What it costs is the object spine plus
 *  one tag per element.
 *
 *  The map doubles as the walk's cycle guard (`false` = visited spine), because
 *  a frame is not guaranteed acyclic: the in-process link passes values through
 *  without serialization, the same reason `framesEqual` carries one. */
function freshElementKey(next: object): (item: unknown) => unknown {
  const tags = new WeakMap<object, boolean>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const element of value) {
        if (element !== null && typeof element === "object") {
          tags.set(element as object, ELEMENT_OF_THIS_FRAME);
        }
      }
      return;
    }
    if (tags.has(value)) return;
    tags.set(value, false);
    for (const key in value as Record<string, unknown>) {
      walk((value as Record<string, unknown>)[key]);
    }
  };
  walk(next);
  return (item: unknown) =>
    typeof item === "object" && item !== null && tags.get(item) === true
      ? ELEMENT_OF_THIS_FRAME
      : undefined;
}

/** The merge to run for this frame, or `null` when `next` must REPLACE what
 *  stands there rather than merge into it.
 *
 *  Three cases replace. Nothing mergeable is there yet (the first frame, or a
 *  primitive where an object now arrives) — `reconcile` requires a wrapped
 *  object and throws on anything else. And, under a declared key, a root whose
 *  key reads DIFFERENT from the incoming one: that is a different entity, which
 *  `reconcileState` :6553 answers with a throw rather than a replacement
 *  (replacement is what the member means, and what Solid 1.9 did). A root key
 *  that reads `undefined` on the standing value is no mismatch — the member's
 *  key simply does not describe the root — and merges. */
function frameMerge<T extends object>(
  prev: unknown,
  next: T,
  arrayKey: string | undefined,
): ((state: object) => unknown) | null {
  if (prev === null || typeof prev !== "object") return null;
  if (arrayKey === undefined) {
    return reconcile<T, object>(next, freshElementKey(next));
  }
  const was = (prev as Record<string, unknown>)[arrayKey];
  const now = (next as Record<string, unknown>)[arrayKey];
  // `sameKey`'s rule (:3876), so this agrees with the check it is pre-empting:
  // identical, or both `NaN`.
  if (
    was !== undefined &&
    !(was === now || (Number.isNaN(was) && Number.isNaN(now)))
  ) {
    return null;
  }
  return reconcile<T, object>(next, arrayKey);
}

/** Merge `next` into a store ROOT under the member's DECLARED array identity —
 *  the merge `useCell`'s local store performs on a whole value (see the module
 *  docstring for what `arrayKey` buys and what an undeclared member gets
 *  instead). Exported so the other store-writing seams in `@kolu/surface/solid`
 *  reach the merge through this module rather than importing `reconcile` and
 *  re-deciding the question.
 *
 *  `arrayKey` undefined ⇒ array elements are replaced, never recycled. */
export function reconcileFrame<T extends object>(
  next: T,
  arrayKey?: string,
): (state: T) => T | undefined {
  return (state) => {
    const merge = frameMerge(state, next, arrayKey);
    // A setter callback that RETURNS a value replaces: every root key the frame
    // carries is written by reference and every key it drops is deleted, which
    // is the replacement a root identity change means.
    if (merge === null) return next;
    merge(state);
  };
}

/** Write `next` into the wrapped `{ v: T }` store at the `"v"` key, under the
 *  member's declared array identity (see {@link reconcileFrame}). The wrapper is
 *  what lets a member's value be of ANY shape — a primitive, or an object a
 *  merge can reach — while the store itself stays an object. */
export function writeWrappedValue<T>(
  setStore: StoreSetter<{ v: T | undefined }>,
  next: T,
  arrayKey?: string,
): void {
  if (next === null || typeof next !== "object") {
    setStore((draft) => {
      draft.v = next;
    });
    return;
  }
  const frame: object = next;
  setStore((draft) => {
    const prev: unknown = draft.v;
    const merge = frameMerge(prev, frame, arrayKey);
    if (merge === null || prev === null || typeof prev !== "object") {
      draft.v = next;
      return;
    }
    merge(prev);
  });
}
