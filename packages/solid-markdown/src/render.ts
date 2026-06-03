/** Markdown → HTML (raw, pre-sanitization). Pure and DOM-free: `marked` in
 *  GFM mode. The default renderer handles GitHub-Flavored Markdown — headings,
 *  tables, task lists, strikethrough, autolinks, links, images — and passes
 *  inline HTML through verbatim, so `<details>`, `<kbd>`, `<img>`, alignment
 *  wrappers and friends survive to the sanitizer.
 *
 *  What this renderer does NOT support — math/LaTeX, mermaid, emoji
 *  shortcodes, @mentions, #issue/SHA autolinks, and the non-GitHub ecosystem
 *  syntaxes — is catalogued in ../LIMITATIONS.md. Keep it in sync when adding
 *  or dropping a feature here.
 *
 *  Link *and* image policy are deliberately *not* applied here. This layer is
 *  purely structural: it emits the default `<a href=…>` / `<img src=…>` tags,
 *  and the per-slot decisions — "is this href safe? should links be anchors at
 *  all? what target/rel? can this image src load?" — all live in the sanitize
 *  pass (./sanitize). That's where markdown `[]()`/`![]()` and inline
 *  `<a>`/`<img>` converge into one tree, so applying the policy there covers
 *  both halves uniformly instead of re-deriving it per source.
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
  /** Inline-only parse: no block wrapper, for single-line annotation slots. */
  inline?: boolean;
  /** Treat a single newline as a hard line break (GitHub does NOT — it folds
   *  soft breaks to a space). On for the chat/dock intent scale (message-like),
   *  off for the document preview (GitHub-faithful). Defaults on. */
  breaks?: boolean;
};

// The fixed GFM extension stack — constant across every instance. These are
// GitHub-Flavored extensions the base parser dropped: stable heading ids (so
// in-page anchors + footnote back-refs have landing targets), footnotes, and
// `> [!NOTE]`-style alerts. The plugins reset their slug/counter state per
// parse, so the cached instance is safe to reuse across documents.
function useGfmExtensions(inst: Marked): void {
  inst.use(gfmHeadingId());
  inst.use(markedFootnote());
  inst.use(markedAlert());
}

// The per-slot renderer override — the only thing the parser config varies on.
// Just the code fence today: carry the fence language on `data-lang` so the
// sanitize pass can find + syntax-highlight the block (see ./highlight).
function useCodeFenceRenderer(inst: Marked): void {
  inst.use({
    renderer: {
      code(token) {
        // The sanitizer allowlists `data-lang` but strips `class`, so this is
        // what survives to drive highlighting. The body is escaped here;
        // highlighting replaces it with trusted markup downstream.
        const lang = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
        const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
        return `<pre><code${attr}>${escapeHtml(token.text)}</code></pre>\n`;
      },
    },
  });
}

function buildMarked(breaks: boolean): Marked {
  const inst = new Marked({ gfm: true, breaks });
  useGfmExtensions(inst);
  useCodeFenceRenderer(inst);
  return inst;
}

/** The leading YAML front-matter block (`---` … `---`) at the very start of a
 *  document — a `---` fence line, any body, a closing `---` fence line, and its
 *  line ending. Single-sourced so the renderer (which strips it) and the
 *  task-toggle scanner (which must skip it to stay index-aligned with the
 *  rendered checkboxes) agree on exactly what the prefix is. */
export const FRONT_MATTER_RE =
  /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Strip a leading YAML front-matter block (`---` … `---`) so document
 *  metadata doesn't render as a spurious top-of-page `<hr>` + Setext heading.
 *  Only matches a block at the very start of the document. Exported so the
 *  task-toggle scanner can skip the identical prefix the renderer drops —
 *  otherwise a task-marker-shaped line inside the front-matter (`- [ ]` under a
 *  YAML key) would be counted by the scanner but never rendered, drifting every
 *  `data-md-task` index. */
export function stripFrontMatter(markdown: string): string {
  return markdown.replace(FRONT_MATTER_RE, "");
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

// The soft-break setting is the only axis that varies the parser, so cache one
// configured instance per `breaks`. Rendering is synchronous, so a shared
// instance is safe; the cache just avoids rebuilding the renderer on every call.
const INSTANCES = new Map<boolean, Marked>();
function instance(breaks: boolean): Marked {
  let inst = INSTANCES.get(breaks);
  if (!inst) {
    inst = buildMarked(breaks);
    INSTANCES.set(breaks, inst);
  }
  return inst;
}

/** Parse Markdown to raw (untrusted) HTML. Sanitize before inserting. */
export function renderMarkdownToRawHtml(
  markdown: string,
  opts: RenderOptions,
): string {
  const inst = instance(opts.breaks ?? true);
  // Our config is fully synchronous (no async extensions), so both calls
  // return a string; the union with Promise only arises under `{ async: true }`.
  if (opts.inline) return inst.parseInline(markdown) as string;
  // Block parse: strip front-matter first, then normalize alert markup. Both
  // are document-level concerns that never apply to the inline slot.
  return rewriteAlerts(inst.parse(stripFrontMatter(markdown)) as string);
}
