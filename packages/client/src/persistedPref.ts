/** Validated, persisted per-device preference — a thin policy layer over
 *  `@solid-primitives/storage`'s `makePersisted` that adds the one thing the
 *  off-the-shelf primitive lacks: **validate-on-read with a typed fallback**.
 *
 *  `makePersisted` hands back whatever string sits in `localStorage` — a
 *  hand-edited value, a stale value from an older build, or outright
 *  corruption — coerced by its `deserialize` hook with no error path. Five
 *  call sites used to hand-roll that guard four different ways, and two
 *  skipped it entirely: the font-size pref read `Number("garbage") -> NaN`,
 *  and the canvas-maximized flag used the default coercion where the stored
 *  string `"false"` reads back truthy. Both are fixed by routing through one
 *  receptacle whose `parse` seam is mandatory.
 *
 *  `parse` is that single validation seam: raw stored string -> `T`. Throw on
 *  anything unexpected; {@link readWithFallback} catches, calls `onInvalid`,
 *  and substitutes `fallback`, so a corrupt entry degrades to the default
 *  instead of poisoning the signal. `parse` reaches the fallback *only* by
 *  throwing, so `onInvalid` is never silently skipped. The serialized format
 *  is unchanged from the hand-rolled sites, so values already in
 *  `localStorage` keep loading. */

import { makePersisted } from "@solid-primitives/storage";
import { type Accessor, createSignal, type Setter } from "solid-js";

export interface PersistedPrefOptions<T> {
  /** `localStorage` key. */
  name: string;
  /** Value used before anything is stored, and whenever the stored value
   *  fails `parse`. */
  fallback: T;
  /** Validate a raw stored string into `T`. **Throw** when the stored value
   *  is unexpected — {@link readWithFallback} catches, substitutes `fallback`,
   *  and calls `onInvalid`. Returning is the *only* signal for "valid";
   *  throwing is the *only* way to reach the fallback. Keeping it single-mode
   *  means the `onInvalid` reporting path can never be silently bypassed by a
   *  call site that returns the fallback inline. This is the seam that turns
   *  "trust whatever localStorage holds" into "trust it only if it validates". */
  parse: (raw: string) => T;
  /** Serialize `T` for storage. Defaults to identity for strings and
   *  `JSON.stringify` otherwise — matching the formats the call sites
   *  already wrote, so persisted values survive the migration. */
  serialize?: (value: T) => string;
  /** Side effect on corrupt/unexpected stored data (e.g. a toast). Receives
   *  the thrown error and the offending raw string. A callback, not a baked-in
   *  toast, so notifications stay colocated with their trigger per
   *  `.claude/rules/toast-conventions.md`. */
  onInvalid?: (err: unknown, raw: string) => void;
  /** Storage backend. Defaults to `localStorage` (via `makePersisted`).
   *  Injected by tests with a synchronous in-memory fake. */
  storage?: Storage;
}

/** The validate-on-read core: run `parse`, fall back on throw. Exported so
 *  the validation/fallback contract is unit-testable without a DOM or a real
 *  `Storage`; `persistedPref` feeds it to `makePersisted` as `deserialize`. */
export function readWithFallback<T>(
  raw: string,
  parse: (raw: string) => T,
  fallback: T,
  onInvalid?: (err: unknown, raw: string) => void,
): T {
  try {
    return parse(raw);
  } catch (err) {
    onInvalid?.(err, raw);
    return fallback;
  }
}

/** Default storage encoding: strings store verbatim, everything else via
 *  `JSON.stringify`. Note for boolean prefs: this writes the literal strings
 *  `"true"` / `"false"`, so a boolean `parse` must accept exactly those two —
 *  not `Boolean(raw)` or `JSON.parse(raw)` followed by a truthiness check,
 *  which read the stored `"false"` as truthy (the bug the canvas-maximized
 *  pref was fixed to avoid). */
function defaultSerialize<T>(value: T): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Build a persisted signal whose stored value is validated on every read.
 *  Returns the same `[Accessor, Setter]` tuple as `createSignal`. */
export function persistedPref<T>(
  opts: PersistedPrefOptions<T>,
): [Accessor<T>, Setter<T>] {
  const serialize = opts.serialize ?? defaultSerialize;
  // `makePersisted` returns a 3-tuple `[get, set, init]`; expose just the
  // `[get, set]` signal pair so call sites read exactly like `createSignal`.
  const [value, setValue] = makePersisted(createSignal<T>(opts.fallback), {
    name: opts.name,
    storage: opts.storage,
    serialize,
    deserialize: (raw: string): T =>
      readWithFallback(raw, opts.parse, opts.fallback, opts.onInvalid),
  });
  return [value, setValue];
}
