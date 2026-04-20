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

import { type Component, type JSX, createSignal } from "solid-js";
import { SettingsIcon, InspectorToggleIcon } from "./ui/Icons";
import { formatKeybind, SHORTCUTS } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";
import SettingsPopover from "./settings/SettingsPopover";
import RecordButton from "./recorder/RecordButton";
import { useRightPanel } from "./right-panel/useRightPanel";
import { useViewPosture } from "./canvas/useViewPosture";
import type { WsStatus } from "./rpc/rpc";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const ChromeBar: Component<{
  status: WsStatus;
  onOpenPalette: () => void;
  /** Pill tree slot — caller composes `<PillTree ... />`. ChromeBar
   *  is a layout host (logo + tree + controls); it doesn't need to
   *  know the tree's prop shape, just where to drop it. */
  pillTree: JSX.Element;
}> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  // Dock when either the maximized terminal or the open right panel
  // would otherwise be covered by the overlay. See positioning comment.
  const docked = () => posture.maximized() || !rightPanel.collapsed();

  return (
    <header
      data-testid="chrome-bar"
      data-maximized={posture.maximized() ? "" : undefined}
      // pointer-events-none on the root so the transparent gaps don't
      // eat clicks meant for the canvas under the overlay. Interactive
      // children (identity row, pill tree, control cluster) re-enable
      // pointer events on themselves.
      //
      // Two docking triggers, one positioning rule each:
      //  - canvasMaximized: dock so the maximized terminal's own title
      //    bar doesn't collide with the chrome.
      //  - right panel open: dock so the chrome's controls cluster
      //    doesn't sit on top of (and intercept clicks for) the right
      //    panel's tab bar (pin button, collapse button, tabs).
      //  Otherwise: absolute overlay so the canvas grid reads through
      //  the transparent chrome.
      class="flex items-center gap-3 px-3 py-2 select-none pointer-events-none"
      classList={{
        "absolute top-0 left-0 right-0 z-50": !docked(),
        "relative shrink-0": docked(),
      }}
    >
      {/* Identity: logo (→ kolu.dev) + connection dot. App name lives as
       *  a corner watermark on the canvas, not in the chrome. */}
      <div class="flex items-center gap-2 shrink-0 pointer-events-auto">
        <a
          href="https://kolu.dev"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center"
          aria-label="kolu.dev"
        >
          <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        </a>
        <Tip label="Connection status">
          <span
            data-ws-status={props.status}
            class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
          />
        </Tip>
      </div>

      {/* Pill tree — fills the middle, wraps as needed.
       *  pointer-events-none here so the empty middle space (no pills,
       *  or padding around them) lets clicks pass through to the right
       *  panel / canvas underneath; PillTree's own outer wrapper
       *  re-enables pointer events on the actual pill elements. */}
      <div class="flex-1 min-w-0 flex justify-center pointer-events-none">
        {props.pillTree}
      </div>

      {/* Control cluster: inspector → settings → ⌘K. Cluster wrapper
       *  itself stays pointer-events-none so the gap-2 spaces and any
       *  area covered when the cluster overlaps the right panel pass
       *  clicks through; each button re-enables pointer-events-auto. */}
      <div class="flex items-center gap-2 shrink-0">
        <RecordButton />
        <Tip
          label={`Toggle inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
        >
          <button
            data-testid="inspector-toggle"
            class="pointer-events-auto hidden sm:flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
        <div class="pointer-events-auto">
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
            class="pointer-events-auto h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette()}
          >
            <Kbd>{formatKeybind(SHORTCUTS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
      </div>
    </header>
  );
};

export default ChromeBar;
