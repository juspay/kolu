// @ts-check

// The `langs` preload is the fix for the embedded-grammar load race (Atlas
// note bug-shiki-grammar-load-race): every fence language the content uses is
// derived from the content and loaded before the first block tokenizes, so no
// grammar ever loads mid-build — otherwise rendered bytes depend on vite's
// file-transform order via shiki's lazily-embedded grammars, and here the
// silently-degraded output would ship straight to kolu.dev. Same class and
// same fix as docs/atlas.
import { existsSync } from "node:fs";

const REPO_FENCE_LANGS = new URL(
  "../../scripts/fence-langs.mjs",
  import.meta.url,
);
const SANDBOX_FENCE_LANGS = new URL("../fence-langs.mjs", import.meta.url);

/** @returns {URL} */
function resolveFenceLangsModule() {
  const found = [REPO_FENCE_LANGS, SANDBOX_FENCE_LANGS].find((url) =>
    existsSync(url),
  );
  if (!found)
    throw new Error(
      `fence-langs.mjs is required for the website build (looked at ${REPO_FENCE_LANGS.pathname} and ${SANDBOX_FENCE_LANGS.pathname})`,
    );
  return found;
}

const fenceLangsModule = resolveFenceLangsModule();
const {
  ASTRO_EXCLUDED_LANGS,
  SPECIAL_LANGS,
  fenceLangs,
  noTokenizeBail,
  shikiFencePreload,
} = await import(fenceLangsModule.href);

export { ASTRO_EXCLUDED_LANGS, SPECIAL_LANGS, fenceLangs };

const CONTENT_ROOT = new URL(".", import.meta.url);

const fencePreload = shikiFencePreload(CONTENT_ROOT);

/** @type {Partial<import("astro").ShikiConfig>} */
export const shikiConfig = {
  themes: {
    light: "vitesse-light",
    dark: "vitesse-black",
  },
  defaultColor: false,
  wrap: false,
  // Astro types `langs` too narrowly for the bundled-name-strings path the
  // runtime actually takes — see docs/atlas/astro.config.mjs for the full
  // rationale behind this double-cast.
  langs: /** @type {import("astro").ShikiConfig["langs"]} */ (
    /** @type {unknown} */ (fencePreload.langs)
  ),
  transformers: [fencePreload.guard, noTokenizeBail],
};
