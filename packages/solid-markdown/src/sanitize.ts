/** DOM-dependent sanitization of `marked`-produced HTML, isolated from the
 *  parse layer (./render) so that layer stays Node-testable. DOMPurify needs a
 *  live `window`, so this module is browser-only.
 *
 *  The policy keeps the inline HTML a real-world README leans on — alignment
 *  wrappers (`<p align>`), `<details>`/`<summary>`, `<kbd>`, `<sub>`/`<sup>`,
 *  task-list `<input>`s, images — while stripping anything that could script,
 *  style, or frame the host app. It is the security backstop behind the parse
 *  layer's href allowlist, not a substitute for it.
 *
 *  Sanitizing to a detached DOM (rather than a string) lets us run two small
 *  presentational passes on the *result*, where markdown-rendered and inline
 *  HTML have converged into one tree:
 *    - sever every targeted link from its opener (`rel=noopener`), and
 *    - swap any image whose src can't load here (a repo-relative README image)
 *      for a labelled fallback chip instead of a broken-image icon. */

import DOMPurify from "dompurify";

const CONFIG = {
  // A previewed document must never script, style, or frame the host app.
  // DOMPurify already drops most of these; listing them is defense in depth.
  FORBID_TAGS: [
    "script",
    "style",
    "iframe",
    "form",
    "object",
    "embed",
    "link",
    "meta",
    "base",
  ],
  // Attributes DOMPurify strips by default that GFM / inline HTML depend on:
  // `align` (alignment wrappers + table cells), `target`/`loading` (anchors,
  // images), `checked` (task-list state).
  ADD_ATTR: ["align", "target", "loading", "checked"],
  RETURN_DOM: true,
};

/** Only an absolute http(s) src can load in this context; a repo-relative
 *  README image (`./docs/logo.png`) has no server to resolve against here. */
function isLoadableImage(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

/** Trailing path segment, used to label a fallback chip whose image had no
 *  alt text so it still says something useful. */
function basename(src: string): string {
  const path = src.split(/[?#]/, 1)[0] ?? src;
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "image";
}

/** Sanitize `marked`-produced HTML into DOM-safe markup. Returns an empty
 *  string when there is no DOM (SSR / Node), since there is nothing to render
 *  into anyway. */
export function sanitizeHtml(rawHtml: string): string {
  if (typeof window === "undefined") return "";

  const root = DOMPurify.sanitize(rawHtml, CONFIG) as unknown as HTMLElement;

  // Inline HTML can carry its own `<a target=...>`; the parse layer already
  // stamps `rel` on the anchors it mints, this covers the rest.
  for (const anchor of root.querySelectorAll("a[target]")) {
    anchor.setAttribute("rel", "noopener noreferrer");
  }

  // Replace un-loadable images (markdown- or inline-HTML-sourced alike) with a
  // labelled chip rather than a broken-image icon.
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (isLoadableImage(src)) continue;
    const chip = document.createElement("span");
    chip.className = "kolu-md-img-fallback";
    chip.title = src;
    chip.textContent = img.getAttribute("alt") || basename(src);
    img.replaceWith(chip);
  }

  return root.innerHTML;
}
