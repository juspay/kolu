/** Anchored option-menu — the popover panel + option-list scaffolding shared
 *  by the Dock and the canvas minimap's activity-window pickers. Each surface
 *  keeps its own trigger button. */

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
  /** Cap the panel's height (px) and scroll the option list past it. */
  maxHeight?: number;
  /** Truncate each option label to one line, full text in a `title`. */
  truncate?: boolean;
  /** Flip a `bottom-*` anchored panel upward when it wouldn't fit below. */
  flip?: boolean;
  /** A line above the options saying what is being chosen — read out as the
   *  menu's name. */
  heading?: JSX.Element;
  /** Draw an option as something richer than its label; must not be
   *  interactive (the option is already the button). */
  renderOption?: (option: OptionMenuItem<T>) => JSX.Element;
}) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor,
    flip: props.flip,
    panelMinWidth: 180,
  });
  const headingId = createUniqueId();
  /** Focus enters the menu when it opens (the checked item, else the first)
   *  and returns to the trigger when it closes with focus left nowhere. */
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
  /** ↑/↓ move between items (wrapping), Home/End go to the ends. */
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
          class={`z-50 flex flex-col ${chrome.class} p-1 ${widthClass} ${props.maxHeight !== undefined ? "overflow-y-auto" : ""}`}
          style={{
            ...panelStyle(),
            ...chrome.style,
            ...(props.maxHeight !== undefined
              ? { "max-height": `${props.maxHeight}px` }
              : {}),
          }}
        >
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
