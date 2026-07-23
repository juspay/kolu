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

import {
  isEncodedHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import { TerminalIdSchema, type TerminalId } from "kolu-common/surface";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { persistedPref } from "../persistedPref";

/** Hard cap on the MRU — enough trail for Recent + Ctrl+Tab, bounded storage. */
export const VISIT_MRU_CAP = 50;

/** Reject timestamps that would dominate ranking forever or predate the epoch. */
const MIN_VISITED_AT = 0;
/** 1 year past now at parse time — clock skew / corruption guard. */
function maxAllowedVisitedAt(now: number = Date.now()): number {
  return now + 365 * 24 * 60 * 60 * 1000;
}

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
  const id = TerminalIdSchema.safeParse(o.terminalId);
  if (!id.success) return false;
  if (typeof o.visitedAt !== "number" || !Number.isFinite(o.visitedAt))
    return false;
  if (o.visitedAt < MIN_VISITED_AT || o.visitedAt > maxAllowedVisitedAt(now))
    return false;
  return true;
}

/** Validate persisted JSON — throws so {@link persistedPref} falls back to []. */
export function parseVisitList(
  raw: string,
  now: number = Date.now(),
): VisitEntry[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("visit recency: expected a JSON array");
  }
  if (data.length > VISIT_MRU_CAP) {
    throw new Error(`visit recency: exceeds cap ${VISIT_MRU_CAP}`);
  }
  const seen = new Set<string>();
  const out: VisitEntry[] = [];
  for (const item of data) {
    if (!isVisitEntry(item, now)) {
      throw new Error("visit recency: invalid entry shape");
    }
    const key = visitLiveKey(item.hostKey, item.terminalId);
    if (seen.has(key)) {
      throw new Error("visit recency: duplicate host+terminal key");
    }
    seen.add(key);
    out.push({
      hostKey: item.hostKey,
      terminalId: item.terminalId as TerminalId,
      visitedAt: item.visitedAt,
    });
  }
  return out;
}

/** Upsert one visit to the front of the MRU, dedupe by (hostKey, terminalId),
 *  cap length. Timestamps are forced strictly monotonic so same-ms activations
 *  still rank later-before-earlier. Pure — unit-tested without Solid. */
export function upsertVisit(
  prev: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
  visitedAt: number,
  cap: number = VISIT_MRU_CAP,
): VisitEntry[] {
  const rest = prev.filter(
    (e) => !(e.hostKey === hostKey && e.terminalId === terminalId),
  );
  const maxOther = rest.reduce(
    (m, e) => Math.max(m, e.visitedAt),
    Number.NEGATIVE_INFINITY,
  );
  const at =
    Number.isFinite(maxOther) && visitedAt <= maxOther
      ? maxOther + 1
      : visitedAt;
  const next: VisitEntry = { hostKey, terminalId, visitedAt: at };
  return [next, ...rest].slice(0, cap);
}

/** Remove every entry for a terminal id on a host (tile kill). Does not
 *  restamp survivors. */
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

/**
 * Reconcile one host's trail against live top-level ids:
 * - drop ids no longer live
 * - keep existing `visitedAt` for survivors (no restamp)
 * - append missing live ids with timestamps below all survivors
 *
 * When the host slice is empty, seeds `ids` most-recent-first (restore /
 * first paint). The global list is then ordered by true visit recency and
 * capped — newer other-host visits always outrank older local filler rows.
 */
export function reconcileHostLiveIds(
  prev: readonly VisitEntry[],
  hostKey: string,
  liveIds: readonly TerminalId[],
  now: number,
  cap: number = VISIT_MRU_CAP,
): VisitEntry[] {
  const others = prev.filter((e) => e.hostKey !== hostKey);
  const hostPrev = prev.filter((e) => e.hostKey === hostKey);
  const liveSet = new Set(liveIds);

  let hostNext: VisitEntry[];
  if (hostPrev.length === 0) {
    // Empty host trail — seed only. Decreasing timestamps, most-recent first.
    hostNext = liveIds.map((terminalId, i) => ({
      hostKey,
      terminalId,
      visitedAt: now - i,
    }));
  } else {
    // Preserve timestamps for survivors; drop dead; append missing below oldest.
    const survivors = hostPrev.filter((e) => liveSet.has(e.terminalId));
    const survivorIds = new Set(survivors.map((e) => e.terminalId));
    const missing = liveIds.filter((id) => !survivorIds.has(id));
    const minSurvivor =
      survivors.length === 0
        ? now
        : survivors.reduce(
            (m, e) => Math.min(m, e.visitedAt),
            survivors[0]!.visitedAt,
          );
    const appended: VisitEntry[] = missing.map((terminalId, i) => ({
      hostKey,
      terminalId,
      visitedAt: minSurvivor - 1 - i,
    }));
    hostNext = [...survivors, ...appended];
  }

  return [...hostNext, ...others]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, cap);
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
  /** Seed empty host trail, or reconcile live ids without restamping survivors. */
  reconcileHost: (host: HostKey, liveIds: readonly TerminalId[]) => void;
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

  function reconcileHost(host: HostKey, liveIds: readonly TerminalId[]): void {
    setVisits((prev) =>
      reconcileHostLiveIds(prev, encodeVisitHost(host), liveIds, Date.now()),
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
    reconcileHost,
    mruForHost,
  };
});

/** Reactive visit list for callers that only need to read (palette rank). */
export function visitList(): VisitEntry[] {
  return useVisitRecency().visits();
}
