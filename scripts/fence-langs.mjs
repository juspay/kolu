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
// website/default.nix, same pattern as kolu-server-package.json). Because the
// two projects pin different shiki/astro versions in separate lockfiles, this
// module stays dependency-free: the two small sets below are hand-held copies
// of upstream facts, drift-pinned PER CONSUMER by a unit test that reaches
// the real export through that consumer's own node_modules
// (docs/atlas/build/fence-langs.test.mjs and
// website/test/shiki-eager-langs.test.mjs) — one consumer's pin says nothing
// about the versions the other installs.
//
// Over-approximation is deliberate and benign: a fence opener inside a
// ````markdown example block still contributes its language. A fence in a
// language shiki doesn't bundle (a typo, a decorative name) fails
// createHighlighter LOUDLY at build start — the error names the language, and
// the remedy is to rename the fence to a real language or `text`, never to
// fall back silently. (A deliberate regex parser, not remark: a real markdown
// pipeline would drag parser deps into this dependency-free shared module,
// and shiki's own fence sniffer — `guessEmbeddedLanguages`'s
// /(?:```|~~~)([\w-]+)/g — is strictly weaker than this anchored form.)
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

// Fence openers: optional list indentation, optional blockquote markers
// (`> ```yaml`, nested `> > ```ts`), three-or-more ``` or ~~~ (````markdown
// is a real four-backtick fence), then the language (incl. `#` for c#), then
// an ignored info string (```ts title="x"). Closing fences carry no language
// and don't match.
const FENCE_OPENER = /^[ \t]*(?:>[ \t]*)*(?:`{3,}|~{3,})([a-zA-Z0-9_+#-]+)/gm;

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
 * Ordering honesty: astro lazy-loads the offending grammar BEFORE any
 * transformer runs (@astrojs/internal-helpers shiki.js awaits loadLanguage,
 * then codeToHast fires preprocess) — so this guard is a check-after-write,
 * not a gate: by the time it throws, the registry already took the mid-build
 * load. That is still exactly enough, because the throw fails the build
 * before the order-dependent bytes can ship; determinism of *emitted output*
 * is what the flake is made of, not registry purity.
 *
 * One cell stays out of this guard's reach by construction: astro rewrites a
 * language shiki can't LOAD to "plaintext" before any transformer runs, so an
 * unknown language in a fence shape the scan also missed renders as
 * deterministic plaintext with only a console warning. That cell is not racy
 * (no grammar ever loads), and a scanned unknown language crashes
 * createHighlighter at build start — so the guard's job is exactly the racy
 * remainder: scan-missed fences in REAL languages.
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
