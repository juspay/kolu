/** Group ranked dock rows by repo into sections the dock renders.
 *
 *  Pure projection, and — since #2141 — a pure *bucketing*: it sorts nothing.
 *  `rankDockRows` hands over rows in creation order (padi's registry insertion
 *  order, which `listTerminals` contracts); this module files each into its
 *  repo section and branch cluster and preserves that order throughout.
 *
 *  **Structure decides position; the clock decides nothing.** Sections appear
 *  in first-appearance order, clusters likewise, rows in creation order — all
 *  three fall out of `Map` insertion order for free, because the rows arrive
 *  already ordered. The property that buys is APPEND-ONLY: nothing on screen
 *  moves except what you created or closed. That is what makes the list
 *  learnable and, with it, `Cmd+1..9` (which binds to `flatShortcutRows`)
 *  worth memorising. The previous design sorted all three levels by `ts`, so a
 *  background agent finishing a turn re-ordered a list you were reading and
 *  silently renumbered every shortcut.
 *
 *  Inside a section, rows are **clustered by branch/intent label** so two
 *  terminals on the same branch stay adjacent. This is the one grouping that
 *  can move a row away from strict creation order, and it is structural — it
 *  moves on a re-checkout, not on a clock.
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

export type DockGroup = {
  /** `info.key.group` — git repo name or cwd basename. */
  name: string;
  /** Per-repo OKLCH color (`info.repoColor`). */
  color: string;
  /** Top-level rows inside this group, in creation order, with same-branch
   *  siblings kept adjacent via cluster grouping. */
  topRows: readonly RankedDockRow[];
  /** Every row belonging to this repo, INCLUDING the ones the activity window
   *  parked and the ☾ toggle is hiding — what the header's attention summary
   *  counts. The counts must not move when you toggle a filter: an agent that
   *  has been blocked on you long enough to fall out of the activity window is
   *  the one you most need told about, and folding over the visible rows alone
   *  reported it as zero — the header quietly agreeing with a dock that had
   *  hidden the problem. Same order as `rows`, filters not applied. */
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
      allTopRows: RankedDockRow[];
      /** Blocked entries accumulated in the SAME pass that visits the row, so
       *  the strip costs no second walk over every row and every split. */
      needsYou: DockNeedsYouEntry[];
    }
  >();
  let parkedCount = 0;
  let sleepingCount = 0;
  let hiddenCount = 0;

  /** Is this row one the two filters remove from the tree? ONE reading of the
   *  rule, used to drop rows at the end — never to decide where the survivors
   *  sit. That distinction is the whole point: see the bucketing note below. */
  const filteredOut = (row: RankedDockRow): boolean =>
    row.bucket === "parked" || (row.bucket === "sleeping" && hideSleeping);

  for (const row of ranked) {
    // Resolve the repo AND the branch cluster BEFORE the filters, so a hidden
    // row still joins its group's `allTopRows` (its attention must reach the
    // header) and — the #2141 correction — so the filters cannot decide where
    // the VISIBLE rows sit.
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    let group = byName.get(info.key.group);
    if (!group) {
      group = {
        color: info.repoColor,
        byLabel: new Map(),
        allTopRows: [],
        needsYou: [],
      };
      byName.set(info.key.group, group);
    }
    group.allTopRows.push(row);
    if (row.bucket === "parked") parkedCount++;
    // Count every fresh sleeping row so the footer toggle knows the total,
    // whether or not the ☾ toggle is currently showing it.
    if (row.bucket === "sleeping") sleepingCount++;
    // Counted THROUGH the predicate, not re-derived as arithmetic beside it.
    // `parkedCount`/`sleepingCount` are footer DISCLOSURES with their own
    // meanings; this is the filter rule, and it has exactly one spelling — so
    // "add a third filter and this term grows here" is true of the code and not
    // only of the doc.
    const hidden = filteredOut(row);
    if (hidden) hiddenCount++;
    // The strip's entry, decided HERE — the row and its filter verdict are both
    // already in hand, so a second walk over every row (and, through
    // `needsYouEntry`, every split beneath it) would be re-deriving what this
    // iteration holds. It runs on every tree rebuild, including the ones the
    // 60s staleness tick drives and the common one where nothing is blocked.
    for (const entry of needsYouEntries(row)) {
      group.needsYou.push({ ...entry, hiddenByFilter: hidden });
    }
    const list = group.byLabel.get(info.key.label);
    if (list) list.push(row);
    else group.byLabel.set(info.key.label, [row]);
  }

  // `byName` and each `byLabel` are `Map`s filled in row order, and the rows
  // arrived in creation order — so plain iteration already yields
  // first-appearance sections holding first-appearance clusters. There is no
  // sort here to delete a comparator from; the order is the input's.
  //
  // Both maps are filled from the UNFILTERED stream, and the filters apply
  // only at the flatten below. Bucketing after the filters looked equivalent
  // and was not: cluster first-appearance would then be decided by the visible
  // rows alone, so a row crossing the activity window — a pure 60s CLOCK tick,
  // no user action behind it — could reorder the rows that remain, and
  // renumber `Cmd+1..9` with them. `byName` was already filter-independent;
  // this makes `byLabel` agree, so a row's slot is a function of the row set
  // and its label, and hiding a row only ever removes it.
  const allGroups: DockGroup[] = [...byName.entries()].map(([name, g]) => {
    const topRows = [...g.byLabel.values()]
      .flat()
      .filter((row) => !filteredOut(row));
    const railEntries = topRows.flatMap<DockRailEntry>((row) => [
      { kind: "top", row },
      ...row.subRows.map((sub) => ({ kind: "split" as const, row: sub })),
    ]);
    return {
      name,
      color: g.color,
      topRows,
      allTopRows: g.allTopRows,
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
    flatShortcutRows,
    // Accumulated in the build loop above, over the UNFILTERED rows and in
    // structural order — the same set and the same `asking` test the section
    // headers count with, so the capsule and the strip are two reads of one
    // rule instead of two folds that happened to agree. Filtered rows come
    // through marked rather than dropped.
    needsYou: [...byName.values()].flatMap((g) => g.needsYou),
    parkedCount,
    sleepingCount,
    hiddenCount,
    hasContent:
      flatShortcutRows.length > 0 || parkedCount > 0 || sleepingCount > 0,
  };
}
