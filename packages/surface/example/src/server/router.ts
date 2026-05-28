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

import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { implement } from "@orpc/server";
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

const { router: surfaceRouter } = implementSurface(surface, {
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
      readAll: allNotes,
      upsert: (key, value) => {
        upsertNote(key, value);
        scheduleAutosave(value);
      },
      remove: removeNote,
    },
  },

  streams: {
    search: {
      // One-shot per query: yield the search result for the current
      // query and close. The client's `useStream` re-subscribes whenever
      // its input signal changes, so each keystroke spawns a fresh
      // subscription that runs once. The example doesn't track notes
      // changes for live re-fire — that would either be a client-side
      // `createMemo` over the bound notes view (zero wire) or, if
      // genuinely needed server-side, a future "derived stream"
      // primitive over a graph dep.
      source: async function* (input) {
        yield {
          matches: searchNotes(input.query),
          query: input.query,
        };
      },
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

// `implementSurface` returns a fragment shaped `{ surface: t.router(...) }`
// — a router fragment that the consumer wraps once via
// `implement(contract).router({...fragment})` (or spreads alongside other
// namespaces, as Kolu's main router does). Passing the fragment straight
// to `RPCHandler` produces a `/surface/surface/...` double-prefix in the
// matcher tree (every client request 404s).
export const appRouter = implement(surface.contract).router({
  ...surfaceRouter,
});

// ── Helpers (autosave debounce) ────────────────────────────────────────

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
