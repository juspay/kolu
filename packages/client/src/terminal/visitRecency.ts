/** Client-side visit MRU — "which terminal did the USER just activate?"
 *
 *  A visit is only recorded when a terminal becomes the **active tile**.
 *  Server activity clocks (agent output, etc.) do not count. The store holds
 *  host+terminal keys and timestamps only; labels are joined live from the
 *  fleet index so nothing denormalizes.
 *
 *  Consumers:
 *  - ⌘K Recent ranks by max(visitedAt, serverActivityAt)
 *  - Ctrl+Tab cycles the active host's slice of this same list
 *
 *  Persistence is device-local (`localStorage` via {@link persistedPref});
 *  visits never leave the browser. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { persistedPref } from "../persistedPref";

/** Hard cap on the MRU — enough trail for Recent + Ctrl+Tab, bounded storage. */
export const VISIT_MRU_CAP = 50;

export type VisitEntry = {
  /** Canonical host wire key (`encodeHostKey`). */
  hostKey: string;
  terminalId: TerminalId;
  visitedAt: number;
};

function isVisitEntry(v: unknown): v is VisitEntry {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.hostKey === "string" &&
    o.hostKey.length > 0 &&
    typeof o.terminalId === "string" &&
    o.terminalId.length > 0 &&
    typeof o.visitedAt === "number" &&
    Number.isFinite(o.visitedAt)
  );
}

/** Validate persisted JSON — throws so {@link persistedPref} falls back to []. */
export function parseVisitList(raw: string): VisitEntry[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("visit recency: expected a JSON array");
  }
  for (const item of data) {
    if (!isVisitEntry(item)) {
      throw new Error("visit recency: invalid entry shape");
    }
  }
  return data as VisitEntry[];
}

/** Upsert one visit to the front of the MRU, dedupe by (hostKey, terminalId),
 *  cap length. Pure — unit-tested without Solid. */
export function upsertVisit(
  prev: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
  visitedAt: number,
  cap: number = VISIT_MRU_CAP,
): VisitEntry[] {
  const next: VisitEntry = { hostKey, terminalId, visitedAt };
  const rest = prev.filter(
    (e) => !(e.hostKey === hostKey && e.terminalId === terminalId),
  );
  return [next, ...rest].slice(0, cap);
}

/** Remove every entry for a terminal id on a host (tile kill). */
export function removeVisit(
  prev: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
): VisitEntry[] {
  return prev.filter(
    (e) => !(e.hostKey === hostKey && e.terminalId === terminalId),
  );
}

/** Drop all visits for one host (close-all / host reset). */
export function clearHostVisits(
  prev: readonly VisitEntry[],
  hostKey: string,
): VisitEntry[] {
  return prev.filter((e) => e.hostKey !== hostKey);
}

/** Replace a host's visit order with `ids` (most-recent first). Other hosts'
 *  visits are preserved. Used by session restore to seed the trail. */
export function replaceHostVisitOrder(
  prev: readonly VisitEntry[],
  hostKey: string,
  ids: readonly TerminalId[],
  now: number,
  cap: number = VISIT_MRU_CAP,
): VisitEntry[] {
  const others = prev.filter((e) => e.hostKey !== hostKey);
  // Most-recent first: assign decreasing timestamps so order is stable.
  const seeded: VisitEntry[] = ids.map((terminalId, i) => ({
    hostKey,
    terminalId,
    visitedAt: now - i,
  }));
  return [...seeded, ...others].slice(0, cap);
}

/** Active-host MRU ids (most-recent first) for Ctrl+Tab / WebGL budget. */
export function mruIdsForHost(
  visits: readonly VisitEntry[],
  hostKey: string,
): TerminalId[] {
  return visits.filter((e) => e.hostKey === hostKey).map((e) => e.terminalId);
}

/** Rank score for a live fleet row: max(client visit, server activity). */
export function visitRankScore(
  visits: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
  serverActivityAt: number | null | undefined,
): number {
  const visit = visits.find(
    (e) => e.hostKey === hostKey && e.terminalId === terminalId,
  );
  const visitedAt = visit?.visitedAt ?? 0;
  const activity = serverActivityAt ?? 0;
  return Math.max(visitedAt, activity);
}

/** Join visits to a live fleet id set — drop entries whose host/terminal is
 *  not currently present (disconnected host, killed tile). Pure. */
export function joinVisitsToLive(
  visits: readonly VisitEntry[],
  liveKeys: ReadonlySet<string>,
): VisitEntry[] {
  return visits.filter((e) =>
    liveKeys.has(visitLiveKey(e.hostKey, e.terminalId)),
  );
}

export function visitLiveKey(hostKey: string, terminalId: TerminalId): string {
  return `${hostKey}\0${terminalId}`;
}

export function encodeVisitHost(host: HostKey): string {
  return encodeHostKey(host);
}

const STORAGE_KEY = "kolu-visit-recency";

type VisitRecencyApi = {
  visits: Accessor<VisitEntry[]>;
  noteVisit: (host: HostKey, terminalId: TerminalId, at?: number) => void;
  forgetVisit: (host: HostKey, terminalId: TerminalId) => void;
  clearHost: (host: HostKey) => void;
  replaceHostOrder: (host: HostKey, ids: readonly TerminalId[]) => void;
  mruForHost: (host: HostKey) => TerminalId[];
};

/** App-lifetime visit store. */
export const useVisitRecency = createSharedRoot((): VisitRecencyApi => {
  const [visits, setVisits] = persistedPref<VisitEntry[]>({
    name: STORAGE_KEY,
    fallback: [],
    parse: parseVisitList,
    serialize: (v) => JSON.stringify(v),
    onInvalid: (err, raw) =>
      console.warn(
        `[visitRecency] ignoring invalid stored value: ${JSON.stringify(raw).slice(0, 200)} — falling back to []`,
        err,
      ),
  });

  function noteVisit(
    host: HostKey,
    terminalId: TerminalId,
    at: number = Date.now(),
  ): void {
    setVisits((prev) =>
      upsertVisit(prev, encodeVisitHost(host), terminalId, at),
    );
  }

  function forgetVisit(host: HostKey, terminalId: TerminalId): void {
    setVisits((prev) => removeVisit(prev, encodeVisitHost(host), terminalId));
  }

  function clearHost(host: HostKey): void {
    setVisits((prev) => clearHostVisits(prev, encodeVisitHost(host)));
  }

  function replaceHostOrder(host: HostKey, ids: readonly TerminalId[]): void {
    setVisits((prev) =>
      replaceHostVisitOrder(prev, encodeVisitHost(host), ids, Date.now()),
    );
  }

  function mruForHost(host: HostKey): TerminalId[] {
    return mruIdsForHost(visits(), encodeVisitHost(host));
  }

  return {
    visits,
    noteVisit,
    forgetVisit,
    clearHost,
    replaceHostOrder,
    mruForHost,
  };
});

/** Reactive visit list for callers that only need to read (palette rank). */
export function visitList(): VisitEntry[] {
  return useVisitRecency().visits();
}
