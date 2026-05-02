/**
 * Zod schemas for the example domain.
 *
 * A tiny notes app: editor preferences (Cell), notes keyed by id
 * (Collection), full-text search (Stream), and an "auto-saved" toast
 * notification (Event). One file keeps the example readable end-to-end.
 *
 * Type aliases are exported only for the values App/router/store
 * actually reference. The `defineSurface` call in `cells.ts` infers all
 * the wire-shape types from these schemas — no need for `*PatchInput` /
 * `SearchInput` / `AutosaveEvent` aliases just for the contract.
 */

import { z } from "zod";

export const NoteIdSchema = z.string();
export type NoteId = z.infer<typeof NoteIdSchema>;

export const NoteSchema = z.object({
  id: NoteIdSchema,
  title: z.string(),
  body: z.string(),
  updatedAt: z.number(),
});
export type Note = z.infer<typeof NoteSchema>;

export const EditorPrefsSchema = z.object({
  fontSize: z.number().int().min(10).max(32),
  theme: z.enum(["light", "dark"]),
  autoSaveEnabled: z.boolean(),
});
export type EditorPrefs = z.infer<typeof EditorPrefsSchema>;

export const EditorPrefsPatchSchema = EditorPrefsSchema.partial();

export const DEFAULT_PREFS: EditorPrefs = {
  fontSize: 16,
  theme: "light",
  autoSaveEnabled: true,
};

export const SearchInputSchema = z.object({
  query: z.string(),
});

export const SearchResultSchema = z.object({
  matches: z.array(NoteIdSchema),
  query: z.string(),
});

export const AutosaveEventSchema = z.object({
  noteId: NoteIdSchema,
  noteTitle: z.string(),
  savedAt: z.number(),
});

export const NoteCreateInputSchema = z.object({
  title: z.string(),
});
