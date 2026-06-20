import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

// kolu's Atlas — the in-repo knowledge base, authored in markdown/MDX and
// rendered by this self-contained Astro project. The entry page
// (src/pages/index.astro) is the graph + Maps of Content, derived entirely from
// this collection: notes, and the `parents` edges between them. A category like
// Bugs or Features is NOT a hardcoded axis — it's just a note marked `moc: true`
// that other notes are filed under via `parents`; add another any time.
// `draft: true` keeps an internal/half-baked note out of the build while it still
// lives in-repo and stays readable by agents.
const atlas = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/atlas" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // A Map-of-Content / index node: a note that indexes the notes filed under it
    // (via their `parents`) and renders large in the graph. The categories
    // (Bugs · Features · Analysis · Reference) are exactly such notes — there is
    // no closed `kind` enum, so a new index is just a new `moc: true` note.
    moc: z.boolean().default(false),
    // Presentation accent for an index node (a token like "red"/"teal"/"gold"/
    // "grey"); regular notes inherit the accent of the index they're filed under.
    color: z.string().optional(),
    // Display order among index notes (graph legend + Maps of Content); lower
    // first, unset sorts last.
    order: z.number().optional(),
    maturity: z.enum(["seedling", "budding", "evergreen"]).default("budding"),
    status: z
      .enum(["proposed", "accepted", "implemented", "superseded"])
      .optional(),
    // The edges to the notes this one is filed under — its index (an `moc` note)
    // and/or topical hubs. One slug or a list; a note appears under each. No valid
    // parent (missing/self/cyclic) → a root. This is the ONE membership mechanism:
    // there is no separate `kind` field.
    parents: z.union([z.string(), z.array(z.string())]).optional(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { atlas };
