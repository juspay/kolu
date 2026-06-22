/** The footnote-definition popover for the Markdown document preview.
 *
 *  Clicking a `[n]` marker in the preview (routed across the
 *  `@kolu/solid-markdown` seam by its `onFootnote` callback) opens the matching
 *  definition here, anchored just under the marker — so a reader stays where
 *  their eye is instead of scrolling to the bottom "Footnotes" list and back.
 *  The bottom list is untouched; this is an *additional* way in, and the popover
 *  reads its content straight from that list's live `<li>`.
 *
 *  Reuses `useAnchoredPopover` + `<Portal>` — the very scaffold the
 *  wikilink-disambiguation menu (`OptionMenu`) already uses in this same
 *  preview — so it needs no positioning dependency. Overlay rendering stays on
 *  the client side of the `@kolu/solid-markdown` dependency arrow; the package
 *  only routes the click. */

import { createEventListener } from "@solid-primitives/event-listener";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

/** The open footnote: the clicked `[n]` marker plus its definition `<li>` in
 *  the bottom footnotes list. */
export type FootnoteTarget = { anchor: HTMLElement; definition: HTMLElement };

export const FootnotePopover: Component<{
  /** The open footnote, or `null` when closed. The popover anchors to `anchor`
   *  and renders a cleaned clone of `definition`. */
  target: () => FootnoteTarget | null;
  onDismiss: () => void;
  /** Route a repo-relative link clicked inside the footnote body — the same
   *  handler the preview itself uses, so the link opens the file in the host. */
  onNavigateRelative: (href: string) => void;
  /** Route an Obsidian-style `[[wikilink]]` clicked inside the footnote body. */
  onNavigateWikilink: (target: string, anchor: HTMLElement) => void;
}> = (props) => {
  // Captured panel + body elements: the panel to exclude its own scroll from
  // the dismiss, the body to delegate inner-link clicks off (imperatively, like
  // the preview's own `bindInteractions`, so the a11y lint isn't asked to treat
  // sanitizer-minted anchors as declarative element interactions).
  const [panelEl, setPanelEl] = createSignal<HTMLElement>();
  const [bodyEl, setBodyEl] = createSignal<HTMLElement>();

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.target()?.anchor,
    open: () => props.target() != null,
    onDismiss: props.onDismiss,
    anchor: "bottom-start",
    flip: true,
    // Engage the left-clamp so a marker near the right edge can't push the
    // panel off-screen (the hook has no horizontal shift). Matches the panel's
    // max width below.
    panelMinWidth: 360,
  });

  // Close on a scroll *outside* the panel. The preview sits inside nested
  // `overflow:auto` containers and the hook anchors with `position:fixed`, so a
  // scroll would otherwise drift the panel off its marker; we dismiss instead of
  // re-anchoring (which is the only thing that would have touched the shared
  // hook). Capture phase catches a scroll in either nested ancestor — but a
  // scroll *inside* the panel (reading a tall note) must not dismiss it, hence
  // the `contains` guard.
  createEventListener(
    () => (props.target() ? document : undefined),
    "scroll",
    (e) => {
      const el = panelEl();
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      props.onDismiss();
    },
    { capture: true },
  );

  // Route the footnote body's own links the way the preview does: relative +
  // wikilink through the host resolvers; an external link keeps the sanitizer's
  // `target="_blank"` and needs no handler. We don't dismiss here — a navigation
  // remounts the keyed Code-tab subtree (which unmounts this popover), and not
  // dismissing first lets an ambiguous `[[wikilink]]` anchor its disambiguation
  // menu to the clicked anchor before that remount.
  createEventListener(bodyEl, "click", (e) => {
    const a = (e.target as Element | null)?.closest("a");
    if (!a) return;
    const wikilink = a.getAttribute("data-md-wikilink");
    if (wikilink !== null) {
      e.preventDefault();
      if (wikilink) props.onNavigateWikilink(wikilink, a as HTMLElement);
      return;
    }
    if (a.hasAttribute("data-md-rel")) {
      e.preventDefault();
      const href = a.getAttribute("href");
      if (href) props.onNavigateRelative(href);
    }
  });

  // The popover body: a cleaned clone of the definition `<li>`. Three removals,
  // on the *clone* only (never the live node the bottom list still shows):
  //   - its `id` — the live `<li>` keeps it, so the clone must not duplicate it;
  //   - every back-ref ↩ (`href` carries `-ref-`; a re-cited note has several) —
  //     a "jump back to the marker" link is meaningless inside the popover;
  //   - the `data-md-footnote` flag on any *nested* ref marker, so a footnote
  //     that cites another footnote renders an inert superscript here (no
  //     popover-on-popover, no recursion).
  // Images need no handling: the node was already sanitized in the document, so
  // the clone carries resolved `src`s.
  const body = createMemo(() => {
    const def = props.target()?.definition;
    if (!def) return "";
    const clone = def.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    for (const back of clone.querySelectorAll('a[href*="-ref-"]'))
      back.remove();
    for (const nested of clone.querySelectorAll("[data-md-footnote]"))
      nested.removeAttribute("data-md-footnote");
    return clone.innerHTML;
  });

  const chrome = surface({ radius: "lg", shadow: "soft", portalled: true });

  return (
    <Show when={props.target()}>
      <Portal>
        <div
          ref={(el) => {
            setPanelEl(el);
            panelRef(el);
          }}
          data-testid="footnote-popover"
          class={`fixed z-50 flex max-h-[min(50vh,22rem)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden ${chrome.class}`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          {/* The note body, styled by the shared `.kolu-md` stylesheet so its
              links/code/lists read exactly as they do in the document. */}
          <div
            ref={setBodyEl}
            class="kolu-md min-h-0 flex-1 overflow-auto p-3 text-fg"
            innerHTML={body()}
          />
          {/* "See all ↓": scroll the *live* `<li>` (not the clone — its id is
              gone) into view in the bottom list, then close — today's
              scroll-to-definition, preserved as a deliberate secondary path. */}
          <div class="flex justify-end border-t border-edge px-3 py-1.5">
            <button
              type="button"
              data-testid="footnote-popover-see-all"
              class="cursor-pointer text-xs text-fg-2 transition-colors hover:text-fg"
              onClick={() => {
                props.target()?.definition.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
                props.onDismiss();
              }}
            >
              see all ↓
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
