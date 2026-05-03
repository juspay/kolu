/**
 * App-wide reactive surface, declared once via `defineSurface`.
 *
 * Single source of truth for the example domain — Zod schemas, the spec,
 * and the inferred runtime types all live in this one file. Schemas
 * referenced from multiple positions in the spec (or derived for
 * `.partial()`) are named at the top; one-shot schemas are inline in the
 * spec literal. `SurfaceTypes` lifts the runtime types out of the spec at
 * the bottom — no parallel `z.infer<typeof Schema>` aliases anywhere.
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

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";

// ── Named schemas — referenced from multiple positions or for derivation ──

const NoteIdSchema = z.string();
const NoteSchema = z.object({
  id: NoteIdSchema,
  title: z.string(),
  body: z.string(),
  updatedAt: z.number(),
});
const EditorPrefsSchema = z.object({
  fontSize: z.number().int().min(10).max(32),
  theme: z.enum(["light", "dark"]),
  autoSaveEnabled: z.boolean(),
});

export const DEFAULT_PREFS: z.infer<typeof EditorPrefsSchema> = {
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
      patchSchema: EditorPrefsSchema.partial(),
      patch: (current, patch) => ({ ...current, ...patch }),
    },
  },
  collections: {
    notes: { keySchema: NoteIdSchema, schema: NoteSchema },
  },
  streams: {
    search: {
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({
        matches: z.array(NoteIdSchema),
        query: z.string(),
      }),
    },
  },
  events: {
    autosave: {
      inputSchema: NoteIdSchema,
      outputSchema: z.object({
        noteId: NoteIdSchema,
        noteTitle: z.string(),
        savedAt: z.number(),
      }),
    },
  },
  // Imperative escape hatch: notes.create assigns the id server-side, so
  // it doesn't fit the collection's `upsert`-with-key shape.
  procedures: {
    notes: {
      create: {
        input: z.object({ title: z.string() }),
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
