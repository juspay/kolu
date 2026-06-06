/** Anchored option-menu — the popover panel + option-list scaffolding
 *  shared by the Dock and the canvas minimap's activity-window pickers.
 *
 *  Scope is deliberately the panel only — each surface keeps its own
 *  trigger button so the chip styling (rail-tight 6px height in the
 *  dock, 8px-wide zoom-bar chip in the minimap) can diverge without
 *  forcing a shared trigger contract. The shared part is the part that
 *  *was* duplicated: `useAnchoredPopover` + `Portal` + the option list
 *  with selected-state highlighting + close-on-select.
 *
 *  Distinct from `right-panel/ModeChipPicker` — that picker handles
 *  grouped, hinted, icon-labelled CodeTab modes with a baked-in chip
 *  trigger; consolidating both would mean conditionally suppressing
 *  the icon/hint/group features at every call site, which is more
 *  complecting than two focused components. The panel-chrome itself
 *  is shared via `surface()`. */

import { For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "./Surface";
import { type AnchorSide, useAnchoredPopover } from "./useAnchoredPopover";

export type OptionMenuItem<T extends string> = {
  value: T;
  label: string;
};

export const OptionMenu = <T extends string>(props: {
  /** Element the menu anchors against (typically the trigger button). */
  triggerRef: () => HTMLElement | undefined;
  open: () => boolean;
  onDismiss: () => void;
  anchor: AnchorSide;
  options: readonly OptionMenuItem<T>[];
  value: T;
  onSelect: (value: T) => void;
  /** Used to derive `data-testid` on the panel and each option button —
   *  `<prefix>-menu` and `<prefix>-option-<value>`. */
  testIdPrefix: string;
  /** Cap the panel's height (px) and scroll the option list past it. Off by
   *  default (the dock/minimap option sets are small + fixed). On for a menu
   *  whose options are data-driven and unbounded — an ambiguous wikilink can
   *  match dozens of files, which would otherwise render a full-viewport list. */
  maxHeight?: number;
  /** Truncate each option label to a single line with an ellipsis, keeping the
   *  full text in a `title` tooltip. Off by default (short fixed labels fit).
   *  On for long arbitrary values like repo paths, so the panel can't grow
   *  unboundedly wide. */
  truncate?: boolean;
  /** Flip a `bottom-*` anchored panel to open upward when it wouldn't fit
   *  below the trigger. Threaded to `useAnchoredPopover` (see its `flip`). */
  flip?: boolean;
}) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor,
    flip: props.flip,
    // Engage the bottom-start viewport clamp so a left-edge trigger
    // (the dock chip) cannot push the panel off the right edge of the
    // viewport. Matches the panel's own `min-w-[180px]` Tailwind class.
    panelMinWidth: 180,
  });

  const chrome = surface({ radius: "lg", shadow: "light", portalled: true });
  // When truncation is on, cap the panel width too — an ellipsised label needs
  // a bound to ellipsise against, or the row would still stretch to its full
  // single-line width. The dock/minimap leave this off and stay auto-width.
  const widthClass = props.truncate
    ? "min-w-[180px] max-w-[min(420px,90vw)]"
    : "min-w-[180px]";
  return (
    <Show when={props.open()}>
      <Portal>
        <div
          ref={panelRef}
          data-testid={`${props.testIdPrefix}-menu`}
          class={`fixed z-50 flex flex-col ${chrome.class} p-1 ${widthClass} ${props.maxHeight !== undefined ? "overflow-y-auto" : ""}`}
          style={{
            ...panelStyle(),
            ...chrome.style,
            ...(props.maxHeight !== undefined
              ? { "max-height": `${props.maxHeight}px` }
              : {}),
          }}
        >
          <For each={props.options}>
            {(opt) => (
              <button
                type="button"
                data-testid={`${props.testIdPrefix}-option-${opt.value}`}
                data-selected={props.value === opt.value ? "" : undefined}
                title={props.truncate ? opt.label : undefined}
                class="text-left text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer"
                classList={{
                  "truncate whitespace-nowrap": props.truncate,
                  "bg-accent/20 text-accent": props.value === opt.value,
                  "text-fg-2 hover:bg-surface-3 hover:text-fg":
                    props.value !== opt.value,
                }}
                onClick={() => {
                  props.onSelect(opt.value);
                  props.onDismiss();
                }}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
};
