/**
 * App-wide reactive surface, declared once via `defineSurface`.
 *
 * Single source of truth for the example domain — Effect Schemas, the spec,
 * and the inferred runtime types all live in this one file. Schemas
 * referenced from multiple positions in the spec (or needed to spell the
 * partial `patchSchema`) are named at the top; one-shot schemas are inline
 * in the spec literal. `SurfaceTypes` lifts the runtime types out of the
 * spec at the bottom — no parallel `typeof Schema.Type` aliases anywhere.
 *
 *   - `surface.group` is the flat Effect RPC group the server binds handlers
 *     on and every link is built over; each member sits at the wire tag
 *     `surface/<member>/<verb>`.
 *   - `surface.descriptors.{cells,collections,streams,events}` exposes the
 *     underlying primitives for callers that want to stay manual (the
 *     surface is opt-in, not exclusive).
 *
 * `prefs.patch` lives on the spec (shallow merge) so server and client
 * apply patches via the same function — no `applyPrefsPatch` helper
 * imported in two places.
 *
 * SCHEMA LAW: an optional wire key is `Schema.optionalKey`, never
 * `Schema.optional` — the latter round-trips an explicit `undefined` through
 * `null`, which changes the bytes. A defaulted wire key is
 * `Schema.withDecodingDefaultKey`, never `Schema.withDecodingDefault`.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { Schema } from "effect";

// ── Named schemas — referenced from multiple positions or for derivation ──

const NoteIdSchema = Schema.String;
const NoteSchema = Schema.Struct({
  id: NoteIdSchema,
  title: Schema.String,
  body: Schema.String,
  updatedAt: Schema.Number,
});

const FontSizeSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 10, maximum: 32 }),
);
const ThemeSchema = Schema.Literals(["light", "dark"]);

const EditorPrefsSchema = Schema.Struct({
  fontSize: FontSizeSchema,
  theme: ThemeSchema,
  autoSaveEnabled: Schema.Boolean,
});

/** The patch shape. Effect Schema has no `.partial()`, so the partial twin is
 *  spelled out over the SAME field schemas — which is why they are named above:
 *  the value schema and its patch cannot drift. Every key is `optionalKey`, so a
 *  patch omits what it does not touch and an omitted key stays ABSENT on the
 *  wire (never `null`). */
const EditorPrefsPatchSchema = Schema.Struct({
  fontSize: Schema.optionalKey(FontSizeSchema),
  theme: Schema.optionalKey(ThemeSchema),
  autoSaveEnabled: Schema.optionalKey(Schema.Boolean),
});

export const DEFAULT_PREFS: typeof EditorPrefsSchema.Type = {
  fontSize: 16,
  theme: "light",
  autoSaveEnabled: true,
};

// ── The surface ────────────────────────────────────────────────────────

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
      inputSchema: Schema.Struct({ query: Schema.String }),
      outputSchema: Schema.Struct({
        matches: Schema.Array(NoteIdSchema),
        query: Schema.String,
      }),
    },
  },
  events: {
    autosave: {
      inputSchema: NoteIdSchema,
      outputSchema: Schema.Struct({
        noteId: NoteIdSchema,
        noteTitle: Schema.String,
        savedAt: Schema.Number,
      }),
    },
  },
  // Imperative escape hatch: notes.create assigns the id server-side, so
  // it doesn't fit the collection's `upsert`-with-key shape.
  procedures: {
    notes: {
      create: {
        input: Schema.Struct({ title: Schema.String }),
        output: NoteSchema,
      },
    },
  },
});

// ── Inferred domain types — single source of truth ─────────────────────

type SF = SurfaceTypes<typeof surface.spec>;

export type NoteId = SF["collections"]["notes"]["Key"];
export type Note = SF["collections"]["notes"]["Value"];
export type EditorPrefs = SF["cells"]["prefs"]["Value"];
export type EditorPrefsPatch = SF["cells"]["prefs"]["Patch"];
export type SearchResult = SF["streams"]["search"]["Output"];
export type AutosaveEvent = SF["events"]["autosave"]["Payload"];
