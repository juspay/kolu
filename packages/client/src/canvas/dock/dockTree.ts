/** Group ranked dock rows by repo into sections the dock renders.
 *
 *  Pure projection: `rankDockRows` recency-sorts across all terminals;
 *  this module rearranges that into repo-bucketed sections so the user
 *  sees `repo → branches` as the primary structure.
 *
 *  Inside a section, rows are first **clustered by branch/intent
 *  label** so two terminals on the same branch stay adjacent in the
 *  list. Within a cluster, rows sort by bucket priority (awaiting
 *  first) then recency. Clusters themselves order by their top row's
 *  `(bucket, -ts)` key — so the same-branch sibling of an awaiting
 *  agent rides up with it instead of getting separated by a stranger
 *  branch with newer activity.
 *
 *  Sections themselves sort by **pure recency** — the most recently-
 *  active repo first, regardless of which bucket its rows occupy —
 *  because "which repo did I just touch" is a stronger mental anchor
 *  than "which repo has the loudest bucket". An awaiting agent inside
 *  a quiet repo still pulls attention via its row's animated pip, not
 *  by promoting the whole repo above another that just changed.
 *
 *  Parked rows are filtered out — the activity-window selector becomes a
 *  hard hide, not a dim. The dropped count is surfaced as `parkedCount`
 *  so the dock can render a "N hidden by 24h window" footer with a
 *  one-click "show all" escape.
 *
 *  `flatRows` is the same row order the dock paints, but flat — rail
 *  mode reads each row's `bucket` straight off this list for its
 *  breathe/pulse animation, and `App.tsx` projects `.map(r => r.id)`
 *  to feed `ActionContext.dockOrderedIds` so the `Cmd+1..9` chord
 *  always activates the row visually first. One canonical sequence,
 *  two views.
 *
 *  Repo identity comes from `info.key.group` — the same canonical key
 *  `placementPolicy.ts:getBucketFor` uses for canvas tile clustering,
 *  so the dock's "what counts as one repo" agrees with the canvas. */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { DOCK_ROW_BUCKET_PRIORITY, type RankedDockRow } from "./dockRowRanking";

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
  /** Flat row order across all groups — one canonical list that both
   *  surfaces project from: rail mode reads each row's `bucket` for
   *  its animation class, and `App.tsx` projects `.map(r => r.id)` to
   *  drive `Cmd+1..9` activation. Single source of truth — no parallel
   *  `flatIds` array to keep in sync with `flatRows`. */
  flatRows: readonly RankedDockRow[];
  /** How many rows the activity window filtered out. The dock surfaces
   *  this as a footer hint with a "show all" link. */
  parkedCount: number;
};

export function buildDockTree(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
): DockTree {
  const byName = new Map<
    string,
    { color: string; byLabel: Map<string, RankedDockRow[]> }
  >();
  let parkedCount = 0;

  for (const row of ranked) {
    if (row.bucket === "parked") {
      parkedCount++;
      continue;
    }
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    let group = byName.get(info.key.group);
    if (!group) {
      group = { color: info.repoColor, byLabel: new Map() };
      byName.set(info.key.group, group);
    }
    const list = group.byLabel.get(info.key.label);
    if (list) list.push(row);
    else group.byLabel.set(info.key.label, [row]);
  }

  const groups: DockGroup[] = [...byName.entries()].map(([name, g]) => ({
    name,
    color: g.color,
    rows: flattenLabelClusters(g.byLabel),
  }));

  groups.sort(compareGroups);

  const flatRows = groups.flatMap((g) => g.rows);
  return { groups, flatRows, parkedCount };
}

/** Sort rows inside each label cluster by `(bucket, -ts)`, then order
 *  clusters by their already-sorted top row using the same key — so
 *  the same-branch sibling of an awaiting agent stays adjacent to it
 *  even when another branch in the same repo has more recent
 *  activity in between. */
function flattenLabelClusters(
  byLabel: Map<string, RankedDockRow[]>,
): RankedDockRow[] {
  for (const list of byLabel.values()) list.sort(compareRows);
  const ordered = [...byLabel.values()].sort((a, b) => {
    const ra = a[0];
    const rb = b[0];
    if (!ra || !rb) return 0;
    return compareRows(ra, rb);
  });
  return ordered.flat();
}

function compareRows(a: RankedDockRow, b: RankedDockRow): number {
  const pa = DOCK_ROW_BUCKET_PRIORITY[a.bucket];
  const pb = DOCK_ROW_BUCKET_PRIORITY[b.bucket];
  if (pa !== pb) return pa - pb;
  return b.ts - a.ts;
}

/** Sections sort by **pure recency** — the most recently-active row
 *  in the group wins, with no bucket-priority preamble. "Which repo
 *  did I just touch?" is the question this answers, independent of
 *  whether the touched row is awaiting / working / idle / none.
 *  Attention still propagates inside a section via the row's
 *  animated pip; the section order doesn't second-guess it. Groups
 *  always have ≥1 row (constructed from non-empty buckets), so
 *  `Math.max(...rows.map(r => r.ts))` is defined. */
function compareGroups(a: DockGroup, b: DockGroup): number {
  return groupRecency(b) - groupRecency(a);
}

function groupRecency(g: DockGroup): number {
  let max = 0;
  for (const r of g.rows) if (r.ts > max) max = r.ts;
  return max;
}
