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
// docs/atlas/build/fence-langs.test.mjs — here only the wiring and the
// class-kill are asserted.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The exact object astro.config.mjs hands to astro — plain node can't load
// astro.config.mjs itself (its TS imports need vite's resolver), which is why
// the shiki setup lives in this shared plain-ESM module. `fenceLangs` comes
// through the same module so exactly one place knows the
// working-tree-vs-Nix-sandbox resolution of scripts/fence-langs.mjs.
import { fenceLangs, shikiConfig } from "../src/shiki-config.mjs";

const requireFromAstro = createRequire(
  createRequire(import.meta.url).resolve("astro/package.json"),
);
const { createShikiHighlighter } = await import(
  pathToFileURL(requireFromAstro.resolve("@astrojs/markdown-remark/shiki")).href
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
  const lang = ["ruby", "erlang", "lua"].find(
    (l) => !shikiConfig.langs.includes(l),
  );
  await assert.rejects(
    astroHighlight(lang, "x = 1"),
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
