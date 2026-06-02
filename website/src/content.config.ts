import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default("Sridhar Ratnakumar"),
    authorUrl: z.string().url().default("https://srid.ca/"),
  }),
});

// The Atlas: kolu's in-repo knowledge base, authored in markdown and
// rendered here by Astro. The generated index (src/pages/atlas/index.astro)
// is derived from this collection, so a note can never be "unfiled" — which
// is why the Atlas needs no hand-curated MOC and no docs-moc CI gate.
// `draft: true` keeps an internal/half-baked note out of the public build
// while it still lives in-repo and stays readable by agents from disk.
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

export const collections = { blog, atlas };
