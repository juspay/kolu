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
 *  works, each item's row minted by its OWN memo, and the rows joined in
 *  chunks (`@kolu/surface/solid`) so the list is not as wide as the fleet
 *  either. A title change wakes one row.
 *
 *  EACH ROW READS THE SHARED SNAPSHOT, not the mirror's live record and not
 *  one of its own: `workSubtitle` walks the work's decisions and events,
 *  which off the store proxy is a source per event — past the 200-source
 *  judge at about 150 of them on ONE work, and these rows are live whether
 *  or not the palette is open. `useWorkRecords` holds ONE record
 *  (`../conductor/workRecord.ts`) per work for the whole app, which is one
 *  dependency here however long the timeline is. A record minted per row
 *  would be a SECOND memo per event and per decision of every work, standing
 *  for a section nobody may be looking at.
 *
 *  THE KEY IS REQUIRED, not decoration: `useWorks` mints a fresh `[id, work]`
 *  tuple on every run, so an unkeyed `mapArray` would rebuild every row each
 *  time the list recomputes (and trip `UNSTABLE_LIST_IDENTITY`). Keyed by the
 *  work id — the id a work IS — a row survives every re-sort of the list. */

import type { WorkRow } from "kolu-work";
import { type Accessor, createMemo, mapArray, untrack } from "solid-js";
import type { PaletteAction } from "../CommandPalette";
import { showWork } from "../conductor/workListing";
import { useWorkRecords } from "../conductor/useWorks";
import { workHost, workSubtitle } from "../conductor/workReadings";
import { joinRows } from "@kolu/surface/solid";

/** One row per work, each one its own memo — the palette's "works" section. */
export function workPaletteRows(
  works: Accessor<ReadonlyArray<WorkRow>>,
): Accessor<ReadonlyArray<PaletteAction>> {
  const records = useWorkRecords();
  const rows = mapArray(
    works,
    (row): Accessor<PaletteAction | undefined> => {
      // The key, read once: `mapArray` retains this row for as long as that
      // id is in the list, so the id cannot change under it. It is also all
      // this row takes from the list — the tuple `useWorks` mints fresh per
      // run is never read again, so its churn stops here.
      const id = untrack(() => row()[0]);
      // THE WORK AS THE APP'S ONE SNAPSHOT ({@link useWorkRecords}): the map
      // is re-minted only when the membership changes, and the row's own
      // dependency is that work's record accessor. A work that has left the
      // mirror reads `undefined`, and this row draws nothing.
      const work = createMemo(() => records().get(id)?.(), {
        name: "workPaletteRow.snapshot",
      });

      return createMemo(
        (): PaletteAction | undefined => {
          const one = work();
          if (one === undefined) return undefined;
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
  return joinRows("workPaletteRows", rows);
}
