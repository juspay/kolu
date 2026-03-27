/**
 * Mission Control — bird's eye view grid of all main terminals.
 *
 * Shows miniature live terminal previews alongside repo/PR/activity metadata.
 * Click a card or press its number (1-9) to switch and dismiss the overlay.
 */

import { type Component, For, Show, createMemo } from "solid-js";
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
  const gridCols = createMemo(() => {
    const count = props.terminalIds.length;
    if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-2 sm:grid-cols-3";
    return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
  });

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onOpenChange(false);
  }

  // Number keys 1-9 switch to that terminal while Mission Control is open
  makeEventListener(window, "keydown", (e: KeyboardEvent) => {
    if (!props.open) return;
    const digit = parseInt(e.key);
    if (digit >= 1 && digit <= 9) {
      const id = props.terminalIds[digit - 1];
      if (id) {
        e.preventDefault();
        e.stopPropagation();
        handleSelect(id);
      }
    }
  });

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        data-testid="mission-control"
        class="w-[90vw] max-w-6xl max-h-[80vh] bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-y-auto p-4"
      >
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-fg">Mission Control</h2>
          <button
            class="text-fg-3 hover:text-fg text-xs transition-colors cursor-pointer"
            onClick={() => props.onOpenChange(false)}
          >
            Esc to close
          </button>
        </div>
        <Show
          when={props.terminalIds.length > 0}
          fallback={
            <div class="text-fg-3 text-sm text-center py-8">
              No terminals open
            </div>
          }
        >
          <div class={`grid gap-3 ${gridCols()}`}>
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
                    class="relative flex flex-col bg-surface-0 border rounded-lg overflow-hidden transition-all cursor-pointer text-left hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 aspect-square"
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
                    {/* Terminal preview — fills most of the square card */}
                    <Show when={props.open}>
                      <div class="flex-1 min-h-0 w-full">
                        <TerminalPreview
                          terminalId={id}
                          theme={props.getTerminalTheme(id)}
                        />
                      </div>
                    </Show>
                    {/* Metadata footer */}
                    <div class="px-2.5 py-2 bg-surface-1 border-t border-edge space-y-0.5">
                      <div class="flex items-center gap-1.5 truncate">
                        <span class="text-sm font-semibold text-fg truncate">
                          {meta()?.meta?.git?.repoName ??
                            (cwdBasename(meta()?.meta?.cwd ?? "") ||
                              "terminal")}
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
