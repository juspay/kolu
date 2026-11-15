/**
 * THE WORKS, as a browser is told about them — the `works` and `memberReadings`
 * COLLECTIONS of `koluSurface`.
 *
 * The record itself is `kolu-work`'s ({@link WorkSchema}): what the Conductor
 * stated, what the human decided, what kolu observed. It rides the `works`
 * collection keyed by work id, so a work that moved sends ITSELF and nothing
 * else — an agent-state event on one piece of work used to re-send every work
 * (the finished twenty included) to every connected browser.
 *
 * This module adds the one thing a browser cannot read for itself and kolu does
 * not store — how each member terminal STANDS and since when, which only
 * kolu-server's watch sees (it reads every host, including ones no browser has
 * opened). That is its own collection keyed by terminal ref for the same
 * reason: a member's level changes on its own clock, and a reader of the record
 * has no business re-receiving it.
 *
 * A member's per-terminal wake bookkeeping (what the Conductor was told, whether
 * it was spoken to) never crosses this wire: that is the watch's working
 * memory, and nothing outside it can act on it.
 */

import { Schema } from "effect";
import { ConductorReadingLevelSchema } from "./conductorSchema.ts";

/** HOW ONE MEMBER TERMINAL STANDS, and since when — the value of the
 *  `memberReadings` collection, keyed by the terminal's `<host>/<id>` ref.
 *  Runtime only: an absent key is "not read yet", never "0s". */
export const MemberReadingSchema = Schema.Struct({
  level: ConductorReadingLevelSchema,
  /** ISO time it entered that level, by the watcher's clock. */
  since: Schema.String,
});
export type MemberReading = typeof MemberReadingSchema.Type;
