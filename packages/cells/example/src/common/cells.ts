/**
 * App-wide reactive surface, declared once via `defineMatrix`.
 *
 *   - `matrix.contract` is the generated oRPC router (replaces the old
 *     hand-listed `contract.ts`).
 *   - `matrix.descriptors.{cells,collections,streams,events}` exposes the
 *     underlying primitives for callers that want to stay manual (the
 *     matrix is opt-in, not exclusive).
 *
 * The `applyPrefsPatch` helper sits next to the matrix so the patch shape
 * lives one read away from the descriptor.
 */

import { defineMatrix } from "@kolu/cells/define";
import {
  AutosaveEventSchema,
  DEFAULT_PREFS,
  type EditorPrefs,
  type EditorPrefsPatch,
  EditorPrefsPatchSchema,
  EditorPrefsSchema,
  NoteCreateInputSchema,
  NoteIdSchema,
  NoteSchema,
  SearchInputSchema,
  SearchResultSchema,
} from "./schemas";

export const matrix = defineMatrix({
  cells: {
    prefs: {
      schema: EditorPrefsSchema,
      default: DEFAULT_PREFS,
      patchSchema: EditorPrefsPatchSchema,
    },
  },
  collections: {
    notes: { keySchema: NoteIdSchema, schema: NoteSchema },
  },
  streams: {
    search: {
      inputSchema: SearchInputSchema,
      outputSchema: SearchResultSchema,
    },
  },
  events: {
    autosave: {
      inputSchema: NoteIdSchema,
      outputSchema: AutosaveEventSchema,
    },
  },
  // Imperative escape hatch: notes.create assigns the id server-side, so
  // it doesn't fit the collection's `update`-with-key shape.
  procedures: {
    notes: {
      create: { input: NoteCreateInputSchema, output: NoteSchema },
    },
  },
});

/** Re-exported descriptor handles. The example's hooks/handlers still use
 *  these directly in Phase A; Phases B/C move them onto matrix.implement
 *  / matrix.client. */
export const { prefs: prefsCell } = matrix.descriptors.cells;
export const { notes: notesCollection } = matrix.descriptors.collections;
export const { search: searchStream } = matrix.descriptors.streams;
export const { autosave: autosaveEvent } = matrix.descriptors.events;

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
