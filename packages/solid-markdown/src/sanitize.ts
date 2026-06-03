/** DOM-dependent sanitization of `marked`-produced HTML, isolated from the
 *  parse layer (./render) so that layer stays Node-testable. DOMPurify needs a
 *  live `window`, so this module is browser-only.
 *
 *  The policy is a *tight, Markdown-specific allowlist* — not DOMPurify's broad
 *  defaults. DOMPurify's defaults keep `style`/`class`/`id` attributes plus the
 *  whole SVG/MathML/interactive-element surface, any of which an untrusted
 *  README could use to apply global app styles, render focusable controls, or
 *  otherwise take over the host. Since the result is inserted straight into
 *  Kolu's live DOM, we pin `ALLOWED_TAGS` / `ALLOWED_ATTR` to exactly the
 *  README subset we want and nothing else.
 *
 *  Two scopes share this module:
 *    - the *document* preview keeps the inline HTML a real-world README leans on
 *      — alignment wrappers (`<p align>`), `<details>`/`<summary>`, `<kbd>`,
 *      `<sub>`/`<sup>`, task-list `<input>`s, images;
 *    - the *intent* surfaces (compact / inline chat slots) get a stricter scope
 *      with no raw block HTML and no images, since those are clickable UI rows,
 *      not documents.
 *
 *  Sanitizing to a detached DOM (rather than a string) lets us run a few small
 *  passes on the *result*, where markdown-rendered and inline HTML have
 *  converged into one tree:
 *    - apply the per-slot link policy to *every* anchor (markdown- or
 *      inline-HTML-sourced): drop it when links are off, else force
 *      `target="_blank" rel="noopener noreferrer"`;
 *    - swap any image whose src can't load here (a repo-relative README image)
 *      for a labelled fallback chip instead of a broken-image icon. */

import DOMPurify from "dompurify";
import { safeHref } from "./render";

/** Per-slot policy for the sanitize pass — mirrors the renderer's
 *  `RenderOptions` so one object threads parse + sanitize. */
export type SanitizeOptions = {
  /** Keep real anchors (true) or unwrap them to their inner content (false).
   *  Off for slots whose own click handler must win over a nested anchor. */
  links: boolean;
  /** Allow the README inline-HTML / image surface. Off for the compact and
   *  inline intent slots, which are clickable UI rows, not documents — there a
   *  user/agent string must not inject block HTML or images. */
  richHtml: boolean;
  /** Resolve a non-absolute image `src` (a repo-relative README image like
   *  `./docs/logo.png`) to a URL the browser can actually load — e.g. the
   *  host's per-repo file route. Returns `undefined` when the src can't be
   *  resolved, in which case the image degrades to a labelled chip. App-
   *  agnostic: the host supplies the mapping; the package just applies it. */
  resolveImageSrc?: (src: string) => string | undefined;
};

// The README inline-HTML subset, plus the tags `marked` emits for GFM. No
// `style`/`script`/`iframe`/`form`/`object`/`embed`/SVG/MathML, no media or
// arbitrary interactive controls — only the disabled task-list checkbox.
const DOCUMENT_TAGS = [
  // Block structure marked emits.
  "p",
  "br",
  "hr",
  "blockquote",
  "pre",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  // Inline text.
  "a",
  "img",
  "code",
  "em",
  "strong",
  "del",
  "s",
  "ins",
  "mark",
  "sub",
  "sup",
  "kbd",
  "abbr",
  "small",
  "b",
  "i",
  "u",
  // README-flavoured containers.
  "details",
  "summary",
  "input",
  // Definition lists, figures, table caption/colgroup (raw-HTML in READMEs),
  // and the footnotes/alert containers the marked extensions emit.
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "caption",
  "colgroup",
  "col",
  "section",
];

// Intent slots: just the inline text marks markdown produces — no images, no
// block HTML containers, no inputs.
const INTENT_TAGS = [
  "p",
  "br",
  "span",
  "a",
  "code",
  "em",
  "strong",
  "del",
  "s",
  "ins",
  "mark",
  "sub",
  "sup",
  "kbd",
  "abbr",
  "small",
  "b",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

// Exactly the attributes the allowed tags need — `style`/`class`/`id` are
// deliberately *absent* so a previewed document can't restyle or anchor itself
// into the app. `href` is re-validated below; `target`/`rel` are re-stamped.
const DOCUMENT_ATTR = [
  "href",
  "title",
  "alt",
  "src",
  "align",
  "type",
  "checked",
  // Inert structural/state attributes (no script surface): list numbering,
  // image dimensions, table cell spans, disclosure state, lazy loading.
  "start",
  "width",
  "height",
  "colspan",
  "rowspan",
  "open",
  "loading",
  // `id` is kept so heading anchors + footnote refs have landing targets, but
  // every id is namespaced (md- prefix) post-sanitize so an untrusted README
  // can't collide with an app id (see sanitizeHtml).
  "id",
  // The alert type + title marker the renderer rewrites marked-alert's class
  // markup into (class itself stays forbidden).
  "data-md-alert",
  "data-md-alert-title",
];
const INTENT_ATTR = ["href", "title"];

function configFor(opts: SanitizeOptions) {
  // An explicit `ALLOWED_TAGS`/`ALLOWED_ATTR` *array* replaces DOMPurify's
  // default base (html+svg+mathml) outright — so SVG/MathML and every
  // unlisted interactive/media element are excluded simply by not being in
  // these lists. We deliberately do NOT set `USE_PROFILES`: a profile would
  // overwrite the explicit lists with the full html allowlist and silently
  // re-admit `style`/`class`/inputs/etc.
  //
  // `ALLOWED_ATTR` alone is *not* a complete allowlist: DOMPurify keeps any
  // `data-*` / `aria-*` attribute by default (its `ALLOW_DATA_ATTR` /
  // `ALLOW_ARIA_ATTR` short-circuit the `ALLOWED_ATTR` check). Markdown emits
  // neither, and we don't want an untrusted README seeding `data-*` hooks the
  // app might read or `aria-*` it didn't author — so we turn both off to make
  // the attribute set exactly `DOCUMENT_ATTR` / `INTENT_ATTR`.
  return {
    ALLOWED_TAGS: opts.richHtml ? DOCUMENT_TAGS : INTENT_TAGS,
    ALLOWED_ATTR: opts.richHtml ? DOCUMENT_ATTR : INTENT_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM: true,
  };
}

/** An image that loads directly as written — an absolute http(s) URL or an
 *  inline data:image URI. A repo-relative README src (`./docs/logo.png`) is
 *  NOT loadable as-is; it goes through the host's `resolveImageSrc` first. */
function isLoadableImage(src: string): boolean {
  return /^(?:https?:\/\/|data:image\/)/i.test(src.trim());
}

/** Prefix for every id/hash-href the sanitizer keeps, so an untrusted
 *  document's anchors stay self-consistent but can't collide with app ids. */
const ID_NS = "md-";

/** Trailing path segment, used to label a fallback chip whose image had no
 *  alt text so it still says something useful. */
function basename(src: string): string {
  const path = src.split(/[?#]/, 1)[0] ?? src;
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "image";
}

/** Apply the per-slot link policy to one anchor that survived sanitization
 *  (markdown- or inline-HTML-sourced alike). When links are off, unwrap it to
 *  its children so the text survives but the anchor doesn't. When on, drop a
 *  non-allowlisted href and force every kept anchor to open in a new tab with a
 *  severed opener — the renderer only stamps the anchors *it* mints, so this is
 *  what covers raw inline `<a>`. */
function applyLinkPolicy(anchor: Element, links: boolean): void {
  if (!links) {
    anchor.replaceWith(...Array.from(anchor.childNodes));
    return;
  }
  const href = anchor.getAttribute("href");
  const safe = href ? safeHref(href) : undefined;
  if (safe === undefined) {
    anchor.replaceWith(...Array.from(anchor.childNodes));
    return;
  }
  // In-page anchors (TOC jumps, footnote refs/back-refs) must stay in the
  // document — a new tab to `#frag` would just blank-load the app shell. The
  // component intercepts the click to scroll within the preview.
  if (safe.startsWith("#")) return;
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
}

/** Sanitize `marked`-produced HTML into DOM-safe markup under the given
 *  per-slot policy. Returns an empty string when there is no DOM (SSR / Node),
 *  since there is nothing to render into anyway. */
export function sanitizeHtml(rawHtml: string, opts: SanitizeOptions): string {
  if (typeof window === "undefined") return "";

  const root = DOMPurify.sanitize(
    rawHtml,
    configFor(opts),
  ) as unknown as HTMLElement;

  // Apply the link policy to every anchor — not just the renderer's, and not
  // just the ones that happen to carry a `target`.
  for (const anchor of root.querySelectorAll("a")) {
    applyLinkPolicy(anchor, opts.links);
  }

  // `<input>` is allowed only to carry a GFM task-list checkbox. Drop any
  // other input (a stray `type="text"` etc.), and make the kept checkboxes
  // presentational — they are rendered state, never interactive here.
  for (const input of root.querySelectorAll("input")) {
    if (input.getAttribute("type") === "checkbox") {
      input.setAttribute("disabled", "");
    } else {
      input.remove();
    }
  }

  // Resolve images (markdown- or inline-HTML-sourced alike): absolute http(s)/
  // data URIs load as written; a repo-relative src is handed to the host's
  // resolver (→ the per-repo file route); anything still un-loadable degrades
  // to a labelled chip rather than a broken-image icon.
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (isLoadableImage(src)) continue;
    const resolved = opts.resolveImageSrc?.(src);
    if (resolved !== undefined) {
      img.setAttribute("src", resolved);
      img.setAttribute("loading", "lazy");
      continue;
    }
    const chip = document.createElement("span");
    chip.className = "kolu-md-img-fallback";
    chip.title = src;
    chip.textContent = img.getAttribute("alt") || basename(src);
    img.replaceWith(chip);
  }

  // Namespace every id and the in-page hrefs that target them, so a document's
  // heading/footnote anchors resolve among themselves without colliding with
  // the app's ids.
  for (const el of root.querySelectorAll("[id]")) {
    const id = el.getAttribute("id");
    if (id) el.setAttribute("id", `${ID_NS}${id}`);
  }
  for (const anchor of root.querySelectorAll('a[href^="#"]')) {
    const href = anchor.getAttribute("href");
    if (href && href.length > 1) {
      anchor.setAttribute("href", `#${ID_NS}${href.slice(1)}`);
    }
  }

  return root.innerHTML;
}
