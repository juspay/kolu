/** Client-side host switch trail — "which host did the USER just switch to?"
 *
 *  The host-level twin of {@link ../terminal/visitRecency}: that trail answers
 *  "which TERMINAL did the user just activate?" and ranks ⌘K's Recent band;
 *  this one ranks the host rows, so ⌘⇧H lands on the host you came from and
 *  Enter toggles back — the same gesture, one kind up. Both feed the ONE
 *  selection policy in `palette/rootIndex.defaultSelectionIndex`.
 *
 *  TRAIL-ONLY, like its sibling: what a host row's rank *means* to the palette
 *  is a ranking policy, and it lives at the call site (`palette/fleetActions`'s
 *  `hostRankScore`, beside `terminalRankScore`) — not behind this store's
 *  socket, which would drag the persistence module along every time the ranking
 *  question moves.
 *
 *  Entries carry a WALL CLOCK (`switchedAt`), forced strictly monotonic exactly
 *  as `visitRecency.upsertVisit` does. One unit across both trails means a
 *  palette row's `rankAt` is always milliseconds, whatever kind produced it —
 *  no prose invariant standing between two incomparable number spaces.
 *
 *  Persistence is per TAB (`sessionStorage`), matching the `activeHost` pref
 *  this trail shadows: two tabs view two different hosts, so a shared trail
 *  would let one tab's switch decide the other tab's toggle target. */

import { encodeHostKey, isEncodedHostKey } from "kolu-common/hostKey";
import { type Accessor, createEffect, createRoot, on } from "solid-js";
import {
  defaultInvalidWarning,
  parseTolerantList,
  persistedPref,
} from "../persistedPref";
import { activeHost } from "../wire";

/** Hard cap on the trail — a pool is a handful of hosts; this only bounds a
 *  corrupt or long-lived list. */
export const HOST_MRU_CAP = 20;

export type HostVisit = {
  /** Canonical host wire key (`encodeHostKey`). */
  hostKey: string;
  /** Wall clock of the switch, in the SAME unit a terminal visit carries. */
  switchedAt: number;
};

/** Move `hostKey` to the front, deduped and capped. Stamps are forced strictly
 *  monotonic (mirroring `visitRecency.upsertVisit`) so same-ms switches still
 *  rank later-before-earlier. Pure — unit-tested without Solid. */
export function promoteHost(
  prev: readonly HostVisit[],
  hostKey: string,
  at: number,
  cap: number = HOST_MRU_CAP,
): HostVisit[] {
  const rest = prev.filter((e) => e.hostKey !== hostKey);
  const maxOther = rest.reduce(
    (m, e) => Math.max(m, e.switchedAt),
    Number.NEGATIVE_INFINITY,
  );
  const switchedAt =
    Number.isFinite(maxOther) && at <= maxOther ? maxOther + 1 : at;
  return [{ hostKey, switchedAt }, ...rest].slice(0, cap);
}

/** Reject stamps that would dominate ranking forever or predate the epoch. */
const MIN_SWITCHED_AT = 0;
/** 1 year past now at parse time — clock skew / corruption guard. */
function maxAllowedSwitchedAt(now: number): number {
  return now + 365 * 24 * 60 * 60 * 1000;
}

function isHostVisit(v: unknown, now: number): v is HostVisit {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.hostKey !== "string" || !isEncodedHostKey(o.hostKey))
    return false;
  if (typeof o.switchedAt !== "number" || !Number.isFinite(o.switchedAt))
    return false;
  if (
    o.switchedAt < MIN_SWITCHED_AT ||
    o.switchedAt > maxAllowedSwitchedAt(now)
  )
    return false;
  return true;
}

/** Validate the persisted JSON. Well-formed entries are kept; corrupt entries
 *  and duplicates are dropped — the shared {@link parseTolerantList} cassette,
 *  so both trails degrade the same way. Throws only when the top-level value is
 *  not an array, so {@link persistedPref} can fall back to []. */
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

export type HostRecencyApi = {
  /** The trail, most-recently-switched-to first (canonical wire keys). */
  mru: Accessor<HostVisit[]>;
};

/** Build one host trail. Exported apart from the app-lifetime instance below so
 *  a test can stand up a FRESH trail per case instead of driving (and undoing)
 *  a shared module singleton. */
export function createHostRecency(): HostRecencyApi {
  const [mru, setMru] = persistedPref<HostVisit[]>({
    name: STORAGE_KEY,
    fallback: [],
    parse: parseHostMru,
    serialize: (v) => JSON.stringify(v),
    storage: sessionStorage,
    onInvalid: defaultInvalidWarning(STORAGE_KEY, []),
  });

  // THE host-activation choke point. Every switch path — a palette host row,
  // the selector strip, the mobile chip, the membership reconcile's bounce to
  // local — lands on `activeHost`, so OBSERVING it records them all; there is
  // no writer left to remember to instrument. Runs immediately (no `defer`), so
  // the boot host is the trail's first entry.
  createEffect(
    on(activeHost, (host) => {
      setMru((prev) => promoteHost(prev, encodeHostKey(host), Date.now()));
    }),
  );

  return { mru };
}

/** App-lifetime host trail. EAGER — a module-scope `createRoot`, exactly like
 *  `wire.encActiveHost` / `wire.groundedActiveHost`, and like `wire.activeHost`
 *  itself (a module-scope `sessionStorage` pref, which is the precedent this
 *  follows). Importing the module IS the start, so no consumer holds a boot
 *  wire: a lazily-built trail would miss every switch made before the first
 *  palette read and land ⌘⇧H on a wrong-but-plausible row, with no error to
 *  notice. */
export const hostRecency: HostRecencyApi = createRoot(createHostRecency);
