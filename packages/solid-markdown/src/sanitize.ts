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
import { isLoadableImage, safeHref } from "./url-policy";

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
  /** Syntax-highlight a fenced code block, returning *trusted* HTML (Shiki
   *  output of escaped code text) or `undefined` to leave the block plain.
   *  Wired only for the document preview, once the highlighter is warm. */
  highlightCode?: (code: string, lang: string) => string | undefined;
  /** Make GFM task-list checkboxes interactive: enabled + tagged with their
   *  source order (`data-md-task`), so the host can write a toggle back to the
   *  file. Off (presentational, disabled) everywhere else. */
  interactiveTasks?: boolean;
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
  // image dimensions, table cell spans, disclosure state, lazy loading, and
  // `disabled` — which marked stamps on task checkboxes and is the signal the
  // task pass keys on (it must survive DOMPurify to be read back).
  "start",
  "width",
  "height",
  "colspan",
  "rowspan",
  "open",
  "loading",
  "disabled",
  // `id` is kept so heading anchors + footnote refs have landing targets, but
  // every id is namespaced (md- prefix) post-sanitize so an untrusted README
  // can't collide with an app id (see sanitizeHtml).
  "id",
  // The alert type + title marker the renderer rewrites marked-alert's class
  // markup into (class itself stays forbidden).
  "data-md-alert",
  "data-md-alert-title",
  // The fence language the renderer stamps on `<code>` so the code-block pass
  // can syntax-highlight it (`class` is forbidden, so this carries it).
  "data-lang",
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
 *  severed opener. This is the *only* link-policy site: the render layer emits
 *  marked's default `<a href=…>` and applies no policy, so markdown `[]()` and
 *  raw inline `<a>` both pick the policy up here, uniformly, exactly once. */
function applyLinkPolicy(anchor: Element, links: boolean): void {
  const unwrap = () => anchor.replaceWith(...Array.from(anchor.childNodes));
  if (!links) {
    unwrap();
    return;
  }
  const href = anchor.getAttribute("href");
  const safe = href ? safeHref(href) : undefined;
  if (safe === undefined) {
    unwrap();
    return;
  }
  // In-page anchors (TOC jumps, footnote refs/back-refs) must stay in the
  // document — a new tab to `#frag` would just blank-load the app shell. The
  // component intercepts the click to scroll within the preview.
  if (safe.startsWith("#")) return;
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
}

/** Whether a `<input type="checkbox">` is one `marked` minted from GFM task
 *  syntax (`- [ ]`), as opposed to a raw inline checkbox an author wrote in the
 *  document body. `marked` always emits the task checkbox as the very first
 *  thing in its `<li>`, but the exact wrapper depends on list tightness:
 *    - *tight* list (no blank line between items): `<li><input …> a</li>` —
 *      the input's parent is the `<li>` itself.
 *    - *loose* list (items separated by a blank line, GitHub's most common
 *      README task-list shape): `<li><p><input …> a</p></li>` — the input's
 *      parent is a `<p>` that is the `<li>`'s first element child.
 *  Accepting both shapes is what keeps interactive toggling alive for loose
 *  lists, and — because `toggleTaskInSource` counts *every* source task marker
 *  regardless of tightness — keeps the rendered `data-md-task` indices congruent
 *  with the source-scan order (a loose checkbox that failed this guard would
 *  stay un-clickable *and* not advance the counter, shifting every later task's
 *  click by one). A raw inline `<input disabled>` in body text (a `<p>` outside
 *  any list, a table cell) is rejected because it is not the first element child
 *  of an `<li>` (nor of the `<li>`'s leading `<p>`); `disabled` alone can't tell
 *  the two apart since both arrive `disabled`. */
function isMarkedTaskCheckbox(input: Element): boolean {
  if (input.previousElementSibling !== null) return false;
  const li = input.closest("li");
  if (li === null) return false;
  const parent = input.parentElement;
  // Tight: the input is the `<li>`'s own first element child.
  if (parent === li) return true;
  // Loose: the input is wrapped in a `<p>` that is the `<li>`'s first element
  // child. Guard against a `<p>` deeper in the item (e.g. a nested list's
  // paragraph) by requiring it to be the `<li>`'s leading element.
  return parent?.tagName === "P" && li.firstElementChild === parent;
}

/** The trusted-injection seam: when a highlighter is supplied and returns
 *  markup, replace the plain `<pre>` in the tree with Shiki's themed `<pre>` and
 *  return that; otherwise return the original `<pre>` untouched. Shiki's output
 *  is trusted (it escapes the code text into the span tree), so it's injected
 *  past the allowlist via a `<template>` — the `style`/`class` it relies on
 *  would otherwise be stripped. This is the one place class/style survive, so it
 *  owns nothing else: no wrapping, no buttons, no mutable reassignment leaking
 *  out — just the chosen element. */
function highlightInto(
  pre: Element,
  highlight?: (code: string, lang: string) => string | undefined,
): Element {
  if (!highlight) return pre;
  const code = pre.querySelector(":scope > code");
  const text = code?.textContent ?? "";
  const lang = code?.getAttribute("data-lang") ?? "";
  const html = highlight(text, lang);
  if (!html) return pre;
  const tpl = document.createElement("template");
  tpl.innerHTML = html; // trusted: Shiki output of escaped code text
  const shikiPre = tpl.content.querySelector("pre");
  if (!shikiPre) return pre;
  pre.replaceWith(shikiPre);
  return shikiPre;
}

/** Pure DOM decoration, highlight-agnostic: wrap the given code block in a
 *  `.kolu-md-code` container and append a copy button. The button + wrapper are
 *  elements we mint here, not from the document, so they need no allowlist
 *  entry. */
function wrapWithCopyButton(block: Element): void {
  const wrap = document.createElement("div");
  wrap.className = "kolu-md-code";
  block.replaceWith(wrap);
  wrap.appendChild(block);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "kolu-md-copy";
  button.setAttribute("data-md-copy", "");
  button.setAttribute("aria-label", "Copy code");
  wrap.appendChild(button);
}

/** Highlight (when a highlighter is supplied) and decorate a fenced code
 *  block: replace the plain `<pre>` with Shiki's themed markup, then wrap it in
 *  a `.kolu-md-code` container carrying a copy button. */
function enhanceCodeBlock(
  pre: Element,
  highlight?: (code: string, lang: string) => string | undefined,
): void {
  if (!pre.querySelector(":scope > code")) return;
  wrapWithCopyButton(highlightInto(pre, highlight));
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
  // other input (a stray `type="text"` etc.). When interactive tasks are
  // enabled we re-enable a marked task checkbox and tag it with its source
  // order so the host can write a toggle back to the file — otherwise it stays
  // presentational (disabled).
  //
  // A marked task checkbox is the leading checkbox of an `<li>` — directly for
  // a tight list (`<li><input>…`) or wrapped in the item's leading `<p>` for a
  // loose, blank-line-separated one (`<li><p><input>…`); see
  // `isMarkedTaskCheckbox`. Both shapes are exactly what `marked` emits for
  // `- [ ]` syntax, and the only shapes the source scanner
  // (`toggleTaskInSource`) counts — it counts every source task marker
  // regardless of list tightness, so accepting both shapes here keeps the two
  // index spaces congruent. Keying on `disabled` alone is too broad: a raw
  // inline `<input type="checkbox" disabled>` sitting in body text (a stray
  // `<p>`, a table cell) also arrives `disabled` but has no `[ ]`/`[x]` marker
  // in the source, so the scanner never counts it — tagging it would assign a
  // `data-md-task` index the scanner can't map back, shifting every later
  // task's click by one. Such a raw checkbox stays presentational.
  let taskIndex = 0;
  for (const input of root.querySelectorAll("input")) {
    if (input.getAttribute("type") !== "checkbox") {
      input.remove();
      continue;
    }
    if (opts.interactiveTasks && isMarkedTaskCheckbox(input)) {
      input.removeAttribute("disabled");
      input.setAttribute("data-md-task", String(taskIndex++));
    } else {
      input.setAttribute("disabled", "");
    }
  }

  // Code blocks: syntax-highlight (when a highlighter is supplied) and wrap
  // each in a copy-button affordance. Only for the document scope.
  if (opts.richHtml) {
    for (const pre of Array.from(root.querySelectorAll("pre"))) {
      enhanceCodeBlock(pre, opts.highlightCode);
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
