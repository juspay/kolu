/** Compact chip + popover mode picker. The chip displays the active
 *  `ModeOption`'s icon and label; clicking opens a Portal'd popover with
 *  the full set of options grouped by their optional `group` field.
 *
 *  The picker is purely presentational — mode metadata (label, hint,
 *  testId, icon, group) is passed in by the host. Group dividers are
 *  inferred at render time when consecutive options have different
 *  `group` values.
 *
 *  Popover positioning is hand-rolled (Portal + viewport clamp +
 *  outside-click + Escape). The same scaffold is duplicated across
 *  Settings/Record/PrUnavailable popovers in this codebase — extraction
 *  is tracked in #795. */

import { createEventListener } from "@solid-primitives/event-listener";
import type { CodeTabView } from "kolu-common";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { ChevronDownIcon } from "../ui/Icons";

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
  let triggerRef: HTMLButtonElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ top: 0, left: 0 });

  // Popover panel min-width — kept in sync with the `min-w-[240px]`
  // class on the panel below. Used for viewport clamping so the popover
  // doesn't slip off the right edge when the trigger is near it.
  const PANEL_MIN_WIDTH = 240;
  const VIEWPORT_PAD = 8;

  const updatePos = () => {
    if (!triggerRef) return;
    const r = triggerRef.getBoundingClientRect();
    const maxLeft = window.innerWidth - PANEL_MIN_WIDTH - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(r.left, maxLeft));
    setPos({ top: r.bottom + 6, left });
  };

  // Document listeners exist only while the popover is open — passing
  // `undefined` as the target detaches them. Outside-click ignores the
  // trigger so the chip toggle drives open/close cleanly.
  const popoverTarget = () => (open() ? document : undefined);
  createEventListener(popoverTarget, "mousedown", (e) => {
    const t = e.target as Node;
    if (panelRef?.contains(t) || triggerRef?.contains(t)) return;
    setOpen(false);
  });
  createEventListener(popoverTarget, "keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
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

  return (
    <>
      <button
        ref={triggerRef}
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
            ref={(el) => {
              panelRef = el;
              updatePos();
            }}
            class="fixed z-50 bg-surface-1 border border-edge rounded-md shadow-2xl shadow-black/40 py-1 min-w-[240px] text-[11px] font-mono"
            style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
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
