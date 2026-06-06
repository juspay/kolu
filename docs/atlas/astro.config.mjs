// @ts-check

import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import remarkGfm from "remark-gfm";

import stableInlineStyles from "./build/stable-inline-styles.mjs";

// Self-contained, internal Atlas — NOT published anywhere. Deliberately
// decoupled from the public website (../../website). Built locally via
// `just atlas::build`; the dist/ output is committed so each page previews in
// kolu's Code tab without a dev server.
const DEV_PORT = 4331;

export default defineConfig({
  trailingSlash: "ignore",
  // `file` emits <slug>.html (not <slug>/index.html), so dist/ is a flat set of
  // siblings that cross-link with plain relative hrefs (./other.html) — which is
  // exactly what resolves inside kolu's Code-tab preview iframe. `inlineStylesheets`
  // makes each page self-contained (no hashed _astro bundle to churn git).
  build: { format: "file", inlineStylesheets: "always" },
  server: { port: DEV_PORT, host: "127.0.0.1" },
  // `stableInlineStyles` re-derives each page's inlined <head> CSS from its own
  // components after the build, so a new component usage anywhere can't reshuffle
  // the chunks inlined into unrelated pages (issue #1209). Runs after mdx().
  integrations: [mdx(), stableInlineStyles()],
  markdown: {
    // GFM tables/strikethrough/autolinks. Astro applies GFM to `.md` by default
    // but it does not reach the MDX pipeline, so add it explicitly here —
    // @astrojs/mdx extends `markdown.remarkPlugins`, so this covers .md + .mdx.
    remarkPlugins: [remarkGfm],
    shikiConfig: { theme: "github-light", wrap: false },
  },
});
