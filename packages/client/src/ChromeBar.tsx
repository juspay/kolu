/** ChromeBar — the always-visible workspace chrome band.
 *
 *  Replaces the pre-#622 global Header. Carries app identity (logo +
 *  connection dot) on the left, the workspace switcher in the middle,
 *  and the global control cluster (settings, command palette) on the
 *  right.
 *
 *  Two positioning modes, switched on `canvasMaximized`:
 *  - Canvas mode (default): absolute overlay above the canvas. Pure
 *    transparent so the grid reads through and the chrome looks like
 *    it floats ON the canvas, not capping it. The chrome spans the
 *    full viewport width — the prior right-panel dock no longer exists,
 *    so there is no per-anchor inset to compute.
 *  - Maximized mode: docked in flex flow so the maximized terminal
 *    owns the rest of the viewport without the terminal's own title
 *    bar overlapping the chrome.
 *
 *  Mobile uses a different chrome surface — a pull-down sheet — see
 *  `MobileChromeSheet` and `MobileTileView`. */

import { type Component, createSignal, type JSX } from "solid-js";
import { useViewPosture } from "./canvas/useViewPosture";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import RecordButton from "./recorder/RecordButton";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { SettingsIcon } from "./ui/Icons";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";

const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const ChromeBar: Component<{
  status: WsStatus;
  onOpenPalette: () => void;
  /** Workspace switcher slot — caller composes the live-terminal navigator.
   *  ChromeBar is a layout host (logo + switcher + controls); it doesn't need
   *  to know the switcher's prop shape, just where to drop it. */
  workspaceSwitcher: JSX.Element;
}> = (props) => {
  const posture = useViewPosture();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  // Dock only when the terminal is maximized, so its own title bar
  // doesn't collide with the chrome. Otherwise the chrome floats over
  // the canvas full-width — the prior right-panel inset is gone with
  // the panel itself.
  const docked = () => posture.maximized();

  return (
    <header
      data-testid="chrome-bar"
      data-maximized={posture.maximized() ? "" : undefined}
      // pointer-events-none on the root so the transparent gaps don't
      // eat clicks meant for the canvas under the overlay. Interactive
      // children (identity row, workspace switcher, control cluster) re-enable
      // pointer events on themselves.
      class="chrome-bar-surface flex items-center gap-3 px-3 py-2 select-none pointer-events-none transition-colors duration-150"
      // z-50 in BOTH modes. Without it on the docked branch, the
      // `backdrop-filter` we apply to the bar when the workspace
      // switcher is open creates a stacking context with auto z-index,
      // which traps the dropdown panel's own z-50 inside the bar — the
      // maximized tile (z-40 in the canvas) then paints on top of the
      // panel at the App root's auto-z layer (DOM order wins).
      classList={{
        "absolute top-0 left-0 right-0 z-50": !docked(),
        "relative shrink-0 z-50": docked(),
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

      {/* Workspace switcher — fills the middle, wraps as needed.
       *  pointer-events-none here so the empty middle space (no pills,
       *  or padding around them) lets clicks pass through to the right
       *  panel / canvas underneath; the switcher's own outer wrapper
       *  re-enables pointer events on the actual pill elements. */}
      <div class="flex-1 min-w-0 flex justify-center pointer-events-none">
        {props.workspaceSwitcher}
      </div>

      {/* Control cluster: settings → ⌘K. Cluster wrapper
       *  itself stays pointer-events-none so the gap-2 spaces pass
       *  clicks through; each button re-enables pointer-events-auto. */}
      <div class="flex items-center gap-2 shrink-0">
        <RecordButton />
        <div class="pointer-events-auto">
          <Tip label="Settings">
            <button
              type="button"
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
            type="button"
            data-testid="palette-trigger"
            class="pointer-events-auto h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette()}
          >
            <Kbd>{formatKeybind(ACTIONS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
      </div>
    </header>
  );
};

export default ChromeBar;
