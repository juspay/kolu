/** Client-side host switch trail — "which host did the USER just switch to?"
 *
 *  The host-level twin of {@link ../terminal/visitRecency}: that trail answers
 *  "which TERMINAL did the user just activate?"; this one answers it for
 *  machines, so ⌘⇧H opens HIGHLIGHTED on the host you came from and Enter
 *  toggles back — the same gesture, one kind up. Both feed the ONE selection
 *  policy in `palette/rootIndex.defaultSelectionIndex`.
 *
 *  It decides the HIGHLIGHT, not the order: the Hosts list itself keeps pool
 *  order, because a machine list that reshuffles under the cursor is
 *  unlearnable — the same reason the dock stopped sorting on a clock (#2141).
 *
 *  TRAIL-ONLY, like its sibling: what a host row's stamp *means* to the palette
 *  lives at the call site (`palette/fleetActions`'s `hostVisitedAt`), not behind
 *  this store's socket, which would drag the persistence module along every time
 *  that question moves.
 *
 *  Persistence is per TAB (`sessionStorage`), matching the `activeHost` pref
 *  this trail shadows: two tabs view two different hosts, so a shared trail
 *  would let one tab's switch decide the other tab's toggle target. */

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

/** Hard cap on the trail — a pool is a handful of hosts; this only bounds a
 *  corrupt or long-lived list. */
export const HOST_MRU_CAP = 20;

export type HostVisit = {
  /** Canonical host wire key (`encodeHostKey`). */
  hostKey: string;
  /** Wall clock of the switch, in the SAME unit a terminal visit carries. */
  switchedAt: number;
};

/** Move `hostKey` to the front, deduped and capped, on the shared strictly-
 *  monotonic clock ({@link monotonicStamp}).
 *
 *  Already at the front → returns `prev` UNCHANGED, identity and all. Nothing
 *  about the trail differs, and preserving identity lets Solid's `===` equality
 *  swallow the write: no re-stamp, no re-serialize, no `sessionStorage.setItem`,
 *  no downstream recompute. That case is not hypothetical — it is every page
 *  load (the recording effect runs immediately, on a host already at the head)
 *  and every re-assertion of the host you are already on.
 *
 *  Pure — unit-tested without Solid. */
export function promoteHost(
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

function isHostVisit(v: unknown, now: number): v is HostVisit {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.hostKey !== "string" || !isEncodedHostKey(o.hostKey))
    return false;
  if (!isSaneStamp(o.switchedAt, now)) return false;
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

/** Build one host trail — the trail accessor itself, nothing wrapped around it.
 *  Exported apart from the app-lifetime instance below so a test can stand up a
 *  FRESH trail per case instead of driving (and undoing) a shared singleton. */
export function createHostRecency(): Accessor<readonly HostVisit[]> {
  const [mru, setMru] = persistedPref<readonly HostVisit[]>({
    name: STORAGE_KEY,
    fallback: [],
    parse: parseHostMru,
    serialize: (v) => JSON.stringify(v),
    storage: sessionStorage,
    onInvalid: defaultInvalidWarning(STORAGE_KEY, []),
  });

  // THE host-activation choke point. Every switch path — a palette host row,
  // the selector strip, the mobile chip, a deep link, the membership reconcile's
  // bounce to local — lands on the active-host pref, so OBSERVING it records
  // them all; there is no writer left to remember to instrument. Runs
  // immediately (no `defer`), so the boot host is the trail's first entry.
  //
  // Keyed on `encActiveHost`, not the raw `HostKey` signal: the memo changes
  // when the HOST changes, while the raw signal changes on every WRITE — and
  // the membership reconcile writes a fresh-but-equal `HostKey` object, which
  // is not a switch and must not stamp one.
  createEffect(
    on(encActiveHost, (hostKey) => {
      setMru((prev) => promoteHost(prev, hostKey, Date.now()));
    }),
  );

  return mru;
}

/** App-lifetime host trail. EAGER — a module-scope `createRoot`, exactly like
 *  `wire.encActiveHost` / `wire.groundedActiveHost`, and like `wire.activeHost`
 *  itself (a module-scope `sessionStorage` pref, which is the precedent this
 *  follows). Importing the module IS the start, so no consumer holds a boot
 *  wire: a lazily-built trail would miss every switch made before the first
 *  palette read and land ⌘⇧H on a wrong-but-plausible row, with no error to
 *  notice. */
export const hostRecency: Accessor<readonly HostVisit[]> =
  createRoot(createHostRecency);
