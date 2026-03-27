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
import { cwdBasename } from "./path";
import type { TerminalId, TerminalInfo } from "kolu-common";
import type { ActivitySample } from "./useTerminals";
import type { ITheme } from "@xterm/xterm";

/** Derive a human-readable label for a terminal card: repo name > cwd basename > fallback. */
function cardLabel(meta: Omit<TerminalInfo, "id"> | undefined): string {
  return (
    meta?.meta?.git?.repoName ||
    cwdBasename(meta?.meta?.cwd ?? "") ||
    "terminal"
  );
}

const MissionControl: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMeta: (id: TerminalId) => Omit<TerminalInfo, "id"> | undefined;
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  getTerminalTheme: (id: TerminalId) => ITheme;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  /** Pick column count so all cards fit on screen without scrolling. */
  const gridCols = createMemo(() => {
    const count = props.terminalIds.length;
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    return 4;
  });

  let gridRef!: HTMLDivElement;

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onOpenChange(false);
  }

  // Auto-focus the active terminal's card when Mission Control opens
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        // setTimeout runs after Corvu Dialog's focus trap sets initial focus
        setTimeout(() => {
          const activeCard =
            gridRef?.querySelector<HTMLElement>("[data-active]");
          (
            activeCard ?? gridRef?.querySelector<HTMLElement>("button")
          )?.focus();
        });
      },
    ),
  );

  // Keyboard navigation: number keys (1-9), arrow keys for grid movement
  makeEventListener(window, "keydown", (e: KeyboardEvent) => {
    if (!props.open) return;

    // Number keys 1-9 switch directly
    const digit = parseInt(e.key);
    if (digit >= 1 && digit <= 9) {
      const id = props.terminalIds[digit - 1];
      if (id) {
        e.preventDefault();
        e.stopPropagation();
        handleSelect(id);
      }
      return;
    }

    // Arrow keys navigate the grid
    const cards = gridRef?.querySelectorAll<HTMLElement>(
      "[data-testid='mission-control-card']",
    );
    if (!cards?.length) return;
    const focused = document.activeElement as HTMLElement;
    const idx = Array.from(cards).indexOf(focused);
    if (idx === -1) return;

    const cols = gridCols();
    let next = idx;
    switch (e.key) {
      case "ArrowRight":
        next = Math.min(idx + 1, cards.length - 1);
        break;
      case "ArrowLeft":
        next = Math.max(idx - 1, 0);
        break;
      case "ArrowDown":
        next = Math.min(idx + cols, cards.length - 1);
        break;
      case "ArrowUp":
        next = Math.max(idx - cols, 0);
        break;
      default:
        return;
    }
    if (next !== idx) {
      e.preventDefault();
      cards[next]!.focus();
    }
  });

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        data-testid="mission-control"
        class="w-[90vw] max-w-6xl h-[80vh] bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden p-4 flex flex-col"
      >
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-fg">Mission Control</h2>
          <span class="text-fg-3 text-xs">Esc to close</span>
        </div>
        <Show
          when={props.terminalIds.length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center text-fg-3 text-sm">
              No terminals open
            </div>
          }
        >
          <div
            ref={gridRef}
            class="grid gap-3 flex-1 min-h-0"
            style={{
              "grid-template-columns": `repeat(${gridCols()}, minmax(0, 1fr))`,
              "grid-auto-rows": "1fr",
            }}
          >
            <For each={props.terminalIds}>
              {(id, index) => {
                const meta = () => props.getMeta(id);
                const isActive = () => props.activeId === id;
                const num = () => index() + 1;
                return (
                  <button
                    data-testid="mission-control-card"
                    data-terminal-id={id}
                    data-active={isActive() ? "" : undefined}
                    class="relative flex flex-col bg-surface-0 border rounded-lg overflow-hidden transition-all cursor-pointer text-left hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    classList={{
                      "border-accent": isActive(),
                      "border-edge": !isActive(),
                    }}
                    onClick={() => handleSelect(id)}
                  >
                    {/* Number badge — press this digit to switch */}
                    <Show when={num() <= 9}>
                      <span
                        data-testid="card-number"
                        class="absolute top-1.5 left-1.5 z-10 w-5 h-5 flex items-center justify-center text-[0.6rem] font-bold rounded bg-surface-0/80 text-fg-2 border border-edge"
                      >
                        {num()}
                      </span>
                    </Show>
                    {/* Terminal preview — fills available card height */}
                    <Show when={props.open}>
                      <div class="flex-1 min-h-0 w-full">
                        <TerminalPreview
                          terminalId={id}
                          theme={props.getTerminalTheme(id)}
                        />
                      </div>
                    </Show>
                    {/* Metadata footer — fixed height so cards align when PR info varies */}
                    <div class="px-2.5 py-2 bg-surface-1 border-t border-edge space-y-0.5 h-20 shrink-0">
                      <div class="flex items-center gap-1.5 truncate">
                        <span class="text-sm font-semibold text-fg truncate">
                          {cardLabel(meta())}
                        </span>
                        <Show when={isActive()}>
                          <span class="ml-auto text-[0.6rem] text-accent bg-accent/10 px-1 rounded shrink-0">
                            active
                          </span>
                        </Show>
                      </div>
                      <Show when={meta()?.meta?.git}>
                        {(git) => (
                          <div class="text-xs text-fg-3 truncate">
                            {git().branch}
                          </div>
                        )}
                      </Show>
                      <Show when={meta()?.meta?.pr}>
                        {(pr) => (
                          <div class="flex items-center gap-1 text-xs text-fg-3 truncate">
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
                        <ActivityGraph samples={props.getActivityHistory(id)} />
                      </Show>
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
