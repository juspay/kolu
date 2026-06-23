// @ts-check

import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";

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
    // GFM (tables/strikethrough/autolinks) needs no project-level plugin on
    // Astro 7 — each content type gets it from a different built-in:
    //   .md  → Astro 7's new default Sätteri/pulldown-cmark parser handles GFM.
    //   .mdx → `@astrojs/mdx@7` bundles `remark-gfm` internally (Astro 6's
    //          `@astrojs/mdx@5` did not — hence the explicit `remark-gfm` we
    //          used to need here).
    shikiConfig: { theme: "github-light", wrap: false },
  },
});
