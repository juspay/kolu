/** Client-side visit MRU — "which terminal did the USER just activate?"
 *
 *  A visit is recorded when a terminal becomes the **active tile** — every
 *  landing that moves the selection: a gesture (canvas, dock, palette,
 *  Ctrl+Tab), the boot pick a cold boot lands on, and the survivor the focus
 *  derivation hands the slot to when the active tile exits. Server activity
 *  clocks (agent output, etc.) do not count, and neither does a landing that
 *  RE-STATES the pane already focused.
 *
 *  That last one is a trade, not a free drop. Within one host it changes no
 *  ranking — the tile is already this host's newest stamp — but the trail is
 *  ONE cross-host list and ⌘K's Recent band is fleet-wide, so a stamp that is
 *  not refreshed can be outranked by a tile visited on ANOTHER host in
 *  between: stay on X here, visit Y there, and X ranks below Y though you
 *  never left X. What is bought is the relay: the callers that re-land most
 *  are effect apply arms (the canvas's placement pass, a dock row landing on
 *  the pane it is already on), and a refresh from there is a trail write out
 *  of an effect that had just read the census, which tears every reader of
 *  the trail. The alternative — refreshing from a non-relaying path — buys a
 *  rank nobody asked for at the price of a write per placement pass.
 *
 *  The store holds host+terminal keys and timestamps only; labels are joined
 *  live from the fleet index so nothing denormalizes.
 *
 *  Consumers:
 *  - ⌘K Recent ranks by max(visitedAt, serverActivityAt)
 *  - Ctrl+Tab cycles the active host's slice of this same list
 *
 *  Persistence is device-local (`localStorage` via {@link persistedPref});
 *  visits never leave the browser. */

import {
  isEncodedHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import { Result, Schema } from "effect";
import {
  TerminalIdSchema,
  type TerminalId,
} from "@kolu/terminal-vocab/terminalId";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import {
  defaultInvalidWarning,
  isSaneStamp,
  monotonicStamp,
  parseTolerantList,
  persistedPref,
} from "../persistedPref";

/** Hard cap on the MRU — enough trail for Recent + Ctrl+Tab, bounded storage. */
export const VISIT_MRU_CAP = 50;

/** zod's `safeParse` in Effect terms — a `Result`, so a corrupt persisted row is
 *  a BRANCH (drop the row) rather than a throw at read time. */
const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);

export type VisitEntry = {
  /** Canonical host wire key (`encodeHostKey`). */
  hostKey: string;
  terminalId: TerminalId;
  visitedAt: number;
};

function isVisitEntry(v: unknown, now: number): v is VisitEntry {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.hostKey !== "string" || !isEncodedHostKey(o.hostKey))
    return false;
  if (typeof o.terminalId !== "string") return false;
  if (Result.isFailure(decodeTerminalId(o.terminalId))) return false;
  if (!isSaneStamp(o.visitedAt, now)) return false;
  return true;
}

/**
 * Validate persisted JSON. Well-formed entries are kept; corrupt rows and
 * duplicates are dropped — the shared {@link parseTolerantList} cassette, so the
 * "how a persisted list degrades" policy is spelled once for both trails. Throws
 * only when the top-level value is not an array, so {@link persistedPref} can
 * fall back to [].
 */
export function parseVisitList(
  raw: string,
  now: number = Date.now(),
): VisitEntry[] {
  return parseTolerantList<VisitEntry>(
    raw,
    "visit recency",
    (item) =>
      isVisitEntry(item, now)
        ? {
            hostKey: item.hostKey,
            terminalId: item.terminalId,
            visitedAt: item.visitedAt,
          }
        : undefined,
    (e) => visitLiveKey(e.hostKey, e.terminalId),
    VISIT_MRU_CAP,
  );
}

/** Upsert one visit to the front of the MRU, dedupe by (hostKey, terminalId),
 *  drop this host's `dead` ids, cap length. Timestamps are forced strictly
 *  monotonic so same-ms activations still rank later-before-earlier. Pure —
 *  unit-tested without Solid.
 *
 *  `dead` is the PRUNE, carried by the gesture that writes rather than applied
 *  at the persistence boundary, which cannot know liveness for a host that is
 *  offline and would throw away real history. Without it the 50 slots fill
 *  with killed terminals — each kill leaves the most RECENT entry, which holds
 *  a slot ahead of older live ones — and a browser's long-lived tiles lose
 *  their stamps after about that many open-visit-kill cycles. They read as
 *  never visited then, which is Ctrl+Tab's order, the palette's `rankOf`
 *  tie-break, the no-query Enter target and the Recent band's reserved seat.
 *  Host-scoped, because an id is only dead on the host that lost it. */
export function upsertVisit(
  prev: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
  visitedAt: number,
  dead: readonly TerminalId[] = [],
  cap: number = VISIT_MRU_CAP,
): VisitEntry[] {
  const gone = new Set(dead);
  const rest = prev.filter(
    (e) =>
      e.hostKey !== hostKey ||
      (e.terminalId !== terminalId && !gone.has(e.terminalId)),
  );
  const at = monotonicStamp(rest, visitedAt, (e) => e.visitedAt);
  const next: VisitEntry = { hostKey, terminalId, visitedAt: at };
  return [next, ...rest].slice(0, cap);
}

/** Drop all visits for one host (close-all / host reset). */
export function clearHostVisits(
  prev: readonly VisitEntry[],
  hostKey: string,
): VisitEntry[] {
  return prev.filter((e) => e.hostKey !== hostKey);
}

/** Active-host visit ids (most-recent first) for Ctrl+Tab / WebGL budget. */
export function mruIdsForHost(
  visits: readonly VisitEntry[],
  hostKey: string,
): TerminalId[] {
  return visits.filter((e) => e.hostKey === hostKey).map((e) => e.terminalId);
}

/** Look up a stored visit timestamp (0 if never visited). Trail-only — ranking
 *  policy lives next to the palette. */
export function visitedAtOf(
  visits: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
): number {
  return (
    visits.find((e) => e.hostKey === hostKey && e.terminalId === terminalId)
      ?.visitedAt ?? 0
  );
}

export function visitLiveKey(hostKey: string, terminalId: TerminalId): string {
  return `${hostKey}\0${terminalId}`;
}

const STORAGE_KEY = "kolu-visit-recency";

/** What one activation writes: when it happened, and which of this host's
 *  trailed ids are gone. The caller samples `dead` — it is the only layer
 *  that can ask the live census without subscribing a write verb to it. */
export type NoteVisitOptions = {
  at?: number;
  dead?: readonly TerminalId[];
};

export type VisitRecencyApi = {
  /** The cross-host trail of GESTURES — an activation, and a close-all's
   *  clear. A kill writes nothing of its own: a dead id is dropped where the
   *  trail is READ (`hostScope/createViewState.mruOrder` narrows it to the
   *  host's live census), and PRUNED from storage by the next activation on
   *  that host, which carries the dead ids it saw ({@link upsertVisit}'s
   *  `dead`) — so the {@link VISIT_MRU_CAP} slots hold live history rather
   *  than the last 50 terminals to die. */
  visits: Accessor<VisitEntry[]>;
  noteVisit: (
    host: HostKey,
    terminalId: TerminalId,
    opts?: NoteVisitOptions,
  ) => void;
  clearHost: (host: HostKey) => void;
  mruForHost: (host: HostKey) => TerminalId[];
};

/** App-lifetime visit store. */
export const useVisitRecency = createSharedRoot((): VisitRecencyApi => {
  const [visits, setVisits] = persistedPref<VisitEntry[]>({
    name: STORAGE_KEY,
    fallback: [],
    parse: parseVisitList,
    serialize: (v) => JSON.stringify(v),
    onInvalid: defaultInvalidWarning(STORAGE_KEY, []),
  });

  function noteVisit(
    host: HostKey,
    terminalId: TerminalId,
    opts: NoteVisitOptions = {},
  ): void {
    setVisits((prev) =>
      upsertVisit(
        prev,
        encodeHostKey(host),
        terminalId,
        opts.at ?? Date.now(),
        opts.dead,
      ),
    );
  }

  function clearHost(host: HostKey): void {
    setVisits((prev) => clearHostVisits(prev, encodeHostKey(host)));
  }

  function mruForHost(host: HostKey): TerminalId[] {
    return mruIdsForHost(visits(), encodeHostKey(host));
  }

  return {
    visits,
    noteVisit,
    clearHost,
    mruForHost,
  };
});
