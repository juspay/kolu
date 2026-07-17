// @ts-check

import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";

import { eagerLangsOnly, fenceLangs } from "../../scripts/fence-langs.mjs";
import stableInlineStyles from "./build/stable-inline-styles.mjs";

// Self-contained, internal Atlas — NOT published anywhere. Deliberately
// decoupled from the public website (../../website). Built locally via
// `just atlas::build`; the dist/ output is committed so each page previews in
// kolu's Code tab without a dev server.
const DEV_PORT = 4331;

// Every fence language the content uses, derived from the content itself —
// preloaded into the highlighter so no grammar ever loads mid-build. Shiki's
// `mdx` grammar embeds yaml/tsx/… LAZILY, and a mid-build load re-resolves
// every lazy embedder, so with per-block lazy loading the rendered bytes of
// an ```mdx block depended on whether some other file's ```yaml block was
// highlighted first (vite transform order → the flaky-test tracker's
// release-workflow.html byte-shrink row). Deriving the list from the content
// makes staleness unrepresentable; the eagerLangsOnly guard turns any fence
// the scan might miss into a loud build error instead of silent
// nondeterminism. See Atlas note bug-shiki-grammar-load-race.
const CODE_LANGS = fenceLangs(new URL("./src/", import.meta.url));

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
    shikiConfig: {
      theme: "github-light",
      wrap: false,
      // Astro's ShikiConfig types `langs` as LanguageRegistration[] only, but
      // the runtime hands the array straight to shiki's *bundled*
      // createHighlighter, which resolves bundled-language NAME STRINGS
      // (@astrojs/internal-helpers shiki.js) — the unit pins exercise exactly
      // this path. Cast over the too-narrow type.
      langs: /** @type {import("astro").ShikiConfig["langs"]} */ (
        /** @type {unknown} */ (CODE_LANGS)
      ),
      transformers: [
        eagerLangsOnly(CODE_LANGS),
        // Shiki budgets each line's tokenization at 500ms (tokenizeTimeLimit,
        // @shikijs/primitive) and vscode-textmate's over-budget bail returns
        // PARTIAL tokens with a `stoppedEarly` flag shiki never checks — so on a
        // CPU-contended box a slow line silently loses its per-token <span>
        // wrappers instead of failing. dist/ is committed, so that degradation
        // surfaces as non-deterministic ci::atlas-sync byte-drift (the flaky-test
        // tracker's "release-workflow.html byte-shrinks under load" row). Zero
        // disables the budget: output is correct or the build visibly hangs —
        // never silently degraded. Astro doesn't forward unknown shikiConfig
        // keys, so the option rides a transformer's preprocess hook. Distinct
        // from (and unaffected by) the grammar-load race above.
        {
          name: "kolu:shiki-no-tokenize-bail",
          preprocess(_code, options) {
            options.tokenizeTimeLimit = 0;
          },
        },
      ],
    },
  },
});
