/**
 * oRPC contract — the typed wire shape both server and client agree on.
 *
 * One block per primitive, plus the imperative procedures (`create`)
 * that don't fit any descriptor. The collection's `update` / `delete`
 * / `test__set` shapes match what `collectionHandlers` produces.
 */

import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  AutosaveEventSchema,
  EditorPrefsPatchSchema,
  EditorPrefsSchema,
  NoteCreateInputSchema,
  NoteIdSchema,
  NoteSchema,
  NoteUpdateInputSchema,
  SearchInputSchema,
  SearchResultSchema,
} from "./schemas";

export const contract = oc.router({
  // ── Cell: editor preferences ─────────────────────────────────────────
  prefs: {
    get: oc.output(eventIterator(EditorPrefsSchema)),
    patch: oc.input(EditorPrefsPatchSchema).output(z.void()),
  },
  // ── Collection: notes keyed by id ────────────────────────────────────
  notes: {
    keys: oc.output(eventIterator(z.array(NoteIdSchema))),
    get: oc
      .input(z.object({ key: NoteIdSchema }))
      .output(eventIterator(NoteSchema)),
    update: oc.input(NoteUpdateInputSchema).output(z.void()),
    delete: oc.input(z.object({ key: NoteIdSchema })).output(z.void()),
    // Imperative create — the framework's collection contract doesn't
    // cover ID assignment, so this stays a regular RPC.
    create: oc.input(NoteCreateInputSchema).output(NoteSchema),
  },
  // ── Stream: full-text search over notes ──────────────────────────────
  search: {
    get: oc.input(SearchInputSchema).output(eventIterator(SearchResultSchema)),
  },
  // ── Event: autosave notifications ────────────────────────────────────
  autosave: {
    get: oc.input(NoteIdSchema).output(eventIterator(AutosaveEventSchema)),
  },
});
