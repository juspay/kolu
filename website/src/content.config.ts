import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Starlight's docs collection, mounted at the site root. padi/kaval/architecture
// live here as src/content/docs/*.mdx and serve at /padi, /kaval, /architecture.
//
// The schema is extended with an optional `koluHero` so a page can carry the
// site's bespoke hero (eyebrow · big headline with an accent word · right-side
// product mark) — rendered by the KoluHero PageTitle override. It's OPTIONAL by
// design: a plain doc with only `title` still renders a kolu-styled title, so a
// new .md inherits the theme with zero per-page work.
const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema({
    extend: z.object({
      koluHero: z
        .object({
          // Mono uppercase kicker above the headline.
          eyebrow: z.string().optional(),
          // The big display headline. Wrap a word in {curly braces} to paint it
          // in the accent colour; use line breaks for multi-line headlines.
          headline: z.string(),
          // Optional product mark shown glowing on the right (e.g. a logo svg).
          image: z.string().optional(),
          imageAlt: z.string().optional(),
        })
        .optional(),
    }),
  }),
});

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

export const collections = { docs, blog, changelog };
