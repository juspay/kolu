/** Group ranked dock rows by repo into sections the dock renders.
 *
 *  Pure projection: `rankDockRows` recency-sorts across all terminals;
 *  this module rearranges that into repo-bucketed sections so the user
 *  sees `repo → branches` as the primary structure. Inside a section,
 *  rows sort by bucket priority (awaiting first) then recency. Sections
 *  then sort by the priority of their own top row, so a repo whose
 *  topmost row is `awaiting` floats above a repo whose topmost row is
 *  `working` or `idle`.
 *
 *  Parked rows are filtered out — the activity-window selector becomes a
 *  hard hide, not a dim. The dropped count is surfaced as `parkedCount`
 *  so the dock can render a "N hidden by 24h window" footer with a
 *  one-click "show all" escape.
 *
 *  `flatIds` is the same row order the dock paints, but flat — the
 *  `Cmd+1..9` shortcut consumes this list (via `App.tsx` →
 *  `ActionContext.dockOrderedIds`) so the chord always activates the
 *  row visually first.
 *
 *  Repo identity comes from `info.key.group` — the same canonical key
 *  `placementPolicy.ts:getBucketFor` uses for canvas tile clustering,
 *  so the dock's "what counts as one repo" agrees with the canvas. */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { DockRowBucket, RankedDockRow } from "./dockRowRanking";

/** Within-group sort priority. Matches `dockRowRanking`'s priority,
 *  re-declared so a future divergence here can't silently drift the
 *  ranking module. `parked` is unreachable inside groups (filtered out
 *  upstream); listed for exhaustiveness. */
const BUCKET_PRIORITY: Record<DockRowBucket, number> = {
  awaiting: 0,
  working: 1,
  idle: 2,
  parked: 3,
  none: 4,
};

export type DockGroup = {
  /** `info.key.group` — git repo name or cwd basename. */
  name: string;
  /** Per-repo OKLCH color (`info.repoColor`). */
  color: string;
  /** Rows inside this group, sorted by bucket then recency. */
  rows: RankedDockRow[];
};

export type DockTree = {
  groups: DockGroup[];
  /** Flat row order across all groups — feeds `Cmd+1..9`. */
  flatIds: TerminalId[];
  /** How many rows the activity window filtered out. The dock surfaces
   *  this as a footer hint with a "show all" link. */
  parkedCount: number;
};

export function buildDockTree(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
): DockTree {
  const byName = new Map<string, { color: string; rows: RankedDockRow[] }>();
  let parkedCount = 0;

  for (const row of ranked) {
    if (row.bucket === "parked") {
      parkedCount++;
      continue;
    }
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    const existing = byName.get(info.key.group);
    if (existing) {
      existing.rows.push(row);
    } else {
      byName.set(info.key.group, { color: info.repoColor, rows: [row] });
    }
  }

  const groups: DockGroup[] = [...byName.entries()].map(([name, g]) => ({
    name,
    color: g.color,
    rows: [...g.rows].sort(compareRows),
  }));

  groups.sort(compareGroups);

  const flatIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  return { groups, flatIds, parkedCount };
}

function compareRows(a: RankedDockRow, b: RankedDockRow): number {
  const pa = BUCKET_PRIORITY[a.bucket];
  const pb = BUCKET_PRIORITY[b.bucket];
  if (pa !== pb) return pa - pb;
  return b.ts - a.ts;
}

/** Sections sort by their top row's `(bucket-priority, -ts)` tuple.
 *  The top row is each group's headline; comparing groups by their
 *  headlines means a repo whose hottest row is `awaiting` always
 *  outranks a repo whose hottest row is merely `working` — the dock's
 *  vertical order reads "needs attention → has recent work → quiet"
 *  across repos and within repos with the same rule. Groups always
 *  have ≥1 row (constructed from non-empty buckets), so `rows[0]` is
 *  defined. */
function compareGroups(a: DockGroup, b: DockGroup): number {
  const ra = a.rows[0];
  const rb = b.rows[0];
  if (!ra || !rb) return 0;
  return compareRows(ra, rb);
}
