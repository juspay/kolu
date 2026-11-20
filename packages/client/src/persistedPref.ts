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
  name: string;
  fallback: T;
  parse: (raw: string) => T;
  serialize?: (value: T) => string;
  onInvalid?: (err: unknown, raw: string) => void;
  storage?: Storage;
}

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

function defaultSerialize<T>(value: T): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function persistedPref<T>(
  opts: PersistedPrefOptions<T>,
): [Accessor<T>, Setter<T>] {
  const serialize = opts.serialize ?? defaultSerialize;
  const [value, setValue] = makePersisted(createSignal<T>(opts.fallback), {
    name: opts.name,
    storage: opts.storage,
    serialize,
    deserialize: (raw: string): T =>
      readWithFallback(raw, opts.parse, opts.fallback, opts.onInvalid),
  });
  return [value, setValue];
}

const boolCodec = {
  parse: (raw: string): boolean => {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`expected boolean pref "true"/"false", got: ${raw}`);
  },
  serialize: (value: boolean): string => (value ? "true" : "false"),
};

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

const MAX_STAMP_SKEW_MS = 365 * 24 * 60 * 60 * 1000;

export function isSaneStamp(v: unknown, now: number): v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  return v >= 0 && v <= now + MAX_STAMP_SKEW_MS;
}

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

export function boolPref(opts: {
  name: string;
  fallback: boolean;
  onInvalid?: (err: unknown, raw: string) => void;
}): [Accessor<boolean>, Setter<boolean>] {
  return persistedPref<boolean>({
    name: opts.name,
    fallback: opts.fallback,
    ...boolCodec,
    onInvalid:
      opts.onInvalid ?? defaultInvalidWarning(opts.name, opts.fallback),
  });
}

export function perHostName(base: string, host: HostKey): string {
  return `${base}:${encodeHostKey(host)}`;
}

export interface PerHostPrefOptions<T>
  extends Omit<PersistedPrefOptions<T>, "name"> {
  host: HostKey;
  base: string;
}

export function perHostPref<T>(
  opts: PerHostPrefOptions<T>,
): [Accessor<T>, Setter<T>] {
  if (!getOwner()) {
    throw new Error(
      "perHostPref must run under a reactive owner — it registers the onCleanup " +
        "that evicts its per-host localStorage key on host-pool exit, and would " +
        "leak that key otherwise. Call it inside a component / createRoot / the " +
        "per-host scopedByEntry owner.",
    );
  }
  const name = perHostName(opts.base, opts.host);
  const storage = opts.storage ?? localStorage;
  const signal = persistedPref<T>({
    name,
    fallback: opts.fallback,
    parse: opts.parse,
    serialize: opts.serialize,
    onInvalid: opts.onInvalid ?? defaultInvalidWarning(name, opts.fallback),
    storage,
  });
  onCleanup(() => storage.removeItem(name));
  return signal;
}

export function perHostBoolPref(opts: {
  host: HostKey;
  base: string;
  fallback: boolean;
}): [Accessor<boolean>, Setter<boolean>] {
  return perHostPref<boolean>({
    host: opts.host,
    base: opts.base,
    fallback: opts.fallback,
    ...boolCodec,
  });
}
