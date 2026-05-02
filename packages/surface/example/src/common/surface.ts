/**
 * App-wide reactive surface, declared once via `defineSurface`.
 *
 *   - `surface.contract` is the generated oRPC router.
 *   - `surface.descriptors.{cells,collections,streams,events}` exposes the
 *     underlying primitives for callers that want to stay manual (the
 *     surface is opt-in, not exclusive).
 *
 * `prefs.patch` lives on the spec (shallow merge) so server and client
 * apply patches via the same function — no `applyPrefsPatch` helper
 * imported in two places.
 */

import { defineSurface } from "@kolu/surface/define";
import {
  AutosaveEventSchema,
  DEFAULT_PREFS,
  EditorPrefsPatchSchema,
  EditorPrefsSchema,
  NoteCreateInputSchema,
  NoteIdSchema,
  NoteSchema,
  SearchInputSchema,
  SearchResultSchema,
} from "./schemas";

export const surface = defineSurface({
  cells: {
    prefs: {
      schema: EditorPrefsSchema,
      default: DEFAULT_PREFS,
      patchSchema: EditorPrefsPatchSchema,
      patch: (current, patch) => ({ ...current, ...patch }),
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
