/** Compact chip + popover mode picker. The chip displays the active
 *  `ModeOption`'s icon and label; clicking opens a Portal'd popover with
 *  the full set of options grouped by their optional `group` field.
 *
 *  The picker is purely presentational — mode metadata (label, hint,
 *  testId, icon, group) is passed in by the host. Group dividers are
 *  inferred at render time when consecutive options have different
 *  `group` values.
 *
 *  Popover positioning, outside-click, and Escape come from
 *  `useAnchoredPopover` — same scaffold is shared with the
 *  Settings/Record/PrUnavailable popovers. */

import type { CodeTabView } from "kolu-common/surface";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { ChevronDownIcon } from "@kolu/solid-icons";
import { surface } from "@kolu/solid-ui/Surface";
import { useAnchoredPopover } from "@kolu/solid-overlay";

export type ModeOption = {
  view: CodeTabView;
  /** Optional grouping label rendered as a `<group>:` prefix in the chip
   *  and popover (e.g. `Git: Local`). */
  group?: string;
  label: string;
  hint: string;
  testId: string;
  /** Leading glyph for the chip. Host owns icon registry so the picker
   *  doesn't import every possible icon. */
  icon: Component<{ class?: string }>;
};

const ModeChipPicker: Component<{
  view: CodeTabView;
  onViewChange: (v: CodeTabView) => void;
  modes: readonly ModeOption[];
}> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => triggerEl,
    open,
    onDismiss: () => setOpen(false),
    anchor: "bottom-start",
    panelMinWidth: 240,
    offset: 6,
  });

  const select = (v: CodeTabView) => {
    props.onViewChange(v);
    setOpen(false);
  };

  const activeMode = createMemo(() =>
    props.modes.find((m) => m.view === props.view),
  );
  const chipLabel = (m: ModeOption) =>
    m.group ? `${m.group}: ${m.label}` : m.label;

  const chrome = surface({ radius: "md", shadow: "soft", portalled: true });

  return (
    <>
      <button
        ref={triggerEl}
        type="button"
        onClick={() => setOpen(!open())}
        class="flex items-center gap-1.5 px-2 h-5 rounded text-[10px] font-mono cursor-pointer transition-colors bg-surface-2/40 hover:bg-surface-2/80 text-fg-2 hover:text-fg data-[active=true]:bg-surface-0 data-[active=true]:text-fg data-[active=true]:shadow-sm"
        data-testid="diff-filter-chip"
        data-active={open()}
        data-mode={props.view}
        aria-expanded={open()}
        aria-haspopup="menu"
        title="Change view"
      >
        <Show when={activeMode()}>
          {(m) => (
            <>
              <Dynamic component={m().icon} class="w-3 h-3 opacity-70" />
              <span>{chipLabel(m())}</span>
            </>
          )}
        </Show>
        <ChevronDownIcon
          class={`w-3 h-3 opacity-50 transition-transform ${
            open() ? "rotate-180" : ""
          }`}
        />
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={panelRef}
            class={`fixed z-50 ${chrome.class} py-1 min-w-[240px] text-[11px] font-mono`}
            style={{ ...panelStyle(), ...chrome.style }}
            role="menu"
            data-testid="diff-filter-popover"
          >
            <For each={props.modes}>
              {(opt, idx) => (
                <>
                  <Show
                    when={
                      idx() > 0 && opt.group !== props.modes[idx() - 1]?.group
                    }
                  >
                    <div class="my-1 border-t border-edge/60" />
                  </Show>
                  <button
                    type="button"
                    onClick={() => select(opt.view)}
                    role="menuitemradio"
                    aria-checked={props.view === opt.view}
                    class="group w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-surface-2/60 cursor-pointer"
                    data-testid={opt.testId}
                    data-active={props.view === opt.view}
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors bg-edge-bright group-data-[active=true]:bg-accent"
                      aria-hidden="true"
                    />
                    <div class="flex flex-col items-start min-w-0 gap-0.5">
                      <span class="text-fg-2 group-data-[active=true]:text-fg">
                        <Show when={opt.group}>
                          <span class="text-fg-3">{opt.group}: </span>
                        </Show>
                        {opt.label}
                      </span>
                      <span class="text-fg-3 text-[10px]">{opt.hint}</span>
                    </div>
                  </button>
                </>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
};

export default ModeChipPicker;
