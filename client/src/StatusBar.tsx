/** StatusBar — footer bar with connection status, theme name, and panel toggle icons.
 *  Desktop only — mobile uses MobileKeyBar + header burger. */

import { type Component, Show } from "solid-js";
import { createMediaQuery } from "@solid-primitives/media";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Tip from "./Tip";
import type { WsStatus } from "./rpc";

/** WS connection status indicator colors. */
const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const StatusBar: Component<{
  status: WsStatus;
  themeName?: string;
  onThemeClick?: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasSubPanel: boolean;
  subPanelExpanded: boolean;
  onToggleSubPanel: () => void;
  rightPanelCollapsed: boolean;
  onToggleRightPanel: () => void;
}> = (props) => {
  const isDesktop = createMediaQuery("(min-width: 640px)");

  return (
    <Show when={isDesktop()}>
      <div
        data-testid="status-bar"
        class="flex items-center h-6 shrink-0 bg-surface-1 border-t border-edge text-[10px] text-fg-3 px-2"
      >
        {/* Left: connection + theme */}
        <div class="flex items-center gap-2">
          <Tip label="Connection status">
            <span
              class={`inline-block w-1.5 h-1.5 rounded-full ${statusStyles[props.status]}`}
              data-ws-status={props.status}
            />
          </Tip>
          <Show when={props.themeName}>
            {(name) => (
              <button
                data-testid="theme-name"
                class="text-fg-3 hover:text-fg transition-colors cursor-pointer truncate max-w-[16ch]"
                onClick={props.onThemeClick}
                title={`Theme: ${name()}`}
              >
                {name()}
              </button>
            )}
          </Show>
        </div>

        <div class="flex-1" />

        {/* Right: panel toggles */}
        <div class="flex items-center gap-0.5">
          <Tip
            label={`Toggle sidebar (${formatKeybind(SHORTCUTS.commandPalette.keybind)})`}
          >
            <button
              data-testid="statusbar-sidebar-toggle"
              class="flex items-center justify-center w-6 h-5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
              classList={{ "text-fg-2": props.sidebarOpen }}
              onClick={props.onToggleSidebar}
              aria-label="Toggle sidebar"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </Tip>

          <Tip
            label={`Toggle split (${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)})`}
          >
            <button
              class="flex items-center justify-center w-6 h-5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
              classList={{
                "text-fg-2": props.hasSubPanel && props.subPanelExpanded,
              }}
              onClick={props.onToggleSubPanel}
              aria-label="Toggle terminal split"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="15" x2="21" y2="15" />
              </svg>
            </button>
          </Tip>

          <Tip
            label={`Toggle inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
          >
            <button
              class="flex items-center justify-center w-6 h-5 rounded hover:bg-surface-2 hover:text-fg transition-colors cursor-pointer"
              classList={{ "text-fg-2": !props.rightPanelCollapsed }}
              onClick={props.onToggleRightPanel}
              aria-label="Toggle inspector panel"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          </Tip>
        </div>
      </div>
    </Show>
  );
};

export default StatusBar;
