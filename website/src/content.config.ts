import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Shared schema for the doc-shaped collections (docs + surface). Both render
// through DocsLayout, so they carry the same frontmatter: a sidebar-orderable
// page with an optional section group and an optional bespoke hero.
const docPage = z.object({
  title: z.string(),
  description: z.string().optional(),
  // Sidebar ordering (ascending; ties broken by title).
  order: z.number().default(0),
  // Optional grouping label for the sidebar. The mechanism supports the
  // Diátaxis quadrants (tutorials / how-to / reference / explanation) — but we
  // ship no empty sections: a group appears only once a page opts into it.
  section: z.string().optional(),
  // Optional bespoke hero (eyebrow · accent-word headline · product mark),
  // rendered by KoluHero. OPTIONAL by design: a plain page with only `title`
  // still gets a kolu-styled headline, so a new .md needs zero per-page work.
  koluHero: z
    .object({
      eyebrow: z.string().optional(),
      // Wrap a word in {curly braces} to paint it in the accent colour; use
      // line breaks for a multi-line headline.
      headline: z.string(),
      image: z.string().optional(),
      imageAlt: z.string().optional(),
    })
    .optional(),
});

// The docs collection, mounted at the site ROOT: src/content/docs/<slug>.mdx is
// rendered by src/pages/[slug].astro at /<slug>, so padi/kaval/architecture keep
// their exact URLs. Same glob-loader shape as the blog collection — the docs are
// the site's own design language by construction (rendered through DocsLayout),
// with no separate docs framework.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/docs" }),
  schema: docPage,
});

// The Surface collection — the four-quadrant Diátaxis home for the @kolu/surface
// framework, mounted under its OWN top-level prefix: src/content/surface/<slug>.mdx
// renders at /surface/<slug> (and index.mdx at /surface) via src/pages/surface/.
// A sibling of `docs` rather than a nested section so it carries its own sidebar
// and top-nav entry, keeping the product docs and the framework docs distinct.
const surface = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/surface" }),
  schema: docPage,
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

export const collections = { docs, surface, blog, changelog };
