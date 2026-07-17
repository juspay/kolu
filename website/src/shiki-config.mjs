// The website's entire shiki configuration, as one plain-ESM module — imported
// by astro.config.mjs (the only consumer that feeds astro) AND by
// test/shiki-eager-langs.test.mjs (plain `node --test` can't load
// astro.config.mjs, whose TS imports need vite's resolver). One object, no
// rival copy to drift.
//
// The `langs` preload is the fix for the embedded-grammar load race (Atlas
// note bug-shiki-grammar-load-race): every fence language the content uses is
// derived from the content and loaded before the first block tokenizes, so no
// grammar ever loads mid-build — otherwise rendered bytes depend on vite's
// file-transform order via shiki's lazily-embedded grammars, and here the
// silently-degraded output would ship straight to kolu.dev. Same class and
// same fix as docs/atlas.
import { existsSync } from "node:fs";

// The fence scanner is shared with docs/atlas (one scanner, no rival copy):
// in the working tree it lives at ../../scripts/fence-langs.mjs; the Nix
// sandbox build copies only website/, so default.nix places a copy beside
// astro.config.mjs (same pattern as kolu-server-package.json).
const fenceLangsModule = [
  new URL("../../scripts/fence-langs.mjs", import.meta.url),
  new URL("../fence-langs.mjs", import.meta.url),
].find((url) => existsSync(url));
if (!fenceLangsModule) {
  throw new Error("fence-langs.mjs is required for the website build");
}
const { eagerLangsOnly, fenceLangs } = await import(fenceLangsModule.href);

export const CODE_LANGS = fenceLangs(new URL(".", import.meta.url));

/** @type {Partial<import("astro").ShikiConfig>} */
export const shikiConfig = {
  // Dual theme — astro emits both as CSS variables; global.css routes
  // them via `[data-theme]` so code blocks track the light/dark toggle.
  themes: {
    light: "vitesse-light",
    dark: "vitesse-black",
  },
  defaultColor: false,
  wrap: false,
  langs: CODE_LANGS,
  transformers: [
    eagerLangsOnly(CODE_LANGS),
    // Disable shiki's 500ms/line tokenization budget: the over-budget bail
    // silently drops per-token spans under CPU contention (see
    // docs/atlas/astro.config.mjs for the full mechanism + the flaky-test
    // tracker row it caused there). Here the un-gated degradation would ship
    // straight to kolu.dev as un-highlighted code. Correct or loud, never
    // silently degraded. Distinct from (and unaffected by) the grammar-load
    // race the langs preload above closes.
    {
      name: "kolu:shiki-no-tokenize-bail",
      preprocess(_code, options) {
        options.tokenizeTimeLimit = 0;
      },
    },
  ],
};
