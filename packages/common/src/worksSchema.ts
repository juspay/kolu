/**
 * THE WORKS, as a browser is told about them — the `works`, `memberReadings`
 * and `workCodeViews` COLLECTIONS of `koluSurface`.
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
 *
 * And one thing a PERSON sets: where each work's Code view stands — its mode
 * and the file open in each mode ({@link WorkCodeViewSchema}), a collection
 * of its own keyed by work id, so a file click sends one small record rather
 * than republishing the work.
 */

import {
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  RightPanelPerTerminalStateSchema,
} from "@kolu/padi-client/surface";
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

/** WHERE A WORK'S CODE VIEW STANDS — the mode and the file selected in each
 *  mode, the two fields the Right panel keeps per pane, taken from that
 *  record's own schema so they are spelled once. The value of the
 *  `workCodeViews` collection and of `config.json`'s `workCodeViews` key,
 *  keyed by work id. Back/forward is not here: it lives in the browser, as
 *  the Right panel's does. */
export const WorkCodeViewSchema = Schema.Struct({
  codeMode: RightPanelPerTerminalStateSchema.fields.codeMode,
  selectedFileByMode:
    RightPanelPerTerminalStateSchema.fields.selectedFileByMode,
});
export type WorkCodeView = typeof WorkCodeViewSchema.Type;

/** A work whose Code view nobody has moved yet stands where a fresh pane's
 *  does. */
export const DEFAULT_WORK_CODE_VIEW: WorkCodeView = {
  codeMode: DEFAULT_RIGHT_PANEL_PER_TERMINAL.codeMode,
};

/** The input of `conductor.setWorkCodeView` — the work, and its WHOLE view:
 *  a replace, never a patch, as the Right panel's own report is. */
export const WorkCodeViewInputSchema = Schema.Struct({
  work: Schema.String,
  view: WorkCodeViewSchema,
});
