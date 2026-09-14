/** Group ranked dock rows by repo into sections the dock renders.
 *
 *  Pure projection, and — since #2141 — first a pure *bucketing*: `rankDockRows`
 *  hands over rows in creation order (padi's registry insertion order, which
 *  `listTerminals` contracts), this module files each into its repo section and
 *  branch cluster, and one optional step sequences the buckets by the user's
 *  dragged {@link DockOrder}. Anything never dragged keeps structural order.
 *
 *  **Structure decides position; the clock decides nothing.** Sections appear
 *  in first-appearance order (unless you dragged them), clusters likewise, rows
 *  in creation order — the default list falls out of `Map` insertion order for
 *  free, because the rows arrive already ordered. The property that buys is
 *  APPEND-ONLY unless you act: nothing on screen moves except what you created,
 *  closed, **or dragged**. That is what makes the list learnable and, with it,
 *  `Cmd+1..9` (which binds to `flatShortcutRows`) worth memorising. The previous
 *  design sorted all three levels by `ts`, so a background agent finishing a
 *  turn re-ordered a list you were reading and silently renumbered every
 *  shortcut.
 *
 *  Inside a section, rows are **clustered by branch/intent label** so two
 *  terminals on the same branch stay adjacent. This is the one grouping that
 *  can move a row away from strict creation order, and it is structural — it
 *  moves on a re-checkout, not on a clock. The arrangement overlay reorders the
 *  CLUSTERS, never the rows inside one: a dragged cluster keeps its rows in
 *  creation order.
 *
 *  **Blocked-on-you rows are surfaced, not promoted.** An agent that has waited
 *  20 hours must not hide in a long list — colour and animation alone
 *  demonstrably failed to surface it (fucknotif). It earns a place in
 *  {@link DockTree.needsYou}, the pinned strip the dock renders above the
 *  sections, which MIRRORS the row rather than relocating it: the row keeps its
 *  structural slot and its shortcut number, and the list underneath never
 *  reflows. A fixed place that fills and empties beats a list that rearranges
 *  itself around the thing you were meant to notice.
 *
 *  That claim is only true if the strip is folded over the UNFILTERED rows, and
 *  it now is. A twenty-hour wait falls out of every finite activity window, so a
 *  strip built from the visible rows hid exactly the agent the sentence above
 *  promises to surface — and hid it silently, while the section header above
 *  went on counting it. The strip carries `hiddenByFilter` instead, so the
 *  filters still decide the SECTIONS and no longer decide attention.
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
 *  `flatShortcutRows` is the top-level order `App.tsx` projects to feed
 *  `ActionContext.dockOrderedIds`. Splits deliberately do not claim numeric
 *  shortcuts. `railEntries` is the separate expanded projection for the
 *  collapsed rail, where every split still earns a landing chip.
 *
 *  Repo identity comes from `info.key.group` — the same canonical key
 *  `placementPolicy.ts:getBucketFor` uses for canvas tile clustering,
 *  so the dock's "what counts as one repo" agrees with the canvas. */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import {
  type NeedsYouEntry,
  needsYouEntries,
  type RankedDockRow,
} from "./dockRowRanking";

/** User arrangement of the dock — names, not ids, so the order survives
 *  restarts and terminal churn. The READ shape `buildDockTree` merges as an
 *  overlay over structural (creation) order; `effectiveOrder` produces it from
 *  a rendered tree, and a drop handler writes the moved result back through
 *  `setDockOrder`. One node per repo, its branches in display order.
 *
 *  Two known edges keying by names, both intended: two clones sharing a repo
 *  name already share one dock section, so they share one slot; and a branch
 *  rename/re-checkout yields a new label that appends at the bottom of its
 *  repo (the old name's pinned position is gone with it). */
export type DockOrder = readonly { repo: string; labels: readonly string[] }[];

/** One branch/intent cluster — the draggable unit inside a repo section:
 *  a named group of rows that drag together. */
export type DockClusterSection = {
  /** The cluster's branch/intent label — `info.key.label`. */
  label: string;
  /** Rows in creation order, ALREADY filtered by the dock's two filters —
   *  the rows the section renders. $(ref: `DockGroup.labels`) is the
   *  broader, order-ranking source of truth for a cluster whose every row
   *  is hidden. */
  rows: readonly RankedDockRow[];
};

export type DockGroup = {
  /** `info.key.group` — git repo name or cwd basename. */
  name: string;
  /** Per-repo OKLCH color (`info.repoColor`). */
  color: string;
  /** Branch clusters in DISPLAY order — the draggable unit. Rows inside a
   *  cluster are in creation order and FILTERED by the dock's two filters
   *  (rendering never sees a hidden row); a cluster is dropped only when
   *  every row failed the filters. Dragging a cluster lifts its rows. */
  clusters: readonly DockClusterSection[];
  /** Cluster labels in display order, INCLUDING ones whose every row is
   *  filtered out — a filter hides ROWS, it must never erase the slot a
   *  drag pinned. Written back on the next drop via `effectiveOrder`. */
  labels: readonly string[];
  /** Top-level rows inside this group, in creation order within their branch
   *  cluster, same-branch siblings kept adjacent. Derived from `clusters`
   *  after the filters — literally `clusters.flatMap(rows)`. */
  topRows: readonly RankedDockRow[];
  /** Every row belonging to this repo, INCLUDING the ones the activity window
   *  parked and the ☾ toggle is hiding — what the header's attention summary
   *  counts. Same DISPLAY order as `clusters` (pre-filter), so "needs-you in
   *  the same order as below" holds by construction. */
  allTopRows: readonly RankedDockRow[];
  /** Expanded rendered-entry projection. Its length is the section's visible
   * terminal count; shortcut indices remain on top-level rows only. */
  railEntries: readonly DockRailEntry[];
};

export type DockRailEntry =
  | { kind: "top"; row: RankedDockRow }
  | { kind: "split"; row: RankedDockRow["subRows"][number] };

/** One entry of the pinned strip: `needsYouEntry`'s tile/blocked pair plus the
 *  one fact only this module can answer — whether the dock's own filters
 *  removed the tile from the sections below. */
export type DockNeedsYouEntry = NeedsYouEntry & {
  /** The activity window parked this tile, or the ☾ toggle is hiding it. The
   *  strip shows it ANYWAY, marked: an agent that has waited long enough to
   *  fall out of a 4h window is the exact agent this strip exists for, and
   *  hiding it there was the module header's own stated failure mode. The
   *  entry still lands — `tileStore.activate` does not need a dock row. */
  hiddenByFilter: boolean;
};

export type DockTree = {
  groups: readonly DockGroup[];
  /** Every repo in sequenced (display) order, INCLUDING those whose rows are
   *  all filtered out — the pre-`groups` view. The renderer uses `groups`
   *  (a repo with no visible rows has no header to hang its attention on), but
   *  {@link effectiveOrder} walks THIS list so a filter can never drop a
   *  repo's stored slot from the arrangement: the filters only hide rows, they
   *  must not erase a repo's place in it. */
  allGroups: readonly DockGroup[];

  /** Flat top-level order across all groups. `App.tsx` projects ids from this
   *  list for `Cmd+1..9`; splits are intentionally absent because the rail's
   *  expanded entry projection does not change shortcut numbering.
   *
   *  Now that no layer sorts on a clock, this list is APPEND-ONLY under
   *  ordinary use — which is the whole reason `Cmd+3` is worth learning. The
   *  needs-you strip deliberately does NOT feed it: the strip mirrors rows, so
   *  letting it contribute would renumber every shortcut the moment an agent
   *  blocked, reintroducing exactly what this change removed. */
  flatShortcutRows: readonly RankedDockRow[];

  /** Rows blocked on YOU, in the same structural order they appear below — the
   *  pinned strip's contents ({@link needsYouEntries}).
   *
   *  A MIRROR, not a relocation: each row keeps its slot, its section, and its
   *  shortcut number, and appears here as well. That duplication is the point —
   *  it is what lets the list underneath stay perfectly still while attention
   *  still gets a fixed, glanceable home. Empty (the common case) means the
   *  strip renders nothing at all.
   *
   *  Folded over **`allTopRows`** — the UNFILTERED set, the same one the repo
   *  section headers count — through the same `asking` test their fold uses. So
   *  a header capsule reading "1" can no longer sit above an empty strip. It
   *  used to: the header deliberately counts unfiltered rows ("an agent blocked
   *  long enough to fall out of the activity window is precisely the one whose
   *  count must still show") while the strip was built from the FILTERED
   *  `flatShortcutRows` for the opposite documented reason. Both reasons were
   *  good and nothing recorded that they were in tension; with a 4h window set,
   *  the twenty-hour agent this module's header names was the one row missing.
   *  Filtered rows now arrive here carrying `hiddenByFilter` instead. */
  needsYou: readonly DockNeedsYouEntry[];
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

/** Build the dock tree. THREE clearly separated steps:
 *
 *  1. **Bucket** — file every row (UNFILTERED, creation order) into its repo
 *     and branch cluster. Nothing else. The counts that are order-independent
 *     (`parked`, `sleeping`, `hidden`) are totalled here, once, in the same
 *     pass that visits the rows.
 *  2. **Sequence** — build a name→index lookup from `order` ONCE (no `indexOf`
 *     inside a comparator), then stable-sort the `byName` entries by repo
 *     index and each group's `byLabel` entries by label index. A repo or label
 *     absent from `order` sorts AFTER every pinned one, keeping its
 *     first-appearance order among the unpinned — so an empty `order` is
 *     exactly the pre-#2247 structural list, and anything never dragged keeps
 *     behaving as before.
 *  3. **Derive** — one pass over the sequenced buckets producing every
 *     projection from the same sequence: `clusters` → `allTopRows` → `topRows`
 *     → `railEntries` → `needsYou`, then `flatShortcutRows` / `needsYou`
 *     across groups. Every projection reads the same sequence, so "needs-you
 *     is in the same order as below" is true BY CONSTRUCTION — and the old
 *     intra-group drift the doc called out (the strip accumulated in creation
 *     order while `topRows` showed cluster order) cannot exist.
 *
 *  The order overlay NEVER moves a row the filters have kept: `order` decides
 *  where a REPO or CLUSTER sits, and the filters still only remove rows — a
 *  row the window parks leaves but the survivors keep their relative order. */
export function buildDockTree(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  hideSleeping: boolean,
  order: DockOrder = [],
): DockTree {
  /** Is this row one the two filters remove from the tree? ONE reading of the
   *  rule, used to drop rows at the end — never to decide where the survivors
   *  sit. That distinction is the whole point: see the bucketing note. */
  const filteredOut = (row: RankedDockRow): boolean =>
    row.bucket === "parked" || (row.bucket === "sleeping" && hideSleeping);

  // ---- Step 1: Bucket ------------------------------------------------
  // File each row into its repo/branch cluster, in creation order, BEFORE the
  // filters — so a hidden row still joins its group's clusters (its attention
  // must reach the header) and, the #2141 correction, so the filters cannot
  // decide where the VISIBLE rows sit.
  const byName = new Map<
    string,
    {
      color: string;
      byLabel: Map<string, RankedDockRow[]>;
      needsYou: DockNeedsYouEntry[];
    }
  >();
  let parkedCount = 0;
  let sleepingCount = 0;
  let hiddenCount = 0;

  for (const row of ranked) {
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    let group = byName.get(info.key.group);
    if (!group) {
      group = {
        color: info.repoColor,
        byLabel: new Map(),
        needsYou: [],
      };
      byName.set(info.key.group, group);
    }
    if (row.bucket === "parked") parkedCount++;
    // Count every fresh sleeping row so the footer toggle knows the total,
    // whether or not the ☾ toggle is currently showing it.
    if (row.bucket === "sleeping") sleepingCount++;
    // Counted THROUGH the predicate, not re-derived as arithmetic beside it.
    // `parkedCount`/`sleepingCount` are footer DISCLOSURES with their own
    // meanings; this is the filter rule, and it has exactly one spelling.
    if (filteredOut(row)) hiddenCount++;
    const list = group.byLabel.get(info.key.label);
    if (list) list.push(row);
    else group.byLabel.set(info.key.label, [row]);
  }

  // ---- Step 2: Sequence ---------------------------------------------
  // Build the name→index lookup from the user's order ONCE. Absent names rank
  // after every pinned one (an index past the end, `Infinity`), keeping
  // first-appearance order among themselves — so nothing ever dragged stays
  // put. Each `labelIdx` map is the same one-slot lookup for a group's labels.
  const repoIdx = new Map<string, number>();
  const labelIdx = new Map<string, Map<string, number>>();
  for (const [i, node] of order.entries()) {
    repoIdx.set(node.repo, i);
    const labels = new Map<string, number>();
    for (const [j, label] of node.labels.entries()) labels.set(label, j);
    labelIdx.set(node.repo, labels);
  }
  const sequencedRepos = [...byName.entries()].sort(([a], [b]) => {
    const ia = repoIdx.get(a) ?? Infinity;
    const ib = repoIdx.get(b) ?? Infinity;
    return ia - ib;
  });

  // ---- Step 3: Derive -----------------------------------------------
  // ONE pass over the sequenced buckets; every projection reads the same
  // sequence. `allGroups` carries every repo INCLUDING those with all rows
  // filtered out, so a filter can never drop a repo's stored slot — while the
  // `groups` handed to the renderer drops the all-hidden ones (no header with
  // no rows). The needs-you entries are folded here, in sequence, beside the
  // rows they mirror.
  const allGroups: DockGroup[] = sequencedRepos.map(([name, g]) => {
    const labelRank = labelIdx.get(name);
    const sequenced = [...g.byLabel.entries()].sort(([a], [b]) => {
      const ia = labelRank?.get(a) ?? Infinity;
      const ib = labelRank?.get(b) ?? Infinity;
      return ia - ib;
    });
    // `labels` keeps every slot — including clusters whose every row is
    // hidden — so a filter can never re-arrange what a drop pinned.
    const labels = sequenced.map(([label]) => label);
    const clusters = sequenced
      .map(([label, rows]) => ({
        label,
        rows: rows.filter((row) => !filteredOut(row)),
      }))
      .filter(({ rows }) => rows.length > 0);
    const allTopRows = sequenced.flatMap(([, rows]) => rows);
    const topRows = clusters.flatMap((c) => c.rows);
    const railEntries = topRows.flatMap<DockRailEntry>((row) => [
      { kind: "top", row },
      ...row.subRows.map((sub) => ({ kind: "split" as const, row: sub })),
    ]);
    // The strip's entry, folded over the SAME sequenced unfiltered rows the
    // header counts — so strip membership and order agree with the sections
    // below by construction.
    for (const row of allTopRows) {
      const hidden = filteredOut(row);
      for (const entry of needsYouEntries(row)) {
        g.needsYou.push({ ...entry, hiddenByFilter: hidden });
      }
    }
    return {
      name,
      color: g.color,
      clusters,
      labels,
      allTopRows,
      topRows,
      railEntries,
    };
  });
  // A repo whose every row is filtered out has no header to hang its
  // attention on; the footer's "N hidden" disclosure is what surfaces it.
  // The strip still walks `allGroups` below — a repo whose ONLY row is a
  // parked blocked agent must not lose it along with its header.
  const groups = allGroups.filter((g) => g.topRows.length > 0);

  const flatShortcutRows = groups.flatMap((g) => g.topRows);
  return {
    groups,
    allGroups,
    flatShortcutRows,
    // Folded in the derive pass above, over the UNFILTERED sequenced rows and
    // in the same order they appear — walked from `sequencedRepos` (the
    // SEQUENCED buckets), so a repo pinned later in the arrangement, or one
    // whose every row is filtered out, still contributes its entries in
    // displayed order. Same set and same `asking` test the section headers
    // count with.
    needsYou: sequencedRepos.flatMap(([, g]) => g.needsYou),
    parkedCount,
    sleepingCount,
    hiddenCount,
    hasContent:
      flatShortcutRows.length > 0 || parkedCount > 0 || sleepingCount > 0,
  };
}

/** The order the tree is currently showing, in {@link DockOrder} shape — what
 *  a drop writes back via `setDockOrder`. Built from `tree.allGroups` (the
 *  SEQUENCED buckets, including groups whose rows are all filtered out), not
 *  the filtered `groups` — a filter never erases a repo's or cluster's place
 *  from the arrangement, it only hides the rows. */
export function effectiveOrder(tree: DockTree): DockOrder {
  return tree.allGroups.map((g) => ({ repo: g.name, labels: g.labels }));
}
