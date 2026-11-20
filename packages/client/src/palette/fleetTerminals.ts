import { rosterHolds, type TerminalMetadata } from "@kolu/padi-client/surface";
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
import { rowRecencyAt, tsRank } from "../canvas/dock/dockRowRanking";
import { createSharedRoot } from "../createSharedRoot";
import { readStoredActivityWindow } from "../hostScope/createHostPrefs";
import { hostScopeOf } from "../hostScope/hostScopes";
import { windowOption } from "../terminal/activityWindow";
import { reprojectTerminalClock } from "../terminal/reprojectClock";
import { isStale as isStaleAt } from "../terminal/staleness";
import { containingTileOf, type ParentEdge } from "../terminal/terminalTree";
import { isParked } from "../terminal/useTerminalMetadata";
import { getNowTicker } from "../terminal/staleness";
import { hostKeys, interpretClientError, padiMap } from "../wire";

export type FleetTerminalRow = {
  host: HostKey;
  id: TerminalId;
  meta: TerminalMetadata;
  recencyAt: number | null;
};

export function createStableFleetRows(
  read: Accessor<FleetTerminalRow[]>,
): Accessor<FleetTerminalRow[]> {
  const snapshot = createMemo(
    () => {
      const rows = read();
      return { rows, signature: JSON.stringify(rows) };
    },
    undefined,
    { equals: (a, b) => a.signature === b.signature },
  );
  return () => snapshot().rows;
}

export function rankFleetTerminalRows(
  rows: readonly FleetTerminalRow[],
): FleetTerminalRow[] {
  return [...rows].sort((a, b) => {
    const d = tsRank(b.recencyAt) - tsRank(a.recencyAt);
    if (d !== 0) return d;
    return encodeHostKey(a.host).localeCompare(encodeHostKey(b.host));
  });
}

export function isCanvasRoot(id: TerminalId, parentOf: ParentEdge): boolean {
  return containingTileOf(id, parentOf) === id;
}

export function groupFleetByHost(
  rows: readonly FleetTerminalRow[],
): { host: HostKey; rows: FleetTerminalRow[] }[] {
  const out: { host: HostKey; rows: FleetTerminalRow[] }[] = [];
  const byKey = new Map<string, { host: HostKey; rows: FleetTerminalRow[] }>();
  for (const row of rows) {
    const key = encodeHostKey(row.host);
    let bucket = byKey.get(key);
    if (bucket === undefined) {
      bucket = { host: row.host, rows: [] };
      byKey.set(key, bucket);
      out.push(bucket);
    }
    bucket.rows.push(row);
  }
  return out;
}

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

function reprojectOnHost(
  host: HostKey,
  record: TerminalMetadata,
): TerminalMetadata {
  return reprojectTerminalClock(padiMap.entry(host).clock.toLocal, record);
}

type PerHostHandle = {
  encHost: string;
  rows: Accessor<FleetTerminalRow[]>;
  standing: (id: TerminalId) => FleetTerminalStanding;
};

export type FleetTerminalStanding =
  | { readonly kind: "here"; readonly meta: TerminalMetadata }
  | { readonly kind: "gone" }
  | { readonly kind: "loading" }
  | { readonly kind: "unreachable" };

const GONE: FleetTerminalStanding = { kind: "gone" };
const LOADING: FleetTerminalStanding = { kind: "loading" };
const UNREACHABLE: FleetTerminalStanding = { kind: "unreachable" };

function thresholdMsForHost(host: HostKey): number | null {
  const scoped = hostScopeOf(host)?.prefs.activityWindow();
  if (scoped !== undefined) return windowOption(scoped).thresholdMs;
  return windowOption(readStoredActivityWindow(host)).thresholdMs;
}

const useFleetHosts = createSharedRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost): PerHostHandle => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      const connected = createMemo(() => entry.state().kind === "connected");

      const terminalKeys: Subscription<TerminalId[]> =
        createReactiveSubscription(
          () => host,
          () =>
            unenrolledStreamCall(
              entry.collections.terminals.unenrolledKeys,
              undefined,
              { label: `terminals.keys[${encHost}] (fleet)` },
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
      const roster = entry.cells.roster.use();

      const rows = createStableFleetRows(() => {
        if (!connected()) return [];
        const now = getNowTicker()();
        const thresholdMs = thresholdMsForHost(host);
        const out: FleetTerminalRow[] = [];
        const parentOf = (id: TerminalId) => {
          const record = terminals.byKey(id)?.();
          if (record === undefined || isParked(record)) return undefined;
          return (record.parentId as TerminalId | undefined) ?? null;
        };
        for (const id of keys()) {
          const raw = terminals.byKey(id)?.();
          if (raw === undefined || isParked(raw)) continue;
          if (!isCanvasRoot(id, parentOf)) continue;
          const meta = reprojectOnHost(host, raw);
          const recencyAt = rowRecencyAt(meta);
          if (isStaleAt(recencyAt, now, thresholdMs)) continue;
          out.push({ host, id, meta, recencyAt });
        }
        return out;
      });

      const standing = (id: TerminalId): FleetTerminalStanding => {
        if (!connected()) {
          return entry.state().kind === "warming" ? LOADING : UNREACHABLE;
        }
        const census = roster.value();
        if (census === undefined) return LOADING;
        const held = rosterHolds(census, id);
        if (held === null) return LOADING;
        if (!held) return GONE;
        const record = terminals.byKey(id)?.();
        if (record === undefined) return LOADING;
        return isParked(record) ? GONE : { kind: "here", meta: record };
      };

      return { encHost, rows, standing };
    },
  );
  createComputed(() => void roots());
  return roots;
});

export const useFleetTerminalIndex = createSharedRoot(() => {
  const hosts = useFleetHosts();
  return createMemo((): FleetTerminalRow[] =>
    rankFleetTerminalRows(hosts().flatMap((h) => h.rows())),
  );
});

export function fleetTerminalStanding(
  host: string,
  id: TerminalId,
): FleetTerminalStanding {
  const handle = useFleetHosts()().find((h) => h.encHost === host);
  return handle === undefined ? UNREACHABLE : handle.standing(id);
}
