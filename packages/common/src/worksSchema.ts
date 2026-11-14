/**
 * THE WORKS, as a browser is told about them — the `works` cell.
 *
 * The record itself is `kolu-work`'s ({@link WorkSchema}): what the Conductor
 * stated, what the human decided, what kolu observed. This cell adds the one
 * thing a browser cannot read for itself and kolu does not store — how each
 * member terminal STANDS and since when, which only kolu-server's watch sees
 * (it reads every host, including ones no browser has opened).
 *
 * A member's per-terminal wake bookkeeping (what the Conductor was told, whether
 * it was spoken to) never crosses this wire: that is the watch's working
 * memory, and nothing outside it can act on it.
 */

import { Schema } from "effect";
import { WorkSchema } from "kolu-work";
import { ConductorReadingLevelSchema } from "./conductorSchema.ts";

export const WorksViewSchema = Schema.Struct({
  /** Every work in progress (oldest first), then the finished ones (most
   *  recently ended first, at most `FINISHED_KEPT`). */
  works: Schema.Array(WorkSchema),
  /** HOW EACH MEMBER TERMINAL STANDS, and since when — one entry per terminal
   *  the watch has read in THIS process. Runtime only: an absent terminal is
   *  "not read yet", never "0s". */
  seen: Schema.Array(
    Schema.Struct({
      terminal: Schema.String,
      level: ConductorReadingLevelSchema,
      /** ISO time it entered that level, by the watcher's clock. */
      since: Schema.String,
    }),
  ),
});
export type WorksView = typeof WorksViewSchema.Type;

export const EMPTY_WORKS_VIEW: WorksView = { works: [], seen: [] };
