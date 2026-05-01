/**
 * The four descriptors — one of each primitive.
 *
 * Pure data. Server imports them to wire handlers; client imports them
 * to wire hooks. The `applyPrefsPatch` helper sits next to `prefsCell`
 * so the descriptor and its merge shape are read together (matches
 * Kolu's `applyPreferencesPatch` pattern).
 */

import { cell, collection, event, stream } from "@kolu/cells";
import {
  AutosaveEventSchema,
  DEFAULT_PREFS,
  type EditorPrefs,
  type EditorPrefsPatch,
  EditorPrefsSchema,
  NoteIdSchema,
  NoteSchema,
  SearchInputSchema,
  SearchResultSchema,
} from "./schemas";

/** Cell — editor preferences (singleton, persistable, mutable). */
export const prefsCell = cell({
  name: "prefs",
  schema: EditorPrefsSchema,
  default: DEFAULT_PREFS,
});

/** Collection — notes keyed by id (each independently observable). */
export const notesCollection = collection({
  name: "notes",
  keySchema: NoteIdSchema,
  schema: NoteSchema,
});

/** Stream — search results parameterized by query string. */
export const searchStream = stream({
  name: "search",
  inputSchema: SearchInputSchema,
  outputSchema: SearchResultSchema,
});

/** Event — autosave notification (point-in-time fire, no current value). */
export const autosaveEvent = event({
  name: "autosave",
  inputSchema: NoteIdSchema,
  outputSchema: AutosaveEventSchema,
});

/** Pure merge of a partial preferences patch into the current prefs.
 *  Used by both server (`cellHandlers.patch`) and client
 *  (`useCell({ applyPatch })`) so the merge shape is one canonical
 *  function. */
export function applyPrefsPatch(
  current: EditorPrefs,
  patch: EditorPrefsPatch,
): EditorPrefs {
  return { ...current, ...patch };
}
