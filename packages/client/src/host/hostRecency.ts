/** Client-side host visit MRU — "which host did the USER just switch to?"
 *
 *  The host-level twin of {@link ../terminal/visitRecency}: that trail answers
 *  "which TERMINAL did the user just activate?" and ranks ⌘K's Recent band;
 *  this one ranks the host rows, so ⌘⇧H lands on the host you came from and
 *  Enter toggles back — the same gesture, one kind up. Both feed the ONE
 *  selection policy in `palette/rootIndex.defaultSelectionIndex`.
 *
 *  Order is all this trail carries — no timestamps. A terminal row's rank is
 *  `max(visit, server activity)`, so it needs a real clock; a host is never
 *  "recently active" on the server's behalf, only recently *chosen*, so the
 *  position in the list IS the fact.
 *
 *  Persistence is per TAB (`sessionStorage`), matching the `activeHost` pref
 *  this trail shadows: two tabs view two different hosts, so a shared trail
 *  would let one tab's switch decide the other tab's toggle target. */

import {
  encodeHostKey,
  type HostKey,
  isEncodedHostKey,
} from "kolu-common/hostKey";
import { type Accessor, createEffect, on } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { persistedPref } from "../persistedPref";
import { activeHost } from "../wire";

/** Hard cap on the trail — a pool is a handful of hosts; this only bounds a
 *  corrupt or long-lived list. */
export const HOST_MRU_CAP = 20;

/** Move `hostKey` to the front, deduped and capped. Pure — unit-tested
 *  without Solid. */
export function promoteHost(
  prev: readonly string[],
  hostKey: string,
  cap: number = HOST_MRU_CAP,
): string[] {
  return [hostKey, ...prev.filter((k) => k !== hostKey)].slice(0, cap);
}

/** Rank of a host in the trail — higher = more recently switched to, 0 when
 *  the trail has never seen it. Small positive ints (n … 1), like
 *  `visitRecency.seedHostVisits`' stamps: they are compared only against other
 *  HOST rows (see `defaultSelectionIndex`), never against a terminal row's
 *  wall-clock rank. */
export function hostVisitRank(mru: readonly string[], hostKey: string): number {
  const i = mru.indexOf(hostKey);
  return i === -1 ? 0 : mru.length - i;
}

/** Validate the persisted JSON. Well-formed keys are kept; corrupt entries and
 *  duplicates are dropped (tolerant array read, same shape as
 *  `parseVisitList`). Throws only when the top-level value is not an array, so
 *  {@link persistedPref} can fall back to []. */
export function parseHostMru(raw: string): string[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("host recency: expected a JSON array");
  }
  const out: string[] = [];
  for (const item of data) {
    if (typeof item !== "string" || !isEncodedHostKey(item)) continue;
    if (out.includes(item)) continue;
    out.push(item);
  }
  return out.slice(0, HOST_MRU_CAP);
}

const STORAGE_KEY = "kolu-host-recency";

export type HostRecencyApi = {
  /** The trail, most-recently-switched-to first (canonical wire keys). */
  mru: Accessor<string[]>;
  /** This host's {@link hostVisitRank} against the live trail. */
  rankOf: (host: HostKey) => number;
};

/** App-lifetime host trail. */
export const useHostRecency = createSharedRoot((): HostRecencyApi => {
  const [mru, setMru] = persistedPref<string[]>({
    name: STORAGE_KEY,
    fallback: [],
    parse: parseHostMru,
    serialize: (v) => JSON.stringify(v),
    storage: sessionStorage,
    onInvalid: (err, raw) =>
      console.warn(
        `[hostRecency] ignoring invalid stored value: ${JSON.stringify(raw).slice(0, 200)} — falling back to []`,
        err,
      ),
  });

  // THE host-activation choke point. Every switch path — a palette host row,
  // the selector strip, the mobile chip, the membership reconcile's bounce to
  // local — lands on `activeHost`, so OBSERVING it records them all; there is
  // no writer left to remember to instrument. Runs immediately (no `defer`), so
  // the boot host is the trail's first entry.
  createEffect(
    on(activeHost, (host) => {
      setMru((prev) => promoteHost(prev, encodeHostKey(host)));
    }),
  );

  return {
    mru,
    rankOf: (host) => hostVisitRank(mru(), encodeHostKey(host)),
  };
});
