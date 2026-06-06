/** Markdown → sanitized HTML, rendered into a themed container.
 *
 *  The renderer is a two-stage pipeline: `marked` (GFM) parses to raw HTML
 *  (./render), then DOMPurify sanitizes it (./sanitize). This replaces the
 *  former hand-rolled token walk and gains full GitHub-Flavored Markdown —
 *  tables, task lists, strikethrough, autolinks — plus the inline HTML a
 *  README leans on, all behind a sanitizer.
 *
 *  Styling lives in ./markdown.css, scoped to `.kolu-md`. It paints with
 *  `currentColor` and `color-mix` derivations so it adapts to any host
 *  surface, and reads the app's `--color-accent` for links — so the preview
 *  follows the app's light/dark preference automatically, with no theme prop.
 *
 *  `variant` selects the parse mode + the styling scale:
 *    - "inline"   — inline-only parse, no block wrapper (annotation slots).
 *    - "compact"  — block parse at chat/dock scale (kolu's intent body).
 *    - "document" — full-pane preview: GitHub-faithful soft breaks, Shiki code
 *      highlighting + copy buttons, and read-only (presentational) task-list
 *      checkboxes. The preview never writes back to the file. */

import {
  type Component,
  createMemo,
  createResource,
  onCleanup,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { highlightCode, loadHighlighter } from "./highlight";
import { renderMarkdownToRawHtml } from "./render";
import { sanitizeHtml } from "./sanitize";

export type MarkdownVariant = "inline" | "compact" | "document";

/** Copy a code block's text to the clipboard and flash the button. */
function copyCodeBlock(button: HTMLElement): void {
  const pre = button.closest(".kolu-md-code")?.querySelector("pre");
  const text = pre?.textContent ?? "";
  if (!text) return;
  void navigator.clipboard
    ?.writeText(text)
    .then(() => {
      button.setAttribute("data-copied", "");
      setTimeout(() => button.removeAttribute("data-copied"), 1500);
    })
    // A rejected write (permission denied, unfocused document, API throw) would
    // otherwise surface as an unhandled rejection — and the "Copied" flash never
    // fires, so a failed copy is silently indistinguishable from a successful one.
    // Warn so the failure is diagnosable rather than swallowed.
    .catch((err) => console.warn("markdown: copy to clipboard failed", err));
}

/** Host hooks for the two link kinds the preview intercepts: a repo-relative
 *  `[]()` link (resolved against the doc's directory) and an Obsidian-style
 *  `[[wikilink]]` (resolved pathless across the repo). Both fire only in the
 *  document preview; everywhere else links are off and these never run. */
type LinkHandlers = {
  onNavigateRelative?: (href: string) => void;
  /** A wikilink click — the host resolves `target` (`Note` / `Note#Heading`)
   *  against the whole repo. `anchor` is the clicked element so the host can
   *  anchor a disambiguation menu to it when the target is ambiguous. */
  onNavigateWikilink?: (target: string, anchor: HTMLElement) => void;
};

/** Handle interactive bits inside the rendered Markdown — code-copy buttons,
 *  in-page anchors, and the two intercepted link kinds (`LinkHandlers`). (The
 *  preview is read-only; task-list checkboxes render as presentational state.)
 *  Bound imperatively (not via JSX `onClick`) because these are delegated
 *  handlers over sanitizer-minted DOM, not declarative element interactions the
 *  a11y lint would expect a role for.
 *
 *  Each also stops the bubble so a nested control in a clickable host slot
 *  (dock card, switcher card) doesn't double-fire that slot's handler. */
function bindInteractions(el: HTMLElement, handlers: LinkHandlers): void {
  const onPointerDown = (e: Event) => {
    const target = e.target as Element | null;
    if (target?.closest?.("a, [data-md-copy]")) {
      e.stopPropagation();
    }
  };
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    const copyButton = target.closest<HTMLElement>("[data-md-copy]");
    if (copyButton) {
      e.preventDefault();
      e.stopPropagation();
      copyCodeBlock(copyButton);
      return;
    }

    const anchor = target.closest("a");
    if (anchor) {
      e.stopPropagation();
      const href = anchor.getAttribute("href");
      // In-page anchors (TOC, footnotes — namespaced `#md-…`) scroll within
      // the preview without navigating or writing the app's URL hash.
      if (href?.startsWith("#") && href.length > 1) {
        const landing = el.querySelector(`#${CSS.escape(href.slice(1))}`);
        if (landing) {
          e.preventDefault();
          landing.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      // Wikilinks (`[[Note]]`, tagged by the renderer) resolve pathless across
      // the whole repo — never against the app origin. Suppress navigation and
      // hand the host the bare target plus the clicked anchor, so it can open
      // the file (or anchor a disambiguation menu here when it's ambiguous).
      const wikilinkTarget = anchor.getAttribute("data-md-wikilink");
      if (wikilinkTarget !== null) {
        e.preventDefault();
        if (wikilinkTarget)
          handlers.onNavigateWikilink?.(wikilinkTarget, anchor);
        return;
      }
      // Repo-relative links (tagged by the link policy) must never resolve
      // against the app origin — that opens a bogus app route in a new tab
      // (#1161). Suppress the default navigation unconditionally and, when the
      // host wired a handler, ask it to open the linked file instead. With no
      // handler the link is simply inert (still better than a bogus tab).
      if (anchor.hasAttribute("data-md-rel")) {
        e.preventDefault();
        if (href) handlers.onNavigateRelative?.(href);
      }
    }
  };
  el.addEventListener("click", onClick);
  el.addEventListener("pointerdown", onPointerDown);
  onCleanup(() => {
    el.removeEventListener("click", onClick);
    el.removeEventListener("pointerdown", onPointerDown);
  });
}

export const Markdown: Component<{
  markdown: string;
  variant?: MarkdownVariant;
  links?: boolean;
  /** Resolve a repo-relative image `src` to a loadable URL (see
   *  `SanitizeOptions.resolveImageSrc`). Document variant only. */
  resolveImageSrc?: (src: string) => string | undefined;
  /** Open a repo-relative *link* `href` (a scheme-less `[doc](docs/guide.md)`)
   *  in the host instead of letting the browser navigate the app origin in a
   *  new tab (#1161). The host resolves the path against the previewed file and
   *  opens it (e.g. in the Code tab). Unwired ⇒ such links are inert. */
  onNavigateRelative?: (href: string) => void;
  /** Open an Obsidian-style `[[wikilink]]` in the host. Unlike a relative link,
   *  the `target` (`Note` / `Note#Heading`) resolves *pathless* across the
   *  whole repo. `anchor` is the clicked element, so the host can anchor a
   *  disambiguation menu to it when the basename matches more than one file.
   *  Unwired ⇒ wikilinks are inert. */
  onNavigateWikilink?: (target: string, anchor: HTMLElement) => void;
}> = (props) => {
  const variant = (): MarkdownVariant => props.variant ?? "document";
  const isDocument = () => variant() === "document";
  // Links default on for block variants, off for inline — an inline slot's own
  // click handler (open editor / open palette) must win over a nested anchor.
  const links = () => props.links ?? variant() !== "inline";

  // Lazily load the Shiki highlighter for the document preview; `highlighter()`
  // flips from undefined → ready, re-running the html memo so code re-paints.
  // Swallow a load failure (e.g. the lazy `shiki` chunk fails on a flaky
  // network — the very case this lazy-load tolerates) and resolve to null:
  // reading an *errored* resource inside the `html` memo would re-throw and,
  // with no ErrorBoundary in the preview path, blank the whole preview. Null
  // keeps `highlighter() != null` false so code renders plain, matching
  // highlight.ts's per-block fallback.
  // Only pay for Shiki when the document actually has a fenced code block — a
  // code-less README never triggers the dynamic `shiki` chunk + grammar load.
  // The predicate can't false-negative (every real fence opens a line with
  // ``` / ~~~); a rare false positive just warms an unused highlighter.
  const hasCodeFence = () => /^[ \t]{0,3}(?:```|~~~)/m.test(props.markdown);
  const [highlighter] = createResource(
    () => (isDocument() && hasCodeFence()) || undefined,
    () =>
      loadHighlighter().catch((err) => {
        console.warn(
          "markdown: shiki highlighter failed to load; code renders plain",
          err,
        );
        return null;
      }),
  );

  const html = createMemo(() =>
    sanitizeHtml(
      renderMarkdownToRawHtml(props.markdown, {
        inline: variant() === "inline",
        // GitHub folds a single newline to a space; chat/dock want it as a
        // break. Document → faithful (false); compact/inline → break (true).
        breaks: !isDocument(),
        // Only the document preview admits a README's raw HTML; the compact/
        // inline intent slots (user/agent strings) escape it to literal text.
        rawHtml: isDocument(),
      }),
      {
        links: links(),
        // Only the full-pane document preview is a *document*: it gets the
        // README inline-HTML + image surface, GitHub-faithful soft breaks, and
        // code highlighting. The compact/inline intent slots keep the stricter
        // scope.
        richHtml: isDocument(),
        resolveImageSrc: props.resolveImageSrc,
        highlightCode:
          isDocument() && highlighter() != null ? highlightCode : undefined,
      },
    ),
  );

  return (
    <Dynamic
      component={variant() === "inline" ? "span" : "div"}
      ref={(el: HTMLElement) =>
        bindInteractions(el, {
          onNavigateRelative: props.onNavigateRelative,
          onNavigateWikilink: props.onNavigateWikilink,
        })
      }
      class="kolu-md"
      data-md-variant={variant()}
      innerHTML={html()}
    />
  );
};
