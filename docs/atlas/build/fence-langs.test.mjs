// Fixtures for the ONE fence scanner (scripts/fence-langs.mjs) that both
// astro configs derive their shiki `langs` from. Every shape here is a fence
// astro/remark WILL hand to the highlighter, so a shape the scanner misses is
// a grammar that loads mid-build — the embedded-grammar load race (Atlas note
// bug-shiki-grammar-load-race). The blockquoted case was red-first: the
// initial `^[ \t]*` opener regex missed `> ```yaml` until the blockquote
// prefix was added.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { eagerLangsOnly, fenceLangs } from "../../../scripts/fence-langs.mjs";

const dirWith = (content) => {
  const dir = mkdtempSync(join(tmpdir(), "fence-langs-"));
  writeFileSync(join(dir, "note.mdx"), content);
  return dir;
};

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
    ["```text", "words", "```", "", "```ansi", "[31mred", "```"].join("\n"),
  );
  assert.deepEqual(fenceLangs(dir), []);
});

test("scan is sorted and unique across files", () => {
  const dir = mkdtempSync(join(tmpdir(), "fence-langs-"));
  writeFileSync(join(dir, "a.md"), "```yaml\na: 1\n```\n");
  writeFileSync(join(dir, "b.mdx"), "```bash\nls\n```\n\n```yaml\nb: 2\n```\n");
  assert.deepEqual(fenceLangs(dir), ["bash", "yaml"]);
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
