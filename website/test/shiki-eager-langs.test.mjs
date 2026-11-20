import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

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

const astroRehypeShikiHighlight = async (lang, code) => {
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
  assert.ok(
    shikiConfig.langs.includes("yaml"),
    "content census expects a yaml fence",
  );
  const html = await astroRehypeShikiHighlight(
    "yaml",
    'key: value\nother: "quoted"\n# comment',
  );
  assert.ok(
    distinctLightColors(html) >= 2,
    `yaml must render with its grammar engaged (≥2 distinct token colors), got:\n${html}`,
  );
});

test("guard: an un-preloaded language fails the build loudly", async () => {
  const probe = Object.keys(shiki.bundledLanguages).find(
    (l) => !shikiConfig.langs.includes(l),
  );
  assert.ok(
    probe,
    "no bundled language outside the derived list — impossible census",
  );
  await assert.rejects(
    astroRehypeShikiHighlight(probe, "x = 1"),
    /eager-langs-only/,
    "a fence language outside the derived list must throw, not silently lazy-load",
  );
});

test("guard: shiki special plaintext languages stay allowed", async () => {
  const html = await astroRehypeShikiHighlight("text", "just words");
  assert.ok(html.includes("just words"), "plaintext fences must still render");
  assert.ok(
    distinctLightColors(html) <= 1,
    "plaintext carries no token palette",
  );
});

test("drift pin: every SPECIAL_LANGS member is special per the installed shiki", () => {
  for (const lang of SPECIAL_LANGS) {
    assert.ok(
      shiki.isSpecialLang(lang),
      `"${lang}" is in SPECIAL_LANGS but shiki.isSpecialLang rejects it — the guard would silently skip a real language`,
    );
  }
  assert.ok(!shiki.isSpecialLang("yaml"));
});

test("drift pin: ASTRO_EXCLUDED_LANGS exactly equals astro's defaultExcludeLanguages", () => {
  assert.deepEqual(
    [...ASTRO_EXCLUDED_LANGS].sort(),
    [...astroMarkdown.defaultExcludeLanguages].sort(),
  );
});
