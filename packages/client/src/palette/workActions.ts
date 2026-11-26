/** Works → palette rows, ONE MEMO PER WORK.
 *
 *  A work row says a work's title and where it is, and every word of that is
 *  read off the work RECORD — a mirrored store, so `work.title`,
 *  `workSubtitle`'s walk of `key`/`decisions`/`events` and `workHost`'s read
 *  of the key's host are each a separate leaf subscription. Built inside the
 *  palette's one command-list memo, those leaves all land on THAT scope: a
 *  fleet of twenty works puts a couple of hundred sources on a single
 *  computation, which then re-runs whole for any one of them (and does so
 *  while the palette is shut). Solid's development build says exactly this —
 *  `WIDE_SCOPE_DEPS`, and `HUGE_FAN_IN` at conductor scale.
 *
 *  So the rows are built per record instead: a keyed `mapArray` over the
 *  works, each item's row minted by its OWN memo. The list memo then tracks N
 *  row memos and nothing else, and a title change wakes one row.
 *
 *  THE KEY IS REQUIRED, not decoration: `useWorks` mints a fresh `[id, work]`
 *  tuple on every run, so an unkeyed `mapArray` would rebuild every row each
 *  time the list recomputes (and trip `UNSTABLE_LIST_IDENTITY`). Keyed by the
 *  work id — the id a work IS — a row survives every re-sort of the list. */

import type { WorkRow } from "kolu-work";
import { type Accessor, createMemo, mapArray, untrack } from "solid-js";
import type { PaletteAction } from "../CommandPalette";
import { showWork } from "../conductor/workListing";
import { workHost, workSubtitle } from "../conductor/workReadings";

/** One row per work, each one its own memo — the palette's "works" section. */
export function workPaletteRows(
  works: Accessor<ReadonlyArray<WorkRow>>,
): Accessor<PaletteAction[]> {
  const rows = mapArray(
    works,
    (row): Accessor<PaletteAction> => {
      // The key, read once: `mapArray` retains this row for as long as that
      // id is in the list, so the id cannot change under it.
      const id = untrack(() => row()[0]);
      // The record, behind a memo so the tuple churn above stops here: the
      // mirrored store proxy keeps its identity across publishes, so this
      // memo re-runs on a new tuple and notifies nothing, and the row below
      // wakes only for ITS OWN work's leaves.
      const work = createMemo(() => row()[1], { name: "workPaletteRecord" });
      return createMemo(
        (): PaletteAction => {
          const one = work();
          return {
            kind: "action",
            name: one.title,
            description: workSubtitle(one, workHost(one)).join(" · "),
            section: "works",
            onSelect: () => showWork(id),
          };
        },
        { name: "workPaletteRow" },
      );
    },
    { keyed: ([id]) => id, name: "workPaletteRowsByWork" },
  );
  return createMemo(() => rows().map((one) => one()), {
    name: "workPaletteRows",
  });
}
