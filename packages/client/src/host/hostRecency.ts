import { isEncodedHostKey } from "kolu-common/hostKey";
import { type Accessor, createEffect, createRoot, on } from "solid-js";
import {
  defaultInvalidWarning,
  isSaneStamp,
  monotonicStamp,
  parseTolerantList,
  persistedPref,
} from "../persistedPref";
import { encActiveHost } from "../wire";

export const HOST_MRU_CAP = 20;

export type HostVisit = {
  hostKey: string;
  switchedAt: number;
};

export function promoteHostOrSame(
  prev: readonly HostVisit[],
  hostKey: string,
  at: number,
  cap: number = HOST_MRU_CAP,
): readonly HostVisit[] {
  if (prev[0]?.hostKey === hostKey) return prev;
  const rest = prev.filter((e) => e.hostKey !== hostKey);
  const switchedAt = monotonicStamp(rest, at, (e) => e.switchedAt);
  return [{ hostKey, switchedAt }, ...rest].slice(0, cap);
}

export function switchedAtOf(
  mru: readonly HostVisit[],
  hostKey: string,
): number {
  return mru.find((e) => e.hostKey === hostKey)?.switchedAt ?? 0;
}

function isHostVisit(v: unknown, now: number): v is HostVisit {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.hostKey !== "string" || !isEncodedHostKey(o.hostKey))
    return false;
  if (!isSaneStamp(o.switchedAt, now)) return false;
  return true;
}

export function parseHostMru(
  raw: string,
  now: number = Date.now(),
): HostVisit[] {
  return parseTolerantList<HostVisit>(
    raw,
    "host recency",
    (item) =>
      isHostVisit(item, now)
        ? { hostKey: item.hostKey, switchedAt: item.switchedAt }
        : undefined,
    (e) => e.hostKey,
    HOST_MRU_CAP,
  );
}

const STORAGE_KEY = "kolu-host-recency";

export function createHostRecency(): Accessor<readonly HostVisit[]> {
  const [mru, setMru] = persistedPref<readonly HostVisit[]>({
    name: STORAGE_KEY,
    fallback: [],
    parse: parseHostMru,
    serialize: (v) => JSON.stringify(v),
    storage: sessionStorage,
    onInvalid: defaultInvalidWarning(STORAGE_KEY, []),
  });

  createEffect(
    on(encActiveHost, (hostKey) => {
      setMru((prev) => promoteHostOrSame(prev, hostKey, Date.now()));
    }),
  );

  return mru;
}

export const hostRecency: Accessor<readonly HostVisit[]> =
  createRoot(createHostRecency);
