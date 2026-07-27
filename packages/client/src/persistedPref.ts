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
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  createSignal,
  getOwner,
  onCleanup,
  type Setter,
} from "solid-js";

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

/** The strict-boolean `parse` every boolean pref shares. The default `serialize`
 *  writes the literal `"true"`/`"false"` (see {@link defaultSerialize}'s boolean
 *  note), so a boolean pref MUST parse exactly those two — never `Boolean(raw)` /
 *  `JSON.parse` + truthiness, which read the stored `"false"` back as `true` (the
 *  canvas-maximized bug). Spelled once here so {@link perHostBoolPref} reuses it
 *  instead of re-hand-rolling the parse. */
function parseBool(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`expected boolean pref "true"/"false", got: ${raw}`);
}

/** The default `onInvalid` a {@link perHostPref} or {@link boolPref} installs when
 *  the caller supplies none: a `console.warn` naming the offending key and the
 *  fallback it degraded to,
 *  so a corrupt value is a visible diagnostic rather than a silent reset (without it
 *  a bad value would collapse to the fallback with zero signal). `warn` — not `error`
 *  + a toast — is deliberate and matches the repo's calibration for this class: a
 *  per-host pref reset is a BENIGN, recoverable preference reset (the same call the
 *  `activeHost` and `reattachAnnouncedAt` prefs make: warn-only), NOT user-data loss
 *  (the `comments` queue toasts because a wiped queue IS lost user data). It reads the
 *  composed key `name` from the layer that already owns it, so a caller never recomposes
 *  the key to log it. Generic in `T` (not boolean-specific): "which key was corrupt" is
 *  a useful diagnostic for every per-host pref. */
function defaultInvalidWarning<T>(
  name: string,
  fallback: T,
): (err: unknown, raw: string) => void {
  return (err, raw) =>
    console.warn(
      `[persistedPref] ignoring invalid stored value for "${name}": ${JSON.stringify(raw)} — falling back to ${JSON.stringify(fallback)}`,
      err,
    );
}

/** Strict-boolean {@link persistedPref}, device-global (the per-host variant is
 *  {@link perHostBoolPref}). Reuses the one boolean-parse seam ({@link parseBool})
 *  and the warn-on-corrupt default, so a global boolean pref re-hand-rolls
 *  neither. `onInvalid` defaults to the warn-only surface but — mirroring
 *  {@link perHostPref} — a caller can override it (e.g. a toast) instead of
 *  being hard-wired to console-only with no escape hatch. */
export function boolPref(opts: {
  name: string;
  fallback: boolean;
  onInvalid?: (err: unknown, raw: string) => void;
}): [Accessor<boolean>, Setter<boolean>] {
  return persistedPref<boolean>({
    name: opts.name,
    fallback: opts.fallback,
    parse: parseBool,
    onInvalid:
      opts.onInvalid ?? defaultInvalidWarning(opts.name, opts.fallback),
  });
}

/** Compose a per-host `localStorage` key: `<base>:<encoded host>`. The ONE place
 *  the `:${encoded}` suffix is appended, so a per-host pref cannot be spelled
 *  without its host scope — the "remember to append the host" hazard dies here. */
export function perHostName(base: string, host: HostKey): string {
  return `${base}:${encodeHostKey(host)}`;
}

export interface PerHostPrefOptions<T>
  extends Omit<PersistedPrefOptions<T>, "name"> {
  /** The host this pref is scoped to — its `encodeHostKey` becomes the key suffix. */
  host: HostKey;
  /** The un-scoped key base (e.g. `"kolu-activityWindow"`); the host suffix is
   *  appended, once, by {@link perHostName}. */
  base: string;
}

/** A {@link persistedPref} scoped to ONE host: its key is `<base>:<encoded host>`
 *  AND — inseparably — it registers an `onCleanup` that EVICTS that exact key when
 *  this host's reactive OWNER is disposed. Key composition and eviction live together,
 *  once, so a per-host pref can neither be spelled without its host scope nor, once an
 *  owner exists, forget to evict its key. Must be called under a reactive owner.
 *
 *  A page RELOAD does NOT run the cleanup (the browser kills the process, not a Solid
 *  dispose), so the survive-reload contract holds.
 *
 *  BOUND, not "unspellable": eviction is tied to OWNER disposal, and `scopedByEntry`
 *  builds a host's owner LAZILY on first activation. So the key is evicted only for a
 *  host activated at least once in the current page session before it leaves the pool.
 *  A host removed COLD — never activated this session (e.g. reload, then ✕ a remote
 *  chip without switching to it) — has no owner to dispose, so keys it wrote in an
 *  EARLIER session are not swept. That residual per-host leak predates this seam (the
 *  old hand-rolled `createHostPrefs` cleanup had the identical coupling); closing it
 *  fully needs eviction at the `hosts.remove` membership seam, independent of owner
 *  lifecycle — tracked as follow-up, not solved here. */
export function perHostPref<T>(
  opts: PerHostPrefOptions<T>,
): [Accessor<T>, Setter<T>] {
  // Enforce the "must be called under a reactive owner" precondition rather than
  // merely documenting it: `onCleanup` outside an owner silently no-ops, which would
  // drop the evict-on-host-exit guarantee this helper exists to centralize — a silent
  // degradation the repo's fail-fast rule forbids. Mirror `scopedByEntry`, which owns
  // the very same per-key roots and throws for the same reason.
  if (!getOwner()) {
    throw new Error(
      "perHostPref must run under a reactive owner — it registers the onCleanup " +
        "that evicts its per-host localStorage key on host-pool exit, and would " +
        "leak that key otherwise. Call it inside a component / createRoot / the " +
        "per-host scopedByEntry owner.",
    );
  }
  const name = perHostName(opts.base, opts.host);
  // ONE storage backend for BOTH the persisted write and the evict-on-exit cleanup.
  // Resolve `?? localStorage` HERE rather than leaving each side to default on its own:
  // otherwise an injected `opts.storage` writes to the fake while cleanup deletes from
  // the global `localStorage`, orphaning the fake's key AND clobbering an unrelated
  // global key of the same name. Binding both to the same object makes that split
  // unspellable.
  const storage = opts.storage ?? localStorage;
  const signal = persistedPref<T>({
    name,
    fallback: opts.fallback,
    parse: opts.parse,
    serialize: opts.serialize,
    // Warn-by-default on corrupt storage, using the composed `name` this layer owns —
    // so no caller recomposes the key just to log it. A caller can override (e.g. a toast).
    onInvalid: opts.onInvalid ?? defaultInvalidWarning(name, opts.fallback),
    storage,
  });
  onCleanup(() => storage.removeItem(name));
  return signal;
}

/** Strict-boolean {@link perHostPref}. Reuses BOTH the one boolean-parse seam
 *  ({@link parseBool}) and the one key-composition/eviction seam, so a per-host
 *  boolean pref re-hand-rolls neither. The default corrupt-value warning comes from
 *  `perHostPref` (which owns the composed key `name`), so this wrapper names only its
 *  base — the `<base>:<host>` suffix is still appended exactly once, in `perHostName`. */
export function perHostBoolPref(opts: {
  host: HostKey;
  base: string;
  fallback: boolean;
}): [Accessor<boolean>, Setter<boolean>] {
  return perHostPref<boolean>({
    host: opts.host,
    base: opts.base,
    fallback: opts.fallback,
    parse: parseBool,
  });
}
