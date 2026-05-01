/**
 * oRPC router — wires the contract entries to framework handlers.
 *
 * One handler builder per primitive:
 *   - prefsCell        → cellHandlers
 *   - notesCollection  → collectionHandlers
 *   - searchStream     → streamHandlers (poll-on-event source)
 *   - autosaveEvent    → eventHandlers
 *
 * Plus the imperative `notes.create` mutation (cell descriptors don't
 * cover ID assignment), and a debounced autosave loop that fires the
 * Event whenever a note is updated.
 */

import {
  cellHandlers,
  collectionHandlers,
  eventHandlers,
  pollOnEvent,
  streamHandlers,
} from "@kolu/cells/server";
import { implement } from "@orpc/server";
import {
  applyPrefsPatch,
  autosaveEvent,
  notesCollection,
  prefsCell,
  searchStream,
} from "../common/cells";
import { contract } from "../common/contract";
import {
  allNotes,
  autosaveChannel,
  getPrefs,
  newNoteId,
  noteChannel,
  noteKeysChannel,
  prefsChannel,
  removeNote,
  searchNotes,
  setPrefs,
  upsertNote,
} from "./store";

const t = implement(contract);

// ── Cell ──────────────────────────────────────────────────────────────
const prefsHandlers = cellHandlers(prefsCell, {
  store: { get: getPrefs, set: setPrefs },
  bus: prefsChannel,
  patch: applyPrefsPatch,
});

// ── Collection ────────────────────────────────────────────────────────
const notesHandlers = collectionHandlers(notesCollection, {
  readAll: () => allNotes(),
  upsert: (key, value) => {
    upsertNote(key, value);
    noteKeysChannel.publish(Array.from(allNotes().keys()));
    noteChannel(key).publish(value);
    scheduleAutosave(value);
  },
  remove: (key) => {
    removeNote(key);
    noteKeysChannel.publish(Array.from(allNotes().keys()));
  },
  perKeyBus: noteChannel,
  keysBus: noteKeysChannel,
});

// ── Stream ────────────────────────────────────────────────────────────
const searchHandlers = streamHandlers(searchStream, {
  source: (input, signal) =>
    pollOnEvent({
      // Re-run the search whenever the notes set changes (good enough for
      // the example — a real index would notify selectively per-note).
      // The Stream's first yield is the initial result; subsequent yields
      // fire only when the matches list actually differs.
      read: async () => ({
        matches: searchNotes(input.query),
        query: input.query,
      }),
      isEqual: (a, b) =>
        a.query === b.query &&
        a.matches.length === b.matches.length &&
        a.matches.every((id, i) => id === b.matches[i]),
      install: (cb) => subscribeForCallback(noteKeysChannel.subscribe, cb),
      signal,
    }),
});

// ── Event ─────────────────────────────────────────────────────────────
const autosaveHandlers = eventHandlers(autosaveEvent, {
  // No snapshot: the per-note autosave channel just forwards each
  // debounced "saved" notification. Late subscribers miss past saves.
  source: (id, signal) => autosaveChannel(id).subscribe(signal),
});

// ── Helpers ───────────────────────────────────────────────────────────

/** Convert a `(signal) => AsyncIterable<T>` into a callback-style
 *  subscription suitable for `pollOnEvent.install`. */
function subscribeForCallback<T>(
  subscribe: (signal: AbortSignal | undefined) => AsyncIterable<T>,
  cb: () => void,
): () => void {
  const ctrl = new AbortController();
  void (async () => {
    try {
      for await (const _ of subscribe(ctrl.signal)) {
        if (ctrl.signal.aborted) break;
        cb();
      }
    } catch {
      // Expected on abort; nothing else can fail in our subscribe path.
    }
  })();
  return () => ctrl.abort();
}

/** Debounced autosave fire — coalesces rapid edits into one event. */
const pendingAutosaves = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleAutosave(note: { id: string; title: string }): void {
  const existing = pendingAutosaves.get(note.id);
  if (existing) clearTimeout(existing);
  pendingAutosaves.set(
    note.id,
    setTimeout(() => {
      pendingAutosaves.delete(note.id);
      autosaveChannel(note.id).publish({
        noteId: note.id,
        noteTitle: note.title,
        savedAt: Date.now(),
      });
    }, 500),
  );
}

// ── Router ────────────────────────────────────────────────────────────
export const appRouter = t.router({
  prefs: {
    get: t.prefs.get.handler(prefsHandlers.get),
    patch: t.prefs.patch.handler(prefsHandlers.patch),
  },
  notes: {
    keys: t.notes.keys.handler(notesHandlers.keys),
    get: t.notes.get.handler(notesHandlers.get),
    update: t.notes.update.handler(notesHandlers.update),
    delete: t.notes.delete.handler(notesHandlers.delete),
    create: t.notes.create.handler(async ({ input }) => {
      const id = newNoteId();
      const note = {
        id,
        title: input.title,
        body: "",
        updatedAt: Date.now(),
      };
      upsertNote(id, note);
      noteKeysChannel.publish(Array.from(allNotes().keys()));
      noteChannel(id).publish(note);
      return note;
    }),
  },
  search: {
    get: t.search.get.handler(searchHandlers.get),
  },
  autosave: {
    get: t.autosave.get.handler(autosaveHandlers.get),
  },
});
