/** Singleton memo: the canonical dock tree (rank → filter parked →
 *  group by repo). One reactive value across every consumer — the
 *  desktop dock, the mobile drawer, and `App.tsx`'s `dockOrderedIds`
 *  feed for the `Cmd+1..9` keyboard shortcut — so the three surfaces
 *  cannot drift on row order.
 *
 *  Lazy `createRoot` initialization (via `createSharedRoot`) so the
 *  memo's reactive owner is the app itself, not whichever component
 *  happens to call `useDockOrder()` first. Without that, a fast-
 *  refresh or test teardown that disposed the first caller's owner
 *  would freeze the memo for every later consumer with no error to
 *  point at.
 *
 *  THE FOLD IS TWO LEVELS DEEP, because the dock is the one always-mounted
 *  surface that reads every terminal on the host. Ranked on one scope, a row
 *  cost five to seven store sources (the metadata slot and its projected
 *  record, the staleness clock, the attention class, the pane tree), which put
 *  the memo past Solid's 200-source `WIDE_SCOPE_DEPS` judge at about 29 tiles —
 *  and a tile that built its whole `subRows` sequence was wide on its OWN row
 *  at about 28 panes. So there is a row memo per TILE, a row memo per PANE
 *  inside it, and the joins ({@link joinRows}) that make each level one source
 *  to the level above. */

import { type Accessor, createMemo, mapArray } from "solid-js";
import type { TerminalId } from "kolu-common/surface";
import { useAttentionFacts } from "../../attention/useAttentionFacts";
import { sameEach, sameItems } from "../../conductor/sameItems";
import { createSharedRoot } from "../../createSharedRoot";
import { dockOrder } from "../../terminal/dockOrderPref";
import { showSleeping } from "../../terminal/showSleeping";
import { useStaleCheck } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileStore } from "../../tile/useTileStore";
import { foldEach, joinRows } from "@kolu/surface/solid";
import {
  type DockPaneRef,
  flattenPaneTree,
  prunePaneRows,
  rankPaneRow,
  type RankedDockRow,
  rankTileRow,
} from "./dockRowRanking";
import { buildDockTree, type DockRowSection, type DockTree } from "./dockTree";
import { encActiveHost } from "../../wire";

/** One tile's pane sequence, compared by what a pane IS rather than by the
 *  object the flattening minted for it this run. */
const samePanes = sameEach(
  (a: DockPaneRef, b: DockPaneRef) =>
    a.id === b.id && a.parentId === b.parentId && a.depth === b.depth,
);

/** Two readings of ONE pane's dock entry. Everything the entry carries, so a
 *  row that holds still is a row no surface below it wakes for. */
const samePaneRow = (
  a: RankedDockRow["subRows"][number],
  b: RankedDockRow["subRows"][number],
): boolean =>
  a.id === b.id &&
  a.parentId === b.parentId &&
  a.depth === b.depth &&
  a.kind === b.kind &&
  a.bucket === b.bucket &&
  a.pip === b.pip &&
  a.asking === b.asking &&
  a.ts === b.ts;

/** Two readings of ONE tile's row. Its panes are compared by REFERENCE —
 *  {@link samePaneRow} already gave each pane row a stable identity, so an
 *  unchanged family is an unchanged array. */
const sameTileRow = (
  a: RankedDockRow | undefined,
  b: RankedDockRow | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.id === b.id &&
    a.bucket === b.bucket &&
    a.pip === b.pip &&
    a.asking === b.asking &&
    a.ts === b.ts &&
    sameItems(a.subRows, b.subRows));

/** Two readings of one tile's section facts. */
const sameSection = (a: DockRowSection, b: DockRowSection): boolean =>
  a.group === b.group && a.label === b.label && a.color === b.color;

export const useDockOrder = createSharedRoot<Accessor<DockTree>>(() => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const isStale = useStaleCheck();
  const facts = useAttentionFacts();
  // The dock renders the ACTIVE host's terminals, so that is the frame every
  // row's class comes off — one derivation of the host key, read inside each
  // row that needs it.
  //
  // A row's PAINT is its attention class — the same value its motion and every
  // count read — so the dock reads it from the mirror rather than re-deriving a
  // colour from metadata that arrives on a different subscription. `classOf`
  // deliberately does not read the live set: a row's COLOUR moves on agent
  // transitions, not on the ~1 s byte tick. Its POSITION moves on neither.
  const classOf = (id: TerminalId) => facts.classOf(encActiveHost(), id);

  // The dock ranks TILES (today every tile is a terminal, so the id set equals
  // terminalIds()); per-row metadata + display still come off the terminal,
  // its content. PR 2's sleeping tiles join `tileIds()` and become dock rows
  // through this same seam, not a separate section.
  //
  // `rankTileRow` / `rankPaneRow` are pure — they read no signals — so the
  // reactive filter choices are read HERE (staleness threshold via `isStale`,
  // the attention class via `classOf`) and threaded in as arguments, keeping
  // the classification a testable pure projection.
  const rows = mapArray(
    tileStore.tileIds,
    (id) => {
      // The tile's panes, as the depth-first sequence the dock indents. One
      // source: the store's pane index — the SAME fact the canvas flattens
      // into its tab strip, handed over nested so the dock can indent it.
      // Never the raw one-hop `getSubTerminalIds`: that is the eviction path's
      // edge, and walking it here is what left a split of a split with no dock
      // row.
      const panes = createMemo(
        () => flattenPaneTree(store.getPaneTree(id), id),
        { name: "dockRanked.panes", equals: samePanes },
      );
      // Keyed by pane ID, not by the flattened entry, so a pane whose depth or
      // parent moved keeps its row memo instead of re-keying the whole family.
      const paneIds = createMemo(() => panes().map((pane) => pane.id), {
        name: "dockRanked.paneIds",
        equals: sameItems,
      });
      const paneIndex = createMemo(
        () => new Map(panes().map((pane) => [pane.id, pane])),
        { name: "dockRanked.paneIndex" },
      );
      const paneRows = foldEach(
        "dockRanked.pane",
        paneIds,
        (paneId) => {
          const pane = paneIndex().get(paneId);
          return pane === undefined
            ? undefined
            : rankPaneRow(pane, store.getMetadata, classOf);
        },
        samePaneRow,
      );
      return createMemo(
        () =>
          rankTileRow(
            id,
            prunePaneRows(id, paneRows()),
            store.getMetadata,
            isStale,
            classOf,
          ),
        { name: "dockRanked.row", equals: sameTileRow },
      );
    },
    { name: "dockRanked.byTile" },
  );
  const ranked = joinRows("dockRanked", rows);

  // WHERE EACH TILE FILES, read per tile for the same reason the ranking is:
  // `getDisplayInfo` hands back a projection STORE row, so the three facts the
  // tree groups by are three leaves on it. Read on the tree's own scope they
  // would have grown with the fleet; read here they are one row's own three,
  // and the tree reads the joined table.
  const sections = foldEach(
    "dockSection",
    tileStore.tileIds,
    (id): (DockRowSection & { id: TerminalId }) | undefined => {
      const info = store.getDisplayInfo(id);
      return info === undefined
        ? undefined
        : {
            id,
            group: info.key.group,
            label: info.key.label,
            color: info.repoColor,
          };
    },
    (a, b) => a.id === b.id && sameSection(a, b),
  );
  const sectionOf = createMemo(
    () => new Map(sections().map((row) => [row.id, row])),
    { name: "dockSectionOf" },
  );

  // Split from the ranking above so the ☾ toggle doesn't re-do the
  // classification: that pass is O(n) over the tiles and staleness, and is
  // memoized on its own. Flipping `showSleeping` OR the dragged arrangement
  // (both read as arguments below) invalidates only this grouping. (#2141 made
  // row order structural; #2247 adds ONE user-order stable sort in
  // `buildDockTree`, so the cost this split protects is still the classify
  // pass, not a comparator.)
  return createMemo(
    () =>
      buildDockTree(
        ranked(),
        (id) => sectionOf().get(id),
        !showSleeping(),
        dockOrder(),
      ),
    { name: "dockTree" },
  );
});
