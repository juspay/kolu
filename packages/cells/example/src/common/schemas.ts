/**
 * Zod schemas for the example domain.
 *
 * A tiny notes app: editor preferences (Cell), notes keyed by id
 * (Collection), full-text search (Stream), and an "auto-saved" toast
 * notification (Event). One file keeps the example readable end-to-end.
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
export type EditorPrefsPatch = z.infer<typeof EditorPrefsPatchSchema>;

export const DEFAULT_PREFS: EditorPrefs = {
  fontSize: 16,
  theme: "light",
  autoSaveEnabled: true,
};

export const SearchInputSchema = z.object({
  query: z.string(),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

export const SearchResultSchema = z.object({
  matches: z.array(NoteIdSchema),
  query: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const AutosaveEventSchema = z.object({
  noteId: NoteIdSchema,
  noteTitle: z.string(),
  savedAt: z.number(),
});
export type AutosaveEvent = z.infer<typeof AutosaveEventSchema>;

export const NoteCreateInputSchema = z.object({
  title: z.string(),
});
export type NoteCreateInput = z.infer<typeof NoteCreateInputSchema>;

export const NoteUpdateInputSchema = z.object({
  key: NoteIdSchema,
  value: NoteSchema,
});
export type NoteUpdateInput = z.infer<typeof NoteUpdateInputSchema>;
