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
    kind: z
      .enum(["plan", "design", "review", "retro", "research", "decision"])
      .default("plan"),
    maturity: z.enum(["seedling", "budding", "evergreen"]).default("budding"),
    status: z
      .enum(["proposed", "accepted", "implemented", "superseded"])
      .optional(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { atlas };
