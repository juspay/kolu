/** Filter chrome for the Code tab — a single horizontal strip combining
 *  the mode picker (chip + popover) and a free-text search input that
 *  drives Pierre's tree filter externally.
 *
 *  Visual register intentionally avoids a tab/segmented-control look:
 *  one chip element holds the current mode label, a popover reveals the
 *  full set of options with their semantic hints. The search input
 *  shares the bar so file-set narrowing and file-name filtering live in
 *  one place — the only filter chrome the user has to scan.
 *
 *  Mode metadata is *not* defined in this file — the host (CodeTab)
 *  owns the list of `ModeOption`s and passes them in. That keeps
 *  mode-identity volatility (adding a new view, changing a hint, wiring
 *  a new data source) localized to a single module instead of split
 *  across the picker and the host. */

import { makeEventListener } from "@solid-primitives/event-listener";
import type { CodeTabView } from "kolu-common";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  ChevronDownIcon,
  CloseIcon,
  FileBrowseIcon,
  GitBranchIcon,
  SearchIcon,
} from "../ui/Icons";

export type ModeOption = {
  view: CodeTabView;
  /** Optional grouping label rendered as a `<group>:` prefix in the chip
   *  and popover (e.g. `Git: Local`). */
  group?: string;
  label: string;
  hint: string;
  testId: string;
  /** When `true`, renders the git-branch icon in the chip; otherwise the
   *  file-browse icon. Drives the chip's leading glyph without leaking
   *  view-string knowledge into this component. */
  iconKind?: "git" | "file";
};

const CodeFilterBar: Component<{
  view: CodeTabView;
  onViewChange: (v: CodeTabView) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
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

  // Close on outside click — ignore clicks on the trigger itself so the
  // toggle button drives open/close cleanly.
  makeEventListener(document, "mousedown", (e) => {
    if (!open()) return;
    const t = e.target as Node;
    if (panelRef?.contains(t) || triggerRef?.contains(t)) return;
    setOpen(false);
  });
  makeEventListener(document, "keydown", (e) => {
    if (open() && e.key === "Escape") setOpen(false);
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
    <div class="flex items-center h-7 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-2">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updatePos();
          setOpen(!open());
        }}
        class="flex items-center gap-1.5 px-2 h-5 rounded text-[10px] font-mono cursor-pointer transition-colors bg-surface-2/40 hover:bg-surface-2/80 text-fg-2 hover:text-fg data-[active=true]:bg-surface-0 data-[active=true]:text-fg data-[active=true]:shadow-sm"
        data-testid="diff-filter-chip"
        data-active={open()}
        aria-expanded={open()}
        aria-haspopup="menu"
        title="Change view"
      >
        <Show
          when={activeMode()?.iconKind === "git"}
          fallback={<FileBrowseIcon class="w-3 h-3 opacity-70" />}
        >
          <GitBranchIcon class="w-3 h-3 opacity-70" />
        </Show>
        <span>{activeMode() ? chipLabel(activeMode()!) : props.view}</span>
        <ChevronDownIcon
          class={`w-3 h-3 opacity-50 transition-transform ${
            open() ? "rotate-180" : ""
          }`}
        />
      </button>

      <label class="flex items-center gap-1.5 flex-1 min-w-0 text-[10px] font-mono text-fg-3 focus-within:text-fg-2">
        <SearchIcon class="w-3 h-3 opacity-50 shrink-0" />
        <input
          type="text"
          value={props.searchQuery}
          onInput={(e) => props.onSearchChange(e.currentTarget.value)}
          placeholder="filter files…"
          class="flex-1 min-w-0 bg-transparent outline-none border-0 placeholder:text-fg-3/40 text-fg"
          data-testid="diff-filter-search"
          spellcheck={false}
          autocomplete="off"
        />
        <Show when={props.searchQuery.length > 0}>
          <button
            type="button"
            onClick={() => props.onSearchChange("")}
            title="Clear filter"
            class="shrink-0 text-fg-3 hover:text-fg cursor-pointer p-0.5 -mr-0.5"
            data-testid="diff-filter-clear"
          >
            <CloseIcon class="w-3 h-3" />
          </button>
        </Show>
      </label>

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
                    class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-surface-2/60 cursor-pointer"
                    data-testid={opt.testId}
                    data-active={props.view === opt.view}
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                      classList={{
                        "bg-accent": props.view === opt.view,
                        "bg-edge-bright": props.view !== opt.view,
                      }}
                      aria-hidden="true"
                    />
                    <div class="flex flex-col items-start min-w-0 gap-0.5">
                      <span
                        classList={{
                          "text-fg": props.view === opt.view,
                          "text-fg-2": props.view !== opt.view,
                        }}
                      >
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
    </div>
  );
};

export default CodeFilterBar;
