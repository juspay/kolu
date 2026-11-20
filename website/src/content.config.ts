import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docPage = z.object({
  title: z.string(),
  description: z.string().optional(),
  order: z.number().default(0),
  section: z.string().optional(),
  koluHero: z
    .object({
      eyebrow: z.string().optional(),
      headline: z.string(),
      image: z.string().optional(),
      imageAlt: z.string().optional(),
    })
    .optional(),
});

const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/docs" }),
  schema: docPage,
});

const surface = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/surface" }),
  schema: docPage,
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default("Sridhar Ratnakumar"),
    authorUrl: z.string().url().default("https://srid.ca/"),
  }),
});

const changelog = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/changelog",
  }),
  schema: z.union([
    z.object({
      version: z.literal("Unreleased"),
      date: z.never().optional(),
      summary: z.never().optional(),
    }),
    z.object({
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      date: z.coerce.date(),
      summary: z.string().min(1),
    }),
  ]),
});

export const collections = { docs, surface, blog, changelog };
