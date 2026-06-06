// Astro integration: make each page's inlined `<head>` styles a pure function
// of *that page's own components*, so editing/adding one note never re-churns an
// unrelated note's dist HTML.
//
// Why this exists: with `inlineStylesheets: "always"`, Astro inlines Vite's CSS
// chunks into every page. But Vite derives that chunk *grouping and order* from
// the full set of component styles used across the *whole* build — so a new
// component usage anywhere re-partitions the shared chunks inlined into every
// page. Same selectors, same rules, byte-identical <body>; only the chunk
// boundaries/order move (see issue #1209).
//
// The fix (issue option 1): after the build, re-derive each page's inlined CSS
// from scratch — split every <head> <style> into top-level rules, then re-emit a
// single deterministic block: global/shared rules in document order, followed by
// each component's scoped rules grouped and sorted by Astro's scope id. The
// scope-id set on a page depends only on which components that page uses, so the
// output is invariant to how Vite chunked them globally. Component styles are
// scoped via `[data-astro-cid-*]` attribute selectors and never cascade across
// components, so regrouping them is safe; global rules keep their original order.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Split a CSS string into top-level rules (brace-depth + string aware, so
// `{`/`}` inside quoted values or nested @-blocks don't mis-split).
function splitRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  let inStr = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (inStr) {
      if (c === inStr && css[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  return rules.map((r) => r.trim()).filter(Boolean);
}

function scopeIdsOf(rule) {
  return [
    ...new Set(
      [...rule.matchAll(/data-astro-cid-([a-z0-9]+)/gi)].map((m) => m[1]),
    ),
  ];
}

// Rebuild a single page's <head> styles into one deterministic <style> block.
export function normalizeHeadStyles(html) {
  const headEnd = html.indexOf("</head>");
  if (headEnd === -1) return html;
  const head = html.slice(0, headEnd);
  const blocks = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
  if (blocks.length === 0) return html;

  const globalRules = []; // 0 or >1 scope ids → shared; keep document order
  const scoped = new Map(); // scopeId → rules[] (a component's own styles)
  for (const m of blocks) {
    for (const rule of splitRules(m[1])) {
      const ids = scopeIdsOf(rule);
      if (ids.length === 1) {
        const list = scoped.get(ids[0]);
        if (list) list.push(rule);
        else scoped.set(ids[0], [rule]);
      } else {
        globalRules.push(rule);
      }
    }
  }

  let css = globalRules.join("");
  for (const id of [...scoped.keys()].sort()) css += scoped.get(id).join("");
  const merged = `<style>${css}</style>`;

  // Replace all existing <style> blocks with the single merged one, in place of
  // the first. Remove tail-to-head so earlier indices stay valid; insert last so
  // positions before the first block are untouched (metas, title, etc.).
  const firstStart = blocks[0].index;
  let newHead = head;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    newHead = newHead.slice(0, b.index) + newHead.slice(b.index + b[0].length);
  }
  newHead = newHead.slice(0, firstStart) + merged + newHead.slice(firstStart);
  return newHead + html.slice(headEnd);
}

async function collectHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectHtml(full)));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

export default function stableInlineStyles() {
  return {
    name: "stable-inline-styles",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const files = await collectHtml(fileURLToPath(dir));
        let changed = 0;
        for (const file of files) {
          const html = await readFile(file, "utf8");
          const out = normalizeHeadStyles(html);
          if (out !== html) {
            await writeFile(file, out);
            changed++;
          }
        }
        logger.info(
          `normalized inlined <head> styles in ${changed}/${files.length} pages`,
        );
      },
    },
  };
}
