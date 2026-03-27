/** Empty state — shown when no terminals exist. Highlights key features. */

import { type Component, For } from "solid-js";
import { SHORTCUTS, formatKeybind } from "./keyboard";

const features = [
  { label: "New terminal", shortcut: SHORTCUTS.createTerminalAlt.keybind },
  { label: "Command palette", shortcut: SHORTCUTS.commandPalette.keybind },
  { label: "Mission Control", shortcut: SHORTCUTS.missionControl.keybind },
  { label: "Split view", shortcut: SHORTCUTS.toggleSubPanel.keybind },
];

const EmptyState: Component = () => (
  <div
    data-testid="empty-state"
    class="flex items-center justify-center h-full"
  >
    <div class="bg-surface-1 border border-edge-bright rounded-lg p-5 max-w-xs w-full">
      <p class="text-fg-2 text-sm mb-3">Get started</p>
      <div class="space-y-2">
        <For each={features}>
          {(f) => (
            <div class="flex items-center justify-between text-sm">
              <span class="text-fg-3">{f.label}</span>
              <kbd class="text-xs text-fg-3 font-mono bg-surface-2 px-1.5 py-0.5 rounded border border-edge shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]">
                {formatKeybind(f.shortcut)}
              </kbd>
            </div>
          )}
        </For>
      </div>
    </div>
  </div>
);

export default EmptyState;
