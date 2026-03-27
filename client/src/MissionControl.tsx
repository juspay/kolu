/**
 * Mission Control — bird's eye view grid of all main terminals.
 *
 * Shows miniature live terminal previews alongside repo/PR/activity metadata.
 * Click a card or press its number (1-9) to switch and dismiss the overlay.
 */

import {
  type Component,
  For,
  Show,
  createMemo,
  createEffect,
  on,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import TerminalPreview from "./TerminalPreview";
import ChecksIndicator from "./ChecksIndicator";
import ActivityGraph from "./ActivityGraph";
import { terminalName, buildRepoColorMap } from "./path";
import { matchesKeybind, SHORTCUTS } from "./keyboard";
import type { TerminalId, TerminalInfo } from "kolu-common";
import type { ActivitySample } from "./useTerminals";
import type { ITheme } from "@xterm/xterm";

/** Mission Control mode — discriminated union eliminates impossible states
 *  (e.g. quickSwitch without open, direction without quickSwitch).
 *
 *  - `closed`      — Mission Control is not visible.
 *  - `browse`      — Opened via icon, palette, or Cmd+. for manual browsing.
 *  - `quickSwitch` — Opened via Ctrl+Tab. Shows MRU order, auto-advances focus
 *                     by one in `direction`, and selects on Ctrl release.
 */
export type MCMode =
  | { mode: "closed" }
  | { mode: "browse" }
  | { mode: "quickSwitch"; direction: 1 | -1 };

const MissionControl: Component<{
  mcMode: MCMode;
  onMcModeChange: (mode: MCMode) => void;
  terminalIds: TerminalId[];
  /** Terminal IDs in most-recently-used order (for quick-switch card ordering). */
  mruOrder: TerminalId[];
  activeId: TerminalId | null;
  getMeta: (id: TerminalId) => Omit<TerminalInfo, "id"> | undefined;
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  getTerminalTheme: (id: TerminalId) => ITheme;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const isOpen = () => props.mcMode.mode !== "closed";
  const isQuickSwitch = () => props.mcMode.mode === "quickSwitch";

  /** Cards in display order: MRU for quick-switch, sidebar order otherwise.
   *  MRU may be incomplete (e.g. after refresh) — append any missing terminals at the end. */
  const displayIds = createMemo(() => {
    if (!isQuickSwitch()) return props.terminalIds;
    const mru = props.mruOrder;
    const existing = new Set(props.terminalIds);
    const inMru = new Set(mru);
    const ordered = mru.filter((id) => existing.has(id));
    const missing = props.terminalIds.filter((id) => !inMru.has(id));
    return [...ordered, ...missing];
  });

  /** Grid dimensions: cols biased by viewport aspect ratio (Windows Task View formula).
   *  Produces near-square grids that feel natural — e.g. 6 items on 16:9 → 3x2. */
  const gridCols = createMemo(() => {
    const n = displayIds().length;
    if (n <= 1) return 1;
    const aspect = window.innerWidth / window.innerHeight;
    return Math.ceil(Math.sqrt(n * aspect));
  });

  const colorMap = createMemo(() =>
    buildRepoColorMap(props.terminalIds, props.getMeta),
  );

  function colorFor(
    meta: Omit<TerminalInfo, "id"> | undefined,
  ): string | undefined {
    const key = terminalName(meta);
    return key ? colorMap().get(key) : undefined;
  }

  let gridRef!: HTMLDivElement;

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onMcModeChange({ mode: "closed" });
  }

  // On open: auto-focus the right card.
  createEffect(
    on(isOpen, (open) => {
      if (!open) return;
      // setTimeout runs after Corvu Dialog processes the open transition
      setTimeout(() => {
        const cards = gridRef?.querySelectorAll<HTMLElement>(
          "[data-testid='mission-control-card']",
        );
        if (!cards?.length) return;

        const mc = props.mcMode;
        if (mc.mode === "quickSwitch" && cards.length > 1) {
          // Advance by one in the requested direction (like OS Alt+Tab)
          const target = mc.direction === -1 ? cards.length - 1 : 1;
          cards[target]!.focus();
        } else {
          const activeCard =
            gridRef?.querySelector<HTMLElement>("[data-active]");
          (activeCard ?? cards[0])?.focus();
        }
      });
    }),
  );

  // Keyboard listeners — reactively owned: only installed while MC is open.
  // SolidJS auto-disposes them when isOpen() becomes false.
  createEffect(() => {
    if (!isOpen()) return;

    // Quick-switch: releasing the modifier key (Ctrl or Alt) selects the focused card
    makeEventListener(window, "keyup", (e: KeyboardEvent) => {
      if (!isQuickSwitch()) return;
      if (e.key === "Control" || e.key === "Alt") {
        const focused = document.activeElement as HTMLElement;
        const id = focused?.getAttribute("data-terminal-id") as TerminalId;
        if (id) handleSelect(id);
      }
    });

    // Keyboard navigation: Tab, number keys (1-9), arrow keys, Mod+. to close.
    // Capture phase to intercept Tab before Corvu Dialog's focus trap.
    makeEventListener(
      window,
      "keydown",
      (e: KeyboardEvent) => {
        // Mod+. closes Mission Control (useShortcuts' listener is gone while MC is open)
        if (matchesKeybind(e, SHORTCUTS.missionControl.keybind)) {
          e.preventDefault();
          e.stopPropagation();
          props.onMcModeChange({ mode: "closed" });
          return;
        }

        // Number keys 1-9 switch directly
        const digit = parseInt(e.key);
        if (digit >= 1 && digit <= 9) {
          const id = displayIds()[digit - 1];
          if (id) {
            e.preventDefault();
            e.stopPropagation();
            handleSelect(id);
          }
          return;
        }

        // Tab, Shift+Tab, and arrow keys navigate the grid
        const cards = gridRef?.querySelectorAll<HTMLElement>(
          "[data-testid='mission-control-card']",
        );
        if (!cards?.length) return;
        const focused = document.activeElement as HTMLElement;
        const idx = Array.from(cards).indexOf(focused);
        // If focus isn't on a card (e.g. Corvu sentinel), redirect to first card
        const currentIdx = idx === -1 ? 0 : idx;

        const cols = gridCols();
        let next = currentIdx;
        switch (e.key) {
          case "Tab":
            // Override Corvu's focus trap — wrap Tab/Shift+Tab within cards
            next = e.shiftKey
              ? (currentIdx - 1 + cards.length) % cards.length
              : (currentIdx + 1) % cards.length;
            break;
          case "ArrowRight":
            next = Math.min(currentIdx + 1, cards.length - 1);
            break;
          case "ArrowLeft":
            next = Math.max(currentIdx - 1, 0);
            break;
          case "ArrowDown":
            next = Math.min(currentIdx + cols, cards.length - 1);
            break;
          case "ArrowUp":
            next = Math.max(currentIdx - cols, 0);
            break;
          default:
            return;
        }
        if (next !== currentIdx || idx === -1) {
          e.preventDefault();
          e.stopPropagation();
          cards[next]!.focus();
        }
      },
      { capture: true },
    );
  });

  return (
    <ModalDialog
      open={isOpen()}
      onOpenChange={(open) => {
        if (!open) props.onMcModeChange({ mode: "closed" });
      }}
      trapFocus={false}
    >
      <Dialog.Content
        data-testid="mission-control"
        class="w-[90vw] max-w-5xl h-[80vh] bg-surface-2 border border-edge-bright rounded-lg shadow-2xl overflow-hidden p-4 flex flex-col"
      >
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-fg">Mission Control</h2>
          <span class="text-fg-3 text-xs">Esc to close</span>
        </div>
        <Show
          when={displayIds().length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center text-fg-3 text-sm">
              No terminals open
            </div>
          }
        >
          <div
            ref={gridRef}
            class="grid gap-3 flex-1 min-h-0 p-1"
            style={{
              "grid-template-columns": `repeat(${gridCols()}, minmax(0, 1fr))`,
              "grid-auto-rows": "minmax(0, 1fr)",
            }}
          >
            <For each={displayIds()}>
              {(id, index) => {
                const meta = () => props.getMeta(id);
                const isActive = () => props.activeId === id;
                const num = () => index() + 1;
                return (
                  <button
                    data-testid="mission-control-card"
                    data-terminal-id={id}
                    data-active={isActive() ? "" : undefined}
                    class="group min-h-0 min-w-0 w-full h-full cursor-pointer focus-visible:outline-none text-left"
                    onClick={() => handleSelect(id)}
                  >
                    {/* Inner wrapper: square aspect ratio constrained by grid cell.
                        aspect-ratio on grid items overflows; on a nested element with
                        max-h/w-full it's constrained by the cell's definite dimensions. */}
                    <div class="relative flex flex-col aspect-square max-h-full max-w-full w-full bg-surface-0 border-2 border-edge rounded-lg overflow-hidden transition-all hover:border-accent/60 group-focus-visible:border-accent group-focus-visible:ring-4 group-focus-visible:ring-accent/40">
                      {/* Number badge — press this digit to switch */}
                      <Show when={num() <= 9}>
                        <span
                          data-testid="card-number"
                          class="absolute top-1.5 left-1.5 z-10 w-5 h-5 flex items-center justify-center text-[0.6rem] font-bold rounded bg-surface-0/80 text-fg-2 border border-edge"
                        >
                          {num()}
                        </span>
                      </Show>
                      {/* Terminal preview — takes most of the card */}
                      <Show when={isOpen()}>
                        <div class="flex-1 min-h-0 w-full">
                          <TerminalPreview
                            terminalId={id}
                            theme={props.getTerminalTheme(id)}
                          />
                        </div>
                      </Show>
                      {/* Metadata footer — fixed height so cards align when PR info varies */}
                      <div class="px-3 py-2 bg-surface-1 border-t border-edge space-y-0.5 h-24 shrink-0">
                        <div
                          class="text-base font-semibold truncate"
                          style={{ color: colorFor(meta()) }}
                        >
                          {terminalName(meta()) ?? "terminal"}
                        </div>
                        <Show when={meta()?.meta?.git}>
                          {(git) => (
                            <div class="text-sm text-fg-2 truncate">
                              {git().branch}
                            </div>
                          )}
                        </Show>
                        <Show when={meta()?.meta?.pr}>
                          {(pr) => (
                            <div class="flex items-center gap-1.5 text-sm text-fg-3 truncate">
                              <Show when={pr().checks}>
                                {(checks) => (
                                  <ChecksIndicator status={checks()} />
                                )}
                              </Show>
                              <span class="shrink-0">#{pr().number}</span>
                              <span class="truncate">{pr().title}</span>
                            </div>
                          )}
                        </Show>
                        <Show when={props.getActivityHistory(id).length > 0}>
                          <ActivityGraph
                            samples={props.getActivityHistory(id)}
                          />
                        </Show>
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default MissionControl;
