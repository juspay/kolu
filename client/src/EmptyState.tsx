/** Empty state — shown when no terminals exist. Offers session restore + key shortcuts. */

import { type Component, For, Show } from "solid-js";
import type { SavedSession } from "kolu-common";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Kbd from "./Kbd";

const features = [
  { label: "New terminal", shortcut: SHORTCUTS.createTerminalAlt.keybind },
  { label: "Command palette", shortcut: SHORTCUTS.commandPalette.keybind },
  { label: "Cycle terminals", shortcut: SHORTCUTS.cycleTerminalMru.keybind },
  { label: "Split view", shortcut: SHORTCUTS.toggleSubPanel.keybind },
];

interface EmptyStateProps {
  savedSession?: SavedSession;
  onRestore?: () => void;
}

const EmptyState: Component<EmptyStateProps> = (props) => (
  <div
    data-testid="empty-state"
    class="flex items-center justify-center h-full"
  >
    <div class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/40 p-5 max-w-xs w-full">
      <Show when={props.savedSession}>
        {(session) => {
          const topLevel = () => session().terminals.filter((t) => !t.parentId);
          const subCount = () =>
            session().terminals.filter((t) => t.parentId).length;
          return (
            <div
              data-testid="session-restore"
              class="mb-4 pb-4 border-b border-edge"
            >
              <p class="text-fg-2 text-sm mb-2">Restore previous session</p>
              <div class="space-y-1 mb-3">
                <For each={topLevel()}>
                  {(t) => (
                    <div class="text-xs text-fg-3 truncate" title={t.cwd}>
                      <Show when={t.repoName} fallback={t.cwd}>
                        {t.repoName}
                        <Show when={t.branch}>
                          <span class="ml-1 text-fg-3/50">{t.branch}</span>
                        </Show>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={subCount() > 0}>
                  <div class="text-xs text-fg-3/50">
                    +{subCount()} split{subCount() > 1 ? "s" : ""}
                  </div>
                </Show>
              </div>
              <button
                data-testid="restore-session"
                class="w-full px-3 py-1.5 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
                onClick={() => props.onRestore?.()}
              >
                Restore {session().terminals.length} terminal
                {session().terminals.length > 1 ? "s" : ""}
              </button>
            </div>
          );
        }}
      </Show>
      <p class="text-fg-2 text-sm mb-3">Get started</p>
      <div class="space-y-2">
        <For each={features}>
          {(f) => (
            <div class="flex items-center justify-between text-sm">
              <span class="text-fg-3">{f.label}</span>
              <Kbd>{formatKeybind(f.shortcut)}</Kbd>
            </div>
          )}
        </For>
      </div>
    </div>
  </div>
);

export default EmptyState;
