// Teeth for the #1209 fix: prove `normalizeHeadStyles` is a pure function of the
// *set of CSS rules on a page*, not of how Vite happened to chunk/order them.
// A build-based "add a note, diff the others" gate is vacuous here — Astro's
// current chunking doesn't reliably reshuffle on a synthetic probe, so it stays
// green whether or not the normalizer runs, hiding the regression instead of
// catching it. This tests the invariant directly: scramble the inlined-style
// chunking and assert the output is byte-identical.

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHeadStyles } from "./stable-inline-styles.mjs";

const GLOBAL = ":root{--x: 1}body{margin:0}a{color:red}a:hover{color:blue}";
const KBD =
  ".kbd[data-astro-cid-kbd]{padding:1px}.kbd-plus[data-astro-cid-kbd]{color:gray}";
const TERM =
  ".term[data-astro-cid-trm]{border:1px}.term-dot[data-astro-cid-trm]{width:2px}";

const page = (...styleBlocks) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8">` +
  styleBlocks.map((s) => `<style>${s}</style>`).join("") +
  `</head><body><p>hi</p></body></html>`;

test("identical rule-set, different chunk grouping/order → byte-identical output", () => {
  // The exact shape of #1209: same rules, but Vite split+reordered the chunks.
  const combined = normalizeHeadStyles(page(GLOBAL, KBD + TERM)); // kbd then term, one block
  const split = normalizeHeadStyles(page(GLOBAL, TERM, KBD)); // term first, two blocks
  assert.equal(combined, split);
});

test("collapses to exactly one <style> block, in <head>", () => {
  const out = normalizeHeadStyles(page(GLOBAL, TERM, KBD));
  assert.equal(out.match(/<style/g)?.length, 1);
  const head = out.slice(0, out.indexOf("</head>"));
  assert.ok(head.includes("<style>"), "the merged block lands in <head>");
});

test("scoped components are grouped and sorted by scope id; global rules keep order", () => {
  const out = normalizeHeadStyles(page(GLOBAL, TERM, KBD));
  const css = out.match(/<style>([\s\S]*?)<\/style>/)[1];
  // global block verbatim and first (order preserved), then kbd (< trm), then term
  assert.equal(css, GLOBAL + KBD + TERM);
});

test("body and non-style head content are untouched", () => {
  const out = normalizeHeadStyles(page(GLOBAL, KBD));
  assert.ok(out.includes(`<meta charset="utf-8">`));
  assert.ok(out.endsWith(`<body><p>hi</p></body></html>`));
});

test("no <style> blocks → returned unchanged", () => {
  const html = `<html><head><title>t</title></head><body>x</body></html>`;
  assert.equal(normalizeHeadStyles(html), html);
});
