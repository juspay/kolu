/** Markdown → HTML (raw, pre-sanitization). Pure and DOM-free: `marked` in
 *  GFM mode with a custom link renderer that allowlists hrefs and honours the
 *  per-slot link policy. The default renderer handles the rest of
 *  GitHub-Flavored Markdown — headings, tables, task lists, strikethrough,
 *  autolinks, images — and passes inline HTML through verbatim, so
 *  `<details>`, `<kbd>`, `<img>`, alignment wrappers and friends survive to
 *  the sanitizer.
 *
 *  Images are deliberately *not* special-cased here: markdown `![]()` and
 *  inline `<img>` only converge after parsing, so their "can this src load?"
 *  fallback lives in the sanitize pass (./sanitize), where both are seen
 *  uniformly. This layer just emits the tags.
 *
 *  The output is *untrusted* HTML: every caller must run it through
 *  `sanitizeHtml` (see ./sanitize) before inserting it into the DOM. Keeping
 *  this layer DOM-free is deliberate — it lets the parse contract be unit
 *  tested in a plain Node environment, where DOMPurify (and `window`) are
 *  absent. */

import { escapeHtml } from "@kolu/html-escape";
import { Marked } from "marked";
import markedAlert from "marked-alert";
import markedFootnote from "marked-footnote";
import { gfmHeadingId } from "marked-gfm-heading-id";

export type RenderOptions = {
  /** Render links as real anchors (true) or inert text (false). Off for slots
   *  whose own click handler must win over a nested anchor — dock rows,
   *  switcher cards, the title bar. */
  links: boolean;
  /** Inline-only parse: no block wrapper, for single-line annotation slots. */
  inline?: boolean;
};

/** Allowlist a URL for use as an `href`. Returns the original string when
 *  safe, else `undefined` (the caller then renders inert text). DOM-free:
 *  resolves relative refs against a fixed base so we can read the *effective*
 *  scheme without a `window`. Blocks `javascript:`, `data:`, `vbscript:` and
 *  any other script-capable scheme; allows http(s), mailto, and in-page
 *  anchors. */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed === "") return undefined;
  if (trimmed.startsWith("#")) return trimmed; // in-page anchor
  let url: URL;
  try {
    // A relative or protocol-relative ref carries no scheme of its own;
    // resolving against an https base surfaces the effective protocol so the
    // check below is uniform for absolute and relative hrefs alike.
    url = new URL(trimmed, "https://markdown.local/");
  } catch {
    return undefined; // unparseable → treat as unsafe, render as plain text
  }
  const ok =
    url.protocol === "http:" ||
    url.protocol === "https:" ||
    url.protocol === "mailto:";
  return ok ? trimmed : undefined;
}

function buildMarked(links: boolean): Marked {
  const inst = new Marked({ gfm: true, breaks: true });
  inst.use({
    renderer: {
      link(token) {
        const inner = this.parser.parseInline(token.tokens ?? []);
        const href = safeHref(token.href);
        // Unsafe scheme, or links disabled for this slot → inert text. The
        // rendered inner is already HTML, so it carries through emphasis/code.
        if (!href || !links) return inner;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
    },
  });
  // GitHub-Flavored extensions the base parser dropped: stable heading ids (so
  // in-page anchors + footnote back-refs have landing targets), footnotes, and
  // `> [!NOTE]`-style alerts. The plugins reset their slug/counter state per
  // parse, so the cached instance is safe to reuse across documents.
  inst.use(gfmHeadingId());
  inst.use(markedFootnote());
  inst.use(markedAlert());
  return inst;
}

/** Strip a leading YAML front-matter block (`---` … `---`) so document
 *  metadata doesn't render as a spurious top-of-page `<hr>` + Setext heading.
 *  Only matches a block at the very start of the document. */
function stripFrontMatter(markdown: string): string {
  return markdown.replace(
    /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,
    "",
  );
}

/** Rewrite `marked-alert`'s class-based markup into an allowlist-safe
 *  `data-md-alert` attribute. The sanitizer drops `class` outright (an
 *  untrusted README must not apply app classes) and strips the injected
 *  octicon SVG, so the alert type is carried on a data attribute the allowlist
 *  permits and the icon comes from CSS instead. */
function rewriteAlerts(html: string): string {
  return html
    .replace(
      /<div class="markdown-alert markdown-alert-(\w+)"\s*>/g,
      '<div data-md-alert="$1">',
    )
    .replace(/<p class="markdown-alert-title"\s*>/g, "<p data-md-alert-title>");
}

// Link policy is the only axis that varies the parser, so cache one configured
// instance per boolean. Rendering is synchronous, so a shared instance is
// safe; the cache just avoids rebuilding the renderer on every call.
const INSTANCES = new Map<boolean, Marked>();
function instance(links: boolean): Marked {
  let inst = INSTANCES.get(links);
  if (!inst) {
    inst = buildMarked(links);
    INSTANCES.set(links, inst);
  }
  return inst;
}

/** Parse Markdown to raw (untrusted) HTML. Sanitize before inserting. */
export function renderMarkdownToRawHtml(
  markdown: string,
  opts: RenderOptions,
): string {
  const inst = instance(opts.links);
  // Our config is fully synchronous (no async extensions), so both calls
  // return a string; the union with Promise only arises under `{ async: true }`.
  if (opts.inline) return inst.parseInline(markdown) as string;
  // Block parse: strip front-matter first, then normalize alert markup. Both
  // are document-level concerns that never apply to the inline slot.
  return rewriteAlerts(inst.parse(stripFrontMatter(markdown)) as string);
}
