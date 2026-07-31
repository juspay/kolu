// Teeth for the atlas-sync byte-shrink flake ("release-workflow.html
// byte-shrinks under load"; design note
// bug-shiki-grammar-load-race): shiki's bundled `mdx` grammar declares its
// embedded languages LAZILY (`embeddedLangs: []`, `embeddedLangsLazy:
// ["yaml", ...]`), and astro's shared highlighter loads grammars per code
// block on demand — so whether the lone ```mdx fence renders its YAML
// frontmatter with embedded-YAML tokens depended on whether the lone ```yaml
// fence elsewhere happened to be highlighted first, a cross-file vite
// transform-order race. These tests pin both halves:
//
//   1. the MECHANISM — grammar presence in the registry flips the exact byte
//      signature the flake produced (plain `#005CC5` bold fences vs YAML
//      `#22863A`/`#032F62` tokens);
//   2. the FIX — the REAL astro.config.mjs, run through astro's own
//      createShikiHighlighter exactly as rehype-shiki does, must render the
//      mdx block with YAML tokens as the FIRST tokenization, no other block
//      having loaded yaml — i.e. grammar readiness is deterministic, not
//      order-dependent. (Red on the pre-fix config: no `langs` → lazy mdx →
//      plain frontmatter.)
//   3. the GUARD — a fence language outside the derived `langs` list must
//      fail the build loudly (`kolu:shiki-eager-langs-only`), because an
//      un-preloaded language would silently re-open the race; shiki's
//      special plaintext languages stay allowed.
//
// The scanner itself (fence shapes, over-approximation) is fixture-tested in
// fence-langs.test.mjs; here only the WIRING is asserted (config.langs IS the
// derived list), so there is exactly one scanner — never a rival
// re-implementation that could drift from the one the build uses.

import assert from "node:assert/strict";
import test from "node:test";

import { fenceLangs } from "../../../scripts/fence-langs.mjs";
import astroConfig from "../astro.config.mjs";
import { createShikiHighlighter, shiki } from "./astro-deps.mjs";

const { createHighlighter, bundledLanguages } = shiki;

// The release-workflow.mdx fence's shape: YAML frontmatter + markdown body.
const SAMPLE = [
  "---",
  "version: Unreleased",
  "---",
  "### Added",
  "- One line",
].join("\n");

// The two byte signatures from the flake forensics (github-light):
const YAML_KEY = "#22863A"; // `version` as embedded-YAML key
const YAML_STRING = "#032F62"; // `Unreleased` as embedded-YAML string
const PLAIN_FENCE = "#005CC5"; // `---` as a bold markdown thematic break

const shikiConfig = astroConfig.markdown.shikiConfig;

// Mirror rehype-shiki.js: this is the exact construction + call the build uses.
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

// ── 2. the FIX: deterministic grammar readiness on the real config ─────────
//
// NB: astro's highlighter cache is keyed by theme, not langs. Taken at module
// load — structurally the first-ever tokenization, provably before any test
// body could warm that shared cache with extra grammars.
const firstMdxHtml = await astroHighlight("mdx", SAMPLE);

test("real astro config: first-ever mdx tokenization gets embedded YAML (no order dependence)", () => {
  assert.ok(
    firstMdxHtml.includes(YAML_KEY) && firstMdxHtml.includes(YAML_STRING),
    `mdx frontmatter must tokenize as embedded YAML on the first block the build
sees — got the order-dependent plain rendering instead (the atlas-sync flake):
${firstMdxHtml}`,
  );
});

test("real astro config: shikiConfig.langs IS the content-derived fence list", () => {
  assert.deepEqual(
    shikiConfig.langs,
    fenceLangs(new URL("../src/", import.meta.url)),
    "astro.config.mjs must derive its langs from the content via fenceLangs — a hand-maintained list can drift and reopen the race",
  );
  assert.ok(shikiConfig.langs.length > 0, "the derived list must not be empty");
});

// ── 1. the MECHANISM: registry state flips the flake's byte signature ──────
test("mechanism: yaml grammar absent → plain frontmatter; present → YAML tokens", async () => {
  // Raw shiki with explicit instances — no shared cache, so each case pins a
  // precise registry state.
  const render = async (langs) => {
    const hl = await createHighlighter({ themes: ["github-light"], langs });
    const html = hl.codeToHtml(SAMPLE, { lang: "mdx", theme: "github-light" });
    hl.dispose();
    return html;
  };

  const without = await render(["mdx"]);
  assert.ok(
    !without.includes(YAML_KEY) && !without.includes(YAML_STRING),
    "with yaml unloaded, the frontmatter must NOT carry YAML tokens (the flaked rendering)",
  );
  assert.ok(
    without.includes(PLAIN_FENCE),
    "the flaked rendering shows `---` as a plain bold thematic break",
  );

  // Load order must not matter — shiki re-resolves lazy embedders on load.
  for (const langs of [
    ["mdx", "yaml"],
    ["yaml", "mdx"],
  ]) {
    const withYaml = await render(langs);
    assert.ok(
      withYaml.includes(YAML_KEY) && withYaml.includes(YAML_STRING),
      `with yaml loaded (${langs.join(",")}), frontmatter must tokenize as embedded YAML`,
    );
  }
});

// ── 3. the GUARD: an un-enumerated language fails loudly ────────────────────
test("guard: a fence language outside shikiConfig.langs throws at build time", async () => {
  // Derive the probe language from the installed shiki bundle instead of
  // hardcoding one: a hardcoded "ruby" would make correct production behavior
  // fail this test the day a real ruby fence lands in content (codex F3).
  const probe = Object.keys(bundledLanguages).find(
    (l) => !shikiConfig.langs.includes(l),
  );
  assert.ok(
    probe,
    "no bundled language outside the derived list — impossible census",
  );
  await assert.rejects(
    astroHighlight(probe, "x = 1"),
    /not in shikiConfig\.langs|eager-langs-only/i,
    "an un-enumerated language must fail the build, not silently lazy-load",
  );
});

test("guard: shiki special plaintext languages stay allowed", async () => {
  const html = await astroHighlight("text", "just words");
  assert.ok(html.includes("just words"), "plaintext fences must still render");
});
