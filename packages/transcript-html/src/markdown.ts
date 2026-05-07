/** Markdown engine: `marked` for parsing + a custom renderer that
 *  emits the document's existing `.md-*` class hooks (so the
 *  hand-tuned prose CSS in `styles.css` keeps working) and routes
 *  fenced code blocks through Pierre via `walkTokens`.
 *
 *  Marked's async mode lets `walkTokens` be async — we mutate the
 *  fenced-code token to carry a `pierreHtml` field, and the
 *  synchronous `code` renderer just returns that field verbatim.
 *  This is the canonical async-renderer pattern in marked v18; the
 *  alternative (returning a Promise from a renderer) is not
 *  supported.
 *
 *  Headings shift down by two so a single `#` in agent prose becomes
 *  `h3` — `h1`/`h2` are reserved for the document chrome
 *  (transcript title + sectioning). */

import { escapeHtml } from "kolu-common/html";
import { Marked, type Tokens } from "marked";

import { renderCodeBlock } from "./pierre.ts";

interface PierreCodeToken extends Tokens.Code {
  pierreHtml?: string;
}

const md = new Marked({
  gfm: true,
  async: true,
  walkTokens: async (token) => {
    if (token.type === "code") {
      const t = token as PierreCodeToken;
      t.pierreHtml = await renderCodeBlock(t.text, t.lang);
    }
  },
  renderer: {
    code(token) {
      const t = token as PierreCodeToken;
      if (typeof t.pierreHtml === "string") return t.pierreHtml;
      // Fallback only fires if walkTokens was bypassed — keep it safe.
      return `<pre class="md-code"><code>${escapeHtml(t.text)}</code></pre>`;
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

/** Render a markdown string to HTML. Async because fenced code blocks
 *  are routed through Pierre's SSR. */
export async function renderMarkdown(text: string): Promise<string> {
  return await md.parse(text);
}
