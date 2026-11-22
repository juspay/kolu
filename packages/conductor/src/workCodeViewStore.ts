/**
 * WHERE EACH WORK'S CODE VIEW STANDS, AND ITS ONE WRITER.
 *
 * A person's place in a work's files — the mode, the file open in each mode —
 * keyed by work id: the `workCodeViews` key of `config.json` and the
 * `workCodeViews` collection of the wire. A record of its own beside the
 * works rather than a field of a work: it moves on every file click, and a
 * work changed on each would republish its whole record and mark the works
 * file for writing.
 *
 * ITS LIFE IS ITS WORK'S. An entry is kept only for a work kolu holds; the
 * rule is {@link WorkCodeViewStore.keepOnly}, which the work store asks
 * wherever a work can go (`workStore.ts`), so no view outlives its work.
 */

import { Schema } from "effect";
import { type WorkCodeView, WorkCodeViewSchema } from "kolu-common/works";
import type { WorkId } from "kolu-work";
import type { PersistedWorkCodeViews } from "./persisted.ts";
import type { RecordWrites } from "./recordWrites.ts";

export interface WorkCodeViewStore {
  /** The boot read. */
  readonly load: (views: PersistedWorkCodeViews) => void;
  /** What the `workCodeViews` key holds. */
  readonly read: () => PersistedWorkCodeViews;
  /** Put one work's view where a person left it — a whole-record replace.
   *  A write equal to what is held is DROPPED: the browser reports on every
   *  file click, and an unchanged view is neither republished nor written.
   *  Whether the work exists is the caller's to check. */
  readonly set: (id: WorkId, view: WorkCodeView) => void;
  /** EVERY VIEW, REPLACED — a restored backup. Followed by
   *  {@link keepOnly}, so a view whose work the snapshot lacks goes. */
  readonly restore: (views: PersistedWorkCodeViews) => void;
  /** THE RULE: keep a view only for a work kolu holds. Every other entry
   *  goes, from the record and from every reader. */
  readonly keepOnly: (works: ReadonlySet<WorkId>) => void;
}

export interface WorkCodeViewStoreDeps {
  readonly records: RecordWrites<"workCodeViews">;
  /** A view moved, or went (`null`). */
  readonly publish: (id: WorkId, view: WorkCodeView | null) => void;
}

const sameView = Schema.toEquivalence(WorkCodeViewSchema);

export const workCodeViewStore = (
  deps: WorkCodeViewStoreDeps,
): WorkCodeViewStore => {
  const views = new Map<WorkId, WorkCodeView>();

  return {
    load: (kept) => {
      for (const [id, view] of Object.entries(kept)) {
        views.set(id, view);
        deps.publish(id, view);
      }
    },
    read: () => Object.fromEntries(views),
    set: (id, view) => {
      const held = views.get(id);
      if (held !== undefined && sameView(held, view)) return;
      views.set(id, view);
      deps.publish(id, view);
      deps.records.schedule("workCodeViews");
    },
    restore: (kept) => {
      for (const id of views.keys()) if (!(id in kept)) deps.publish(id, null);
      views.clear();
      for (const [id, view] of Object.entries(kept)) {
        views.set(id, view);
        deps.publish(id, view);
      }
      deps.records.now("workCodeViews");
    },
    keepOnly: (works) => {
      let dropped = false;
      for (const id of [...views.keys()]) {
        if (works.has(id)) continue;
        views.delete(id);
        deps.publish(id, null);
        dropped = true;
      }
      if (dropped) deps.records.schedule("workCodeViews");
    },
  };
};
