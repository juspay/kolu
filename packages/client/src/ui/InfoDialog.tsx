/** Shared chrome for the identity info panels (Kolu · Padi · Kaval).
 *
 *  Each panel is an **anchored dropdown** that opens below its trigger icon —
 *  never a center-screen modal — so the association "this panel is about the
 *  mark I just clicked (on this host chip)" is structural. Positioning,
 *  outside-click, and Escape dismiss ride {@link useAnchoredPopover}. */

import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import { CloseIcon } from "./Icons";
import { surface } from "./Surface";
import { useAnchoredPopover } from "./useAnchoredPopover";

const chrome = surface({ portalled: true, radius: "xl", shadow: "soft" });

/** A label/value row — fixed-width label column, truncating value. */
export const DetailRow: Component<{ label: string; children: JSX.Element }> = (
  props,
) => (
  <div class="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3 text-[11px] leading-5">
    <span class="text-fg-3">{props.label}</span>
    <span class="min-w-0 truncate text-fg-2">{props.children}</span>
  </div>
);

/** The bordered version pill shown next to a panel's name. */
export const VersionChip: Component<{ children: JSX.Element }> = (props) => (
  <span class="rounded-md border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg-2">
    {props.children}
  </span>
);

const SIZE_CLASS = {
  sm: "w-[min(20rem,calc(100vw-1rem))]",
  md: "w-[min(24rem,calc(100vw-1rem))]",
} as const;

const InfoDialogShell: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size: "sm" | "md";
  logoSrc: string;
  name: string;
  /** Optional host / scope label shown under the title (e.g. `local`). */
  contextLabel?: string;
  /** The header version pill (a {@link VersionChip}), or nothing before it lands. */
  version?: JSX.Element;
  description: string;
  children: JSX.Element;
  /** Anchor — the panel drops below this element. */
  triggerRef: () => HTMLElement | undefined;
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-start",
    panelMinWidth: props.size === "sm" ? 280 : 320,
    offset: 6,
    flip: true,
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          role="dialog"
          aria-label={props.name}
          data-testid="info-popover"
          // `fixed` is load-bearing: useAnchoredPopover positions via top/left
          // viewport coords (same as RecordPopover). `relative` left the panel
          // in document flow so top/left did nothing — the dropdown "opened"
          // but was invisible / off-canvas.
          class={`${chrome.class} fixed z-50 max-h-[min(32rem,calc(100vh-2rem))] overflow-y-auto p-0 ${SIZE_CLASS[props.size]}`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <button
            type="button"
            onClick={() => props.onOpenChange(false)}
            class="absolute right-2.5 top-2.5 rounded-md p-1 text-fg-3 transition-colors hover:bg-surface-3/60 hover:text-fg"
            aria-label="Close"
          >
            <CloseIcon class="h-4 w-4" />
          </button>

          <div class="border-b border-edge/70 px-4 py-3 pr-10">
            <div class="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
              <img src={props.logoSrc} alt="" class="h-5 w-5" />
              <span>{props.name}</span>
              {props.version}
            </div>
            <Show when={props.contextLabel}>
              {(label) => (
                <div class="mt-1 truncate font-mono text-[11px] font-medium text-accent">
                  {label()}
                </div>
              )}
            </Show>
            <p class="mt-1 text-xs text-fg-3">{props.description}</p>
          </div>

          <div class="space-y-4 px-4 py-3">{props.children}</div>
        </div>
      </Portal>
    </Show>
  );
};

export default InfoDialogShell;
