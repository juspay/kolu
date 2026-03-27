/** Empty state — shown when no terminals exist. Highlights key features. */

import { type Component, For, Show } from "solid-js";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Kbd from "./Kbd";

const isPWA = window.matchMedia("(display-mode: standalone)").matches;

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
              <Kbd>{formatKeybind(f.shortcut)}</Kbd>
            </div>
          )}
        </For>
      </div>
      <Show when={!isPWA}>
        <p class="mt-4 pt-3 border-t border-edge text-xs text-fg-3">
          💡 Install as PWA for full shortcut support (<Kbd>⌘T</Kbd>,{" "}
          <Kbd>⌃Tab</Kbd>, etc.)
        </p>
      </Show>
    </div>
  </div>
);

export default EmptyState;
