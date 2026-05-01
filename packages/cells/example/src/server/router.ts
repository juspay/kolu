/**
 * oRPC router built from `surface.implement` — one declarative call wires
 * every cell, collection, stream, event, and imperative procedure declared
 * in `common/surface.ts`.
 *
 * The surface owns publish channels for cells and collections (channel
 * names derived from the surface key). Consumer-supplied `upsert`/`remove`
 * stay persistence-only; the framework wraps them so every change
 * broadcasts through the surface's channels. Imperative procedures get a
 * typed `ctx` (`ctx.collections.notes.upsert(...)`) so cross-descriptor
 * publishes route through the same channels.
 */

import {
  implementSurface,
  pollOnEvent,
  publisherChannel,
} from "@kolu/cells/server";
import { surface } from "../common/surface";
import {
  allNotes,
  autosaveChannel,
  getPrefs,
  newNoteId,
  publisher,
  removeNote,
  searchNotes,
  setPrefs,
  upsertNote,
} from "./store";

export const appRouter = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),

  cells: {
    prefs: {
      // patch fn comes from `surface.cells.prefs.patch` on the spec —
      // server and client share one merge function, no duplicate import.
      store: { get: getPrefs, set: setPrefs },
    },
  },

  collections: {
    notes: {
      readAll,
      upsert: (key, value) => {
        upsertNote(key, value);
        scheduleAutosave(value);
      },
      remove: removeNote,
    },
  },

  streams: {
    search: {
      source: (input, signal) =>
        pollOnEvent({
          // Re-run the search whenever the notes set changes (good enough
          // for the example — a real index would notify selectively
          // per-note). The Stream's first yield is the initial result;
          // subsequent yields fire only when matches actually differ.
          read: async () => ({
            matches: searchNotes(input.query),
            query: input.query,
          }),
          isEqual: (a, b) =>
            a.query === b.query &&
            a.matches.length === b.matches.length &&
            a.matches.every((id, i) => id === b.matches[i]),
          install: (cb) => subscribeForCallback(cb),
          signal,
        }),
    },
  },

  events: {
    autosave: {
      // Per-note channel: each note id has its own subscribe stream.
      // Channel managed in store.ts (not surface-derived) so the publish
      // path inside scheduleAutosave can write to the same instance.
      source: (id, signal) => autosaveChannel(id).subscribe(signal),
    },
  },

  procedures: {
    notes: {
      // Imperative create — server assigns the id; the surface's wrapped
      // upsert publishes through the framework's note channels.
      create: async ({ input, ctx }) => {
        const id = newNoteId();
        const note = {
          id,
          title: input.title,
          body: "",
          updatedAt: Date.now(),
        };
        ctx.collections.notes.upsert(id, note);
        return note;
      },
    },
  },
});

// ── Helpers (search-tick subscription, autosave debounce) ──────────────

function readAll(): Map<
  string,
  ReturnType<typeof allNotes> extends Map<infer _K, infer V> ? V : never
> {
  return allNotes();
}

/** Convert the surface's keys-channel into a callback-style subscription
 *  for `pollOnEvent.install`. Subscribes via the publisher directly so the
 *  `notes:keys` channel matches what `implementSurface` emits. */
function subscribeForCallback(cb: () => void): () => void {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const sub = publisherChannel<unknown>(
        // biome-ignore lint/suspicious/noExplicitAny: matches publisher generic at use site
        publisher as any,
        "notes:keys",
      ).subscribe(ctrl.signal);
      for await (const _ of sub) {
        if (ctrl.signal.aborted) break;
        cb();
      }
    } catch {
      // Expected on abort.
    }
  })();
  return () => ctrl.abort();
}

/** Debounced autosave fire — coalesces rapid edits into one event.
 *  Publishes to `autosaveChannel` (managed in store.ts), which the
 *  surface's `events.autosave.source` subscribes to. */
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
