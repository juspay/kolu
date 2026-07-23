/** Fleet-wide terminal index for the unified switcher.
 *
 *  The Dock is active-host only. The switcher must also find terminals on
 *  other connected hosts in the padi pool. For every membership host that is
 *  `connected`, this module opens that host's `terminals.keys` stream + the
 *  composed terminals collection (same shape as `createHostWire`) and flattens
 *  them into ranked rows carrying the host key.
 *
 *  Entry source matches the Dock: only top-level tiles (`!parentId`) — split
 *  children ride their parent. Ranking: recency-desc across the fleet
 *  (`rowRecencyAt`). Parked (activity-window) rows are dropped the same way
 *  the Dock drops them. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  createReactiveSubscription,
  type Subscription,
} from "@kolu/surface/solid";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createComputed, createMemo, mapArray } from "solid-js";
import { rowRecencyAt } from "../canvas/dock/dockRowRanking";
import { createSharedRoot } from "../createSharedRoot";
import { hostScopeOf } from "../hostScope/hostScopes";
import {
  DEFAULT_ACTIVITY_WINDOW,
  windowOption,
} from "../terminal/activityWindow";
import { isParked } from "../terminal/useTerminalMetadata";
import { isStale as isStaleAt } from "../terminal/staleness";
import { getClockNow } from "../time/clock";
import { hostKeys, interpretClientError, padiMap } from "../wire";

export type FleetTerminalRow = {
  host: HostKey;
  id: TerminalId;
  meta: TerminalMetadata;
  recencyAt: number | null;
};

/** Pure merge + rank — unit-tested without Solid. Higher recency first;
 *  never-active (`null`) last. Host encoding is a stable secondary key. */
export function rankFleetTerminalRows(
  rows: readonly FleetTerminalRow[],
): FleetTerminalRow[] {
  return [...rows].sort((a, b) => {
    const ra = a.recencyAt ?? Number.NEGATIVE_INFINITY;
    const rb = b.recencyAt ?? Number.NEGATIVE_INFINITY;
    if (ra !== rb) return rb - ra;
    return encodeHostKey(a.host).localeCompare(encodeHostKey(b.host));
  });
}

/** Whether a terminal is a switcher/dock row — same rule as
 *  `useTerminalMetadata.terminalIds`: split children (`parentId` set) ride
 *  their parent tile and must not appear as independent entries. */
export function isTopLevelTerminal(meta: {
  parentId?: string | null;
}): boolean {
  return !meta.parentId;
}

/** Group a recency-ranked fleet list by host, preserving first-seen host order
 *  and within-host recency (rows stay in input order). Used to fill each host
 *  bucket under Terminals. */
export function groupFleetByHost(
  rows: readonly FleetTerminalRow[],
): { host: HostKey; rows: FleetTerminalRow[] }[] {
  const order: string[] = [];
  const map = new Map<string, { host: HostKey; rows: FleetTerminalRow[] }>();
  for (const row of rows) {
    const key = encodeHostKey(row.host);
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = { host: row.host, rows: [] };
      map.set(key, bucket);
      order.push(key);
    }
    bucket.rows.push(row);
  }
  return order.map((key) => map.get(key)!);
}

/** Active host first, then the remaining hosts in their original order.
 *  Terminals browse paints the active host's section at the top. */
export function orderHostsActiveFirst(
  hosts: readonly HostKey[],
  active: HostKey,
): HostKey[] {
  const rest: HostKey[] = [];
  let activeHost: HostKey | undefined;
  const activeEnc = encodeHostKey(active);
  for (const h of hosts) {
    if (encodeHostKey(h) === activeEnc) activeHost = h;
    else rest.push(h);
  }
  return activeHost === undefined ? [...hosts] : [activeHost, ...rest];
}

/** Reproject padi-stamped epochs onto the browser clock using THIS host's
 *  measured offset. Same 0-sentinel rule as useTerminalMetadata. */
function reprojectOnHost(
  host: HostKey,
  record: TerminalMetadata,
): TerminalMetadata {
  const { toLocal } = padiMap.entry(host).clock;
  const lastActivityAt = record.lastActivityAt
    ? (toLocal(record.lastActivityAt) ?? undefined)
    : record.lastActivityAt;
  const agent =
    "agent" in record && typeof record.agent?.startedAt === "number"
      ? {
          ...record.agent,
          startedAt: record.agent.startedAt
            ? (toLocal(record.agent.startedAt) ?? 0)
            : record.agent.startedAt,
        }
      : "agent" in record
        ? record.agent
        : undefined;
  const sleptAt =
    "sleptAt" in record && typeof record.sleptAt === "number"
      ? record.sleptAt
        ? (toLocal(record.sleptAt) ?? 0)
        : record.sleptAt
      : undefined;
  return {
    ...record,
    lastActivityAt,
    ...(agent === undefined ? {} : { agent }),
    ...(sleptAt === undefined ? {} : { sleptAt }),
  } as TerminalMetadata;
}

type PerHostHandle = {
  rows: Accessor<FleetTerminalRow[]>;
};

/** Per-host activity-window threshold for the fleet index — THIS host's
 *  preference when its scope exists, else the default (usually "all"). Never
 *  the active host's window applied to a foreign host. */
function thresholdMsForHost(host: HostKey): number | null {
  const window =
    hostScopeOf(host)?.prefs.activityWindow() ?? DEFAULT_ACTIVITY_WINDOW;
  return windowOption(window).thresholdMs;
}

/** App-lifetime fleet index — one shared root so the switcher opens per-host
 *  streams once. */
export const useFleetTerminalIndex = createSharedRoot(() => {
  // Eager per-host roots over the FULL member set (same mapArray shape as
  // useAttention). Each root opens that host's terminal list while connected.
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost): PerHostHandle => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      const connected = createMemo(() => entry.state().kind === "connected");

      const terminalKeys: Subscription<TerminalId[]> =
        createReactiveSubscription(
          () => host,
          (_h, signal) =>
            unenrolledStreamCall(
              entry.collections.terminals.unenrolledKeys,
              undefined,
              { signal },
            ),
          {
            onError: (err) =>
              interpretClientError(
                { kind: "scopedSub", label: "Fleet terminal list error" },
                err,
                { key: host },
              ),
          },
        );

      const keys = createMemo<TerminalId[]>(() =>
        connected() ? (terminalKeys() ?? []) : [],
      );
      const terminals = entry.collections.terminals.use({ keys });

      const rows = createMemo((): FleetTerminalRow[] => {
        if (!connected()) return [];
        const now = getClockNow()();
        const thresholdMs = thresholdMsForHost(host);
        const out: FleetTerminalRow[] = [];
        for (const id of keys()) {
          // Bound collection: `byKey` is a method on the use() result (not a signal).
          const raw = terminals.byKey(id)?.();
          if (raw === undefined || isParked(raw)) continue;
          // Match Dock / `terminalIds`: splits are not independent rows.
          if (!isTopLevelTerminal(raw)) continue;
          const meta = reprojectOnHost(host, raw);
          const recencyAt = rowRecencyAt(meta);
          if (isStaleAt(recencyAt, now, thresholdMs)) continue;
          out.push({ host, id, meta, recencyAt });
        }
        return out;
      });

      return { rows };
    },
  );
  // mapArray is lazy until read.
  createComputed(() => void roots());

  return createMemo((): FleetTerminalRow[] =>
    rankFleetTerminalRows(roots().flatMap((h) => h.rows())),
  );
});
