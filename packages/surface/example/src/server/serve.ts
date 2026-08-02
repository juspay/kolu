/**
 * The served surface — one declarative `implementSurfaceOnPublisher` call wires
 * every cell, collection, stream, event, and imperative procedure declared in
 * `common/surface.ts`.
 *
 * What comes back is a `SurfaceRuntime`: a flat `group` (the Effect RPC group
 * `defineSurface` minted) plus `handlers` — one bound member handler per wire
 * tag. That PAIR is what every transport takes: `serveSurfaceSocket({ group,
 * handlers, socket })` here, `serveOverStdio` / `serveOverUnixSocket` elsewhere,
 * `directDispatch({ handlers })` in-process. There is no router any more; a tag
 * carries its own route.
 *
 * The surface owns publish channels for cells and collections (channel names
 * derived from the surface key). Consumer-supplied `upsert`/`remove` stay
 * persistence-only; the framework wraps them so every change broadcasts through
 * the surface's channels. Imperative procedures get a typed `ctx`
 * (`ctx.collections.notes.upsert(...)`) so cross-descriptor publishes route
 * through the same channels — and they return an `Effect`, so a declared failure
 * is `Effect.fail` and anything undeclared stays a defect.
 */

import {
  implementSurfaceOnPublisher,
  publisherChannel,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import { Effect, Stream } from "effect";
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

export const runtime = implementSurfaceOnPublisher(
  surface,
  {
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
        // One-shot per query: emit the search result for the current query and
        // end. The client's `.use()` re-subscribes whenever its input signal
        // changes, so each keystroke opens a fresh stream that runs once.
        // `Stream.suspend` defers the search to SUBSCRIBE time, so a stream
        // value held un-run costs nothing and a re-subscribe really re-searches.
        source: (input) =>
          Stream.suspend(() =>
            Stream.succeed({
              matches: searchNotes(input.query),
              query: input.query,
            }),
          ),
      },
    },

    events: {
      autosave: {
        // Per-note channel: each note id has its own subscribe stream. The
        // channel is managed in store.ts (not surface-derived) so the publish
        // path inside `scheduleAutosave` writes to the same instance.
        //
        // `Channel<T>.subscribe` is an AbortSignal-shaped producer, and the
        // framework's members are Streams — `streamFromAbortableSource` is the
        // ONE sanctioned bridge between the two: it scopes an `AbortController`
        // to the stream, so interrupting the consuming fiber (the subscriber
        // going away) aborts the subscription exactly as a `close()` used to.
        source: (id) =>
          streamFromAbortableSource((signal) =>
            autosaveChannel(id).subscribe(signal),
          ),
      },
    },

    procedures: {
      notes: {
        // Imperative create — server assigns the id; the surface's wrapped
        // upsert publishes through the framework's note channels. The handler
        // returns an `Effect`: `Effect.sync` here, because nothing about
        // creating a note can fail in a way a caller could act on (an
        // undeclared throw stays a defect, which is the loud channel).
        create: ({ input, ctx }) =>
          Effect.sync(() => {
            const id = newNoteId();
            const note = {
              id,
              title: input.title,
              body: "",
              updatedAt: Date.now(),
            };
            ctx.collections.notes.upsert(id, note);
            return note;
          }),
      },
    },
  },
  <T>(name: string) => publisherChannel<T>(publisher, name),
);

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
