import DOMPurify from "dompurify";
import type { Diagram } from "./diagram";
import { DIAGRAM_LANG } from "./render";
import { hasOwnScheme, isLoadableImage, safeHref } from "./url-policy";

export type SanitizeOptions = {
  links: boolean;
  richHtml: boolean;
  resolveImageSrc?: (src: string) => string | undefined;
  highlightCode?: (code: string, lang: string) => string | undefined;
  diagram?: (source: string) => Diagram | undefined;
};

const DOCUMENT_TAGS = [
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
  "details",
  "summary",
  "input",
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

const DOCUMENT_ATTR = [
  "href",
  "title",
  "alt",
  "src",
  "align",
  "type",
  "checked",
  "start",
  "width",
  "height",
  "colspan",
  "rowspan",
  "open",
  "loading",
  "disabled",
  "id",
  "data-md-alert",
  "data-md-alert-title",
  "data-md-frontmatter",
  "data-lang",
  "data-md-wikilink",
  "data-md-footnote",
  "data-md-footnote-backref",
];
const INTENT_ATTR = ["href", "title", "data-lang"];

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

const ID_NS = "md-";

function basename(src: string): string {
  // `split(…, 1)[0]` is always present at runtime, but `noUncheckedIndexedAccess`
  // types it `string | undefined`, so keep the `?? src` to satisfy the checker.
  const path = src.split(/[?#]/, 1)[0] ?? src;
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "image";
}

function applyLinkPolicy(anchor: Element, links: boolean): void {
  const unwrap = () => anchor.replaceWith(...Array.from(anchor.childNodes));
  if (!links) {
    unwrap();
    return;
  }
  const href = anchor.getAttribute("href");
  // Wikilink marker (`[[Note]]`, stamped by the renderer): trust it ONLY on a
  // parser-minted anchor. The renderer always emits `href="#"` and carries the
  // resolver payload on `data-md-wikilink` itself, so a genuine wikilink reads
  // exactly `href="#"`. A README's *raw* HTML can mint `<a data-md-wikilink …>`
  // too (the marker is in the document allowlist) — but with any *other* href
  // that's a spoof trying to opt a raw anchor into the host's pathless resolver,
  // so strip the marker and let the href fall through to the normal policy below
  // (external → `target=_blank`, relative → `data-md-rel`, unsafe → unwrapped).
  // Net: the marker is only ever honoured on the renderer's own `href="#"`
  // output, so raw HTML can't opt into wikilink behaviour.
  if (anchor.hasAttribute("data-md-wikilink")) {
    if (href === "#") return;
    anchor.removeAttribute("data-md-wikilink");
  }
  const safe = href ? safeHref(href) : undefined;
  if (safe === undefined) {
    unwrap();
    return;
  }
  if (safe.startsWith("#")) return;
  if (!hasOwnScheme(safe)) {
    anchor.setAttribute("data-md-rel", "");
    return;
  }
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
}

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
  tpl.innerHTML = html;
  const shikiPre = tpl.content.querySelector("pre");
  if (!shikiPre) return pre;
  pre.replaceWith(shikiPre);
  return shikiPre;
}

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

function enhanceCodeBlock(
  pre: Element,
  highlight?: (code: string, lang: string) => string | undefined,
): void {
  if (!pre.querySelector(":scope > code")) return;
  wrapWithCopyButton(highlightInto(pre, highlight));
}

function diagramFigure(diagram: Extract<Diagram, { ok: true }>): Element {
  const figure = document.createElement("figure");
  figure.setAttribute("data-md-diagram", "");
  for (const [scheme, image] of [
    ["light", diagram.light],
    ["dark", diagram.dark],
  ] as const) {
    const img = document.createElement("img");
    img.setAttribute("data-md-scheme", scheme);
    img.setAttribute("src", image.src);
    img.setAttribute("width", String(image.width));
    img.setAttribute("height", String(image.height));
    img.setAttribute("alt", "Mermaid diagram");
    img.setAttribute("decoding", "sync");
    figure.appendChild(img);
  }
  return figure;
}

export function sanitizeHtml(rawHtml: string, opts: SanitizeOptions): string {
  if (typeof window === "undefined") return "";

  const root = DOMPurify.sanitize(
    rawHtml,
    configFor(opts),
  ) as unknown as HTMLElement;

  for (const anchor of root.querySelectorAll("a")) {
    applyLinkPolicy(anchor, opts.links);
  }

  for (const input of root.querySelectorAll("input")) {
    if (input.getAttribute("type") === "checkbox") {
      input.setAttribute("disabled", "");
    } else {
      input.remove();
    }
  }

  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    const code = pre.querySelector(":scope > code");
    const diagram =
      code?.getAttribute("data-lang") === DIAGRAM_LANG
        ? opts.diagram?.(code.textContent ?? "")
        : undefined;
    if (diagram?.ok) {
      pre.replaceWith(diagramFigure(diagram));
      continue;
    }
    if (diagram) {
      // Placed while the `<pre>` still stands where it was: the decoration
      // below replaces it in place, so the note ends up after the wrapper.
      const error = document.createElement("p");
      error.setAttribute("data-md-diagram-error", "");
      error.textContent = diagram.message;
      pre.after(error);
    }
    if (opts.richHtml) enhanceCodeBlock(pre, opts.highlightCode);
  }

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
