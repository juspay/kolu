/** Header — minimal app bar.
 *
 *  Per #622, the workspace is mode-less and per-tile chrome carries the
 *  per-terminal controls (theme, agent status, search, split). The header
 *  retains only app-global affordances: identity, inspector toggle, settings,
 *  command palette, and connection status. */

import { type Component, createSignal, mergeProps } from "solid-js";
import { SettingsIcon } from "./ui/Icons";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";
import SettingsPopover from "./settings/SettingsPopover";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";

/** WS connection status indicator colors. */
const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** Inspector toggle icon — square with a divider on the right edge. */
const InspectorToggleIcon: Component<{ active: boolean }> = (props) => (
  <svg
    class="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    stroke-width="2"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
    {props.active ? <rect x="15" y="3" width="6" height="18" rx="0" /> : null}
  </svg>
);

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  appTitle?: string;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const rightPanel = useRightPanel();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <header class="flex items-center h-10 shrink-0 bg-surface-1 border-b border-edge">
      {/* Identity */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        <span class="font-semibold text-sm hidden sm:inline">
          {props.appTitle ?? "kolu"}
        </span>
      </div>

      <div class="flex-1 min-w-0" />

      {/* Inspector toggle → Settings → ⌘K → Connection dot */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        <Tip
          label={`Toggle inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
        >
          <button
            data-testid="inspector-toggle"
            class="hidden sm:flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              "bg-surface-2 text-fg": !rightPanel.collapsed(),
              "text-fg-3 hover:bg-surface-2 hover:text-fg":
                rightPanel.collapsed(),
            }}
            data-active={!rightPanel.collapsed() ? "" : undefined}
            onClick={() => rightPanel.togglePanel()}
            aria-label="Toggle inspector"
          >
            <InspectorToggleIcon active={!rightPanel.collapsed()} />
          </button>
        </Tip>
        <div>
          <Tip label="Settings">
            <button
              ref={settingsTriggerRef}
              data-testid="settings-trigger"
              class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => setSettingsOpen(!settingsOpen())}
            >
              <SettingsIcon />
            </button>
          </Tip>
          <SettingsPopover
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
            triggerRef={settingsTriggerRef}
          />
        </div>
        <Tip label="Command palette">
          <button
            data-testid="palette-trigger"
            class="h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette?.()}
          >
            <Kbd>{formatKeybind(SHORTCUTS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
        <Tip label="Connection status">
          <div class="flex items-center gap-1.5" data-ws-status={props.status}>
            <span
              class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
            />
          </div>
        </Tip>
      </div>
    </header>
  );
};

export default Header;
