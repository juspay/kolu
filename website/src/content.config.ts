import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    // An optional deck: one plain line under the title that decrypts an
    // evocative headline into what the reader will actually learn.
    subtitle: z.string().optional(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default("Sridhar Ratnakumar"),
    authorUrl: z.string().url().default("https://srid.ca/"),
  }),
});

// Changelog — one entry per release, plus a perpetual `unreleased.mdx` the
// agent appends to on every user-facing PR. A dateless entry is the open
// Unreleased section; `/release X.Y.Z` stamps it with a version + date.
const changelog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/changelog" }),
  schema: z.object({
    // The renderer sorts and anchors dated entries on an `X.Y.Z` shape; the
    // perpetual unreleased entry carries the literal `Unreleased` placeholder
    // (it's filtered out before any sort/anchor). Enforce that shape here so a
    // malformed version fails the build instead of mis-sorting silently.
    version: z.union([
      z.literal("Unreleased"),
      z.string().regex(/^\d+\.\d+\.\d+$/),
    ]),
    date: z.coerce.date().optional(),
  }),
});

export const collections = { blog, changelog };
