// Website half of the embedded-grammar load-race fix (Atlas note
// bug-shiki-grammar-load-race; the atlas-sync byte-shrink flake): the same
// astro/shiki pipeline builds kolu.dev, where order-dependent rendering would
// ship silently instead of failing a sync gate. These pins are THEME-AGNOSTIC
// (the site uses vitesse dual themes, so the atlas tests' github-light hex
// constants don't apply): a grammar-engaged block carries multiple distinct
// `--shiki-light` token colors; a plaintext fallback carries at most one.
//
// Runs in the website's Nix derivation checkPhase (CI-gated via ci::nix) and
// under `just website::check`. The fence scanner itself is fixture-tested in
// docs/atlas/build/fence-langs.test.mjs (version-independent shapes) — here
// the wiring and the class-kill are asserted, PLUS the scanner's two upstream
// drift pins, which are version-DEPENDENT: the website pins its own
// shiki/astro versions in a separate lockfile, so docs/atlas's pins say
// nothing about the exports installed here.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The exact object astro.config.mjs hands to astro — plain node can't load
// astro.config.mjs itself (its TS imports need vite's resolver), which is why
// the shiki setup lives in this shared plain-ESM module. `fenceLangs` (and the
// two drift-pinned mirror sets) come through the same module so exactly one
// place knows the working-tree-vs-Nix-sandbox resolution of
// scripts/fence-langs.mjs.
import {
  ASTRO_EXCLUDED_LANGS,
  SPECIAL_LANGS,
  fenceLangs,
  shikiConfig,
} from "../src/shiki-config.mjs";

const requireFromAstro = createRequire(
  createRequire(import.meta.url).resolve("astro/package.json"),
);
const { createShikiHighlighter } = await import(
  pathToFileURL(requireFromAstro.resolve("@astrojs/markdown-remark/shiki")).href
);
const shiki = await import(
  pathToFileURL(requireFromAstro.resolve("shiki")).href
);
// (anchored on the resolved entry file — the package doesn't export
// ./package.json)
const requireFromMdRemark = createRequire(
  requireFromAstro.resolve("@astrojs/markdown-remark"),
);
const astroMarkdown = await import(
  pathToFileURL(
    requireFromMdRemark.resolve("@astrojs/internal-helpers/markdown"),
  ).href
);

// Mirror rehype-shiki.js: the exact construction + call the build uses.
const astroHighlight = async (lang, code) => {
  const highlighter = await createShikiHighlighter({
    langs: shikiConfig.langs,
    theme: shikiConfig.theme,
    themes: shikiConfig.themes,
    langAlias: shikiConfig.langAlias,
  });
  return highlighter.codeToHtml(code, lang, {
    wrap: shikiConfig.wrap,
    defaultColor: shikiConfig.defaultColor,
    transformers: shikiConfig.transformers,
  });
};

const distinctLightColors = (html) =>
  new Set(
    [...html.matchAll(/--shiki-light:\s*(#[0-9A-Fa-f]+)/g)].map((m) => m[1]),
  ).size;

test("shikiConfig.langs IS the content-derived fence list", () => {
  assert.deepEqual(
    shikiConfig.langs,
    fenceLangs(new URL("../src/", import.meta.url)),
    "astro.config.mjs must derive its langs from the content via fenceLangs",
  );
  assert.ok(shikiConfig.langs.length > 0, "the derived list must not be empty");
});

test("a content language renders with its grammar engaged (sanity, fix-independent)", async () => {
  // Honest scope: a DIRECTLY-requested lang lazy-loads fine even without the
  // preload, so this pin passes pre-fix too — it is a rendering-sanity check
  // that the preloaded grammar actually tokenizes, not a race pin. The
  // race-kill pins on the website side are the wiring assert above (langs
  // derived from content) and the guard pins below; the fix-dependent
  // first-tokenization pin lives in docs/atlas (the project with an embedded-
  // grammar fence pair).
  assert.ok(
    shikiConfig.langs.includes("yaml"),
    "content census expects a yaml fence",
  );
  const html = await astroHighlight(
    "yaml",
    'key: value\nother: "quoted"\n# comment',
  );
  assert.ok(
    distinctLightColors(html) >= 2,
    `yaml must render with its grammar engaged (≥2 distinct token colors), got:\n${html}`,
  );
});

test("guard: an un-preloaded language fails the build loudly", async () => {
  // Derive the probe language from the installed shiki bundle instead of
  // hardcoding candidates: a hardcoded list would make correct production
  // behavior fail this test the day a real fence in one lands (codex F3).
  const probe = Object.keys(shiki.bundledLanguages).find(
    (l) => !shikiConfig.langs.includes(l),
  );
  assert.ok(
    probe,
    "no bundled language outside the derived list — impossible census",
  );
  await assert.rejects(
    astroHighlight(probe, "x = 1"),
    /eager-langs-only/,
    "a fence language outside the derived list must throw, not silently lazy-load",
  );
});

test("guard: shiki special plaintext languages stay allowed", async () => {
  const html = await astroHighlight("text", "just words");
  assert.ok(html.includes("just words"), "plaintext fences must still render");
  assert.ok(
    distinctLightColors(html) <= 1,
    "plaintext carries no token palette",
  );
});

// ── drift pins: the scanner's two hand-held upstream mirrors, checked against
// the WEBSITE-installed shiki/astro (its own lockfile, its own versions) ─────
test("drift pin: every SPECIAL_LANGS member is special per the installed shiki", () => {
  // The dangerous direction: a non-special entry here would make the guard
  // silently allow a racy mid-build lazy load for a real language.
  for (const lang of SPECIAL_LANGS) {
    assert.ok(
      shiki.isSpecialLang(lang),
      `"${lang}" is in SPECIAL_LANGS but shiki.isSpecialLang rejects it — the guard would silently skip a real language`,
    );
  }
  // Canary for the benign direction (a special lang we miss is filtered out
  // by shiki's own resolveLangs, so no crash — but keep one honest sample).
  assert.ok(!shiki.isSpecialLang("yaml"));
});

test("drift pin: ASTRO_EXCLUDED_LANGS exactly equals astro's defaultExcludeLanguages", () => {
  // Either direction of drift is a hole: a stale extra entry silently allows
  // a racy lazy load; a missing entry crashes the build on a legal fence.
  assert.deepEqual(
    [...ASTRO_EXCLUDED_LANGS].sort(),
    [...astroMarkdown.defaultExcludeLanguages].sort(),
  );
});
