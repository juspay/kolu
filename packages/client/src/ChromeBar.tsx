/** ChromeBar — the always-visible workspace chrome band, overlaid on the canvas.
 *
 *  Replaces the pre-#622 global Header. Carries app identity (logo +
 *  connection dot) on the left, the pill tree in the middle, and the
 *  global control cluster (inspector toggle, settings, command palette)
 *  on the right. Floats above the canvas with a frosted backdrop so the
 *  grid (and any tile that drifts under it) shows through faintly —
 *  reinforces "the canvas extends past the chrome" rather than "chrome
 *  caps the canvas."
 *
 *  Mobile uses a different chrome surface — a pull-down sheet — see
 *  `MobileChromeSheet` and `MobileTileView`. */

import { type Component, createSignal } from "solid-js";
import { SettingsIcon, InspectorToggleIcon } from "./ui/Icons";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";
import SettingsPopover from "./settings/SettingsPopover";
import { useRightPanel } from "./right-panel/useRightPanel";
import PillTree from "./canvas/PillTree";
import type { PillRepoGroup } from "./canvas/pillTreeOrder";
import type { TileTheme } from "./canvas/tileChrome";
import type { TerminalDisplayInfo } from "./terminal/terminalDisplay";
import type { TerminalId } from "kolu-common";
import type { WsStatus } from "./rpc/rpc";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const ChromeBar: Component<{
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
  /** Pill tree props passthrough. The tree lives inside the chrome band
   *  so identity / controls / nav share one docked surface. */
  groups: PillRepoGroup[];
  activeId: TerminalId | null;
  canvasMaximized: boolean;
  onExitMaximize: () => void;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  getTileTheme: (id: TerminalId) => TileTheme;
  isUnread: (id: TerminalId) => boolean;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <div
      data-testid="chrome-bar"
      // Absolute overlay above the canvas: the canvas region beneath
      // takes the full app height so tiles, grid lines, and even a
      // maximized tile (z-40 inside canvas) read through. Fully
      // transparent — no bg, no blur — so the canvas grid is the
      // visible surface behind the chrome. z-50 keeps the chrome above
      // the maximized tile so the user can always switch terminals or
      // exit maximize without dismissing first.
      class="absolute top-0 left-0 right-0 z-50 flex items-center gap-3 px-3 py-2 select-none"
    >
      {/* Identity: logo + app name + connection dot */}
      <div class="flex items-center gap-2 shrink-0">
        <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        <span class="font-semibold text-sm hidden sm:inline">
          {props.appTitle}
        </span>
        <Tip label="Connection status">
          <span
            data-ws-status={props.status}
            class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
          />
        </Tip>
      </div>

      {/* Pill tree — fills the middle, wraps as needed */}
      <div class="flex-1 min-w-0 flex justify-center">
        <PillTree
          groups={props.groups}
          activeId={props.activeId}
          canvasMaximized={props.canvasMaximized}
          onExitMaximize={props.onExitMaximize}
          getDisplayInfo={props.getDisplayInfo}
          getTileTheme={props.getTileTheme}
          isUnread={props.isUnread}
          onSelect={props.onSelect}
        />
      </div>

      {/* Control cluster: inspector → settings → ⌘K */}
      <div class="flex items-center gap-2 shrink-0">
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
            onClick={() => props.onOpenPalette()}
          >
            <Kbd>{formatKeybind(SHORTCUTS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
      </div>
    </div>
  );
};

export default ChromeBar;
