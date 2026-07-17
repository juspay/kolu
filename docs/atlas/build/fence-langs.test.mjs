// Fixtures for the ONE fence scanner (scripts/fence-langs.mjs) that both
// astro configs derive their shiki `langs` from. Every shape here is a fence
// astro/remark WILL hand to the highlighter, so a shape the scanner misses is
// a grammar that loads mid-build — the embedded-grammar load race (Atlas note
// bug-shiki-grammar-load-race). The blockquoted case was red-first: the
// initial `^[ \t]*` opener regex missed `> ```yaml` until the blockquote
// prefix was added.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import {
  ASTRO_EXCLUDED_LANGS,
  SPECIAL_LANGS,
  eagerLangsOnly,
  fenceLangs,
  shikiFencePreload,
} from "../../../scripts/fence-langs.mjs";
import { astroMarkdown, astroMarkdownRemark, shiki } from "./astro-deps.mjs";

// Every fixture dir is tracked and removed after the suite — the soak runs
// this file dozens of times in a row and must not accumulate temp debris.
const fixtureDirs = [];
after(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "fence-langs-"));
  fixtureDirs.push(dir);
  return dir;
};
const dirWith = (content) => {
  const dir = freshDir();
  writeFileSync(join(dir, "note.mdx"), content);
  return dir;
};

// The scanner module is dependency-free (shared across two projects with
// separate lockfiles), so its two hand-held upstream mirrors are pinned here
// against the REAL installed exports (astro-deps.mjs resolves them through
// astro's own require context).

test("plain, indented, tilde, and info-string fences", () => {
  const dir = dirWith(
    [
      "```ts",
      "x",
      "```",
      "",
      "- item:",
      '  ```jsonc title="cfg" {1-2}',
      "  {}",
      "  ```",
      "",
      "~~~diff",
      "-a",
      "~~~",
    ].join("\n"),
  );
  assert.deepEqual(fenceLangs(dir), ["diff", "jsonc", "ts"]);
});

test("blockquoted fences are scanned (red-first: the shape the flake gate caught)", () => {
  const dir = dirWith(
    [
      "> a quote:",
      ">",
      "> ```yaml",
      "> a: 1",
      "> ```",
      "",
      "> > ```ini",
      "> > k=v",
      "> > ```",
    ].join("\n"),
  );
  assert.deepEqual(fenceLangs(dir), ["ini", "yaml"]);
});

test("nested example fences over-approximate (benign by design)", () => {
  // A ```js opener inside a ````markdown example block still counts:
  // preloading an extra real grammar is harmless, and the policy for a fake
  // language is loud (createHighlighter fails at build start), never silent.
  const dir = dirWith(
    ["````markdown", "```js", "inner", "```", "````"].join("\n"),
  );
  assert.deepEqual(fenceLangs(dir), ["js", "markdown"]);
});

test("special plaintext languages are never preloaded; closing fences don't match", () => {
  const dir = dirWith(
    ["```text", "words", "```", "", "```ansi", "\x1b[31mred", "```"].join("\n"),
  );
  assert.deepEqual(fenceLangs(dir), []);
});

test("scan is sorted and unique across files", () => {
  const dir = freshDir();
  writeFileSync(join(dir, "a.md"), "```yaml\na: 1\n```\n");
  writeFileSync(join(dir, "b.mdx"), "```bash\nls\n```\n\n```yaml\nb: 2\n```\n");
  assert.deepEqual(fenceLangs(dir), ["bash", "yaml"]);
});

// The container-prefix + info-string shapes astro's parser accepts that the
// pre-round-1 regex missed (codex F1, red-first: each of these failed before
// the scanner learned markdown container prefixes).
const PARSER_BOUNDARY_FIXTURE = [
  "- ```ruby", // fence opens ON the list-marker line
  "  x = 1",
  "  ```",
  "",
  "1. ```lua", // ordered list marker
  "   x = 1",
  "   ```",
  "",
  "> - ```elixir", // blockquote + list combination
  ">   x",
  ">   ```",
  "",
  "[^1]: ```erlang", // GFM footnote definition
  "    x.",
  "    ```",
  "",
  "``` yaml", // whitespace before the info string — still a yaml fence
  "a: 1",
  "```",
  "",
  "```文言", // shiki's Unicode bundled alias — ASCII-only capture missed it
  "吾有一數",
  "```",
].join("\n");

test("container-prefix and info-string fence shapes are scanned (codex F1, red-first)", () => {
  const dir = dirWith(PARSER_BOUNDARY_FIXTURE);
  assert.deepEqual(fenceLangs(dir), [
    "elixir",
    "erlang",
    "lua",
    "ruby",
    "yaml",
    "文言",
  ]);
});

test("cross-pin: every fence astro's real parser highlights is in the scanner's census", async () => {
  // The scanner must OVER-approximate the parser: render the boundary fixture
  // through astro's actual markdown processor (syntax highlighting off, so
  // the language survives as a class instead of being consumed by shiki) and
  // assert every language the parser hands to the highlighter was scanned.
  // This pins the accepted shapes to the installed parser, not to our own
  // expectations of it.
  const processor = await astroMarkdownRemark.createMarkdownProcessor({
    syntaxHighlight: false,
  });
  const { code: html } = await processor.render(PARSER_BOUNDARY_FIXTURE);
  const parserLangs = new Set(
    [...html.matchAll(/class="language-([^"\s]+)"/g)].map((m) =>
      decodeURIComponent(m[1]),
    ),
  );
  assert.ok(parserLangs.size >= 5, `parser saw too few fences:\n${html}`);
  const scanned = new Set(fenceLangs(dirWith(PARSER_BOUNDARY_FIXTURE)));
  const missed = [...parserLangs].filter((l) => !scanned.has(l));
  assert.deepEqual(
    missed,
    [],
    `astro's parser highlights language(s) the scanner missed: ${missed.join(", ")}`,
  );
});

test("eagerLangsOnly: allows preloaded + specials, throws on the rest", () => {
  const guard = eagerLangsOnly(["ts", "yaml"]);
  assert.equal(guard.preprocess("x", { lang: "ts" }), undefined);
  assert.equal(guard.preprocess("x", { lang: "text" }), undefined);
  assert.throws(
    () => guard.preprocess("x", { lang: "ruby" }),
    /eager-langs-only/,
  );
});

test("shikiFencePreload fuses the derived list with its guard", () => {
  const dir = dirWith("```yaml\na: 1\n```\n");
  const { langs, guard } = shikiFencePreload(dir);
  assert.deepEqual(langs, ["yaml"]);
  assert.equal(guard.name, "kolu:shiki-eager-langs-only");
  assert.equal(guard.preprocess("x", { lang: "yaml" }), undefined);
  assert.throws(
    () => guard.preprocess("x", { lang: "ruby" }),
    /eager-langs-only/,
  );
});

test("languages containing '#' are captured whole (c# is not scanned as c)", () => {
  const dir = dirWith("```c#\nvar x = 1;\n```\n");
  assert.deepEqual(fenceLangs(dir), ["c#"]);
});

test("astro-excluded fence languages are never enumerated (```math never reaches shiki)", () => {
  const dir = dirWith("```math\nx^2\n```\n\n```yaml\na: 1\n```\n");
  assert.deepEqual(fenceLangs(dir), ["yaml"]);
});

// ── drift pins: the module's two hand-held upstream mirrors ────────────────
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
