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
 *      highlighting + copy buttons, and (when a host wires `onToggleTask`)
 *      interactive task-list checkboxes. */

import {
  type Component,
  createMemo,
  createResource,
  onCleanup,
  Show,
} from "solid-js";
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

/** Handle interactive bits inside the rendered Markdown — links, code-copy
 *  buttons, and task-list checkboxes. Bound imperatively (not via JSX
 *  `onClick`) because these are delegated handlers over sanitizer-minted DOM,
 *  not declarative element interactions the a11y lint would expect a role for.
 *
 *  Each also stops the bubble so a nested control in a clickable host slot
 *  (dock card, switcher card) doesn't double-fire that slot's handler. */
function bindInteractions(
  el: HTMLElement,
  onToggleTask: () => ((taskIndex: number) => void) | undefined,
): void {
  const onPointerDown = (e: Event) => {
    const target = e.target as Element | null;
    if (target?.closest?.("a, [data-md-copy], input[data-md-task]")) {
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

    const task = target.closest<HTMLInputElement>("input[data-md-task]");
    if (task) {
      // Let the server round-trip drive the checked state (write → file
      // watcher → re-render), so prevent the local toggle to avoid a
      // flicker/revert.
      e.preventDefault();
      e.stopPropagation();
      const index = Number(task.getAttribute("data-md-task"));
      if (Number.isInteger(index)) onToggleTask()?.(index);
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
  /** Persist a GFM task-list toggle: called with the task's source order when
   *  a checkbox is clicked. When set (document variant), checkboxes render
   *  interactive; the host writes the flip back to the file. */
  onToggleTask?: (taskIndex: number) => void;
}> = (props) => {
  const variant = (): MarkdownVariant => props.variant ?? "document";
  const isDocument = () => variant() === "document";
  // Links default on for block variants, off for inline — an inline slot's own
  // click handler (open editor / open palette) must win over a nested anchor.
  const links = () => props.links ?? variant() !== "inline";
  // Only the full-pane document preview is a *document*: it gets the README
  // inline-HTML + image surface, GitHub-faithful soft breaks, and code
  // highlighting. The compact/inline intent slots keep the stricter scope.
  const richHtml = () => isDocument();

  // Lazily load the Shiki highlighter for the document preview; `highlighter()`
  // flips from undefined → ready, re-running the html memo so code re-paints.
  const [highlighter] = createResource(
    () => isDocument() || undefined,
    () => loadHighlighter(),
  );

  const html = createMemo(() =>
    sanitizeHtml(
      renderMarkdownToRawHtml(props.markdown, {
        inline: variant() === "inline",
        // GitHub folds a single newline to a space; chat/dock want it as a
        // break. Document → faithful (false); compact/inline → break (true).
        breaks: !isDocument(),
      }),
      {
        links: links(),
        richHtml: richHtml(),
        resolveImageSrc: props.resolveImageSrc,
        highlightCode:
          isDocument() && highlighter() != null ? highlightCode : undefined,
        interactiveTasks: isDocument() && props.onToggleTask != null,
      },
    ),
  );

  const bind = (el: HTMLElement) =>
    bindInteractions(el, () => props.onToggleTask);

  return (
    <Show
      when={variant() !== "inline"}
      fallback={
        <span
          ref={bind}
          class="kolu-md"
          data-md-variant={variant()}
          innerHTML={html()}
        />
      }
    >
      <div
        ref={bind}
        class="kolu-md"
        data-md-variant={variant()}
        innerHTML={html()}
      />
    </Show>
  );
};
