/**
 * In-memory state for the example.
 *
 * Three maps + one publisher. Notes are keyed by a generated id; the
 * key set evolves as notes are created/deleted. Preferences are a
 * singleton.
 *
 * Swap to disk-backed persistence by replacing `inMemoryStore` calls
 * in `router.ts` with `confStore` (see `@kolu/cells/server`) — wire
 * format is identical, only the storage adapter changes.
 */

import { publisherChannel } from "@kolu/cells/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { DEFAULT_PREFS, type EditorPrefs, type Note } from "../common/schemas";

// ── Publisher ─────────────────────────────────────────────────────────

// `MemoryPublisher`'s `Record<string, object>` generic is too strict for
// our primitive payloads (we publish `string` keys arrays etc.). Real
// type safety lives on the typed channels below.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export const publisher = new MemoryPublisher<Record<string, any>>();

// ── Singleton state: preferences ──────────────────────────────────────
let prefs: EditorPrefs = { ...DEFAULT_PREFS };
export const getPrefs = (): EditorPrefs => prefs;
export const setPrefs = (next: EditorPrefs): void => {
  prefs = next;
};

// ── Keyed state: notes ────────────────────────────────────────────────
const notes = new Map<string, Note>([
  [
    "welcome",
    {
      id: "welcome",
      title: "Welcome",
      body: "Edit me, create new notes with + New, or search above.",
      updatedAt: 0,
    },
  ],
]);

let nextId = 1;
export const newNoteId = (): string => `n${nextId++}`;

export const allNotes = (): Map<string, Note> => notes;
export const upsertNote = (id: string, value: Note): void => {
  notes.set(id, value);
};
export const removeNote = (id: string): void => {
  notes.delete(id);
};

// ── Domain-owned channel ──────────────────────────────────────────────
/** Per-note autosave channel — written by `scheduleAutosave` (router.ts),
 *  read as the source for the `autosave` event. The surface doesn't own
 *  event channels; this one is domain-managed and shared between the
 *  publish (debounce timer) and subscribe (event source) paths.
 *
 *  Cell + collection channels are surface-derived: `implementSurface`
 *  computes `"prefs:changed"`, `"notes:keys"`, and `"notes:<id>"` from
 *  the surface keys and wires them internally — no exports needed here. */
export const autosaveChannel = (id: string) =>
  publisherChannel<{ noteId: string; noteTitle: string; savedAt: number }>(
    publisher,
    `autosave:${id}`,
  );

// ── Search index helper (re-runs on each query) ───────────────────────
/** Run a case-insensitive substring match over titles and bodies. In a
 *  real app this would be backed by an external full-text index — kept
 *  inline here so the example is self-contained. The Stream re-runs the
 *  search whenever notes change, so the result auto-updates. */
export function searchNotes(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: string[] = [];
  for (const note of notes.values()) {
    const haystack = `${note.title}\n${note.body}`.toLowerCase();
    if (haystack.includes(q)) matches.push(note.id);
  }
  return matches;
}
