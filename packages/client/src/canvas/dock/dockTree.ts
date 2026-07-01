/** Group ranked dock rows by repo into sections the dock renders.
 *
 *  Pure projection: `rankDockRows` recency-sorts across all terminals;
 *  this module rearranges that into repo-bucketed sections so the user
 *  sees `repo → branches` as the primary structure.
 *
 *  **Pure recency at every layer.** Sections sort by their newest row's
 *  `ts`. Clusters (same-branch siblings) sort by their newest row's
 *  `ts`. Rows inside a cluster sort by `ts`. The bucket no longer
 *  promotes a row's position — "needs attention" is carried by the
 *  state pip's color and animation (`RowPips.tsx`), not by where it
 *  sits in the list. This keeps the order's mental model consistent
 *  with how the user thinks about it: "what did I just touch?"
 *
 *  Inside a section, rows are **clustered by branch/intent label** so
 *  two terminals on the same branch stay adjacent even when an
 *  unrelated row sits between them in pure-recency time. The cluster
 *  is the grouping primitive; the sort key inside and outside the
 *  cluster is the same (`-ts`).
 *
 *  Parked rows are filtered out — the activity-window selector becomes a
 *  hard hide, not a dim. The dropped count is surfaced as `parkedCount`
 *  so the dock's `Filters` footer can render a combined "N hidden · show
 *  all" disclosure (parked + hidden-sleeping) with a one-click escape.
 *
 *  `sleeping` rows get the same hard-hide treatment when `hideSleeping` is
 *  set (the dock footer's ☾ toggle) — an orthogonal filter to staleness:
 *  the window hides *stale* rows, this hides *deliberately dormant* ones.
 *  `sleepingCount` counts every fresh sleeping row (shown or hidden) so the
 *  footer knows whether the toggle earns its place and what count to show.
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
import type { RankedDockRow } from "./dockRowRanking";

export type DockGroup = {
  /** `info.key.group` — git repo name or cwd basename. */
  name: string;
  /** Per-repo OKLCH color (`info.repoColor`). */
  color: string;
  /** Rows inside this group, sorted by recency (newest first), with
   *  same-branch siblings kept adjacent via cluster grouping. */
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
  /** How many fresh (in-window) sleeping rows the dock holds — counted
   *  whether they're shown or hidden by the ☾ toggle, so the footer can
   *  decide whether the toggle earns its place and show the count. Stale
   *  sleeping tiles are `parked`, not counted here. */
  sleepingCount: number;
  /** The dock has substantive content — visible rows, parked rows, or
   *  sleeping rows the ☾ toggle is hiding. This is the boolean the
   *  empty-canvas Dock is defined by (true zero is the only state with no
   *  content), so the HiddenFooter reads it to decide whether the footer
   *  controls earn their place. Sleeping rows count even when hidden, so
   *  the toggle stays reachable to bring them back. */
  hasContent: boolean;
};

export function buildDockTree(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  hideSleeping: boolean,
): DockTree {
  const byName = new Map<
    string,
    { color: string; byLabel: Map<string, RankedDockRow[]> }
  >();
  let parkedCount = 0;
  let sleepingCount = 0;

  for (const row of ranked) {
    if (row.bucket === "parked") {
      parkedCount++;
      continue;
    }
    if (row.bucket === "sleeping") {
      // Count every fresh sleeping row so the footer toggle knows the total,
      // then drop it from the tree when the ☾ toggle is off — the same
      // hard-hide the activity window applies to parked rows.
      sleepingCount++;
      if (hideSleeping) continue;
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
  return {
    groups,
    flatRows,
    parkedCount,
    sleepingCount,
    hasContent: flatRows.length > 0 || parkedCount > 0 || sleepingCount > 0,
  };
}

/** Sort rows inside each label cluster by `-ts`, then order clusters
 *  by their already-sorted top row using the same key — so the same-
 *  branch sibling of a recent row stays adjacent to it even when
 *  another branch in the same repo has activity falling between the
 *  pair in pure-recency time. */
function flattenLabelClusters(
  byLabel: Map<string, RankedDockRow[]>,
): RankedDockRow[] {
  for (const list of byLabel.values()) list.sort(compareRows);
  const ordered = [...byLabel.values()].sort((a, b) => {
    const ra = a[0];
    const rb = b[0];
    // byLabel values are always initialized with at least one row (see buildDockTree),
    // so ra and rb are never undefined in practice — this guard appeases TypeScript.
    if (!ra || !rb) return 0;
    return compareRows(ra, rb);
  });
  return ordered.flat();
}

function compareRows(a: RankedDockRow, b: RankedDockRow): number {
  return b.ts - a.ts;
}

/** Sections sort by recency too — the most recently-active row in the
 *  group wins. "Which repo did I just touch?" is the question this
 *  answers; attention propagates inside a section via the row's state
 *  pip, not via section order. Groups always have ≥1 row (constructed
 *  from non-empty buckets), so the max is defined. */
function compareGroups(a: DockGroup, b: DockGroup): number {
  return groupRecency(b) - groupRecency(a);
}

function groupRecency(g: DockGroup): number {
  let max = 0;
  for (const r of g.rows) if (r.ts > max) max = r.ts;
  return max;
}
