import { bindMarkdownLinks } from "@kolu/solid-markdown";
import { createEventListener } from "@solid-primitives/event-listener";
import { type Component, createMemo, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

export type FootnoteTarget = { anchor: HTMLElement; definition: HTMLElement };

export const FootnotePopover: Component<{
  target: () => FootnoteTarget | null;
  onDismiss: () => void;
  onNavigateRelative: (href: string) => void;
  onNavigateWikilink: (target: string, anchor: HTMLElement) => void;
}> = (props) => {
  let panelEl: HTMLElement | undefined;

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.target()?.anchor,
    open: () => props.target() != null,
    onDismiss: props.onDismiss,
    anchor: "bottom-start",
    flip: true,
    panelMinWidth: 360,
  });

  createEventListener(
    () => (props.target() ? document : undefined),
    "scroll",
    (e) => {
      if (panelEl && e.target instanceof Node && panelEl.contains(e.target))
        return;
      props.onDismiss();
    },
    { capture: true },
  );

  const body = createMemo(() => {
    const def = props.target()?.definition;
    if (!def) return "";
    const clone = def.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    for (const withId of clone.querySelectorAll("[id]"))
      withId.removeAttribute("id");
    for (const back of clone.querySelectorAll("a[data-md-footnote-backref]"))
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
            panelEl = el;
            panelRef(el);
          }}
          data-testid="footnote-popover"
          class={`fixed z-50 flex max-h-[min(50vh,22rem)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden ${chrome.class}`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <div
            ref={(el) =>
              bindMarkdownLinks(el, {
                onNavigateRelative: props.onNavigateRelative,
                onNavigateWikilink: props.onNavigateWikilink,
              })
            }
            class="kolu-md min-h-0 flex-1 overflow-auto p-3 text-fg"
            innerHTML={body()}
          />
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
