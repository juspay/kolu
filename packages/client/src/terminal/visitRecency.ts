import {
  isEncodedHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import { Result, Schema } from "effect";
import { TerminalIdSchema, type TerminalId } from "kolu-common/surface";
import type { Accessor } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import {
  defaultInvalidWarning,
  isSaneStamp,
  monotonicStamp,
  parseTolerantList,
  persistedPref,
} from "../persistedPref";

export const VISIT_MRU_CAP = 50;

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
  const at = monotonicStamp(rest, visitedAt, (e) => e.visitedAt);
  const next: VisitEntry = { hostKey, terminalId, visitedAt: at };
  return [next, ...rest].slice(0, cap);
}

export function removeVisit(
  prev: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
): VisitEntry[] {
  return prev.filter(
    (e) => !(e.hostKey === hostKey && e.terminalId === terminalId),
  );
}

export function clearHostVisits(
  prev: readonly VisitEntry[],
  hostKey: string,
): VisitEntry[] {
  return prev.filter((e) => e.hostKey !== hostKey);
}

export function seedHostVisits(
  hostKey: string,
  liveIds: readonly TerminalId[],
  _now?: number,
): VisitEntry[] {
  const n = liveIds.length;
  return liveIds.map((terminalId, i) => ({
    hostKey,
    terminalId,
    visitedAt: n - i,
  }));
}

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
  const appended: VisitEntry[] = missing.map((terminalId, i) => ({
    hostKey,
    terminalId,
    visitedAt: Math.max(0, minSurvivor - 1 - i),
  }));
  return [...survivors, ...appended];
}

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

export function mruIdsForHost(
  visits: readonly VisitEntry[],
  hostKey: string,
): TerminalId[] {
  return visits.filter((e) => e.hostKey === hostKey).map((e) => e.terminalId);
}

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
  applyLiveIds: (host: HostKey, liveIds: readonly TerminalId[]) => void;
  mruForHost: (host: HostKey) => TerminalId[];
};

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
