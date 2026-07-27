/** Group ranked dock rows by repo into sections the dock renders.
 *
 *  Pure projection: `rankDockRows` recency-sorts across all terminals;
 *  this module rearranges that into repo-bucketed sections so the user
 *  sees `repo → branches` as the primary structure.
 *
 *  **Blocked-on-you first, then pure recency.** Within a section, rows whose
 *  agent is genuinely blocked on the user (`bucket === "awaiting"`, i.e.
 *  `awaiting_user` — the post-turn `waiting` linger ranks idle, per the
 *  order≠colour law) sort ABOVE everything else; recency decides the rest.
 *  An agent that has waited 20 hours must not hide under fresher busy rows —
 *  colour and animation alone demonstrably failed to surface it (fucknotif).
 *  Sections themselves still sort by pure recency: the section header's
 *  attention triplet + the host tab capsule carry cross-section discovery,
 *  so the macro-order keeps the "what did I just touch?" mental model.
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
import {
  isActive,
  type TerminalAttention,
} from "../../attention/attentionFacts";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { type RankedDockRow, tsRank } from "./dockRowRanking";

export type DockGroup = {
  /** `info.key.group` — git repo name or cwd basename. */
  name: string;
  /** Per-repo OKLCH color (`info.repoColor`). */
  color: string;
  /** Rows inside this group, sorted by recency (newest first), with
   *  same-branch siblings kept adjacent via cluster grouping. */
  rows: RankedDockRow[];
  /** Every row belonging to this repo, INCLUDING the ones the activity window
   *  parked and the ☾ toggle is hiding — what the header's attention summary
   *  counts. The counts must not move when you toggle a filter: an agent that
   *  has been blocked on you long enough to fall out of the activity window is
   *  the one you most need told about, and folding over the visible rows alone
   *  reported it as zero — the header quietly agreeing with a dock that had
   *  hidden the problem. Same order as `rows`, filters not applied. */
  allRows: RankedDockRow[];
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
  /** How many rows BOTH dock filters are hiding right now — the parked
   *  rows the activity window dropped plus the sleeping rows the ☾ toggle
   *  is hiding (only when `hideSleeping`). The tree owns this arithmetic
   *  so the footer reads the answer instead of re-applying the filter rule
   *  itself; add a third filter and this term grows here, not at the
   *  consumer. */
  hiddenCount: number;
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
    {
      color: string;
      byLabel: Map<string, RankedDockRow[]>;
      allRows: RankedDockRow[];
    }
  >();
  let parkedCount = 0;
  let sleepingCount = 0;

  for (const row of ranked) {
    // Resolve the repo BEFORE the filters, so a hidden row still joins its
    // group's `allRows` and its attention still reaches the header.
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    let group = byName.get(info.key.group);
    if (!group) {
      group = { color: info.repoColor, byLabel: new Map(), allRows: [] };
      byName.set(info.key.group, group);
    }
    group.allRows.push(row);
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
    const list = group.byLabel.get(info.key.label);
    if (list) list.push(row);
    else group.byLabel.set(info.key.label, [row]);
  }

  const groups: DockGroup[] = [...byName.entries()]
    .map(([name, g]) => ({
      name,
      color: g.color,
      rows: flattenLabelClusters(g.byLabel),
      allRows: g.allRows,
    }))
    // A repo whose every row is filtered out has no header to hang its
    // attention on; the footer's "N hidden" disclosure is what surfaces it.
    .filter((g) => g.rows.length > 0);

  groups.sort(compareGroups);

  const flatRows = groups.flatMap((g) => g.rows);
  return {
    groups,
    flatRows,
    parkedCount,
    sleepingCount,
    hiddenCount: parkedCount + (hideSleeping ? sleepingCount : 0),
    hasContent: flatRows.length > 0 || parkedCount > 0 || sleepingCount > 0,
  };
}

/** Sort rows inside each label cluster (blocked-first, then `-ts`), then order
 *  clusters by their already-sorted top row using the same key — so the same-
 *  branch sibling of a recent row stays adjacent to it even when
 *  another branch in the same repo has activity falling between the
 *  pair in pure-recency time, and a cluster holding a blocked row
 *  floats to the top of its section (siblings ride along — the cluster
 *  is the grouping primitive). */
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
  // Blocked-on-you floats first — `awaiting` is exactly `awaiting_user`
  // (the ORDER bucket; linger ranks idle), so only genuinely blocked rows
  // promote. Everything else stays pure recency.
  const blocked = askingRank(a) - askingRank(b);
  if (blocked !== 0) return blocked;
  const ra = tsRank(a.ts);
  const rb = tsRank(b.ts);
  // Guard the subtraction: `tsRank` can return `-Infinity` (never-active), and
  // `-Infinity - -Infinity` is `NaN`. Equal ranks (including two never-active
  // rows) short-circuit to the explicit tie before that can happen.
  return ra === rb ? 0 : rb - ra;
}

function askingRank(row: RankedDockRow): number {
  return row.bucket === "awaiting" ? 0 : 1;
}

/** Sections sort by recency too — the most recently-active row in the
 *  group wins. "Which repo did I just touch?" is the question this
 *  answers; attention propagates inside a section via the row's state
 *  pip, not via section order. Groups always have ≥1 row (constructed
 *  from non-empty buckets), so the max is defined. */
function compareGroups(a: DockGroup, b: DockGroup): number {
  const ra = groupRecency(a);
  const rb = groupRecency(b);
  // Same NaN guard as `compareRows`: two all-never-active groups both rank
  // `-Infinity`, and the bare subtraction would be `NaN`.
  return ra === rb ? 0 : rb - ra;
}

function groupRecency(g: DockGroup): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const r of g.rows) {
    const rank = tsRank(r.ts);
    if (rank > max) max = rank;
  }
  return max;
}

/** A section's attention summary — the counts the header's `AttentionTriplet`
 *  renders. The SAME vocabulary, and the same PREDICATE, the host tab shows
 *  (active · needs-you · unread): `attentionActive` decides the rust count here
 *  exactly as it does on the tab and in each row's pip motion, so a section can
 *  never report a different number of busy terminals than the marks beneath it.
 *
 *  Asking and active are mutually exclusive — they answer the same question
 *  (what state is this terminal in) and a row paints one or the other. Unread
 *  is counted INDEPENDENTLY, because it is a different axis: state is the pip's
 *  colour, unread is the amber badge riding on top of it (the StatePip axis
 *  contract), and a row genuinely wears both. Rolling it into the state legs
 *  would make the header disagree with the row right beneath it.
 *
 *  Defined ONCE for both dock surfaces (desktop `Dock.tsx`, touch
 *  `DockList.tsx`) so the two headers cannot count differently. */
export function sectionAttention(
  rows: readonly RankedDockRow[],
  isUnread: (id: TerminalId) => boolean,
  attentionOf: (id: TerminalId) => TerminalAttention,
): { active: number; asking: number; unseen: number } {
  let active = 0;
  let asking = 0;
  let unseen = 0;
  for (const row of rows) {
    const attention = attentionOf(row.id);
    if (attention.klass === "asking") asking++;
    else if (isActive(attention)) active++;
    if (isUnread(row.id)) unseen++;
  }
  return { active, asking, unseen };
}
