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
  encodeHostKey,
  type HostKey,
  isEncodedHostKey,
} from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";
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

/**
 * Validate persisted JSON. Well-formed entries are kept; corrupt rows and
 * duplicates are dropped (tolerant array read). Throws only when the top-level
 * value is not an array, so {@link persistedPref} can fall back to [].
 */
export function parseVisitList(
  raw: string,
  now: number = Date.now(),
): VisitEntry[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("visit recency: expected a JSON array");
  }
  const seen = new Set<string>();
  const out: VisitEntry[] = [];
  for (const item of data) {
    if (!isVisitEntry(item, now)) continue;
    const key = visitLiveKey(item.hostKey, item.terminalId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      hostKey: item.hostKey,
      terminalId: item.terminalId as TerminalId,
      visitedAt: item.visitedAt,
    });
  }
  return out.slice(0, VISIT_MRU_CAP);
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
 * Seed membership for a host that has no trail yet — Ctrl+Tab order only.
 * Stamps are tiny positive ranks (n … 1), never wall-clock times, so they
 * cannot drown real `noteVisit` stamps or server activity in max() ranking.
 */
export function seedHostVisits(
  hostKey: string,
  liveIds: readonly TerminalId[],
  _now?: number,
): VisitEntry[] {
  const n = liveIds.length;
  return liveIds.map((terminalId, i) => ({
    hostKey,
    terminalId,
    // First live id is most-recent for cycle order; values stay << Date.now().
    visitedAt: n - i,
  }));
}

/**
 * Membership reconcile for a host that already has visits:
 * drop dead, keep survivor timestamps, append missing below oldest survivor.
 */
export function reconcileHostLiveIds(
  hostPrev: readonly VisitEntry[],
  hostKey: string,
  liveIds: readonly TerminalId[],
  now: number,
): VisitEntry[] {
  const liveSet = new Set(liveIds);
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
  // Append below oldest survivor; never go negative (parse rejects < 0).
  const appended: VisitEntry[] = missing.map((terminalId, i) => ({
    hostKey,
    terminalId,
    visitedAt: Math.max(0, minSurvivor - 1 - i),
  }));
  return [...survivors, ...appended];
}

/**
 * Apply live top-level ids for one host: seed if empty, else membership
 * reconcile. Merges with other-host visits, sorts by true recency, caps.
 */
export function applyHostLiveIds(
  prev: readonly VisitEntry[],
  hostKey: string,
  liveIds: readonly TerminalId[],
  now: number,
  cap: number = VISIT_MRU_CAP,
): VisitEntry[] {
  const others = prev.filter((e) => e.hostKey !== hostKey);
  const hostPrev = prev.filter((e) => e.hostKey === hostKey);
  const hostNext =
    hostPrev.length === 0
      ? seedHostVisits(hostKey, liveIds, now)
      : reconcileHostLiveIds(hostPrev, hostKey, liveIds, now);
  return [...hostNext, ...others]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, cap);
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

type VisitRecencyApi = {
  visits: Accessor<VisitEntry[]>;
  noteVisit: (host: HostKey, terminalId: TerminalId, at?: number) => void;
  forgetVisit: (host: HostKey, terminalId: TerminalId) => void;
  clearHost: (host: HostKey) => void;
  /** Seed empty host trail, or reconcile live membership without restamping. */
  applyLiveIds: (host: HostKey, liveIds: readonly TerminalId[]) => void;
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
    setVisits((prev) => upsertVisit(prev, encodeHostKey(host), terminalId, at));
  }

  function forgetVisit(host: HostKey, terminalId: TerminalId): void {
    setVisits((prev) => removeVisit(prev, encodeHostKey(host), terminalId));
  }

  function clearHost(host: HostKey): void {
    setVisits((prev) => clearHostVisits(prev, encodeHostKey(host)));
  }

  function applyLiveIds(host: HostKey, liveIds: readonly TerminalId[]): void {
    setVisits((prev) =>
      applyHostLiveIds(prev, encodeHostKey(host), liveIds, Date.now()),
    );
  }

  function mruForHost(host: HostKey): TerminalId[] {
    return mruIdsForHost(visits(), encodeHostKey(host));
  }

  return {
    visits,
    noteVisit,
    forgetVisit,
    clearHost,
    applyLiveIds,
    mruForHost,
  };
});
