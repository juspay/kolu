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
  /** Pass *raw* inline/block HTML through to the sanitizer (true) or escape it
   *  to literal text at parse time (false). Only the document preview is a
   *  document, so only it admits a README's raw HTML. The compact/inline intent
   *  slots are clickable UI rows built from user/agent strings — there a raw
   *  `<h1>`/`<pre>`/`<a>` must render as literal text, NOT as markup. The
   *  downstream tag allowlist can't make this distinction on its own (it would
   *  also have to drop the *same* tags when markdown legitimately produces
   *  them), so the boundary is enforced here, at the token level. Defaults on. */
  rawHtml?: boolean;
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

/** One `[[wikilink]]` token: an Obsidian-style internal reference. `target`
 *  is the note/path (never empty); `heading` is the optional `#…` fragment;
 *  `alias` is the optional `|…` display override; `embed` marks the `![[…]]`
 *  transclusion form, which this renderer deliberately does NOT expand. */
interface WikilinkToken {
  type: "wikilink";
  raw: string;
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
}

// `[[target]]`, `[[target|alias]]`, `[[target#heading]]`, and the `![[…]]`
// embed form. Each captured part stops at the structural delimiters (`#`, `|`,
// `]]`) so `target` / `heading` / `alias` split cleanly. `target` is `+`
// (non-empty); the others are optional. A newline ends the candidate — a
// wikilink never spans lines.
const WIKILINK_RE =
  /^(!)?\[\[([^\][\n|#]+)(?:#([^\][\n|]+))?(?:\|([^\][\n]+))?\]\]/;

// The Obsidian-style `[[wikilink]]` inline extension. It desugars a wikilink
// into the *same* tagged anchor a repo-relative `[]()` link produces — minted
// here with `data-md-wikilink` so the sanitizer keeps the marker (it's in the
// document allowlist) and the component routes the click to the host's
// pathless, vault-wide resolver instead of the directory-relative one. The
// `![[…]]` embed (transclusion) form is intentionally left inert: it renders as
// literal text, never expanded into the referenced note's content.
function useWikilinkExtension(inst: Marked): void {
  inst.use({
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        // Point the inline lexer at the next `[[` / `![[` so the default text
        // tokenizer stops there and this extension gets first refusal.
        start(src: string) {
          return src.match(/!?\[\[/)?.index;
        },
        tokenizer(src: string): WikilinkToken | undefined {
          const m = WIKILINK_RE.exec(src);
          if (!m || m[2] === undefined) return undefined;
          return {
            type: "wikilink",
            raw: m[0],
            target: m[2].trim(),
            heading: m[3]?.trim(),
            alias: m[4]?.trim(),
            embed: m[1] === "!",
          };
        },
        renderer(token) {
          const w = token as WikilinkToken;
          // Embeds are out of scope — emit the literal source so `![[Note]]`
          // shows as text rather than being silently expanded or half-linked.
          if (w.embed) return escapeHtml(w.raw);
          // Carry the heading in the href so the host can resolve (it strips
          // the fragment) without a second attribute; the marker disambiguates
          // a wikilink from a `[]()` relative link at the click seam.
          const href = w.heading ? `${w.target}#${w.heading}` : w.target;
          const display =
            w.alias ?? (w.heading ? `${w.target}#${w.heading}` : w.target);
          return `<a href="${escapeHtml(href)}" data-md-wikilink>${escapeHtml(display)}</a>`;
        },
      },
    ],
  });
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

// The document-only raw-HTML boundary. `marked`'s `html` hook fires for both
// raw *block* HTML (`<div>…`) and inline raw *tags* (`<a>`, `<kbd>`, `<pre>`),
// so escaping it here neutralizes the whole raw-HTML surface for compact/inline
// at the token level — markdown-*produced* tags (which never flow through this
// hook) keep rendering. When `rawHtml` is on (the document preview), return
// false to fall back to marked's default passthrough. The downstream allowlist
// can't enforce this (it must keep `<h1>`/`<pre>`/`<a>` for markdown output),
// so the boundary lives here.
function useRawHtmlPolicy(inst: Marked, rawHtml: boolean): void {
  inst.use({
    renderer: {
      html({ text }) {
        return rawHtml ? false : escapeHtml(text);
      },
    },
  });
}

function buildMarked(breaks: boolean, rawHtml: boolean): Marked {
  const inst = new Marked({ gfm: true, breaks });
  useGfmExtensions(inst);
  // Wikilinks are a document-preview feature, scoped to the one variant that
  // admits a document's full surface (`rawHtml` is true only for the document
  // preview). The compact/inline intent slots leave `[[…]]` as plain text —
  // their links are off, so a wikilink anchor would just be unwrapped anyway.
  if (rawHtml) useWikilinkExtension(inst);
  useCodeFenceRenderer(inst);
  useRawHtmlPolicy(inst, rawHtml);
  return inst;
}

/** The leading YAML front-matter block (`---` … `---`) at the very start of a
 *  document — a `---` fence line, any body, a closing `---` fence line, and its
 *  line ending. */
const FRONT_MATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Strip a leading YAML front-matter block (`---` … `---`) so document
 *  metadata doesn't render as a spurious top-of-page `<hr>` + Setext heading.
 *  Only matches a block at the very start of the document. */
function stripFrontMatter(markdown: string): string {
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

// The soft-break setting and the raw-HTML toggle are the axes that vary the
// parser, so cache one configured instance per (breaks, rawHtml). Rendering is
// synchronous, so a shared instance is safe; the cache just avoids rebuilding
// the renderer on every call.
const INSTANCES = new Map<string, Marked>();
function instance(breaks: boolean, rawHtml: boolean): Marked {
  const key = `${breaks}:${rawHtml}`;
  let inst = INSTANCES.get(key);
  if (!inst) {
    inst = buildMarked(breaks, rawHtml);
    INSTANCES.set(key, inst);
  }
  return inst;
}

/** Parse Markdown to raw (untrusted) HTML. Sanitize before inserting. */
export function renderMarkdownToRawHtml(
  markdown: string,
  opts: RenderOptions,
): string {
  const inst = instance(opts.breaks ?? true, opts.rawHtml ?? true);
  // Our config is fully synchronous (no async extensions), so both calls
  // return a string; the union with Promise only arises under `{ async: true }`.
  if (opts.inline) return inst.parseInline(markdown) as string;
  // Block parse: strip front-matter first, then normalize alert markup. Both
  // are document-level concerns that never apply to the inline slot.
  return rewriteAlerts(inst.parse(stripFrontMatter(markdown)) as string);
}
