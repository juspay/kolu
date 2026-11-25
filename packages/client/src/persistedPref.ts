/** Validated, persisted preference — per device by default, or per browser tab
 *  when the caller picks `sessionStorage` (see `storage` below) — a thin policy layer over
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

import type { NoFn } from "@kolu/surface/solid";
import {
  makePersisted,
  type PersistenceSyncAPI,
} from "@solid-primitives/storage";
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
   *  fails `parse`. Never a FUNCTION: Solid 2 reads a function handed to
   *  `createSignal` as a derivation rather than a value, so a pref holding one
   *  would silently become a derived signal. A pref is data. {@link NoFn} is
   *  that constraint, defined once in `@kolu/surface/solid`. */
  fallback: NoFn<T>;
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
   *  `dev/skills/kolu-client/SKILL.md`. */
  onInvalid?: (err: unknown, raw: string) => void;
  /** Storage backend — a first-class DURABILITY choice, not just a test seam:
   *  `localStorage` (device-wide, the default via `makePersisted`) or
   *  `sessionStorage` for a fact that is per BROWSER TAB and must not be
   *  decided by another tab (the `activeHost` pref and the host-switch trail
   *  that shadows it). Tests also inject a synchronous in-memory fake. */
  storage?: Storage;
  /** Follow writes other pages make to the same key — {@link originStorageSync}
   *  for `localStorage`. Without it the value is read once, at load, and a
   *  page's next write puts back whatever it read then. For a value several
   *  pages change, where a write must not undo another page's. */
  sync?: PersistenceSyncAPI;
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

/** The {@link PersistedPrefOptions.sync} for a `localStorage` value every page
 *  of this ORIGIN shares: the browser's `storage` event, handed on without
 *  the writer's address. `makePersisted` drops a sync event whose `url` is not
 *  this page's own address (`@solid-primitives/storage`'s sync handler
 *  compares `data.url` with `location.href`), and `storageSync` hands the
 *  event on as it is, so a page opened from a kolu link, which keeps the link
 *  (`#/…`) in its address bar, never heard the other pages, nor they it.
 *  `localStorage` is one store per origin, and the address a page shows does
 *  not change what it reads.
 *
 *  WHY THIS STEPS AROUND THE LIBRARY instead of fixing it there: no released
 *  version removes that check (every release through 5.0.0 carries it). Kept
 *  here by decision until a release drops it.
 *
 *  The subscribe half returns its unsubscribe, which `makePersisted` calls from
 *  the disposer it hands back (see {@link persistedPref}). */
export const originStorageSync: PersistenceSyncAPI = [
  (subscriber) => {
    const onStorage = (event: StorageEvent) => {
      // `key` is null only for `localStorage.clear()`, which names no value.
      if (event.key === null) return;
      subscriber({
        key: event.key,
        newValue: event.newValue,
        timeStamp: event.timeStamp,
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
  // The browser announces a write to the other pages itself.
  () => {},
];

/** What a persisted pref hands back: `createSignal`'s `[Accessor, Setter]`, and
 *  `loaded` — the value the stored string parsed to at construction (the
 *  fallback when nothing valid was stored). The accessor reads the fallback
 *  until `makePersisted`'s hydration write lands on the next flush, so a caller
 *  that needs the stored value DURING construction takes `loaded`. */
export type PersistedPref<T> = [value: Accessor<T>, set: Setter<T>, loaded: T];

/** Build a persisted signal whose stored value is validated on every read.
 *  Returns a {@link PersistedPref}.
 *
 *  `makePersisted` also returns the raw stored string it read at creation and a
 *  disposer, which stops the sync subscription and any pending hydration read.
 *  Under a reactive owner the disposer runs with that owner; a pref built at
 *  module scope has no owner and lives as long as the page, so there is
 *  nothing to dispose.
 *
 *  `ownedWrite` — an INTERNAL signal that intentionally accepts a write from
 *  the scope that creates it: `makePersisted` hydrates by calling this setter
 *  synchronously while it builds the pref, and most prefs are built inside an
 *  owner (a `createRoot`, a component or hook body). Without it that hydration
 *  write is a write in an owned scope, which `makePersisted` swallows — the
 *  stored value would be silently dropped for the fallback in dev while
 *  production kept it. Nothing outside this module can reach the signal to
 *  write it from an owned scope for any other reason.
 *
 *  The fix is merged upstream (solidjs-community/solid-primitives#1137,
 *  `9c935afb`: `makePersisted` restores the stored value outside the creating
 *  owner) and ships in `@solid-primitives/storage@5.0.1`. Bumping to it
 *  deletes `{ ownedWrite: true }` below, this paragraph and the one above it,
 *  and the comment at the call. */
export function persistedPref<T>(
  opts: PersistedPrefOptions<T>,
): PersistedPref<T> {
  const serialize = opts.serialize ?? defaultSerialize;
  // What the stored string parsed to at construction, captured from the ONE
  // `deserialize` call `makePersisted` makes while it hydrates — not a second
  // read of the storage, which would run `parse` (and `onInvalid`) again over
  // the same raw string. Later calls are other pages' sync events and must
  // not overwrite it. The signal itself answers the fallback until the
  // hydration write lands on the next flush, so a caller that needs the
  // loaded value DURING construction takes it from here.
  let loaded: T | undefined;
  const [value, setValue, , dispose] = makePersisted(
    // `ownedWrite`: see the header — deleted with the bump to
    // `@solid-primitives/storage@5.0.1`.
    createSignal<T>(opts.fallback, { ownedWrite: true }),
    {
      name: opts.name,
      storage: opts.storage,
      serialize,
      deserialize: (raw: string): T => {
        const parsed = readWithFallback(
          raw,
          opts.parse,
          opts.fallback,
          opts.onInvalid,
        );
        loaded ??= parsed;
        return parsed;
      },
      sync: opts.sync,
    },
  );
  if (getOwner()) onCleanup(dispose);
  return [value, setValue, loaded ?? opts.fallback];
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

/** The tolerant-array `parse` every persisted LIST pref shares — the list twin of
 *  {@link parseBool}. Throws only when the stored value is not an array (so the
 *  caller's `fallback` takes over wholesale); a corrupt or duplicate ENTRY is a
 *  branch, not a throw, so one bad row never costs the user the whole trail.
 *  Spelled once here so `visitRecency` and `hostRecency` reuse it instead of
 *  re-hand-rolling the parse (the {@link parseBool} precedent). */
export function parseTolerantList<T>(
  raw: string,
  what: string,
  accept: (item: unknown) => T | undefined,
  identity: (item: T) => string,
  cap: number,
): T[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error(`${what}: expected a JSON array`);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of data) {
    const ok = accept(item);
    if (ok === undefined) continue;
    const id = identity(ok);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(ok);
  }
  return out.slice(0, cap);
}

/** How far past `now` a persisted stamp may sit before it reads as corruption
 *  rather than clock skew. Spelled once because BOTH recency trails' stamps end
 *  up in the same comparison (a palette row's `visitedAt`): two copies of this
 *  window is exactly how that one number space silently forks. */
const MAX_STAMP_SKEW_MS = 365 * 24 * 60 * 60 * 1000;

/** Whether a persisted timestamp is plausible — finite, not pre-epoch, and not
 *  so far in the future it would dominate a recency ranking forever. The
 *  accept-window every persisted TRAIL shares (`visitRecency`, `hostRecency`),
 *  beside {@link parseTolerantList}, which owns the loop around it. */
export function isSaneStamp(v: unknown, now: number): v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return v >= 0 && v <= now + MAX_STAMP_SKEW_MS;
}

/** The next strictly-monotonic stamp for a trail: `at`, unless some surviving
 *  entry already carries that instant or later, in which case one past the
 *  newest of them. Keeps same-millisecond events ordered later-before-earlier,
 *  which is the tie-break both trails rely on. `rest` is the trail MINUS the
 *  entry being (re)stamped; `stampOf` reads each entry's clock.
 *
 *  Shared because the two trails' stamps meet in one `visitedAt` comparison — a
 *  tie-break rule maintained in two places is one that can quietly disagree. */
export function monotonicStamp<T>(
  rest: readonly T[],
  at: number,
  stampOf: (entry: T) => number,
): number {
  const newest = rest.reduce(
    (m, e) => Math.max(m, stampOf(e)),
    Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(newest) && at <= newest ? newest + 1 : at;
}

/** The default `onInvalid` a {@link perHostPref} or {@link boolPref} installs when
 *  the caller supplies none — and the one a trail pref (`visitRecency`,
 *  `hostRecency`) passes explicitly rather than hand-rolling a fourth copy of the
 *  same message: a `console.warn` naming the offending key and the
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
export function defaultInvalidWarning<T>(
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
}): PersistedPref<boolean> {
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
export function perHostPref<T>(opts: PerHostPrefOptions<T>): PersistedPref<T> {
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
}): PersistedPref<boolean> {
  return perHostPref<boolean>({
    host: opts.host,
    base: opts.base,
    fallback: opts.fallback,
    parse: parseBool,
  });
}
