/** ChromeBar — the always-visible workspace chrome band.
 *
 *  Replaces the pre-#622 global Header. Carries app identity (logo +
 *  connection dot) on the left, the pill tree in the middle, and the
 *  global control cluster (inspector toggle, settings, command palette)
 *  on the right.
 *
 *  Two positioning modes, switched on `canvasMaximized`:
 *  - Canvas mode (default): absolute overlay above the canvas. Pure
 *    transparent so the grid reads through and the chrome looks like
 *    it floats ON the canvas, not capping it.
 *  - Maximized mode: docked in flex flow so the maximized terminal
 *    owns the rest of the viewport without the terminal's own title
 *    bar overlapping the chrome.
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
import { useTerminalStore } from "./terminal/useTerminalStore";
import type { PillRepoGroup } from "./canvas/pillTreeOrder";
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
  /** Grouped pill tree to render in the middle. Caller owns grouping
   *  (so the same groups feed mobile-swipe order in App.tsx). */
  groups: PillRepoGroup[];
  /** Click handler for a pill — caller decides whether to pan, swap
   *  active terminal, etc. */
  onSelectPill: (id: TerminalId) => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const store = useTerminalStore();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <div
      data-testid="chrome-bar"
      data-maximized={store.canvasMaximized() ? "" : undefined}
      class="flex items-center gap-3 px-3 py-2 select-none"
      classList={{
        // Canvas mode: absolute overlay, transparent — grid shows
        // through. z-50 stays above the maximized tile (z-40) should
        // the mode flip mid-render.
        "absolute top-0 left-0 right-0 z-50": !store.canvasMaximized(),
        // Maximized: docked flex-col child of the app root. Takes a
        // real row at the top so the terminal below starts BELOW the
        // chrome, not behind it — prevents the terminal's own title
        // bar from colliding with the chrome contents.
        "relative shrink-0": store.canvasMaximized(),
      }}
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
        <PillTree groups={props.groups} onSelect={props.onSelectPill} />
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
