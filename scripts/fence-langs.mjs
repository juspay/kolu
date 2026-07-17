// The exhaustive shiki `langs` list, DERIVED from the content itself — the fix
// for the embedded-grammar load race (Atlas note bug-shiki-grammar-load-race;
// flaky-test-tracker's release-workflow.html byte-shrink row).
//
// Why derived, not hand-enumerated: shiki's bundled `mdx`/`markdown` grammars
// declare their embedded languages lazily (`embeddedLangsLazy`), and astro's
// shared highlighter loads grammars per code block on demand — so any fence
// language that is NOT preloaded at highlighter creation gets loaded
// mid-build, re-resolving every lazy embedder and making the rendered bytes a
// function of vite's transform order. Deriving the list from the content
// makes "a fence language that isn't preloaded" unrepresentable: the content
// is the source of truth, so the list can never drift from it.
//
// Shared by BOTH astro projects (docs/atlas and website — same class of
// build): docs/atlas imports it relatively; the website imports it via a
// candidates URL because its Nix sandbox build copies only website/ (the
// derivation cp's this file in beside astro.config.mjs — see
// website/default.nix, same pattern as kolu-server-package.json).
//
// Over-approximation is deliberate and benign: a fence opener inside a
// ````markdown example block still contributes its language, and a decorative
// fence (```mermaid, ```console) is enumerated like any other — if shiki
// bundles the grammar it preloads, if not, createHighlighter fails LOUDLY at
// build start and the remedy is to rename the fence to a real language (or
// `text`), never to fall back silently. A new fence added while `astro dev`
// runs: the config only evaluates at server start, so the eagerLangsOnly
// guard below throws with the same remedy — restart dev.
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Shiki renders these without a grammar (isSpecialLang) — never preload them.
const SPECIAL_LANGS = new Set(["plaintext", "plain", "text", "txt", "ansi"]);

// Fence openers: optional list indentation, optional blockquote markers
// (`> ```yaml`, nested `> > ```ts`), three-or-more ``` or ~~~ (````markdown
// is a real four-backtick fence), then the language, then an ignored info
// string (```ts title="x"). Closing fences carry no language and don't match.
const FENCE_OPENER = /^[ \t]*(?:>[ \t]*)*(?:`{3,}|~{3,})([a-zA-Z0-9_+-]+)/gm;

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
      if (!SPECIAL_LANGS.has(m[1])) langs.add(m[1]);
    }
  }
  return [...langs].sort();
}

/**
 * The fail-fast backstop: if any code block reaches tokenization in a
 * language that wasn't preloaded (a fence shape the scan missed, a language
 * astro aliased unexpectedly), fail the build loudly instead of letting shiki
 * lazy-load it mid-build and silently reopen the order race.
 *
 * One cell stays out of this guard's reach by construction: astro rewrites a
 * language shiki can't LOAD to "plaintext" before any transformer runs
 * (@astrojs/internal-helpers shiki.js), so an unknown language in a fence
 * shape the scan also missed renders as deterministic plaintext with only a
 * console warning. That cell is not racy (no grammar ever loads), and a
 * scanned unknown language crashes createHighlighter at build start — so the
 * guard's job is exactly the racy remainder: scan-missed fences in REAL
 * languages, which it turns from silent nondeterminism into a build error.
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
      if (SPECIAL_LANGS.has(lang) || lang === "" || allowed.has(lang)) return;
      throw new Error(
        `[kolu:shiki-eager-langs-only] code block language "${lang}" was not ` +
          `preloaded — it is not in shikiConfig.langs (derived from the ` +
          `content's fences by scripts/fence-langs.mjs). A mid-build grammar ` +
          `load makes rendered bytes depend on file-transform order (the ` +
          `atlas-sync byte-shrink flake). If this fence is real, its shape ` +
          `escaped the scanner — extend FENCE_OPENER; if it's a typo, fix ` +
          `the fence.`,
      );
    },
  };
}
