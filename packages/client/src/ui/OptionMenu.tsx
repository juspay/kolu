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
 *  Unrelated to the CodeTab's scope switcher (the shared
 *  `ui/SegmentedControl`): that's an always-visible segmented control,
 *  not a popover, so it shares no chrome with this panel. The panel-chrome
 *  itself is shared via `surface()`. */

import { createEffect, createUniqueId, For, type JSX, Show } from "solid-js";
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
  /** The option drawn as selected — none for a menu that is a choice among
   *  things rather than a setting. */
  value?: T;
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
  /** A line above the options saying what is being chosen — read out as the
   *  menu's name. */
  heading?: JSX.Element;
  /** Draw an option as something richer than its label (the label stays
   *  its accessible name and its tooltip). The drawing must not be
   *  interactive: the option is already the button. */
  renderOption?: (option: OptionMenuItem<T>) => JSX.Element;
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
  const headingId = createUniqueId();
  /** FOCUS GOES IN, AND COMES BACK. Every menu takes focus when it opens —
   *  the checked item of a setting, else the first — so the keys below reach
   *  it whoever opened it; and when it closes with focus left nowhere (the
   *  panel it was in is gone), focus returns to the trigger, so a keyboard
   *  reader keeps their place. */
  let wasOpen = false;
  createEffect(() => {
    const open = props.open();
    if (wasOpen && !open) {
      const trigger = props.triggerRef();
      const lost =
        document.activeElement === null ||
        document.activeElement === document.body;
      if (trigger?.isConnected === true && lost) trigger.focus();
    }
    wasOpen = open;
  });
  /** THE KEYS A MENU PROMISES: ↑/↓ move between its items (wrapping),
   *  Home/End go to the ends. Escape and an outside press are the popover's
   *  own dismissal. */
  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]',
      ),
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to = (() => {
      switch (event.key) {
        case "ArrowDown":
          return at < 0 ? 0 : (at + 1) % items.length;
        case "ArrowUp":
          return at < 0
            ? items.length - 1
            : (at - 1 + items.length) % items.length;
        case "Home":
          return 0;
        case "End":
          return items.length - 1;
        default:
          return undefined;
      }
    })();
    if (to === undefined) return;
    event.preventDefault();
    items[to]?.focus();
  };

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
          ref={(el) => {
            panelRef(el);
            queueMicrotask(() =>
              (
                el.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
                el.querySelector<HTMLButtonElement>('[role^="menuitem"]')
              )?.focus(),
            );
          }}
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
          {/* The heading names the menu, beside it rather than inside it:
              a menu holds only its items. */}
          <Show when={props.heading}>
            {(heading) => (
              <p
                id={headingId}
                class="m-0 px-2 pb-1 pt-0.5 text-[0.7rem] text-fg-3"
              >
                {heading()}
              </p>
            )}
          </Show>
          <div
            role="menu"
            aria-labelledby={
              props.heading === undefined ? undefined : headingId
            }
            class="flex flex-col"
            onKeyDown={onKeyDown}
          >
            <For each={props.options}>
              {(opt) => {
                /** What both kinds of item share: their name, their look and
                 *  their press. */
                const item = () => ({
                  type: "button" as const,
                  "aria-label": props.renderOption ? opt.label : undefined,
                  "data-testid": `${props.testIdPrefix}-option-${opt.value}`,
                  "data-selected": props.value === opt.value ? "" : undefined,
                  title: props.truncate ? opt.label : undefined,
                  class: `text-left text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer ${
                    props.truncate === true ? "truncate whitespace-nowrap" : ""
                  } ${
                    props.value === opt.value
                      ? "bg-accent/20 text-accent"
                      : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                  }`,
                  onClick: () => {
                    props.onSelect(opt.value);
                    props.onDismiss();
                  },
                });
                const face = () =>
                  props.renderOption ? props.renderOption(opt) : opt.label;
                // A SETTING (a value is passed) is a set of radio items, the
                // current one checked; a CHOICE among things is plain items.
                return (
                  <Show
                    when={props.value !== undefined}
                    fallback={
                      <button role="menuitem" {...item()}>
                        {face()}
                      </button>
                    }
                  >
                    <button
                      role="menuitemradio"
                      aria-checked={props.value === opt.value}
                      {...item()}
                    >
                      {face()}
                    </button>
                  </Show>
                );
              }}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  );
};
