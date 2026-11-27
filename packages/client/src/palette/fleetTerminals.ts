/** Fleet-wide terminal index — the unified switcher's rows, and where any one
 *  terminal on any host stands (`fleetTerminalStanding`, which the Conductor's
 *  agent lines read), over ONE set of per-host streams.
 *
 *  The Dock is active-host only. The switcher must also find terminals on
 *  other connected hosts in the padi pool. For every membership host that is
 *  `connected`, this module opens that host's `terminals.keys` stream + the
 *  composed terminals collection (same shape as `createHostWire`) and flattens
 *  them into ranked rows carrying the host key.
 *
 *  Entry source matches the Dock: only canvas TILES — split children ride their
 *  parent. "Tile" is the store's own rule (`containingTileOf(id) === id`), not
 *  `!parentId`: a split whose parent died without a client reconcile keeps a
 *  dangling `parentId` and is painted as a tile by the canvas and the Dock, so
 *  the cheaper test would drop it from the switcher alone — findable nowhere.
 *  Ranking: recency-desc across the fleet
 *  (`rowRecencyAt`). Parked (activity-window) rows are dropped the same way
 *  the Dock drops them. */

import {
  type PadiRoster,
  type PadiTerminal,
  rosterHolds,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
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
import { type Accessor, createEffect, createMemo, mapArray } from "solid-js";
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
import { joinRows } from "../wideFold";

export type FleetTerminalRow = {
  host: HostKey;
  id: TerminalId;
  meta: TerminalMetadata;
  recencyAt: number | null;
};

/** Whether two row lists hold the SAME rows in the same order. Rows carry
 *  per-id identity ({@link createFleetHostRows}), so reference comparison is
 *  the whole test — and the list only has to republish when a row did. */
function sameRowList(
  a: readonly FleetTerminalRow[],
  b: readonly FleetTerminalRow[],
): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/** ONE HOST'S SWITCHER ROWS, with PER-ID IDENTITY — the shape the active
 *  host's records already have (`useTerminalMetadata`'s per-id projection).
 *
 *  One memo per terminal id, so a terminal whose record did not move keeps its
 *  row object AND the clock-reprojected `meta` inside it while any other
 *  terminal on the host changes. A single pass that rebuilt every row per
 *  snapshot handed each row's downstream bindings — the pip, the lead subtree
 *  — a new-but-equal object on every census tick, and the list memo above it
 *  had to read every leaf of every record to tell the churn from a real move.
 *
 *  The activity window is a WHOLE-LIST gate, so the ticker and the threshold
 *  are read here and not in the per-id memos, whose values must not churn
 *  when only the clock advances.
 *
 *  The readers are injected so the rule is exercisable without a host pool:
 *  `recordOf` is that id's record as its host publishes it, `project` is the
 *  clock reprojection (a fresh object per call). */
export function createFleetHostRows(opts: {
  host: HostKey;
  keys: Accessor<TerminalId[]>;
  recordOf: (id: TerminalId) => PadiTerminal | undefined;
  project: (record: TerminalMetadata) => TerminalMetadata;
  now: Accessor<number>;
  thresholdMs: Accessor<number | null>;
}): Accessor<FleetTerminalRow[]> {
  // Live parent edge over THIS host's census. A parked or not-yet-arrived
  // record is `undefined` (absent), exactly as the active host's store reads
  // it, so the shared walk answers the same question here.
  const parentOf = (id: TerminalId): TerminalId | null | undefined => {
    const record = opts.recordOf(id);
    if (record === undefined || isParked(record)) return undefined;
    return (record.parentId as TerminalId | undefined) ?? null;
  };
  const rowOf = mapArray(
    opts.keys,
    (id): Accessor<FleetTerminalRow | undefined> =>
      createMemo(
        (): FleetTerminalRow | undefined => {
          const raw = opts.recordOf(id);
          if (raw === undefined || isParked(raw)) return undefined;
          // Match Dock / `terminalIds`: splits are not independent rows.
          if (!isTileTerminal(id, parentOf)) return undefined;
          const meta = opts.project(raw);
          return { host: opts.host, id, meta, recencyAt: rowRecencyAt(meta) };
        },
        { name: "fleetRow" },
      ),
    { name: "fleetHostRows.byKey" },
  );
  // The rows are joined a CHUNK at a time: reading every row memo on one scope
  // put a source per terminal on it, so a host with a few hundred panes was
  // past Solid's 200-source `WIDE_SCOPE_DEPS` judge. The `mapArray` above is a
  // flat two sources at any fleet size (it reads the key array's container and
  // walks its raw slots untracked), so the per-key memo is the affordable half
  // already — {@link joinRows} is what makes the published list affordable too.
  const present = joinRows("fleetHostRows.present", rowOf);
  // The activity window is applied OFF the join, over the plain row list: the
  // clock ticks on its own cadence, and folding it into each row memo would
  // wake every row in the fleet on every tick. Three sources, any N.
  return createMemo(
    (): FleetTerminalRow[] => {
      const now = opts.now();
      const thresholdMs = opts.thresholdMs();
      return present().filter(
        (row) => !isStaleAt(row.recencyAt, now, thresholdMs),
      );
    },
    { name: "fleetHostRows", equals: sameRowList },
  );
}

/** Pure merge + rank — unit-tested without Solid. Higher recency first;
 *  never-active (`null`) last. Host encoding is a stable secondary key. */
export function rankFleetTerminalRows(
  rows: readonly FleetTerminalRow[],
): FleetTerminalRow[] {
  return [...rows].sort((a, b) => {
    const d = tsRank(b.recencyAt) - tsRank(a.recencyAt);
    if (d !== 0) return d;
    return encodeHostKey(a.host).localeCompare(encodeHostKey(b.host));
  });
}

/** Whether a terminal is a switcher/dock row — the SAME walk
 *  `useTerminalMetadata.terminalIds` uses, over this host's census: a genuine
 *  split rides its parent tile, while a node with no resolvable root (cycle, or
 *  a parent that is gone) is its own tile. Sharing the walk is what keeps the
 *  two lists from disagreeing about which terminals exist. */
export function isTileTerminal(id: TerminalId, parentOf: ParentEdge): boolean {
  return containingTileOf(id, parentOf) === id;
}

/** Group a recency-ranked fleet list by host, preserving first-seen host order
 *  and within-host recency (rows stay in input order). Used to fill each host
 *  bucket under Terminals. */
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
 *  measured offset — shared 0-sentinel rules via {@link reprojectTerminalClock}. */
function reprojectOnHost(
  host: HostKey,
  record: TerminalMetadata,
): TerminalMetadata {
  return reprojectTerminalClock(padiMap.entry(host).clock.toLocal, record);
}

type PerHostHandle = {
  /** The host's ENCODED key — what a fleet ref's host half spells. */
  encHost: string;
  rows: Accessor<FleetTerminalRow[]>;
  standing: (id: TerminalId) => FleetTerminalStanding;
};

/** Where ONE terminal stands in its host's roster — every terminal, not only
 *  the switcher's rows: a split, and a row the activity window parks out of the
 *  switcher, are both still terminals somebody may be asking about.
 *
 *  Four answers, because "not in the list" means three different things and
 *  only one of them is that the terminal is gone:
 *   - `here`        — listed, with its record — padi's own, so its time stamps
 *                     are on that host's clock (the switcher's rows reproject
 *                     theirs; nothing reading a standing needs to).
 *   - `gone`        — the host's list arrived AND the host says that list is a
 *                     census (its `roster` cell is `established`: padi finished
 *                     adopting) and this id is not in it — or its record is a
 *                     parked restore card (the terminal ended).
 *   - `loading`     — the host is warming up, its list or this record has not
 *                     arrived yet, or the host says its roster is still
 *                     SETTLING (booting its kaval, reconciling the session,
 *                     recycling). Saying "gone" in any of those is a guess, and
 *                     the one kolu made on every redeploy (#2376).
 *   - `unreachable` — the host is down or not in the pool, so nobody can say.
 */
export type FleetTerminalStanding =
  | { readonly kind: "here"; readonly meta: TerminalMetadata }
  | { readonly kind: "gone" }
  | { readonly kind: "loading" }
  | { readonly kind: "unreachable" };

const GONE: FleetTerminalStanding = { kind: "gone" };
const LOADING: FleetTerminalStanding = { kind: "loading" };
const UNREACHABLE: FleetTerminalStanding = { kind: "unreachable" };

/** HOW ONE TERMINAL STANDS, from the four reads that decide it — the rule
 *  itself, so it can be driven over a real collection view without a host map
 *  (`fleetStanding.test.ts`).
 *
 *  EVERY read but `connected` is a THUNK, read only on the branch that needs
 *  it. The host entry's state publishes while it is connected (phase, log
 *  tail, elapsed), so an eager `warming` read would make every one of those
 *  publishes invalidate every terminal's standing — and each re-read mints a
 *  fresh `{kind:"here"}`, which is a new object for every gate above it.
 *
 *  `census` is the host's own roster standing, which rides the same frame as
 *  the list it qualifies. A padi still adopting (a fresh daemon, a kaval
 *  recycle) has no census, and reading its silence as a death is what
 *  recorded live terminals as gone on every redeploy (#2376) — as was reading
 *  the `terminals` collection beside the standing, since the two are separate
 *  members and this browser reads them through kolu-server's per-host mirror,
 *  which can have folded one and not the other. */
export function terminalStandingFrom(args: {
  readonly id: TerminalId;
  readonly connected: boolean;
  /** The host entry's own word, READ ONLY while it is not connected. */
  readonly warming: () => boolean;
  /** The host's roster standing, READ ONLY once it is connected. */
  readonly census: () => PadiRoster | undefined;
  /** The terminal's record, READ ONLY once the census says the host holds it:
   *  a record this host does not hold is not a dependency of its standing. */
  readonly record: () => PadiTerminal | undefined;
}): FleetTerminalStanding {
  if (!args.connected) return args.warming() ? LOADING : UNREACHABLE;
  const census = args.census();
  if (census === undefined) return LOADING;
  const held = rosterHolds(census, args.id);
  if (held === null) return LOADING;
  if (!held) return GONE;
  const record = args.record();
  if (record === undefined) return LOADING;
  return isParked(record) ? GONE : { kind: "here", meta: record };
}

/** Per-host activity-window threshold for the fleet index — THIS host's
 *  preference. Prefer the live HostScope when born; otherwise the canonical
 *  non-reactive reader in createHostPrefs (same key + parse). */
function thresholdMsForHost(host: HostKey): number | null {
  const scoped = hostScopeOf(host)?.prefs.activityWindow();
  if (scoped !== undefined) return windowOption(scoped).thresholdMs;
  return windowOption(readStoredActivityWindow(host)).thresholdMs;
}

/** The per-host roots, app-lifetime — one shared root so every reader of the
 *  fleet (the switcher's ranked rows, a single terminal's standing) rides the
 *  SAME per-host streams instead of opening its own. */
const useFleetHosts = createSharedRoot(() => {
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
          () =>
            unenrolledStreamCall(
              entry.collections.terminals.unenrolledKeys,
              undefined,
              // Scoped by host, and named for the consumer: the fleet index and
              // the per-host wire open the SAME member for different reasons,
              // and a table that merged them would report one park as two
              // (kolu#2101 J2).
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
      // WHETHER THAT LIST IS A CENSUS — padi's own `roster` standing, read per
      // host beside the list it qualifies. A cheap value cell: one frame when
      // the host finishes adopting, one more if it recycles.
      const roster = entry.cells.roster.use();

      // `keys` is already empty while disconnected, so the row set empties
      // with the host. `byKey` is a method on the use() result, not a signal.
      const rows = createFleetHostRows({
        host,
        keys,
        recordOf: (id) => terminals.byKey(id)?.(),
        project: (record) => reprojectOnHost(host, record),
        now: getNowTicker(),
        thresholdMs: () => thresholdMsForHost(host),
      });

      const standing = (id: TerminalId): FleetTerminalStanding =>
        terminalStandingFrom({
          id,
          connected: connected(),
          // THUNKS, so a branch that does not decide this standing is not a
          // dependency of it: the entry's state publishes on every phase and
          // log-tail move while connected, and the census is beside the
          // record it qualifies (`terminalStandingFrom`).
          warming: () => entry.state().kind === "warming",
          census: () => roster.value(),
          record: () => terminals.byKey(id)?.(),
        });

      return { encHost, rows, standing };
    },
  );
  // mapArray is lazy until read — this pass keeps the per-host roots (and the
  // subscriptions they hold) alive for the shared root's lifetime.
  createEffect(
    () => void roots(),
    () => {},
  );
  return roots;
});

/** App-lifetime fleet index — the switcher's ranked rows, over the shared
 *  per-host roots. */
export const useFleetTerminalIndex = createSharedRoot(
  // Handed out as a plain `Accessor`: a reader of the index ranks rows, it
  // never refreshes the memo behind it.
  (): Accessor<FleetTerminalRow[]> => {
    const hosts = useFleetHosts();
    return createMemo(
      (): FleetTerminalRow[] =>
        rankFleetTerminalRows(hosts().flatMap((h) => h.rows())),
      { name: "fleetTerminalIndex" },
    );
  },
);

/** Where the terminal `id` on `host` (an ENCODED host key, the host half of a
 *  fleet ref) stands right now — reactive, and read off the same per-host
 *  mirror the switcher reads, so it opens no stream of its own. A host that is
 *  not in the pool is `unreachable`: nothing here can vouch for its terminals
 *  either way. */
export function fleetTerminalStanding(
  host: string,
  id: TerminalId,
): FleetTerminalStanding {
  const handle = useFleetHosts()().find((h) => h.encHost === host);
  return handle === undefined ? UNREACHABLE : handle.standing(id);
}
