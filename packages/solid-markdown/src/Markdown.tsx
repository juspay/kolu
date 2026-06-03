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
 *    - "document" — block parse at reading scale (full-pane previews). */

import { type Component, createMemo, onCleanup, Show } from "solid-js";
import { renderMarkdownToRawHtml } from "./render";
import { sanitizeHtml } from "./sanitize";

export type MarkdownVariant = "inline" | "compact" | "document";

/** Handle clicks on links inside the rendered Markdown. Bound imperatively
 *  rather than via a JSX `onClick` because it's a propagation guard, not a
 *  primary interaction — it needs no keyboard affordance and would otherwise
 *  be a static-element interaction the a11y lint (rightly) rejects.
 *
 *  Two jobs:
 *    - swallow the bubble so a nested anchor in a clickable host slot (dock
 *      card, switcher card, intent body) doesn't also fire that slot's handler;
 *    - resolve an in-page anchor (TOC jump, footnote ref/back-ref — namespaced
 *      `#md-…` by the sanitizer) by scrolling to the target *within* the
 *      preview, without navigating or writing to the app's URL hash. */
function guardAnchorClicks(el: HTMLElement): void {
  const handle = (e: Event) => {
    const anchor = (e.target as Element | null)?.closest?.("a");
    if (!anchor) return;
    e.stopPropagation();
    if (e.type !== "click") return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("#") || href.length < 2) return;
    const target = el.querySelector(`#${CSS.escape(href.slice(1))}`);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  el.addEventListener("click", handle);
  el.addEventListener("pointerdown", handle);
  onCleanup(() => {
    el.removeEventListener("click", handle);
    el.removeEventListener("pointerdown", handle);
  });
}

export const Markdown: Component<{
  markdown: string;
  variant?: MarkdownVariant;
  links?: boolean;
  /** Resolve a repo-relative image `src` to a loadable URL (see
   *  `SanitizeOptions.resolveImageSrc`). Only consulted for the document
   *  variant, which is the one that renders images. */
  resolveImageSrc?: (src: string) => string | undefined;
}> = (props) => {
  const variant = (): MarkdownVariant => props.variant ?? "document";
  // Links default on for block variants, off for inline — an inline slot's own
  // click handler (open editor / open palette) must win over a nested anchor.
  const links = () => props.links ?? variant() !== "inline";
  // Only the full-pane document preview is a *document*: it gets the README
  // inline-HTML + image surface. The compact/inline intent slots are clickable
  // UI rows rendering user/agent text, so they keep the stricter scope that
  // strips raw block HTML and images (the behaviour they had before this
  // renderer gained raw-HTML support).
  const richHtml = () => variant() === "document";
  const html = createMemo(() =>
    sanitizeHtml(
      renderMarkdownToRawHtml(props.markdown, {
        links: links(),
        inline: variant() === "inline",
      }),
      {
        links: links(),
        richHtml: richHtml(),
        resolveImageSrc: props.resolveImageSrc,
      },
    ),
  );

  return (
    <Show
      when={variant() !== "inline"}
      fallback={
        <span
          ref={guardAnchorClicks}
          class="kolu-md"
          data-md-variant={variant()}
          innerHTML={html()}
        />
      }
    >
      <div
        ref={guardAnchorClicks}
        class="kolu-md"
        data-md-variant={variant()}
        innerHTML={html()}
      />
    </Show>
  );
};
