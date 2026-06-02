/** Markdown engine: `marked` for parsing + a custom renderer that
 *  emits the document's existing `.md-*` class hooks (so the
 *  hand-tuned prose CSS in `styles.css` keeps working) and routes
 *  fenced code blocks through Pierre via `walkTokens`.
 *
 *  Marked's async mode lets `walkTokens` be async; the synchronous
 *  `code` renderer reads Pierre's result from a per-parse WeakMap
 *  keyed on the code token — no foreign-field mutation, no cast.
 *  (Returning a Promise from a renderer is not supported in marked.)
 *
 *  Headings shift down by two so a single `#` in agent prose becomes
 *  `h3` — `h1`/`h2` are reserved for the document chrome
 *  (transcript title + sectioning).
 *
 *  Two instances share the same renderer config but differ on
 *  `breaks`: assistant/reasoning prose follows the CommonMark default
 *  (single newlines fold into a paragraph), while user prompts use
 *  `breaks: true` so multi-line typing preserves its line breaks the
 *  way a chat UI would. */

import { escapeHtml } from "@kolu/html-escape";
import { Marked, type Tokens } from "marked";

import { renderCodeBlock } from "./pierre.ts";

function makeMarked(options: { breaks: boolean }): Marked {
  // Pierre's SSR is async, marked's `code` renderer is sync; we bridge
  // the two by stashing the async result in a closure-captured WeakMap
  // keyed by the code token. The async `walkTokens` pass writes;
  // the sync `code` renderer reads on the same token instance.
  // WeakMap keeps `marked`'s token objects untouched (no foreign-field
  // mutation, no cast) and lets the cache GC alongside the parse AST.
  const pierreCache = new WeakMap<Tokens.Code, string>();
  return new Marked({
    gfm: true,
    async: true,
    breaks: options.breaks,
    walkTokens: async (token) => {
      if (token.type === "code") {
        // marked's `walkTokens` types `token` as the full token union,
        // and the `type === "code"` guard doesn't narrow it to `Code`
        // (the union includes `Generic` with an open `type` string).
        // The cast is the same one the upstream marked types expect.
        const code = token as Tokens.Code;
        pierreCache.set(code, await renderCodeBlock(code.text, code.lang));
      }
    },
    renderer: {
      code(token) {
        const rendered = pierreCache.get(token);
        if (rendered !== undefined) return rendered;
        // Fallback only fires if walkTokens was bypassed — keep it safe.
        return `<pre class="md-code"><code>${escapeHtml(token.text)}</code></pre>`;
      },
      heading(token) {
        const text = this.parser.parseInline(token.tokens);
        const level = Math.min(token.depth + 2, 6);
        return `<h${level} class="md-h">${text}</h${level}>`;
      },
      list(token) {
        const tag = token.ordered ? "ol" : "ul";
        const cls = token.ordered ? "md-list md-list--ordered" : "md-list";
        const start =
          token.ordered && token.start !== 1 ? ` start="${token.start}"` : "";
        const body = token.items.map((item) => this.listitem(item)).join("");
        return `<${tag} class="${cls}"${start}>${body}</${tag}>`;
      },
      blockquote(token) {
        const body = this.parser.parse(token.tokens);
        return `<blockquote class="md-quote">${body}</blockquote>`;
      },
      hr() {
        return `<hr class="md-hr" />`;
      },
      table(token) {
        const align = (idx: number): string => {
          const a = token.align[idx];
          return a ? ` style="text-align:${a}"` : "";
        };
        const head = token.header
          .map(
            (cell, idx) =>
              `<th${align(idx)}>${this.parser.parseInline(cell.tokens)}</th>`,
          )
          .join("");
        const body = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map(
                  (cell, idx) =>
                    `<td${align(idx)}>${this.parser.parseInline(cell.tokens)}</td>`,
                )
                .join("")}</tr>`,
          )
          .join("");
        return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      },
      link(token) {
        const text = this.parser.parseInline(token.tokens);
        const titleAttr = token.title
          ? ` title="${escapeHtml(token.title)}"`
          : "";
        return `<a href="${escapeHtml(token.href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
    },
  });
}

const mdProse = makeMarked({ breaks: false });
const mdUser = makeMarked({ breaks: true });

/** Render assistant / reasoning markdown. Async because fenced code
 *  blocks are routed through Pierre's SSR. */
export async function renderMarkdown(text: string): Promise<string> {
  return await mdProse.parse(text);
}

/** Render a user prompt as markdown with hard line breaks — a typed
 *  multi-line message preserves each newline as a `<br>` so the
 *  prompt reads the way it was composed, not folded into a single
 *  CommonMark paragraph. */
export async function renderUserMarkdown(text: string): Promise<string> {
  return await mdUser.parse(text);
}
