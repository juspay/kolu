import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

// kolu's Atlas — the in-repo knowledge base, authored in markdown/MDX and
// rendered by this self-contained Astro project. The generated index
// (src/pages/index.astro) is derived from this collection's frontmatter, so a
// note can never be "unfiled" — which is why the Atlas needs no hand-curated MOC
// and no docs-moc CI gate. `draft: true` keeps an internal/half-baked note out
// of the index while it still lives in-repo and stays readable by agents.
const atlas = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/atlas" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // The category that groups a note in the index. `bug` = a diagnosed defect +
    // fix direction; `feature` = a proposed capability not yet built; `analysis`
    // = an investigation into how the system behaves; `reference` = durable
    // knowledge (designs, decisions, how-it-works). The index renders one section
    // per category (see src/lib/indexTree.ts), so this axis is the primary
    // skeleton — `parents` only nests notes *within* a category.
    kind: z
      .enum(["bug", "feature", "analysis", "reference"])
      .default("reference"),
    maturity: z.enum(["seedling", "budding", "evergreen"]).default("budding"),
    status: z
      .enum(["proposed", "accepted", "implemented", "superseded"])
      .optional(),
    // Optional MOC edges: id(s) (flat slugs) of the notes this one nests under
    // in the generated index. Accepts one slug or a list — a note can have
    // multiple parents (e.g. its design parent + a cross-cutting `bugs` hub) and
    // appears under each. No valid parent (missing/self/draft/cyclic) → a root,
    // so membership stays automatic; only the edges are authored.
    parents: z.union([z.string(), z.array(z.string())]).optional(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { atlas };
