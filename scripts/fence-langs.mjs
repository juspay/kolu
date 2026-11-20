// Shared by BOTH astro projects (docs/atlas and website — same class of
// build): docs/atlas imports it relatively; the website imports it via a
// candidates URL because its Nix sandbox build copies only website/ (the
// derivation cp's this file in beside astro.config.mjs — see
// website/default.nix, same pattern as kolu-server-package.json). Because the
// two projects pin different shiki/astro versions in separate lockfiles, this
// module stays dependency-free: the two small sets below are hand-held copies
// of upstream facts, drift-pinned PER CONSUMER by a unit test that reaches
// the real export through that consumer's own node_modules
// (docs/atlas/build/fence-langs.test.mjs and
// website/test/shiki-eager-langs.test.mjs) — one consumer's pin says nothing
// about the versions the other installs.
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Shiki renders these without a grammar — never preload them. Mirror of
// shiki's isSpecialLang (ansi + the plaintext aliases); exported ONLY for the
// per-consumer drift pins, which assert every member really is special per
// each consumer's installed shiki (a non-special entry here would make the
// guard silently allow a racy lazy load).
export const SPECIAL_LANGS = new Set([
  "plaintext",
  "plain",
  "text",
  "txt",
  "ansi",
]);

// Fence languages astro excludes from highlighting BEFORE they ever reach
// shiki (@astrojs/internal-helpers `defaultExcludeLanguages`) — enumerate one
// and createHighlighter would crash on a fence astro itself treats as legal.
// Exported ONLY for the per-consumer drift pins, which assert exact equality
// with each consumer's installed astro export (drift in either direction is a
// hole: a stale extra entry silently allows a racy lazy load, a missing entry
// crashes the build on a legal fence).
export const ASTRO_EXCLUDED_LANGS = new Set(["math"]);

const SKIPPED_LANGS = new Set([...SPECIAL_LANGS, ...ASTRO_EXCLUDED_LANGS]);

// Fence openers, matching what astro's markdown parser actually accepts:
// any run of container prefixes — blockquote `>`, list markers `-`/`*`/`+`,
// ordered `1.`/`1)`, GFM footnote definitions `[^id]:` — each with optional
// following space, then three-or-more ``` or ~~~ (````markdown is a real
// four-backtick fence), optional whitespace (``` yaml is a yaml fence: the
// info string is stripped of leading spaces), then the language as the first
// non-whitespace token (Unicode included — shiki bundles the 文言 alias;
// `#` for c#), then an ignored info string (```ts title="x"). Closing fences
// carry no language and don't match. The fixture suite cross-pins these
// shapes against astro's real createMarkdownProcessor so the scanner can't
// silently diverge from what the parser hands to shiki.
const FENCE_OPENER =
  /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)]|\[\^[^\]\s]*\]:)[ \t]*)*(?:`{3,}|~{3,})[ \t]*([^\s`~]+)/gm;

/**
 * Scan every markdown/MDX file under `dir` for fence openers and return the
 * sorted, unique set of fence languages.
 *
 * @param {URL | string} dir
 * @returns {string[]}
 */
export function fenceLangs(dir) {
  const cwd = dir instanceof URL ? fileURLToPath(dir) : dir;
  const langs = new Set();
  for (const file of globSync("**/*.{md,mdx}", { cwd })) {
    const src = readFileSync(join(cwd, file), "utf8");
    for (const m of src.matchAll(FENCE_OPENER)) {
      if (!SKIPPED_LANGS.has(m[1])) langs.add(m[1]);
    }
  }
  return [...langs].sort();
}

/**
 * The fail-fast backstop: if any code block reaches tokenization in a
 * language that wasn't preloaded (a fence shape the scan missed, a language
 * astro aliased unexpectedly), fail the build loudly instead of shipping
 * bytes whose rendering depended on file-transform order.
 *
 * @param {string[]} preloaded - the derived fence-language list
 * @returns {import("shiki").ShikiTransformer}
 */
export function eagerLangsOnly(preloaded) {
  const allowed = new Set(preloaded);
  return {
    name: "kolu:shiki-eager-langs-only",
    preprocess(_code, options) {
      const lang = typeof options.lang === "string" ? options.lang : "";
      if (SKIPPED_LANGS.has(lang) || lang === "" || allowed.has(lang)) return;
      throw new Error(
        `[kolu:shiki-eager-langs-only] code block language "${lang}" was not ` +
          `preloaded — it is not in shikiConfig.langs (derived from the ` +
          `content's fences by scripts/fence-langs.mjs). A mid-build grammar ` +
          `load makes rendered bytes depend on file-transform order (the ` +
          `atlas-sync byte-shrink flake). If you just added this fence while ` +
          `\`astro dev\` was running, the derived list is stale — restart ` +
          `dev (the config only evaluates at server start). Otherwise: if ` +
          `this fence is real, its shape escaped the scanner — extend ` +
          `FENCE_OPENER; if it's a typo, fix the fence.`,
      );
    },
  };
}

/**
 * The fused entry point production configs should use: derive the langs list
 * and pair it with its guard in one step, so a consumer can never wire the
 * guard against a different (or stale) list than the one it preloads — the
 * exact mis-pairing that would silently reopen the race. `fenceLangs` /
 * `eagerLangsOnly` stay exported for the fixture tests.
 *
 * @param {URL | string} contentDir - root to scan for fences (a project's src/)
 * @returns {{ langs: string[], guard: import("shiki").ShikiTransformer }}
 */
export function shikiFencePreload(contentDir) {
  const langs = fenceLangs(contentDir);
  return { langs, guard: eagerLangsOnly(langs) };
}

// Disable shiki's per-line tokenization budget, for both consumers. Shiki
// budgets each line's tokenization at 500ms (`tokenizeTimeLimit`,
// @shikijs/primitive) and vscode-textmate's over-budget bail returns PARTIAL
// tokens with a `stoppedEarly` flag shiki never checks — so on a
// CPU-contended box a slow line silently loses its per-token <span> wrappers
// instead of failing. Zero disables the budget: output is correct or the
// build visibly hangs — never silently degraded. Astro doesn't forward
// unknown shikiConfig keys, so the option rides a transformer's preprocess
// hook. Distinct from (and unaffected by) the grammar-load race the fence
// preload above closes.
/** @type {import("shiki").ShikiTransformer} */
export const noTokenizeBail = {
  name: "kolu:shiki-no-tokenize-bail",
  preprocess(_code, options) {
    options.tokenizeTimeLimit = 0;
  },
};
